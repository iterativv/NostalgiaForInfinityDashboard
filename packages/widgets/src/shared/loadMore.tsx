// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Growing-window pagination ("infinite load") for the position tables.
 *
 * Closed-trades tables read a newest-first WINDOW of history (the window
 * size rides the stream subscription). Instead of a fixed page, the window
 * GROWS one page at a time as the user approaches the end of the table:
 * the sentinel row's IntersectionObserver fires `loadMore`, the widget
 * re-subscribes with a larger limit, and `useHeldRows` keeps the previous
 * rows rendered while the bigger window streams in — the table never
 * blanks back to a loading pane mid-scroll. A plain "Load more" button
 * rides the same row for keyboards/touch (and as the observer fallback).
 */

import type { ReactNode } from "react";
import { Button, InlineLoading } from "@carbon/react";
import { useStore } from "@tanstack/react-store";
import { useElementStore, useLocalStore, useStoreEffect } from "@nfi/ui";
import type { SourceResult } from "./sources";

/** What `useGrowingWindow` hands back: the live window size + the grow step. */
export interface GrowingWindow {
  readonly size: number;
  readonly loadMore: () => void;
}

/** What `useHeldRows` hands back over the last-received rows. */
export interface HeldRows<T> {
  readonly rows: ReadonlyArray<T>;
  /** A larger window is in flight behind already-rendered rows. */
  readonly loadingMore: boolean;
  /** Nothing has rendered yet — the frame may show its loading pane. */
  readonly firstLoading: boolean;
}

/**
 * Window size that grows by `pageSize` steps up to `max`, resetting when
 * `resetKey` changes (instance or search switch — those swap the dataset).
 */
export function useGrowingWindow(
  pageSize: number,
  max: number,
  resetKey: string,
): GrowingWindow {
  // The store remembers the page size / dataset key it grew from: a drift
  // resets the window during render (identity-compare no-op otherwise).
  const windowStore = useLocalStore({ size: pageSize, pageSize, resetKey });

  if (
    windowStore.state.pageSize !== pageSize ||
    windowStore.state.resetKey !== resetKey
  ) {
    windowStore.setState(() => ({ size: pageSize, pageSize, resetKey }));
  }

  const size = useStore(windowStore, (s) => s.size);

  return {
    size: Math.min(size, max),

    loadMore: () =>
      windowStore.setState((s) => ({
        ...s,
        size: Math.min(s.size + pageSize, max),
      })),
  };
}

/**
 * Last-received rows with holdover: while the next (larger) window streams
 * in — or a refresh of the current one is mid-flight — the previously
 * decoded rows stay rendered instead of collapsing to a loading pane.
 */
export function useHeldRows<T>(
  source: SourceResult<ReadonlyArray<T>>,
  resetKey: string,
): HeldRows<T> {
  // The store mirrors the last-adopted data reference; comparing it against
  // `source.data` each render replaces the holdover only when the decoded
  // rows actually changed (render-phase writes are identity-compare no-ops).
  interface HeldRowsState {
    rows: ReadonlyArray<T>;
    data: ReadonlyArray<T> | undefined;
    resetKey: string;
  }

  const heldStore = useLocalStore<HeldRowsState>({
    rows: [],
    data: undefined,
    resetKey,
  });

  // Dataset switch (instance or search edit): the new dataset's first load
  // must NOT blank the table. Dropping the holdover here would collapse the
  // widget to zero rows → the frame flips to its loading pane → the whole
  // body (toolbar included) unmounts and the search input's keyboard focus
  // dies mid-typing — the "filter can't be changed" bug. So the previous
  // dataset's rows stay on screen (stale by one dataset, only for the fetch
  // window) until the new dataset's rows land and adopt below. A failed
  // first load drops the holdover so the error state stays honest.
  const reset = heldStore.state.resetKey !== resetKey;
  const dataChanged = heldStore.state.data !== source.data;

  if (reset) {
    // Adopt the new dataset's rows when already cached (e.g. clearing the
    // search lands on the still-cached unfiltered key); otherwise hold the
    // previous dataset's rows while the first load streams in, and only a
    // failed load drops them so the error state stays honest.
    heldStore.setState(() => ({
      rows:
        source.data ??
        (source.error === null ? heldStore.state.rows : []),
      data: source.data,
      resetKey,
    }));
  } else if (dataChanged && source.data !== undefined) {
    // Local capture keeps the guard's narrowing for the callback below.
    const rows = source.data;

    heldStore.setState(() => ({ rows, data: source.data, resetKey }));
  }

  const rows = useStore(heldStore, (s) => s.rows);

  return {
    rows,

    loadingMore: source.isLoading && rows.length > 0,

    firstLoading: source.isLoading && rows.length === 0,
  };
}

