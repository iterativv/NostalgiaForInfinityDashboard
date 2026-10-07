// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { LayoutNode } from "@danfessler/trellis";

/**
 * Tetris wall layout — the page-mode render for `Workspace.stacked`.
 *
 * Where the old masonry stack dropped every pane into one full-width
 * column, the tetris mode packs panes as blocks of DIFFERENT widths into a
 * tight wall: blocks sit in shelves row by row, every block in a row shares
 * the same top edge (aligned up), and the canvas scrolls once the wall
 * outgrows the viewport — nothing is ever crushed to fit one screen.
 *
 * The wall is a pure render override (the Trellis document is untouched, so
 * any tiled preset restores the previous arrangement exactly). Block widths
 * come from the pane's own geometry in that document: its tiled width
 * fraction maps to a span on a fixed 6-column grid, floored by the
 * selected widget's readable minimum, so a wide chart stays wide and a
 * narrow widget stays narrow. Placement is FIRST-FIT in tree order: each
 * block lands in the leftmost shelf row that still has room for it, so
 * later small blocks backfill the gaps earlier wide ones left — tetris
 * gravity, toward the top-left.
 *
 * Everything here is pure math over the persisted document (no DOM, no
 * measurement) so presets, the annotator hook and tests share one packer.
 */

/**
 * Grid columns every tetris wall packs into. Six splits evenly into 2, 3
 * and 6 blocks per row — pairs, triples and full-width strips — which is
 * all the block variety a dashboard wall needs; narrower steps produce
 * slivers on laptop widths.
 */
export const TETRIS_COLUMNS = 6;

/** Visual gap between wall blocks (matches `--trellis-gap`). */
export const TETRIS_GAP_PX = 8;

/** Fallback readable width when a widget type is unknown (uninstalled plugin). */
export const DEFAULT_TETRIS_MIN_WIDTH = 280;

/**
 * Map one pane's tiled width fraction (0..1 of the stage) to a column
 * span: nearest sixth, clamped to 1..columns. Full-width panes keep their
 * own row, half-width panes pair up, thirds triple up.
 */
export function tetrisSpanFromFraction(
  fraction: number,
  columns: number = TETRIS_COLUMNS,
): number {
  const count =
    Number.isFinite(columns) && columns >= 1 ? Math.floor(columns) : TETRIS_COLUMNS;

  if (!Number.isFinite(fraction) || fraction <= 0) return 1;

  return Math.max(1, Math.min(count, Math.round(fraction * count)));
}

/**
 * Smallest span whose rendered width still fits a widget's readable
 * minimum at the live stage size (gap included, ceil — a span-k block
 * renders `k·step − gap` wide), clamped to 1..columns. Unknown or
 * zero-minimum widgets read as span 1.
 */
export function tetrisSpanForMinWidth(
  minWidth: number,
  stageWidth: number,
  gap: number = TETRIS_GAP_PX,
  columns: number = TETRIS_COLUMNS,
): number {
  const count =
    Number.isFinite(columns) && columns >= 1 ? Math.floor(columns) : TETRIS_COLUMNS;

  const width =
    Number.isFinite(stageWidth) && stageWidth > 0 ? stageWidth : 0;

  if (width <= 0) return 1;

  const step = (width - Math.max(0, gap) * (count - 1)) / count;

  if (!(step > 0)) return count;

  const floor =
    Number.isFinite(minWidth) && minWidth > 0
      ? Math.ceil((minWidth + Math.max(0, gap)) / (step + Math.max(0, gap)))
      : 1;

  return Math.max(1, Math.min(count, floor));
}

/**
 * Column span under a resize drag: `offsetPx` is the pointer's distance
 * from the block's LEFT edge at the live stage size (gap included —
 * rounding snaps to the nearest column line, so a pointer on span k's
 * right edge reads exactly k). Degenerate inputs read as span 1.
 */
export function tetrisSpanAtOffset(
  offsetPx: number,
  stageWidth: number,
  gap: number = TETRIS_GAP_PX,
  columns: number = TETRIS_COLUMNS,
): number {
  const count =
    Number.isFinite(columns) && columns >= 1 ? Math.floor(columns) : TETRIS_COLUMNS;

  if (!Number.isFinite(offsetPx)) return 1;

  const width =
    Number.isFinite(stageWidth) && stageWidth > 0 ? stageWidth : 0;

  if (width <= 0) return 1;

  const step = (width - Math.max(0, gap) * (count - 1)) / count;

  if (!(step > 0)) return count;

  return Math.max(
    1,
    Math.min(count, Math.round((offsetPx + Math.max(0, gap)) / (step + Math.max(0, gap)))),
  );
}

/** One packed wall block: 1-based grid row, start column and span. */
export interface TetrisPlacement {
  row: number;
  column: number;
  span: number;
}

/**
 * First-fit shelf packing over a fixed column grid, in tree order: each
 * span lands in the FIRST row (topmost) that still has room for it — later
 * small blocks backfill the pockets earlier wide blocks left above — else a
 * new row opens beneath. Rows never overflow (spans clamp to the grid),
 * every block keeps its tree-order priority, and the result is a pure
 * function of the span list: same spans in, same wall out. Returns 1-based
 * grid lines ready for `grid-row` / `grid-column`.
 */
export function packTetrisRows(
  spans: ReadonlyArray<number>,
  columns: number = TETRIS_COLUMNS,
): TetrisPlacement[] {
  const count =
    Number.isFinite(columns) && columns >= 1 ? Math.floor(columns) : TETRIS_COLUMNS;

  const usedPerRow: number[] = [];
  const placements: TetrisPlacement[] = [];

  const clampSpan = (raw: number): number => {
    if (!Number.isFinite(raw) || raw < 1) return 1;

    return Math.min(count, Math.floor(raw));
  };

  for (const raw of spans) {
    const span = clampSpan(raw);
    let row = usedPerRow.findIndex((used) => count - used >= span);

    if (row === -1) {
      usedPerRow.push(0);
      row = usedPerRow.length - 1;
    }

    const column = usedPerRow[row]!;
    usedPerRow[row] = column + span;

    placements.push({ row: row + 1, column: column + 1, span });
  }

  return placements;
}

/**
 * Tiled width fraction (0..1 of the stage) of every panel in a Trellis
 * document: x-splits divide their width by weight among children, y-splits
 * pass the full width down. These fractions are the tetris wall's block
 * widths — the shape the page already has decides how wide each block
 * renders when the wall re-packs it.
 */
export function panelWidthFractions(root: LayoutNode | null): Map<string, number> {
  const fractions = new Map<string, number>();

  const walk = (node: LayoutNode | null | undefined, width: number): void => {
    if (!node) return;

    if (node.kind === "stage") {
      walk(node.child, width);

      return;
    }

    if (node.kind === "panel") {
      fractions.set(node.id, width);

      return;
    }

    const weights = node.children.map((_, index) => {
      const raw = node.weights?.[index];

      return raw != null && Number.isFinite(raw) && raw > 0 ? raw : 1;
    });

    const total = weights.reduce((sum, w) => sum + w, 0);

    node.children.forEach((child, index) => {
      walk(
        child,
        node.axis === "x" && total > 0 ? (width * weights[index]!) / total : width,
      );
    });
  };

  walk(root, 1);

  return fractions;
}
