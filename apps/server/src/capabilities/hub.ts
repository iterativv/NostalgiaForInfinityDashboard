// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { capabilityKey, type CapabilityName, type CapabilityOptions } from "@nfi/capabilities"

/**
 * LiveHub — the in-memory fan-out between freqtrade and SSE subscribers.
 *
 * The backend poller (`poller.ts`, the ONLY interval in the system) refreshes
 * tracked capability keys and calls `publish`; every `/api/stream`
 * subscriber holds a `subscribe` listener and gets the new snapshot pushed —
 * the frontend never polls. Plain TypeScript (no Effect) so the SSE stream
 * can bridge hub callbacks into `Stream.asyncScoped`.
 */

export interface HubSnapshot {
  readonly result: unknown
  readonly updatedAt: string
}

export interface TrackedKey {
  readonly key: string
  readonly name: CapabilityName
  readonly options: unknown
  readonly lastRefreshMs: number
  readonly subscribers: number
}

type Listener = (snapshot: HubSnapshot) => void

class LiveHub {
  private readonly snapshots = new Map<string, HubSnapshot>()
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly tracked = new Map<string, { name: CapabilityName; options: unknown; lastRefreshMs: number }>()
  /** SSE subscriber refcount per key — drives `release` pruning. */
  private readonly refs = new Map<string, number>()

  /** Ensure a capability+options is refreshed by the poller; returns its key. */
  track<N extends CapabilityName>(name: N, options: CapabilityOptions<N>): string
  track(name: CapabilityName, options: unknown): string
  track(name: CapabilityName, options: unknown): string {
    const key = `${name}:${stableKeyPart(options)}`
    if (!this.tracked.has(key)) {
      this.tracked.set(key, { name, options, lastRefreshMs: 0 })
    }
    return key
  }

  /**
   * Pin a key to an SSE subscriber. The LAST release removes the key (and
   * its cached snapshot) from the poller, so options-heavy keys (per pair,
   * per offset, …) cannot accumulate forever once nobody watches them. The
   * poller's own baseline keys are never retained and thus never pruned.
   */
  retain(key: string): void {
    this.refs.set(key, (this.refs.get(key) ?? 0) + 1)
  }

  release(key: string): void {
    // Only SSE-retained keys are release-managed: an unbalanced release
    // (no prior retain) must never prune a poller baseline key.
    if (!this.refs.has(key)) return
    const next = (this.refs.get(key) ?? 0) - 1
    if (next > 0) {
      this.refs.set(key, next)
      return
    }
    this.refs.delete(key)
    this.tracked.delete(key)
    this.snapshots.delete(key)
  }

  get(key: string): HubSnapshot | undefined {
    return this.snapshots.get(key)
  }

  publish(key: string, result: unknown): HubSnapshot {
    const snapshot: HubSnapshot = { result, updatedAt: new Date().toISOString() }
    this.snapshots.set(key, snapshot)
    const entry = this.tracked.get(key)
    if (entry) entry.lastRefreshMs = Date.now()
    this.listeners.get(key)?.forEach((listener) => listener(snapshot))
    return snapshot
  }

  subscribe(key: string, listener: Listener): () => void {
    let set = this.listeners.get(key)
    if (!set) {
      set = new Set()
      this.listeners.set(key, set)
    }
    set.add(listener)
    return () => {
      set?.delete(listener)
      if (set?.size === 0) this.listeners.delete(key)
    }
  }

  trackedKeys(): TrackedKey[] {
    return [...this.tracked.entries()].map(([key, entry]) => ({
      key,
      name: entry.name,
      options: entry.options,
      lastRefreshMs: entry.lastRefreshMs,
      subscribers: this.listeners.get(key)?.size ?? 0,
    }))
  }
}

const stableKeyPart = (value: unknown): string => {
  if (value === null || value === undefined) return "null"
  if (Array.isArray(value)) return `[${value.map(stableKeyPart).join(",")}]`
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableKeyPart(v)}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

export const keyFor = <N extends CapabilityName>(name: N, options: CapabilityOptions<N>): string =>
  capabilityKey(name, options)

export const liveHub = new LiveHub()