/**
 * Sentinel row that grows the window when it scrolls into view, and always
 * tells the user where the table stands: "Showing 50 of 125 · scroll for
 * more", a spinner while the next page streams in, or the end-of-history
 * line once everything is loaded. A plain "Load more" button rides the same
 * row for keyboards/touch (and as the observer fallback).
 */
export function LoadMoreRow({
  onLoadMore,
  shown,
  total,
  loading,
  done,
  atLimit,
  error,
  rearm,
}: {
  onLoadMore: () => void;
  /** Rows currently rendered under the window. */
  shown: number;
  /** Full-history size when the backend reports it (undefined while a
   * search makes the all-trades total meaningless). */
  total: number | undefined;
  loading: boolean;
  done: boolean;
  /** The window hit its hard cap — "end" is a limit, not the history end. */
  atLimit: boolean;
  /** Last growth attempt failed — surfaced inline, rows stay rendered. */
  error: string | null;
  /** Identity that changes when new rows land (re-arms the observer). */
  rearm: unknown;
}) {
  const { store: elStore, setElement } = useElementStore<HTMLDivElement>();
  const el = useStore(elStore, (s) => s);

  // IntersectionObserver is an external system wired to the element store:
  // `el` rides the deps so the observer attaches once the node lands and
  // re-arms exactly when the old effect's deps changed.
  useStoreEffect(() => {
    if (done || loading || error !== null) return;

    if (el === null || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      // Fire once per arming: the next data change re-arms the observer, so
      // a sentinel still in view after rows land pages again — but one
      // intersection burst never double-grows the window.
      { threshold: 0 },
    );

    observer.observe(el);

    return () => observer.disconnect();
  }, [el, done, loading, error, rearm, onLoadMore]);

  // Nothing rendered and nothing failed — no status worth showing.
  if (shown === 0 && done && error === null) return null;

  const label = (count: number): string => count.toLocaleString();
  const muted = { fontSize: "0.75rem", opacity: 0.7 } as const;

  let status: ReactNode;

  if (error !== null) {
    status = (
      <>
        <span className="nfi-pnl-negative" style={{ fontSize: "0.75rem" }}>
          {error}
        </span>
        <Button size="sm" kind="ghost" onClick={onLoadMore}>
          Retry
        </Button>
      </>
    );
  } else if (loading) {
    status = <InlineLoading description="Loading more…" />;
  } else if (done) {
    status = (
      <span style={muted}>
        {atLimit
          ? `Window limit reached — showing the first ${label(shown)} trades.`
          : total !== undefined
            ? `End of history — all ${label(total)} trades loaded.`
            : `${label(shown)} trades loaded.`}
      </span>
    );
  } else {
    status = (
      <>
        <span style={muted}>
          Showing {label(shown)}
          {total !== undefined ? ` of ${label(total)}` : ""} · scroll for more
        </span>
        <Button size="sm" kind="ghost" onClick={onLoadMore}>
          Load more
        </Button>
      </>
    );
  }

  return (
    <div
      ref={setElement}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.5rem",
        padding: "0.5rem 0.25rem",
        minHeight: "2.5rem",
      }}
    >
      {status}
    </div>
  );
}
