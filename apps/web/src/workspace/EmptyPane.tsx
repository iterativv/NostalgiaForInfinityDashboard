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
}) {
  return (
    <div className="nfi-slot">
      <div className="nfi-slot-inner">
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
