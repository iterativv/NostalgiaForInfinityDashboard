// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Position pager — prev/next stepping through every position of the
 * followed pair, with an `i/x` readout where x is the newest position
 * (‹ walks back into history). Rendered by the position-candle toolbars;
 * hidden when the pair has fewer than two positions to step through.
 *
 * `busy` is honest feedback for the step's async tail: stepping back can
 * anchor on an entry older than the loaded candles, and the backward
 * history pages (spinner by the counter) stream in while the buttons stay
 * live for rapid stepping.
 */

import { InlineLoading } from "@carbon/react";

export function PositionPager({
  index,
  count,
  onMove,
  busy = false,
}: {
  /** 1-based position shown — the newest position reads `count`. */
  readonly index: number;
  /** Total positions of the pair (open + closed). */
  readonly count: number;
  /** Move to a neighboring index (clamped by the disabled buttons). */
  readonly onMove: (index: number) => void;
  /** A backward history page for the focused position is in flight. */
  readonly busy?: boolean;
}) {
  if (count <= 1) return null;

  const clamped = Math.min(Math.max(index, 1), count);

  return (
    <div
      className="nfi-tf-group"
      role="group"
      aria-label="Position navigation"
      aria-busy={busy || undefined}
      title="Step through this pair's positions (‹ back into history, newest last)"
    >
      <button
        type="button"
        className="nfi-tf-btn"
        disabled={clamped <= 1}
        onClick={() => onMove(clamped - 1)}
        aria-label="Previous position"
        title="Previous (older) position"
      >
        ‹
      </button>
      {busy ? (
        <div
          className="nfi-pager-busy"
          title="Loading older candles for this position…"
        >
          <InlineLoading />
        </div>
      ) : null}
      <span className="nfi-candle-range" aria-live="polite">
        {clamped}/{count}
      </span>
      <button
        type="button"
        className="nfi-tf-btn"
        disabled={clamped >= count}
        onClick={() => onMove(clamped + 1)}
        aria-label="Next position"
        title="Next (newer) position"
      >
        ›
      </button>
    </div>
  );
}
