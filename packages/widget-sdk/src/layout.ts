// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type {
  FlowItemLayoutNode,
  GridLayoutNode,
  GridItemLayoutNode,
  LayoutNode,
  SplitDirection,
} from "@nfi/api-contract";
/**
 * Smart responsive layouting — keeps dense grids readable on resize.
 *
 * Every widget declares a `minWidth`/`minHeight` (px needed to stay
 * readable). Grids derive per-track minimums from the widgets they contain,
 * so:
 * - gutter drags clamp to content (a table column cannot be squeezed shut),
 * - narrow containers automatically stack grid columns vertically instead of
 *   crushing them (render-only, never persisted),
 * - new cell splits pick the direction that fits the current viewport.
 *
 * Flows (the freeform wrapping container) give every card an explicit pixel
 * box: SE-corner drags clamp to the card's content minimums and overflowing
 * cards wrap onto the next row (flex-wrap, render-only row breaks).
 *
 * Masonries (the column-packing container) keep flexible per-card heights
 * with the same minimum clamps, while widths come from the responsive
 * columns (target density persisted on the container).
 */

// Fallbacks when a widget type is unknown (uninstalled plugin) or has no hint.
export const DEFAULT_MIN_WIDGET_WIDTH = 280;

export const DEFAULT_MIN_WIDGET_HEIGHT = 160;

export const MIN_SPLIT_PIXELS_FLOOR = 96;

export const COMPACT_STACK_BREAKPOINT = 720;

export const DIVIDER_PX = 3;

/** Visual gap between grid cells (and the drag-gutter track width). */
export const GRID_GUTTER_PX = 6;

/** Visual gap between flow cards (flex gap, render-only). */
export const FLOW_GAP_PX = 8;

/** Visual gap between masonry columns and rows (render-only). */
export const MASONRY_GAP_PX = 8;

/** Default masonry target column width for fresh conversions. */
export const DEFAULT_MASONRY_COLUMN_WIDTH = 380;

/** Absolute floor for masonry card heights (per-widget minimums win when larger). */
export const MIN_MASONRY_ITEM_HEIGHT = 140;

/**
 * Hard cap on masonry column count: density presets only choose a target,
 * the packer never builds more than this many columns (a 240px target on a
 * 2560px monitor would otherwise wall every card into a sliver).
 */
export const MAX_MASONRY_COLUMNS = 4;

/**
 * Outer-box allowance for the tab-strip chrome a masonry card hosts around
 * its panel body (strip + card borders). Widget minimums measure the BODY,
 * so card heights/widths need this on top or the too-small guard fires at
 * exact-minimum sizes.
 */
export const MASONRY_ITEM_CHROME_PX = 28;

/** Visual gap between auto rows/columns (render-only). */
export const AUTO_GAP_PX = 8;

/** Default auto target column width for fresh conversions. */
export const DEFAULT_AUTO_COLUMN_WIDTH = 320;

/** Absolute floor for auto card heights (per-widget minimums win when larger). */
export const MIN_AUTO_ITEM_HEIGHT = 140;

/**
 * Hard cap on auto column count — one notch above masonry: rows justify
 * edge-to-edge and small widgets can widen via span, so slightly narrower
 * base columns stay readable while letting bento rows mix sizes.
 */
export const MAX_AUTO_COLUMNS = 6;

/** Tab-strip chrome allowance for auto cards (same box as masonry cards). */
export const AUTO_ITEM_CHROME_PX = 28;

/** Default flow card size for fresh conversions (before min-clamping). */
export const DEFAULT_FLOW_ITEM_WIDTH = 360;

export const DEFAULT_FLOW_ITEM_HEIGHT = 280;

/** Absolute floors for flow cards (per-widget minimums win when larger). */
export const MIN_FLOW_ITEM_WIDTH = 200;

export const MIN_FLOW_ITEM_HEIGHT = 140;

