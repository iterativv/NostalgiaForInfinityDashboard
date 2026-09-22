// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { createContext, useContext, useEffect } from "react";
import { Store } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";
import {
  CAPABILITY_REGISTRY,
  capabilityKey,
  decodeCapabilityResult,
  encodeStreamOptions,
  type CapabilityName,
  type CapabilityOptions,
  type CapabilityResult,
} from "@nfi/capabilities";
import { formatQueryError } from "@nfi/api-contract";
import { callCapability, capabilitiesGrantStore } from "./transport";
import {
  clearInstanceAuthFailure,
  noteInstanceAuthFailure,
} from "./credentialsFix";

/**
 * Real-time capability state — the ONLY live-data path in the frontend.
 *
 * There is deliberately NO polling here (`setInterval`/`refetchInterval` do
 * not exist in the web shell): `useCapability(name, options)` seeds first
 * paint with one unary `callCapability` and then renders snapshots pushed by
 * the backend over SSE (`GET /api/stream`), stored in the `liveStore`
 * TanStack Store below. The only interval in the system ticks between the
 * backend and freqtrade (`LivePollerLive`); browsers only receive pushes.
 *
 * All live widgets share ONE multiplexed `EventSource`: the server accepts
 * repeated `capability`/`options` pairs per connection, so dense terminal
 * pages (many visible widgets) hold a single connection instead of one per
 * widget — the browser caps connections per host (~6 on HTTP/1.1), and one
 * connection per widget starved unary fetches. When the subscription set
 * changes, the pool reopens the connection (debounced) with the new set.
 *
 * Non-streamable capabilities (mutations, static config) fetch once and never
 * open a stream. Availability is gated on the capability id itself (the auth
 * model is one function per id): revoked ids render the unauthorized error
 * instead of opening a connection.
 */

export interface LiveResult<T> {
  readonly data: T | undefined;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly updatedAt: string | null;
}

interface StoredLive {
  readonly data: unknown;
  readonly error: string | null;
  readonly isLoading: boolean;
  readonly updatedAt: string | null;
}

export const liveStore = new Store<Record<string, StoredLive>>({});

/**
 * Visibility for live subscriptions. Inactive tabs stay mounted but hidden
 * (see `TabGroup`) — their widgets fetch once over REST but must NOT hold an
 * SSE subscription: only visible panels stream; hidden ones re-fetch +
 * resubscribe when revealed.
 */
export const PanelVisibleContext = createContext<boolean>(true);

const setEntry = (key: string, entry: StoredLive): void => {
  liveStore.setState((state) => ({ ...state, [key]: entry }));
};

// --- Shared multiplexed SSE pool ---------------------------------------------

interface StreamMessage {
  readonly key: string;
  readonly result: unknown;
  readonly updatedAt: unknown;
}

interface PoolEntry {
  readonly name: CapabilityName;
  readonly encodedOptions: string;
  refcount: number;
  readonly listeners: Set<(message: StreamMessage) => void>;
  readonly errorListeners: Set<() => void>;
}

const REOPEN_DEBOUNCE_MS = 250;

class StreamPool {
  private readonly entries = new Map<string, PoolEntry>();
  private source: EventSource | null = null;
  private sourceGeneration = 0;
  private reopenTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Subscribe to one capability key (key + encoded options precomputed by the
   * caller via `capabilityKey` / `encodeStreamOptions`). Returns a release
   * function; the shared connection reopens (debounced) when the last
   * subscriber of any key joins or leaves.
   */
  subscribe(
    key: string,
    name: CapabilityName,
    encodedOptions: string,
    onMessage: (message: StreamMessage) => void,
    onError: () => void,
  ): () => void {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        name,
        encodedOptions,
        refcount: 0,
        listeners: new Set(),
        errorListeners: new Set(),
      };
      this.entries.set(key, entry);
    }
    entry.refcount += 1;
    entry.listeners.add(onMessage);
    entry.errorListeners.add(onError);
    this.scheduleReopen();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.entries.get(key);
      if (!current) return;
      current.listeners.delete(onMessage);
      current.errorListeners.delete(onError);
      current.refcount -= 1;
      if (current.refcount <= 0) this.entries.delete(key);
      this.scheduleReopen();
    };
  }

  private scheduleReopen(): void {
    if (typeof EventSource === "undefined") return;
    if (this.reopenTimer !== null) clearTimeout(this.reopenTimer);
    this.reopenTimer = setTimeout(() => {
      this.reopenTimer = null;
      this.reopen();
    }, REOPEN_DEBOUNCE_MS);
  }

  private reopen(): void {
    this.source?.close();
    this.source = null;
    this.sourceGeneration += 1;
    const generation = this.sourceGeneration;
    if (this.entries.size === 0) return;
    const params = new URLSearchParams();
    for (const entry of this.entries.values()) {
      params.append("capability", entry.name);
      params.append("options", entry.encodedOptions);
    }
    // withCredentials: the session cookie must reach the stream when the
    // backend lives on another origin (same-origin sends it anyway).
    const next = new EventSource(`/api/stream?${params.toString()}`, {
      withCredentials: true,
    });
    this.source = next;
    next.addEventListener("snapshot", (event) => {
      if (this.sourceGeneration !== generation) return;
      try {
        const message = JSON.parse(
          (event as MessageEvent).data as string,
        ) as StreamMessage;
        const entry = this.entries.get(message.key);
        if (!entry) return;
        for (const listener of entry.listeners) listener(message);
      } catch {
        // Malformed frame: keep the connection; the next snapshot re-decodes.
      }
    });
    next.onerror = () => {
      if (this.sourceGeneration !== generation) return;
      // EventSource reconnects on its own; keep stale data visible meanwhile.
      for (const entry of this.entries.values()) {
        for (const listener of entry.errorListeners) listener();
      }
    };
  }
}

