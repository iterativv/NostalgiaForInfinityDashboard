/**
 * Position pager — prev/next stepping through every position of the
 * followed pair, with an `i/x` readout where x is the newest position
 * (‹ walks back into history). Rendered by the position-candle toolbars;
 * hidden when the pair has fewer than two positions to step through.
 */

export function PositionPager({
  index,
  count,
  onMove,
}: {
  /** 1-based position shown — the newest position reads `count`. */
  readonly index: number;
  /** Total positions of the pair (open + closed). */
  readonly count: number;
  /** Move to a neighboring index (clamped by the disabled buttons). */
  readonly onMove: (index: number) => void;
}) {
  if (count <= 1) return null;

  const clamped = Math.min(Math.max(index, 1), count);

  return (
    <div
      className="nfi-tf-group"
      role="group"
      aria-label="Position navigation"
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