/** Largest flow card the resizer allows (keeps drags sane on huge monitors). */
export const MAX_FLOW_ITEM_WIDTH = 1600;

export const MAX_FLOW_ITEM_HEIGHT = 1200;

/** Minimum width/height of one grid track as a share of the usable size. */
export const MIN_TRACK_FRACTION = 0.05;

/** One packed masonry card position (px within the masonry canvas). */
export interface MasonryPackedPosition {
  left: number;
  top: number;
  /** Rendered width: span × column width plus the gutters it crosses. */
  width: number;
}

/** Deterministic masonry packing result for one container measurement. */
export interface MasonryPacking {
  /** Columns actually used (may be below the target-derived count). */
  columnCount: number;
  /** Stretched column width so columns fill the container row. */
  columnWidth: number;
  /** Total canvas height (tallest column, trailing gutter trimmed). */
  height: number;
  /** Per-item position in tree order. */
  items: MasonryPackedPosition[];
}

/** Options for `packMasonry` beyond the card heights. */
export interface PackMasonryOptions {
  /** Per-item column spans (tree order; missing/invalid entries read as 1). */
  readonly spans?: ReadonlyArray<number>;
  /** Upper bound on the derived column count (default `MAX_MASONRY_COLUMNS`). */
  readonly maxColumns?: number;
}

/**
 * Deterministic gap-free column packing for one masonry container:
 * the column count derives from the container width and the masonry's
 * TARGET column width (the density knob), capped at `maxColumns` so wide
 * monitors never produce sliver columns; columns stretch to fill the row,
 * and every card lands in the currently shortest column run (leftmost on
 * ties) so vertical gaps are always filled — the dashboard has gravity to
 * the top no matter the panel size. Spans are stepless (fractional):
 * a card with span s renders exactly `s·step − gap` wide (the flexible
 * resize) while occupying `ceil(s)` adjacent columns for placement — the
 * leftmost ceil(s)-run with the lowest maximum top — so a 1.5-wide card
 * still reserves 2 columns and nothing ever overlaps.
 *
 * Pure math over KNOWN heights — persisted card px clamped by the caller
 * to their content minimums — so the layout is a pure function of the
 * container width: no measurement, no observers, no frame scheduling.
 * Returns zero-width geometry for unmeasured (0px) containers so the
 * first paint before the ResizeObserver fires renders nothing yet stays
 * consistent.
 */