const streamPool = new StreamPool();

// --- Active-key registry ------------------------------------------------------

interface ActiveKey {
  readonly name: CapabilityName;
  readonly options: CapabilityOptions<CapabilityName>;
  refcount: number;
  /** Panels (widget instances) currently holding this key. */
  readonly owners: Set<string>;
}

/**
 * Every capability key a MOUNTED widget currently holds (hidden tabs stay
 * mounted — their one-shot entries count too). `useCapability` acquires on
 * effect start and releases on cleanup, so the registry is exactly the set
 * of widgets that would show stale data after a cross-cutting mutation.
 * Each entry also tracks which panel ids hold it, so a single widget can
 * reload just its own data (see `reloadOwnerCapabilities`).
 */
const activeKeys = new Map<string, ActiveKey>();

/**
 * Identifies the panel (widget instance) a `useCapability` call renders
 * into — the host `Panel` provides its panel id, so capability keys can be
 * re-fetch per widget. Null outside a hosted panel.
 */
export const LiveOwnerContext = createContext<string | null>(null);

function acquireActiveKey(
  key: string,
  name: CapabilityName,
  options: CapabilityOptions<CapabilityName>,
  owner: string | null,
): void {
  const existing = activeKeys.get(key);
  if (existing) {
    existing.refcount += 1;
    if (owner !== null) existing.owners.add(owner);
    return;
  }
  activeKeys.set(key, {
    name,
    options,
    refcount: 1,
    owners: owner !== null ? new Set([owner]) : new Set(),
  });
}

function releaseActiveKey(key: string, owner: string | null): void {
  const existing = activeKeys.get(key);
  if (!existing) return;
  existing.refcount -= 1;
  if (owner !== null) existing.owners.delete(owner);
  if (existing.refcount <= 0) activeKeys.delete(key);
}

/**
 * Re-fetch every capability held by one panel (the widget's ⋯ → Reload
 * action): publishes fresh data into the live store for exactly that
 * widget's keys. A failing fetch publishes its error entry and settles —
 * it never blocks the widget's remaining keys.
 */
export async function reloadOwnerCapabilities(ownerId: string): Promise<void> {
  const entries = [...activeKeys.values()].filter((entry) =>
    entry.owners.has(ownerId),
  );
  await Promise.allSettled(
    entries.map((entry) => refreshCapability(entry.name, entry.options)),
  );
}

/**
 * Re-fetch every capability a mounted widget holds, publishing fresh data
 * into the live store so streamed AND hidden-tab widgets converge
 * immediately — used after cross-cutting mutations (deleting a freqtrade
 * instance re-shapes every aggregate and orphans every per-instance key).
 * Keys whose fetch fails (e.g. keyed on the removed instance) publish
 * their error entry and settle: one dead key never blocks the rest.
 */
export async function refreshAllCapabilities(): Promise<void> {
  const entries = [...activeKeys.values()];
  await Promise.allSettled(
    entries.map((entry) => refreshCapability(entry.name, entry.options)),
  );
}

/**
 * One-shot refresh of a capability key (e.g. after a mutation): re-fetches
 * over REST and publishes into the store so SSE subscribers and mounted
 * widgets converge immediately instead of waiting for the next backend tick.
 */
