// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useDerived, useLocalStore, useStore, useStoreEffect } from "@nfi/ui";

/**
 * Progressive mounting for bento pages.
 *
 * Every historical "add page froze the app" incident shared one shape: a
 * page's whole card set mounting in a single synchronous commit — every
 * widget's first render (charts, tables, live subscriptions) lands in ONE
 * long task whose length scales with widget count × live data volume, so
 * any sufficiently heavy page or slow machine reaches browser-unresponsive
 * territory. Patching individual effects moved the number around; the
 * class of bug survives as long as one commit can carry N heavy widgets.
 *
 * This bounds the class instead: the first `firstBatch` cards (the top of
 * the page) mount immediately; the rest mount `batch` at a time across
 * idle callbacks, each chunk its own short task. Layout never shifts —
 * bento geometry is pure math over persisted sizes, so unmounted cards
 * render as inert placeholders at their exact packed position until their
 * turn arrives. Reordering or resizing never regresses already-mounted
 * cards (the set only grows within an id signature).
 */

/** Immediate mounts — the first visible row on typical desktop widths. */
const FIRST_BATCH = 3;

/** Mounts per idle tick after the first batch. */
const BATCH = 2;

/** Idle-callback timeout: progression is guaranteed even under load. */
const IDLE_TIMEOUT_MS = 200;

/**
 * Pure planner: split `ids` into mount batches. The first batch carries
 * `firstBatch` ids (the page top), every later batch `batch` ids. Order
 * preserving, total coverage, never an empty batch — degenerate options
 * floor at 1 so the cursor always advances (a zero batch size here would
 * loop forever, the exact freeze class this module exists to prevent).
 */
export function planMountBatches(
  ids: ReadonlyArray<string>,
  firstBatch: number,
  batch: number,
): ReadonlyArray<ReadonlyArray<string>> {
  const head = Math.max(1, Math.floor(firstBatch) || 1);
  const step = Math.max(1, Math.floor(batch) || 1);
  const out: Array<ReadonlyArray<string>> = [];

  for (let start = 0; start < ids.length; start += start === 0 ? head : step) {
    const size = start === 0 ? head : step;

    out.push(ids.slice(start, start + size));
  }

  return out;
}

/**
 * requestIdleCallback fallback for browsers without it (Safari). Probed
 * once at module scope; `in` checks the property on the global (no type
 * assertion on the window shape).
 */
const hasIdleCallback =
  typeof window !== "undefined" && "requestIdleCallback" in window;

const scheduleIdle: (cb: () => void) => () => void = hasIdleCallback
  ? (cb) => {
      const handle = window.requestIdleCallback(cb, {
        timeout: IDLE_TIMEOUT_MS,
      });

      return () => window.cancelIdleCallback(handle);
    }
  : (cb) => {
      const timer = window.setTimeout(cb, 0);

      return () => window.clearTimeout(timer);
    };

/**
 * Ids allowed to render their real content. The progressive schedule
 * restarts only when the id LIST changes (page switch), never on reorder
 * or resize — mounted cards stay mounted, so gestures never see cards
 * flip back to placeholders.
 */
export function useProgressiveMount(
  ids: ReadonlyArray<string>,
  options?: { firstBatch?: number; batch?: number },
): ReadonlySet<string> {
  const firstBatch = options?.firstBatch ?? FIRST_BATCH;
  const batch = options?.batch ?? BATCH;
  const signature = useDerived(ids, (list) => list.join("\n"));

  // The store IS the fresh snapshot: the scheduler reads `mountedStore.state`
  // at event time (a store, unlike hook state, is never captured stale), so
  // no separate "latest value" mirror is needed.
  const mountedStore = useLocalStore<ReadonlySet<string>>(
    () => new Set(planMountBatches(ids, firstBatch, batch)[0] ?? []),
  );

  useStoreEffect(() => {
    const pending = ids.filter((id) => !mountedStore.state.has(id));

    if (pending.length === 0) return;

    // Each batch — including the first of a NEW page — mounts in its own
    // idle task, so the page-switch commit itself stays light and the top
    // row appears a tick later rather than blocking the switch.
    const batches = planMountBatches(pending, firstBatch, batch);

    let index = 0;
    let cancelled = false;
    let cancelIdle: (() => void) | null = null;

    const drain = (): void => {
      if (cancelled) return;

      const slice = batches[index];

      index += 1;
      mountedStore.setState((prev) => {
        const next = new Set(prev);

        for (const id of slice ?? []) next.add(id);

        return next;
      });

      if (index < batches.length) cancelIdle = scheduleIdle(drain);
    };

    cancelIdle = scheduleIdle(drain);

    return () => {
      cancelled = true;
      cancelIdle?.();
    };
    // The schedule depends only on the id list; batch sizes are stable.
  }, [signature, firstBatch, batch]);

  return useStore(mountedStore, (mounted) => mounted);
}
