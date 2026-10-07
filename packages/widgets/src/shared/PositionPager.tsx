// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Position pager — prev/next stepping through every position of the
 * followed pair (newest first), with an `i/x` readout. Rendered by the
 * position-candle toolbars; hidden when the pair has fewer than two
 * positions to step through.
 */

export function PositionPager({
  index,
  count,
  onMove,
}: {
  /** Current 0-based position index. */
  readonly index: number;
  /** Total positions of the pair (open + closed). */
  readonly count: number;
  /** Move to a neighboring index (clamped by the disabled buttons). */
  readonly onMove: (index: number) => void;
}) {
  if (count <= 1) return null;

  const clamped = Math.min(Math.max(index, 0), count - 1);

  return (
    <div
      className="nfi-tf-group"
      role="group"
      aria-label="Position navigation"
      title="Step through this pair's positions (open and closed, newest first)"
    >
      <button
        type="button"
        className="nfi-tf-btn"
        disabled={clamped <= 0}
        onClick={() => onMove(clamped - 1)}
        aria-label="Previous position"
        title="Previous position"
      >
        ‹
      </button>
      <span className="nfi-candle-range" aria-live="polite">
        {clamped + 1}/{count}
      </span>
      <button
        type="button"
        className="nfi-tf-btn"
        disabled={clamped >= count - 1}
        onClick={() => onMove(clamped + 1)}
        aria-label="Next position"
        title="Next position"
      >
        ›
      </button>
    </div>
  );
}