export async function refreshCapability<N extends CapabilityName>(
  name: N,
  options: CapabilityOptions<N>,
): Promise<void> {
  const key = capabilityKey(name, options);
  try {
    const data = await callCapability(name, options);
    setEntry(key, {
      data,
      error: null,
      isLoading: false,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const current = liveStore.state[key];
    setEntry(key, {
      data: current?.data,
      error: formatQueryError(error) ?? "Refresh failed",
      isLoading: false,
      updatedAt: current?.updatedAt ?? null,
    });
    throw error;
  }
}

export interface UseCapabilityOptions {
  readonly enabled?: boolean;
  /**
   * Join the continuous SSE subscription after the initial fetch. Disable
   * for hidden panels (the shell does this automatically via
   * `PanelVisibleContext`): they still fetch once over REST, but they don't
   * hold a subscription slot. Defaults to true.
   */
  readonly stream?: boolean;
}

export function useCapability<N extends CapabilityName>(
  name: N,
  options: CapabilityOptions<N>,
  opts?: UseCapabilityOptions,
): LiveResult<CapabilityResult<N>> {
  const key = capabilityKey(name, options);
  const enabled = opts?.enabled ?? true;
  const wantStream = opts?.stream ?? true;
  const visible = useContext(PanelVisibleContext);
  const ownerId = useContext(LiveOwnerContext);
  const granted = useStore(capabilitiesGrantStore, (state) => state.granted);
  const allowed = granted.includes(name);
  const subscribed =
    enabled &&
    allowed &&
    wantStream &&
    visible &&
    CAPABILITY_REGISTRY[name].streamable;

  useEffect(() => {
    if (!enabled || !allowed) return;
    let cancelled = false;
    let release: (() => void) | null = null;
    // Register the live subscription so the refresh/reload helpers cover it.
    acquireActiveKey(
      key,
      name,
      options as CapabilityOptions<CapabilityName>,
      ownerId,
    );
    const previous = liveStore.state[key];
    setEntry(key, {
      data: previous?.data,
      error: null,
      isLoading: previous?.data === undefined,
      updatedAt: previous?.updatedAt ?? null,
    });
    const joinStream = (): void => {
      if (cancelled || !subscribed || release !== null) return;
      release = streamPool.subscribe(
        key,
        name,
        encodeStreamOptions(options),
        (message) => {
          try {
            const data = decodeCapabilityResult(name, message.result);
            if (cancelled) return;
            setEntry(key, {
              data,
              error: null,
              isLoading: false,
              updatedAt:
                typeof message.updatedAt === "string"
                  ? message.updatedAt
                  : new Date().toISOString(),
            });
          } catch (error) {
            if (cancelled) return;
            const current = liveStore.state[key];
            setEntry(key, {
              data: current?.data,
              error: formatQueryError(error) ?? "Stream update failed",
              isLoading: false,
              updatedAt: current?.updatedAt ?? null,
            });
          }
        },
        () => {
          if (cancelled) return;
          const current = liveStore.state[key];
          setEntry(key, {
            data: current?.data,
            error:
              current?.data === undefined
                ? "Live stream disconnected — retrying"
                : null,
            isLoading: false,
            updatedAt: current?.updatedAt ?? null,
          });
        },
      );
    };
    // Seed first paint over REST, then join the shared stream: opening the
    // persistent connection only after the short-lived fetch settles keeps
    // unary calls from queueing behind held SSE connections on HTTP/1.1.
    callCapability(name, options).then(
      (data) => {
        if (cancelled) return;
        clearInstanceAuthFailure(name, options);
        setEntry(key, {
          data,
          error: null,
          isLoading: false,
          updatedAt: new Date().toISOString(),
        });
        joinStream();
      },
      (error) => {
        if (cancelled) return;
        const current = liveStore.state[key];
        const formatted = formatQueryError(error) ?? "Capability call failed";
        noteInstanceAuthFailure(name, options, formatted);
        setEntry(key, {
          data: current?.data,
          error: formatted,
          isLoading: false,
          updatedAt: current?.updatedAt ?? null,
        });
        joinStream();
      },
    );
    return () => {
      cancelled = true;
      releaseActiveKey(key, ownerId);
      release?.();
    };
    // `key` is the canonical identity of (name, options); the closure values match it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, allowed, subscribed, ownerId]);

  const entry = useStore(liveStore, (state) => state[key]);
  if (!enabled) {
    return { data: undefined, error: null, isLoading: false, updatedAt: null };
  }
  if (!allowed) {
    return {
      data: undefined,
      error: `Not authorized — needs ${name}`,
      isLoading: false,
      updatedAt: null,
    };
  }
  return {
    data: entry?.data as CapabilityResult<N> | undefined,
    error: entry?.error ?? null,
    isLoading: entry?.isLoading ?? true,
    updatedAt: entry?.updatedAt ?? null,
  };
}
