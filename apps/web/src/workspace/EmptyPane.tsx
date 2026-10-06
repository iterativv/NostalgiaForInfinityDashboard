// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * EmptyPane — the single empty state for the Trellis workspace.
 *
 * Previously three near-identical markups existed (page-empty fallback,
 * stage empty, workspace empty) plus a fourth look for preset slot
 * placeholders — same intent, four implementations. This is the only one:
 * a dashed fillable card with an optional Add action. Callers differ only
 * in title and whether the action is wired (read-only surfaces pass no
 * `onAdd` and get the label alone).
 */

export function EmptyPane({
  title,
  actionLabel = "Add widget",
  onAdd,
  onClose,
}: {
  /** "No widgets yet.", "Workspace is empty.", "Empty pane", … */
  title: string;
  /** Button caption (default "Add widget"). */
  actionLabel?: string;
  /**
   * Opens the widget picker; receives the trigger rect for anchoring.
   * Absent = label only (locked / read-only surfaces).
   */
  onAdd?: (anchor: DOMRect | null) => void;
  /**
   * Closes this empty pane (slot placeholders from grid presets).
   * Absent = no close affordance (workspace-level empties).
   */
  onClose?: () => void;
}) {
  return (
    <div className="nfi-slot">
      <div className="nfi-slot-inner">
        {onClose ? (
          <button
            type="button"
            className="nfi-slot-close"
            title="Close empty pane"
            aria-label="Close empty pane"
            onClick={onClose}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden
            >
              <path d="M12 4.7 11.3 4 8 7.3 4.7 4 4 4.7 7.3 8 4 11.3 4.7 12 8 8.7 11.3 12 12 11.3 8.7 8z" />
            </svg>
          </button>
        ) : null}
        <p className="nfi-slot-label">{title}</p>
        {onAdd ? (
          <button
            type="button"
            className="cds--btn cds--btn--secondary cds--btn--sm"
            onClick={(event) =>
              onAdd(event.currentTarget.getBoundingClientRect())
            }
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