export function packMasonry(
  containerWidth: number,
  targetColumnWidth: number,
  gap: number,
  heights: ReadonlyArray<number>,
  options: PackMasonryOptions = {},
): MasonryPacking {
  const width =
    Number.isFinite(containerWidth) && containerWidth > 0
      ? Math.floor(containerWidth)
      : 0;

  const target =
    Number.isFinite(targetColumnWidth) && targetColumnWidth > 0
      ? targetColumnWidth
      : DEFAULT_MASONRY_COLUMN_WIDTH;

  const gutter = Number.isFinite(gap) && gap >= 0 ? gap : 0;

  const cap =
    Number.isFinite(options.maxColumns) && (options.maxColumns ?? 0) >= 1
      ? Math.floor(options.maxColumns!)
      : MAX_MASONRY_COLUMNS;

  if (width <= 0 || heights.length === 0) {
    return {
      columnCount: 1,
      columnWidth: 0,
      height: 0,
      items: Array.from({ length: heights.length }, () => ({
        left: 0,
        top: 0,
        width: 0,
      })),
    };
  }

  const columnCount = Math.max(
    1,
    Math.min(
      heights.length,
      cap,
      Math.floor((width + gutter) / (target + gutter)),
    ),
  );

  const columnWidth = Math.max(
    1,
    Math.floor((width - gutter * (columnCount - 1)) / columnCount),
  );

  const columnTops = Array.from({ length: columnCount }, () => 0);

  const items = heights.map((rawHeight, index) => {
    // Stepless spans: the RENDERED width tracks the fractional span 1:1
    // (the flexible resize), while placement reserves ceil(span) whole
    // columns so fractional cards never overlap. Spans clamp to the live
    // column count so a wide card from a big monitor renders full-width on
    // a narrow one instead of overflowing.
    const requested = options.spans?.[index] ?? 1;

    // Runtime guard: the static type is `number`, but a decoded layout can
    // still carry NaN/Infinity — fall back to a single-column span then.
    const finite = Number.isFinite(requested) && requested > 0 ? requested : 1;

    const clampedSpan = Math.max(1, Math.min(columnCount, finite));

    const occupy = Math.max(
      1,
      Math.min(columnCount, Math.ceil(clampedSpan - 1e-9)),
    );

    let column = 0;
    let top = Number.POSITIVE_INFINITY;

    // Leftmost window of `occupy` consecutive columns with the lowest max top.
    for (let start = 0; start + occupy <= columnCount; start++) {
      let windowTop = columnTops[start]!;

      for (let c = start + 1; c < start + occupy; c++)
        windowTop = Math.max(windowTop, columnTops[c]!);

      if (windowTop < top) {
        top = windowTop;
        column = start;
      }
    }

    const height =
      Number.isFinite(rawHeight) && rawHeight > 0 ? Math.ceil(rawHeight) : 0;

    for (let c = column; c < column + occupy; c++)
      columnTops[c] = top + height + gutter;

    return {
      left: column * (columnWidth + gutter),
      top,
      width: clampedSpan * (columnWidth + gutter) - gutter,
    };
  });

  const tallest = Math.max(0, ...columnTops) - gutter;

  return {
    columnCount,
    columnWidth,
    height: tallest > 0 ? tallest : 0,
    items,
  };
}

/** One packed auto card position (px within the auto canvas). */
export interface AutoPackedPosition {
  left: number;
  /** Column-packed top (shortest-column gravity — no vertical gaps). */
  top: number;
  /** Rendered width: exact span × column width plus the gutters it crosses. */
  width: number;
  /** Rendered height: the card's own height (no stretch — columns vary). */
  height: number;
}

/** Deterministic column packing result for one container measurement. */
export interface AutoPacking {
  /** Columns actually used (may be below the target-derived count). */
  columnCount: number;
  /** Stretched column width so columns fill the container row. */
  columnWidth: number;
  /** Total canvas height (tallest column, trailing gap trimmed). */
  height: number;
  /** Per-item position in tree order. */
  items: AutoPackedPosition[];
}

/** Options for `packAuto` (same shape as `packMasonry`'s). */
export interface PackAutoOptions {
  /** Per-item column spans (tree order; missing/invalid entries read as 1). */
  readonly spans?: ReadonlyArray<number>;
  /** Upper bound on the derived column count (default `MAX_AUTO_COLUMNS`). */
  readonly maxColumns?: number;
}

/**
 * Deterministic COLUMN packing for one auto container (the bento layout
 * with masonry gravity): the column grid derives from the container width
 * and the auto's TARGET column width (capped at `maxColumns`), then every
 * card lands in the currently shortest column run (leftmost on ties) so
 * empty space is always filled and the dashboard has gravity to the top
 * no matter the panel size. Every card keeps its EXACT persisted size
 * (width = span × step − gap with stepless fractional spans, height = own
 * px): no justification, no height stretch — so a resize release
 * re-renders pixel-identical to the drag's final frame. A span-s card
 * occupies `ceil(s)` adjacent columns (the leftmost run with the lowest
 * maximum top) while rendering its exact fractional width. Responsiveness
 * comes from the live column grid (narrow containers derive fewer,
 * full-width columns), not from growing cards — sub-minimum widths scale
 * content down in the renderer.
 *
 * The grid NEVER shrinks to the card count: a lone card on an empty page
 * still gets the full column grid (span 1..N resizable, the trailing add
 * tile fills the unused pocket). Capping columns at the card count pinned
 * the first widget full-width with span locked at 1 — width resize was a
 * no-op until a second card existed.
 *
 * Pure math over KNOWN heights (persisted card px clamped by the caller to
 * their content minimums) — a pure function of the container width: no
 * measurement, no observers, no frame scheduling (see packMasonry's header
 * for why that matters). Returns zero-width geometry for unmeasured (0px)
 * containers so the first paint renders nothing yet stays consistent.
 */
