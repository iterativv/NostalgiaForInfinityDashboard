// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type {
  GridLayoutNode,
  GridItemLayoutNode,
  LayoutNode,
  SplitDirection,
} from "@nfi/api-contract";
/**
 * Smart responsive layouting — keeps dense grids readable on resize.
 *
 * Every widget declares a `minWidth` (px needed to stay readable). Grids
 * derive per-track minimums from the widgets they contain, so:
 * - gutter drags clamp to content (a table column cannot be squeezed shut),
 * - narrow containers automatically stack grid columns vertically instead of
 *   crushing them (render-only, never persisted),
 * - new cell splits pick the direction that fits the current viewport.
 */

// Fallbacks when a widget type is unknown (uninstalled plugin) or has no hint.
export const DEFAULT_MIN_WIDGET_WIDTH = 280;
export const MIN_SPLIT_PIXELS_FLOOR = 96;
export const COMPACT_STACK_BREAKPOINT = 720;
export const DIVIDER_PX = 3;
/** Visual gap between grid cells (and the drag-gutter track width). */
export const GRID_GUTTER_PX = 6;
/** Minimum width/height of one grid track as a share of the usable size. */
export const MIN_TRACK_FRACTION = 0.05;
/**
 * Dense-page tolerance: columns may shrink to this share of their nominal
 * minimum before the whole grid stacks — a slightly cramped table (it
 * scrolls internally) beats collapsing a 12-panel page to one column.
 */
export const STACK_TOLERANCE = 0.85;

/** Structural widget hint the helpers need — any registry lookup satisfies it. */
export interface MinWidthLookup {
  readonly minWidth: number;
}

/** Minimum readable width for one widget type (registry lookup with fallback). */
export function getWidgetMinWidth(
  widgetType: string | undefined,
  lookup: (type: string) => MinWidthLookup | undefined,
): number {
  if (!widgetType) return DEFAULT_MIN_WIDGET_WIDTH;
  const definition = lookup(widgetType);
  const min = definition?.minWidth ?? DEFAULT_MIN_WIDGET_WIDTH;
  return Number.isFinite(min) && min > 0 ? min : DEFAULT_MIN_WIDGET_WIDTH;
}

/**
 * Minimum width (px) a layout subtree needs to stay readable:
 * - panel -> its widget's minWidth
 * - tabs -> max over tabbed panels (only the active one is visible)
 * - grid -> sum of per-column minimums (+ gutters) when side-by-side
 * - grid (stacked) -> max column minimum (columns render as rows)
 * - split -> legacy sum/max (pre-grid documents)
 */
export function getLayoutMinWidth(
  node: LayoutNode,
  panels: Record<string, { widgetType: string } | undefined>,
  lookup: (type: string) => MinWidthLookup | undefined,
): number {
  switch (node.type) {
    case "panel":
      return getWidgetMinWidth(panels[node.panelId]?.widgetType, lookup);
    case "tabs": {
      if (node.panels.length === 0) return DEFAULT_MIN_WIDGET_WIDTH;
      return Math.max(
        ...node.panels.map((id) =>
          getWidgetMinWidth(panels[id]?.widgetType, lookup),
        ),
      );
    }
    case "grid": {
      const mins = gridColumnMinWidths(node, panels, lookup);
      const total =
        mins.reduce((sum, m) => sum + m, 0) +
        GRID_GUTTER_PX * Math.max(0, mins.length - 1);
      return total;
    }
    case "split": {
      const first = getLayoutMinWidth(node.first, panels, lookup);
      const second = getLayoutMinWidth(node.second, panels, lookup);
      return node.direction === "horizontal"
        ? first + DIVIDER_PX + second
        : Math.max(first, second);
    }
  }
}

/** Minimum width each grid column needs: widest child sharing that column. */
export function gridColumnMinWidths(
  grid: GridLayoutNode,
  panels: Record<string, { widgetType: string } | undefined>,
  lookup: (type: string) => MinWidthLookup | undefined,
): number[] {
  const columnCount = Math.max(
    grid.columns.length,
    ...grid.items.map((i) => i.col + Math.max(1, i.colSpan) - 1),
    1,
  );
  const mins = new Array<number>(columnCount).fill(0);
  for (const item of grid.items) {
    const childMin = getLayoutMinWidth(item.child, panels, lookup);
    const span = Math.min(
      Math.max(1, item.colSpan),
      columnCount - item.col + 1,
    );
    const share = childMin / Math.max(1, span);
    for (let c = item.col; c < item.col + span; c++) {
      mins[c - 1] = Math.max(mins[c - 1]!, share);
    }
  }
  return mins;
}

/** Grid minimum when columns stack (render-only): widest column wins. */
export function getGridStackedMinWidth(
  grid: GridLayoutNode,
  panels: Record<string, { widgetType: string } | undefined>,
  lookup: (type: string) => MinWidthLookup | undefined,
): number {
  const mins = gridColumnMinWidths(grid, panels, lookup);
  return Math.max(...mins, DEFAULT_MIN_WIDGET_WIDTH);
}

/**
 * Render-only responsive decision: should grid columns currently stack
 * vertically? True when the container cannot fit all column minimums
 * side-by-side. Persisted tracks are untouched — widening the window
 * restores the grid arrangement.
 */
export function shouldStackGrid(
  containerWidth: number,
  grid: GridLayoutNode,
  panels: Record<string, { widgetType: string } | undefined>,
  lookup: (type: string) => MinWidthLookup | undefined,
): boolean {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return false;
  if (grid.columns.length <= 1) return false;
  const mins = gridColumnMinWidths(grid, panels, lookup);
  const needed =
    mins.reduce((sum, m) => sum + m, 0) + GRID_GUTTER_PX * (mins.length - 1);
  return containerWidth < needed;
}

/**
 * Clamp a drag ratio so neither pane drops below its pixel minimum.
 * Falls back to the global ratio bounds when minimums exceed the container.
 */
export function clampRatioForMinWidths(
  ratio: number,
  containerPx: number,
  minFirst: number,
  minSecond: number,
  minRatio = 0.1,
  maxRatio = 0.9,
): number {
  const base = Math.min(maxRatio, Math.max(minRatio, ratio));
  if (
    !Number.isFinite(containerPx) ||
    containerPx <= minFirst + DIVIDER_PX + minSecond
  )
    return base;
  const usable = containerPx - DIVIDER_PX;
  const lo = Math.max(minRatio, minFirst / usable);
  const hi = Math.min(maxRatio, 1 - minSecond / usable);
  if (hi <= lo) return base;
  return Math.min(hi, Math.max(lo, ratio));
}

/**
 * Clamp one dragged track fraction against the content minimums of the two
 * adjacent tracks. `usablePx` excludes gutters; the pair's total fraction is
 * preserved (the right track absorbs the delta).
 */
export function clampTrackFractions(
  left: number,
  right: number,
  usablePx: number,
  minLeftPx: number,
  minRightPx: number,
): { left: number; right: number } {
  const total = left + right;
  if (!(total > 0) || !Number.isFinite(usablePx) || usablePx <= 0)
    return { left, right };
  const pxPerFr = usablePx / total;
  const minLeftFr = Math.max(MIN_TRACK_FRACTION * total, minLeftPx / pxPerFr);
  const minRightFr = Math.max(MIN_TRACK_FRACTION * total, minRightPx / pxPerFr);
  const clampedLeft = Math.min(total - minRightFr, Math.max(minLeftFr, left));
  return { left: clampedLeft, right: total - clampedLeft };
}

/**
 * Smart split direction for NEW cell splits: on narrow viewports (or portrait
 * containers) prefer stacking vertically so both cells stay readable;
 * otherwise keep the requested direction.
 */
export function chooseSplitDirection(
  requested: SplitDirection,
  viewportWidth: number,
  breakpoint: number = COMPACT_STACK_BREAKPOINT,
): SplitDirection {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return requested;
  if (requested === "horizontal" && viewportWidth < breakpoint)
    return "vertical";
  return requested;
}

/** Effective render direction after responsive stacking is applied (legacy splits). */
export function effectiveSplitDirection(
  persisted: SplitDirection,
  containerWidth: number,
  minFirst: number,
  minSecond: number,
): SplitDirection {
  if (
    persisted === "horizontal" &&
    Number.isFinite(containerWidth) &&
    containerWidth > 0 &&
    containerWidth < minFirst + DIVIDER_PX + minSecond
  ) {
    return "vertical";
  }
  return persisted;
}

export type { GridItemLayoutNode as GridItem };