export function packAuto(
  containerWidth: number,
  targetColumnWidth: number,
  gap: number,
  heights: ReadonlyArray<number>,
  options: PackAutoOptions = {},
): AutoPacking {
  const width =
    Number.isFinite(containerWidth) && containerWidth > 0
      ? Math.floor(containerWidth)
      : 0;

  const target =
    Number.isFinite(targetColumnWidth) && targetColumnWidth > 0
      ? targetColumnWidth
      : DEFAULT_AUTO_COLUMN_WIDTH;

  const gutter = Number.isFinite(gap) && gap >= 0 ? gap : 0;

  const cap =
    Number.isFinite(options.maxColumns) && (options.maxColumns ?? 0) >= 1
      ? Math.floor(options.maxColumns!)
      : MAX_AUTO_COLUMNS;

  if (width <= 0 || heights.length === 0) {
    return {
      columnCount: 1,
      columnWidth: 0,
      height: 0,
      items: Array.from({ length: heights.length }, () => ({
        left: 0,
        top: 0,
        width: 0,
        height: 0,
      })),
    };
  }

  const columnCount = Math.max(
    1,
    Math.min(cap, Math.floor((width + gutter) / (target + gutter))),
  );

  const columnWidth = Math.max(
    1,
    Math.floor((width - gutter * (columnCount - 1)) / columnCount),
  );

  // Stepless spans (fractional drags persist fractions of a column):
  // rendered width tracks the span 1:1, placement reserves ceil(span)
  // whole columns. Clamped to the live column count so a wide card from a
  // big monitor renders full-width on a narrow one instead of overflowing.
  const spans = heights.map((_, index) => {
    const requested = options.spans?.[index] ?? 1;

    // Runtime guard: the static type is `number`, but a decoded layout can
    // still carry NaN/Infinity — fall back to a single-column span then.
    const finite = Number.isFinite(requested) && requested > 0 ? requested : 1;

    return Math.max(1, Math.min(columnCount, finite));
  });

  const occupies = spans.map((span) =>
    Math.max(1, Math.min(columnCount, Math.ceil(span - 1e-9))),
  );

  const columnTops = Array.from({ length: columnCount }, () => 0);
  const items: AutoPackedPosition[] = Array.from({ length: heights.length });

  spans.forEach((span, index) => {
    const occupy = occupies[index]!;
    let column = 0;
    let top = Number.POSITIVE_INFINITY;

    // Leftmost window of `occupy` consecutive columns with the lowest max top.
    for (let start = 0; start + occupy <= columnCount; start++) {
      let windowTop = columnTops[start]!;

      for (let c = start + 1; c < start + occupy; c++)
        windowTop = Math.max(windowTop, columnTops[c]!);

      if (windowTop < top) {
        top = windowTop;
        column = start;
      }
    }

    const raw = heights[index]!;
    const own = Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : 0;

    for (let c = column; c < column + occupy; c++)
      columnTops[c] = top + own + gutter;

    items[index] = {
      left: column * (columnWidth + gutter),
      top,
      width: span * (columnWidth + gutter) - gutter,
      height: own,
    };
  });

  const tallest = Math.max(0, ...columnTops) - gutter;

  return {
    columnCount,
    columnWidth,
    height: tallest > 0 ? tallest : 0,
    items,
  };
}

/**
 * Dense-page tolerance: columns may shrink to this share of their nominal
 * minimum before the whole grid stacks — a slightly cramped table (it
 * scrolls internally) beats collapsing a 12-panel page to one column.
 */
export const STACK_TOLERANCE = 0.85;

/** Structural widget hint the helpers need — any registry lookup satisfies it. */
export interface MinWidthLookup {
  readonly minWidth: number;
  readonly minHeight?: number;
}

/** One adjusted pair of adjacent track fractions; `left + right` is preserved. */
export interface TrackFractionPair {
  left: number;
  right: number;
}

/** One clamped flow card size (width × height in px). */
export interface FlowItemSize {
  width: number;
  height: number;
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

/** Minimum readable height for one widget type (registry lookup with fallback). */
export function getWidgetMinHeight(
  widgetType: string | undefined,
  lookup: (type: string) => MinWidthLookup | undefined,
): number {
  if (!widgetType) return DEFAULT_MIN_WIDGET_HEIGHT;
  const definition = lookup(widgetType);
  const min = definition?.minHeight ?? DEFAULT_MIN_WIDGET_HEIGHT;

  return Number.isFinite(min) && min > 0 ? min : DEFAULT_MIN_WIDGET_HEIGHT;
}

/**
 * Minimum width (px) a layout subtree needs to stay readable:
 * - panel -> its widget's minWidth
 * - tabs -> max over tabbed panels (only the active one is visible)
 * - grid -> sum of per-column minimums (+ gutters) when side-by-side
 * - grid (stacked) -> max column minimum (columns render as rows)
 * - flow -> max over cards (wrapping means only the widest card must fit)
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

    case "flow": {
      if (node.items.length === 0) return DEFAULT_MIN_WIDGET_WIDTH;

      return Math.max(
        ...node.items.map((item) =>
          getLayoutMinWidth(item.child, panels, lookup),
        ),
      );
    }

    case "masonry": {
      if (node.items.length === 0) return DEFAULT_MIN_WIDGET_WIDTH;

      return Math.max(
        ...node.items.map((item) =>
          getLayoutMinWidth(item.child, panels, lookup),
        ),
      );
    }

    case "auto": {
      if (node.items.length === 0) return DEFAULT_MIN_WIDGET_WIDTH;

      return Math.max(
        ...node.items.map((item) =>
          getLayoutMinWidth(item.child, panels, lookup),
        ),
      );
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

/**
 * Minimum height (px) a layout subtree needs to stay readable:
 * - panel -> its widget's minHeight
 * - tabs -> max over tabbed panels
 * - grid -> sum of per-row minimums (+ gutters)
 * - flow -> max over cards (row breaks are render-only)
 * - split -> legacy max/sum (pre-grid documents)
 */
export function getLayoutMinHeight(
  node: LayoutNode,
  panels: Record<string, { widgetType: string } | undefined>,
  lookup: (type: string) => MinWidthLookup | undefined,
): number {
  switch (node.type) {
    case "panel":
      return getWidgetMinHeight(panels[node.panelId]?.widgetType, lookup);
    case "tabs": {
      if (node.panels.length === 0) return DEFAULT_MIN_WIDGET_HEIGHT;

      return Math.max(
        ...node.panels.map((id) =>
          getWidgetMinHeight(panels[id]?.widgetType, lookup),
        ),
      );
    }

    case "grid": {
      const mins = gridRowMinHeights(node, panels, lookup);

      return (
        mins.reduce((sum, m) => sum + m, 0) +
        GRID_GUTTER_PX * Math.max(0, mins.length - 1)
      );
    }

    case "flow": {
      if (node.items.length === 0) return DEFAULT_MIN_WIDGET_HEIGHT;

      return Math.max(
        ...node.items.map((item) =>
          getLayoutMinHeight(item.child, panels, lookup),
        ),
      );
    }

    case "masonry": {
      if (node.items.length === 0) return DEFAULT_MIN_WIDGET_HEIGHT;

      return Math.max(
        ...node.items.map((item) =>
          getLayoutMinHeight(item.child, panels, lookup),
        ),
      );
    }

    case "auto": {
      if (node.items.length === 0) return DEFAULT_MIN_WIDGET_HEIGHT;

      return Math.max(
        ...node.items.map((item) =>
          getLayoutMinHeight(item.child, panels, lookup),
        ),
      );
    }

    case "split": {
      const first = getLayoutMinHeight(node.first, panels, lookup);
      const second = getLayoutMinHeight(node.second, panels, lookup);

      return node.direction === "vertical"
        ? first + DIVIDER_PX + second
        : Math.max(first, second);
    }
  }
}

/** Minimum height each grid row needs: tallest child covering that row. */
export function gridRowMinHeights(
  grid: GridLayoutNode,
  panels: Record<string, { widgetType: string } | undefined>,
  lookup: (type: string) => MinWidthLookup | undefined,
): number[] {
  const rowCount = Math.max(
    grid.rows.length,
    ...grid.items.map((i) => i.row + Math.max(1, i.rowSpan) - 1),
    1,
  );

  const mins = Array.from({ length: rowCount }, () => 0);

  for (const item of grid.items) {
    const childMin = getLayoutMinHeight(item.child, panels, lookup);
    const span = Math.min(Math.max(1, item.rowSpan), rowCount - item.row + 1);
    const share = childMin / Math.max(1, span);

    for (let r = item.row; r < item.row + span; r++) {
      mins[r - 1] = Math.max(mins[r - 1]!, share);
    }
  }

  return mins;
}

/**
 * Content minimums for one flow card's child: the box may never shrink
 * below these (plus the absolute flow floors) — the SE-corner resizer and
 * the persisted-size validator both clamp through here.
 */
export function getFlowItemMinSize(
  child: LayoutNode,
  panels: Record<string, { widgetType: string } | undefined>,
  lookup: (type: string) => MinWidthLookup | undefined,
): FlowItemSize {
  return {
    width: Math.max(
      MIN_FLOW_ITEM_WIDTH,
      getLayoutMinWidth(child, panels, lookup),
    ),
    height: Math.max(
      MIN_FLOW_ITEM_HEIGHT,
      getLayoutMinHeight(child, panels, lookup),
    ),
  };
}

/**
 * Minimum height for one masonry card's child: the persisted height may
 * never shrink below this (the child's content minimum plus the tab-strip
 * chrome, or the absolute masonry floor) — the SE-corner resizer and the
 * renderer clamp through here. Masonry widths are column-driven, so there
 * is no per-card width minimum.
 */
export function getMasonryItemMinHeight(
  child: LayoutNode,
  panels: Record<string, { widgetType: string } | undefined>,
  lookup: (type: string) => MinWidthLookup | undefined,
): number {
  return Math.max(
    MIN_MASONRY_ITEM_HEIGHT,
    getLayoutMinHeight(child, panels, lookup) + MASONRY_ITEM_CHROME_PX,
  );
}

/**
 * Minimum height for one auto card's child: the persisted height may never
 * shrink below this (the child's content minimum plus the tab-strip chrome,
 * or the absolute auto floor) — the SE-corner resizer and the renderer clamp
 * through here. Auto widths are column-span driven (then justified), so
 * render time has no per-card width minimum — but persisted spans should
 * cover the content minimum (see `autoSpanForWidth`).
 */
export function getAutoItemMinHeight(
  child: LayoutNode,
  panels: Record<string, { widgetType: string } | undefined>,
  lookup: (type: string) => MinWidthLookup | undefined,
): number {
  return Math.max(
    MIN_AUTO_ITEM_HEIGHT,
    getLayoutMinHeight(child, panels, lookup) + AUTO_ITEM_CHROME_PX,
  );
}

/**
 * Column span that keeps a fresh auto card readable at a given density: the
 * preferred width rounds to the nearest column step, but the span never
 * falls below what the content NEEDS (ceil, gap included — a span-k card
 * renders k·step − gap wide), clamped to 1..maxColumns. The density is only
 * a target width; a table that needs 990px takes enough columns to keep it,
 * so preset conversions never crush cards into slivers. (User-dragged spans
 * are respected verbatim — an explicit resize wins, same as masonry.)
 */
export function autoSpanForWidth(
  preferredWidth: number,
  minWidth: number,
  columnWidth: number,
  gap: number = AUTO_GAP_PX,
  maxColumns: number = MAX_AUTO_COLUMNS,
): number {
  const target =
    Number.isFinite(columnWidth) && columnWidth > 0
      ? columnWidth
      : DEFAULT_AUTO_COLUMN_WIDTH;

  const step = Math.max(1, target + Math.max(0, gap));

  const preferred =
    Number.isFinite(preferredWidth) && preferredWidth > 0
      ? Math.round(preferredWidth / step)
      : 1;

  const readable =
    Number.isFinite(minWidth) && minWidth > 0
      ? Math.ceil((minWidth + Math.max(0, gap)) / step)
      : 1;

  return Math.max(1, Math.min(maxColumns, Math.max(preferred, readable)));
}

/**
 * Readability floor for one auto card at the LIVE density: the smallest
 * column span whose rendered width (`span·step − gap`) still covers the
 * content minimum, clamped to 1..columnCount. The renderer floors every
 * card at this (persisted spans stay verbatim — even a deliberately tiny
 * one — but nothing ever RENDERS below readable), so a widget snapping
 * into a previous row can never squeeze its new row-mates below their
 * minimums: either the row fits everyone readable, or the card wraps.
 */
export function minAutoSpan(
  minWidth: number,
  columnWidth: number,
  gap: number = AUTO_GAP_PX,
  columnCount: number = MAX_AUTO_COLUMNS,
): number {
  const step = Math.max(
    1,
    (Number.isFinite(columnWidth) && columnWidth > 0
      ? columnWidth
      : DEFAULT_AUTO_COLUMN_WIDTH) + Math.max(0, gap),
  );

  const count =
    Number.isFinite(columnCount) && columnCount >= 1
      ? Math.floor(columnCount)
      : MAX_AUTO_COLUMNS;

  const floor =
    Number.isFinite(minWidth) && minWidth > 0
      ? Math.ceil((minWidth + Math.max(0, gap)) / step)
      : 1;

  return Math.max(1, Math.min(count, floor));
}

/**
 * Clamp a dragged flow card size: never below content minimums (or the
 * absolute floors) and never above the sanity ceilings. The container width
 * caps the width when known so a card cannot be dragged wider than its row
 * — overflowing cards wrap instead of clipping.
 */
export function clampFlowItemSize(
  width: number,
  height: number,
  minWidth: number,
  minHeight: number,
  containerWidth?: number,
): FlowItemSize {
  const loW = Math.max(MIN_FLOW_ITEM_WIDTH, minWidth);
  const loH = Math.max(MIN_FLOW_ITEM_HEIGHT, minHeight);

  const hiW =
    Number.isFinite(containerWidth) && (containerWidth ?? 0) > 0
      ? Math.min(MAX_FLOW_ITEM_WIDTH, Math.max(loW, containerWidth!))
      : MAX_FLOW_ITEM_WIDTH;

  return {
    width: Math.min(hiW, Math.max(loW, width)),
    height: Math.min(
      MAX_FLOW_ITEM_HEIGHT,
      Math.max(loH, Number.isFinite(height) ? height : loH),
    ),
  };
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

  const mins = Array.from({ length: columnCount }, () => 0);

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
): TrackFractionPair {
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

export type { FlowItemLayoutNode as FlowItem };
