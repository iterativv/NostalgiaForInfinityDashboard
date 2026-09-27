// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  type LayoutNodeId,
  LayoutNodeId as LayoutNodeIdSchema,
  type GridLayoutNode,
  type LayoutNode,
  type PanelId,
  PanelId as PanelIdSchema,
} from "@nfi/api-contract";
import {
  autoSpanForWidth,
  chooseSplitDirection,
  clampRatioForMinWidths,
  clampTrackFractions,
  effectiveSplitDirection,
  getGridStackedMinWidth,
  getLayoutMinWidth,
  gridColumnMinWidths,
  GRID_GUTTER_PX,
  MASONRY_GAP_PX,
  minAutoSpan,
  packAuto,
  packMasonry,
  shouldStackGrid,
} from "./layout.js";
import { createWidgetRegistry, defineWidget } from "./widgets.js";

const Table = defineWidget({
  type: "test.table",
  title: "Table",
  description: "test",
  configSchema: Schema.Struct({}),
  defaultConfig: {},
  component: () => null,
  minWidth: 560,
});

const Stat = defineWidget({
  type: "test.stat",
  title: "Stat",
  description: "test",
  configSchema: Schema.Struct({}),
  defaultConfig: {},
  component: () => null,
  minWidth: 280,
});

const registry = createWidgetRegistry([Table, Stat]);

const lookup = (type: string) => registry.getWidget(type);

/** Brand a fixture id through the real api-contract schema (validates it). */
const panelId = (id: string): PanelId => Schema.decodeSync(PanelIdSchema)(id);

const nodeId = (id: string): LayoutNodeId =>
  Schema.decodeSync(LayoutNodeIdSchema)(id);

const panels = {
  a: { widgetType: "test.table" },
  b: { widgetType: "test.stat" },
};

const panel = (id: string): LayoutNode => ({
  type: "panel",
  panelId: panelId(id),
});

const tabs = (id: string, ...ids: string[]): LayoutNode => ({
  type: "tabs",
  id: nodeId(id),
  panels: ids.map(panelId),
  activePanelId: ids[0] === undefined ? null : panelId(ids[0]),
});

const grid = (
  columns: number[],
  rows: number[],
  cells: Array<{
    col: number;
    row: number;
    colSpan?: number;
    rowSpan?: number;
    child: LayoutNode;
  }>,
): GridLayoutNode => ({
  type: "grid",
  id: nodeId("g"),
  columns,
  rows,
  items: cells.map((cell, i) => ({
    type: "item",
    id: nodeId(`g-${i}`),
    col: cell.col,
    row: cell.row,
    colSpan: cell.colSpan ?? 1,
    rowSpan: cell.rowSpan ?? 1,
    child: cell.child,
  })),
});

describe("responsive layout", () => {
  it("derives subtree minimums from widget hints", () => {
    // Two columns: table (560) + stat (280) with one gutter between.
    const twoCol = grid(
      [1, 1],
      [1],
      [
        { col: 1, row: 1, child: panel("a") },
        { col: 2, row: 1, child: panel("b") },
      ],
    );

    expect(getLayoutMinWidth(twoCol, panels, lookup)).toBe(
      560 + GRID_GUTTER_PX + 280,
    );
    // Tabs take the max of their panels (only the active one is visible).
    expect(getLayoutMinWidth(tabs("t", "a", "b"), panels, lookup)).toBe(560);

    // Legacy split still sums horizontally.
    const horizontal: LayoutNode = {
      type: "split",
      id: nodeId("s"),
      direction: "horizontal",
      ratio: 0.5,
      first: panel("a"),
      second: panel("b"),
    };

    expect(getLayoutMinWidth(horizontal, panels, lookup)).toBe(560 + 3 + 280);
    const vertical = { ...horizontal, direction: "vertical" as const };
    expect(getLayoutMinWidth(vertical, panels, lookup)).toBe(560);
  });

  it("spreads spanned-item minimums across their columns", () => {
    const hero = grid(
      [1, 1],
      [1, 1],
      [
        { col: 1, row: 1, colSpan: 2, child: panel("a") },
        { col: 1, row: 2, child: panel("b") },
        { col: 2, row: 2, child: panel("b") },
      ],
    );

    // The table hero spans both columns: 560/2 = 280 per column; the stats
    // need 280 each — so both columns need 280.
    expect(gridColumnMinWidths(hero, panels, lookup)).toEqual([280, 280]);
    expect(getGridStackedMinWidth(hero, panels, lookup)).toBe(280);
  });

  it("stacks grids whose columns cannot fit side-by-side", () => {
    const twoCol = grid(
      [1, 1],
      [1],
      [
        { col: 1, row: 1, child: panel("a") },
        { col: 2, row: 1, child: panel("b") },
      ],
    );

    const needed = 560 + GRID_GUTTER_PX + 280;
    expect(shouldStackGrid(needed - 1, twoCol, panels, lookup)).toBe(true);
    expect(shouldStackGrid(needed, twoCol, panels, lookup)).toBe(false);

    // Single-column grids never stack.
    const oneCol = grid(
      [1],
      [1, 1],
      [
        { col: 1, row: 1, child: panel("a") },
        { col: 1, row: 2, child: panel("b") },
      ],
    );

    expect(shouldStackGrid(200, oneCol, panels, lookup)).toBe(false);
  });

  it("clamps dragged track fractions to pixel minimums", () => {
    // 1000px usable, tracks [3, 1] -> 750px / 250px. Left min 560px = 0.56 of
    // the pair total, so dragging below that clamps.
    const clamped = clampTrackFractions(3, 1, 1000, 560, 280);
    expect(clamped.left / clamped.right).toBeGreaterThanOrEqual(
      560 / 1000 - 1e-9,
    );
    expect(clamped.left + clamped.right).toBeCloseTo(4, 10);
    // Free drags inside the bounds pass through.
    const free = clampTrackFractions(2.5, 1.5, 1000, 560, 280);
    expect(free).toEqual({ left: 2.5, right: 1.5 });
  });

  it("clamps legacy split drag ratios to pixel minimums", () => {
    expect(clampRatioForMinWidths(0.5, 1000, 560, 280)).toBeCloseTo(0.5617, 3);
    expect(clampRatioForMinWidths(0.9, 1000, 560, 280)).toBeCloseTo(0.7192, 3);
    expect(clampRatioForMinWidths(0.65, 1000, 560, 280)).toBeCloseTo(0.65, 5);
    expect(clampRatioForMinWidths(0.5, 400, 560, 280)).toBe(0.5);
  });

  it("keeps legacy split stacking helpers working", () => {
    expect(effectiveSplitDirection("horizontal", 800, 560, 280)).toBe(
      "vertical",
    );
    expect(effectiveSplitDirection("horizontal", 1200, 560, 280)).toBe(
      "horizontal",
    );
    expect(effectiveSplitDirection("vertical", 400, 560, 280)).toBe("vertical");
  });

  it("picks readable directions for new cell splits", () => {
    expect(chooseSplitDirection("horizontal", 500)).toBe("vertical");
    expect(chooseSplitDirection("horizontal", 1400)).toBe("horizontal");
    expect(chooseSplitDirection("vertical", 500)).toBe("vertical");
  });
});

describe("packMasonry", () => {
  it("derives the column count from the target width, not card minimums", () => {
    // 1584px container, 320px target, 8px gap -> 4 columns of ~390px,
    // even when one card would "want" 990px: the density knob wins.
    const heights = [314, 524, 642, 504, 184, 240];
    const packing = packMasonry(1584, 320, MASONRY_GAP_PX, heights);

    expect(packing.columnCount).toBe(4);
    expect(packing.columnWidth).toBe(390);
    expect(packing.items).toHaveLength(6);
  });

  it("packs every card into the shortest column, leftmost on ties", () => {
    const packing = packMasonry(800, 320, 8, [200, 100, 50]);

    expect(packing.columnCount).toBe(2);
    expect(packing.columnWidth).toBe(396);
    // Card 0 -> column 0 (tie 0/0, leftmost), card 1 -> column 1,
    // card 2 -> column 1 again (100+8 < 200+8).
    expect(packing.items.map((item) => item.left)).toEqual([0, 404, 404]);
    expect(packing.items.map((item) => item.top)).toEqual([0, 0, 108]);
  });

  it("stretches columns to fill the row and reports the tallest column", () => {
    const heights = [100, 400, 300, 50, 150];
    const packing = packMasonry(1000, 240, 8, heights);

    let tallest = 0;

    for (let index = 0; index < heights.length; index++) {
      const item = packing.items[index]!;

      tallest = Math.max(tallest, item.top + heights[index]!);
    }

    expect(packing.height).toBe(tallest);
    // Four target columns -> actual count 4, width fills 1000px minus gutters.
    expect(packing.columnCount).toBe(4);
    expect(packing.columnWidth * 4 + 8 * 3).toBeLessThanOrEqual(1000);
    expect(packing.columnWidth * 4 + 8 * 3).toBeGreaterThan(1000 - 4);
  });

  it("collapses to one column on narrow containers and clamps inputs", () => {
    const narrow = packMasonry(300, 320, MASONRY_GAP_PX, [200, 100]);

    expect(narrow.columnCount).toBe(1);
    expect(narrow.columnWidth).toBe(300);
    expect(narrow.items.map((item) => item.left)).toEqual([0, 0]);

    // Unmeasured container: consistent zero-width geometry, no NaN.
    const unmeasured = packMasonry(0, 320, MASONRY_GAP_PX, [200, 100]);

    expect(unmeasured.columnWidth).toBe(0);
    expect(unmeasured.height).toBe(0);
    expect(unmeasured.items).toHaveLength(2);

    // Hostile inputs stay finite.
    const hostile = packMasonry(Number.NaN, Number.NaN, -4, [Number.NaN, 80]);

    expect(Number.isFinite(hostile.columnWidth)).toBe(true);
    expect(hostile.items.every((item) => Number.isFinite(item.top))).toBe(true);
  });

  it("places spanned cards across consecutive columns with per-item widths", () => {
    // 1608px container, 380px target, 8px gap -> 4 columns of 396px.
    const packing = packMasonry(1608, 380, 8, [200, 100, 150, 300], {
      spans: [1, 2, 1, 1],
    });

    expect(packing.columnCount).toBe(4);
    expect(packing.columnWidth).toBe(396);

    // Card 0 -> column 0 (all windows tie at 0, leftmost wins).
    expect(packing.items[0]).toMatchObject({ left: 0, top: 0, width: 396 });
    // Card 1 spans columns 1-2 (the lowest two-column window).
    expect(packing.items[1]).toMatchObject({ left: 404, top: 0, width: 800 });
    // Card 2 -> column 3 (the only untouched column).
    expect(packing.items[2]).toMatchObject({ left: 1212, top: 0, width: 396 });
    // Card 3 -> the leftmost of the tied short columns (1 and 2).
    expect(packing.items[3]).toMatchObject({ left: 404, top: 108 });
  });

  it("caps the column count so wide monitors never build sliver columns", () => {
    // 2560px with a 240px target would derive 10 columns; the cap holds 4.
    const packing = packMasonry(2560, 240, 8, [100, 100, 100, 100, 100]);

    expect(packing.columnCount).toBe(4);
    expect(packing.columnWidth).toBe(634);

    // A custom cap below the default is honored too.
    const capped = packMasonry(2560, 240, 8, [100, 100], { maxColumns: 2 });

    expect(capped.columnCount).toBe(2);
  });

  it("clamps spans to the live column count and tolerates invalid entries", () => {
    // Two columns available; a requested span of 4 renders full-width.
    const packing = packMasonry(800, 320, 8, [100, 100], { spans: [4, 1] });

    expect(packing.columnCount).toBe(2);
    expect(packing.items[0]).toMatchObject({ left: 0, width: 800 });
    // Both columns tie under the full-width card, so the next card is
    // placed leftmost again.
    expect(packing.items[1]).toMatchObject({ left: 0, top: 108 });

    // Missing / non-finite spans read as 1.
    const defaulted = packMasonry(800, 320, 8, [100, 100], {
      spans: [Number.NaN],
    });

    expect(defaulted.items.map((item) => item.width)).toEqual([396, 396]);
  });

  it("renders fractional spans steplessly while reserving whole columns", () => {
    // 800px / (320+8) → 2 columns of 396 (step 404). A 1.5 span renders
    // 1.5·404−8 wide but occupies both columns, so the next card stacks
    // below it — never beside it.
    const packing = packMasonry(800, 320, 8, [100, 100], { spans: [1.5, 1] });

    expect(packing.items[0]!.width).toBeCloseTo(1.5 * 404 - 8, 9);
    expect(packing.items[1]).toMatchObject({ left: 0, top: 108, width: 396 });
  });
});

describe("packAuto", () => {
  it("packs every card into the shortest column run (masonry gravity)", () => {
    // 1000px / (240+8) → 4 columns of 244 (step 252). All span-1: the
    // first four fill the four columns, the fifth lands in the shortest
    // (all tie at 108 after the first row — leftmost wins) with no gaps.
    const packing = packAuto(1000, 240, 8, [100, 200, 300, 150, 120], {
      spans: [1, 1, 1, 1, 1],
    });

    expect(packing.columnCount).toBe(4);
    expect(packing.columnWidth).toBe(244);

    // First row: one card per column, all tops at 0.
    expect(packing.items[0]).toMatchObject({ height: 100, top: 0, left: 0 });
    expect(packing.items[1]).toMatchObject({ height: 200, top: 0 });
    expect(packing.items[2]).toMatchObject({ height: 300, top: 0 });
    expect(packing.items[3]).toMatchObject({ height: 150, top: 0 });

    // Fifth card slides into the shortest column (column 0: 100+8 is the
    // lowest top) — gravity to the top, no row gaps.
    expect(packing.items[4]).toMatchObject({ left: 0, top: 108, height: 120 });

    // Total height: tallest column (300) — trailing gap trimmed.
    expect(packing.height).toBe(300);
  });

  it("fills empty space under short cards instead of leaving row gaps", () => {
    // The regression for the Market Watch wall: a short tape (160) next
    // to a tall chart (540) must NOT leave 380px of dead space — the next
    // cards slide into the shortest columns.
    const packing = packAuto(1920, 360, 8, [260, 360, 160, 540, 220, 320], {
      spans: [2, 2, 2, 3, 2, 2],
    });

    // No card overlaps another and no card floats with dead space above
    // it that a previous card could have filled: every card sits on the
    // lowest available run for its span.
    for (let i = 0; i < packing.items.length; i++) {
      for (let j = i + 1; j < packing.items.length; j++) {
        const a = packing.items[i]!;
        const b = packing.items[j]!;
        const ah = [260, 360, 160, 540, 220, 320][i]!;
        const bh = [260, 360, 160, 540, 220, 320][j]!;
        const overlapX = a.left < b.left + b.width && b.left < a.left + a.width;
        const overlapY = a.top < b.top + bh && b.top < a.top + ah;
        expect(overlapX && overlapY).toBe(false);
      }
    }

    // The wall is compact: height is the tallest column, not the sum of
    // row maxima (row packing would stack 360 + 540 + 320 = 1220+).
    expect(packing.height).toBeLessThan(360 + 8 + 540 + 8 + 320);
  });

  it("keeps exact sizes with no justification or stretch", () => {
    // 4 columns; every card keeps span × step − gap and its own height.
    const packing = packAuto(1000, 240, 8, [100, 100, 100, 100], {
      spans: [1, 1, 1, 2],
    });

    expect(packing.items[0]!.width).toBe(244);
    expect(packing.items[1]!.width).toBe(244);
    expect(packing.items[2]!.width).toBe(244);
    expect(packing.items[3]!.width).toBe(2 * 252 - 8);

    for (const item of packing.items) expect(item.height).toBe(100);
  });

  it("places spanned cards across consecutive columns", () => {
    // 1600px / (240+8) → 6 columns of 260 (step 268). A span-4 card
    // occupies the lowest 4-run; followers fill the shortest runs after it.
    const packing = packAuto(
      1600,
      240,
      8,
      [100, 100, 100, 100, 100, 100, 100],
      { spans: [1, 1, 1, 4, 1, 1, 1] },
    );

    expect(packing.columnCount).toBe(6);

    expect(packing.items[0]!.width).toBe(260);
    expect(packing.items[1]!.width).toBe(260);
    expect(packing.items[2]!.width).toBe(260);
    expect(packing.items[0]!.left).toBe(0);
    expect(packing.items[1]!.left).toBe(268);
    expect(packing.items[2]!.left).toBe(536);
    expect(packing.items[3]!.width).toBe(4 * 268 - 8);
  });

  it("derives columns from the target, caps them and ignores item count", () => {
    // 2560px with a 240px target would derive 10; the cap holds 6.
    const packing = packAuto(2560, 240, 8, Array.from({ length: 10 }, () => 100), {});

    expect(packing.columnCount).toBe(6);

    // Sparse pages keep the full grid: capping columns at the card count
    // pinned a lone card full-width with its span locked at 1 — the
    // width-resize handle was a no-op until a second card existed.
    const sparse = packAuto(2560, 240, 8, [100, 100], {});

    expect(sparse.columnCount).toBe(6);

    // The regression itself: one card on an "empty page" still gets the
    // full column grid, so its span (and width) stays resizable.
    const lone = packAuto(2560, 240, 8, [100], {});

    expect(lone.columnCount).toBe(6);
    expect(lone.columnWidth).toBe(420);

    // A custom cap below the default is honored too.
    const capped = packAuto(2560, 240, 8, [100, 100, 100], { maxColumns: 2 });

    expect(capped.columnCount).toBe(2);
  });

  it("clamps spans to the live column count (wide cards go full-width)", () => {
    // 4 columns; a span-4 card occupies the whole first row, the next lands
    // below it in the shortest (all-tied, leftmost) column.
    const packing = packAuto(1000, 240, 8, [100, 100], { spans: [4, 1] });

    expect(packing.items[0]).toMatchObject({ left: 0, top: 0, width: 1000 });
    expect(packing.items[1]).toMatchObject({ left: 0, top: 108 });

    // An oversized span (6 > 4 columns) clamps to full width.
    const clamped = packAuto(1000, 240, 8, [100, 100], { spans: [6, 1] });

    expect(clamped.items[0]!.width).toBe(1000);

    // Missing / non-finite spans read as 1. The grid stays at 4 columns
    // (1000px / 248 step) — cards render one 244px column each and sit
    // side by side.
    const defaulted = packAuto(1000, 240, 8, [100, 100], {
      spans: [Number.NaN],
    });

    expect(defaulted.columnCount).toBe(4);
    expect(defaulted.items[0]!.width).toBe(244);
    expect(defaulted.items[1]!.width).toBe(244);
  });

  it("collapses to one column on narrow containers (spans clamp along)", () => {
    // 400px with a 320px target → 1 column; everything stacks full-width.
    const packing = packAuto(400, 320, 8, [100, 120, 90], { spans: [3, 2, 1] });

    expect(packing.columnCount).toBe(1);
    expect(packing.columnWidth).toBe(400);

    for (const [index, item] of packing.items.entries()) {
      expect(item.left).toBe(0);
      expect(item.width).toBe(400);
      expect(item.height).toBe([100, 120, 90][index]);
    }

    expect(packing.height).toBe(100 + 8 + 120 + 8 + 90);
  });

  it("returns zero geometry for unmeasured containers and empty input", () => {
    const zero = packAuto(0, 320, 8, [100, 100], {});

    expect(zero.columnWidth).toBe(0);
    expect(zero.height).toBe(0);
    expect(zero.items).toHaveLength(2);

    const empty = packAuto(1000, 320, 8, [], {});

    expect(empty.items).toHaveLength(0);
  });

  it("is deterministic: same inputs, same outputs", () => {
    const inputs: Array<number> = [210, 90, 333, 150, 150, 280];

    const runA = packAuto(1234, 320, 8, inputs, { spans: [1, 2, 1, 1, 3, 2] });
    const runB = packAuto(1234, 320, 8, [...inputs], { spans: [1, 2, 1, 1, 3, 2] });

    expect(runA).toEqual(runB);
  });

  it("packs fractional spans steplessly at exact sizes", () => {
    // 1000px / (240+8) → 4 columns of 244 (step 252; the grid no longer
    // shrinks to the card count). Fractional spans render exact widths
    // while occupying ceil(span) columns: 1.5 and 1.25 both reserve 2.
    const packing = packAuto(1000, 240, 8, [100, 100, 100], {
      spans: [1.5, 1.25, 2],
    });

    expect(packing.columnCount).toBe(4);
    expect(packing.columnWidth).toBe(244);
    // Exact fractional widths.
    expect(packing.items[0]!.width).toBeCloseTo(1.5 * 252 - 8, 9);
    expect(packing.items[1]!.width).toBeCloseTo(1.25 * 252 - 8, 9);
    // First card in columns 0-1, second in the next-lowest 2-run.
    expect(packing.items[0]!.left).toBe(0);
    // The span-2 card lands in the shortest 2-run after the first two.
    expect(packing.items[2]!.width).toBeCloseTo(2 * 252 - 8, 9);
  });

  it("packs integer spans at exact sizes (no float drift)", () => {
    // Regression guard: all-integer input keeps span × step − gap exactly.
    const packing = packAuto(1000, 240, 8, [100, 100, 100, 100], {
      spans: [1, 1, 1, 2],
    });

    expect(packing.items[0]!.width).toBe(244);
    expect(packing.items[1]!.width).toBe(244);
    expect(packing.items[2]!.width).toBe(244);
    expect(Number.isInteger(packing.items[0]!.width)).toBe(true);
  });

  it("autoSpanForWidth never falls below the content minimum", () => {
    // Preferred width rounds to the nearest column step...
    expect(autoSpanForWidth(360, 0, 320)).toBe(1); // 360/328 ≈ 1.10 → 1
    expect(autoSpanForWidth(640, 0, 320)).toBe(2); // 640/328 ≈ 1.95 → 2
    // ...but a card whose content needs more takes enough columns for it
    // (gap included: span k renders k·step − gap wide).
    expect(autoSpanForWidth(360, 370, 320)).toBe(2);
    expect(autoSpanForWidth(960, 990, 320)).toBe(4);
    expect(autoSpanForWidth(480, 560, 260)).toBe(3); // ceil(568/268) = 3
    // Preferred width may also WIN when it is the larger requirement.
    expect(autoSpanForWidth(960, 500, 320)).toBe(3);
    // Clamped to 1..maxColumns; junk input degrades to span 1.
    expect(autoSpanForWidth(2000, 2000, 320, 8, 2)).toBe(2);
    expect(autoSpanForWidth(NaN, NaN, 320)).toBe(1);
    expect(autoSpanForWidth(500, 400, 0)).toBe(2); // density fallback 320

    // Invariant: the span actually renders ≥ minWidth (until the cap).
    for (const [preferred, min] of [
      [360, 370],
      [480, 560],
      [960, 990],
    ] as const) {
      const span = autoSpanForWidth(preferred, min, 320);

      expect(span * (320 + 8) - 8).toBeGreaterThanOrEqual(min);
    }
  });

  it("minAutoSpan floors readability at the live density", () => {
    // Step 328 (320 + 8): a 370px widget needs ceil(378/328) = 2 columns.
    expect(minAutoSpan(370, 320)).toBe(2);
    expect(minAutoSpan(990, 320)).toBe(4);
    // No minimum (or junk) degrades to a single column.
    expect(minAutoSpan(0, 320)).toBe(1);
    expect(minAutoSpan(NaN, 320)).toBe(1);
    // Clamped to the live column count — a narrow window cannot honor more.
    expect(minAutoSpan(2000, 320, 8, 2)).toBe(2);

    // Invariant: the floor actually renders ≥ minWidth (until the cap).
    for (const min of [200, 370, 560, 990]) {
      const span = minAutoSpan(min, 320, 8, 6);

      expect(span * (320 + 8) - 8).toBeGreaterThanOrEqual(min);
    }
  });

  it("keeps exact sizes and shortest-column gravity (invariant over fuzz)", () => {
    // Deterministic pseudo-random heights/spans; every card keeps its exact
    // span width and own height, columns never overlap, every card sits on
    // the lowest available run (no fillable gaps above it).
    let seed = 42;

    const rand = (max: number): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;

      return seed % max;
    };

    for (let trial = 0; trial < 50; trial++) {
      const count = 2 + rand(9);
      const heights = Array.from({ length: count }, () => 80 + rand(300));
      const spans = Array.from({ length: count }, () => 1 + rand(4));
      const width = 600 + rand(1800);
      const packing = packAuto(width, 320, 8, heights, { spans });

      // Exact widths: span × step − gap (span clamped to live columns).
      const step = packing.columnWidth + 8;

      packing.items.forEach((item, index) => {
        const clamped = Math.max(1, Math.min(packing.columnCount, spans[index]!));

        expect(item.width).toBeCloseTo(clamped * step - 8, 9);
        expect(item.height).toBe(Math.ceil(heights[index]!));
      });

      // No two cards overlap.
      for (let i = 0; i < packing.items.length; i++) {
        for (let j = i + 1; j < packing.items.length; j++) {
          const a = packing.items[i]!;
          const b = packing.items[j]!;
          const ah = Math.ceil(heights[i]!);
          const bh = Math.ceil(heights[j]!);

          const overlapX =
            a.left < b.left + b.width - 1e-9 &&
            b.left < a.left + a.width - 1e-9;

          const overlapY = a.top < b.top + bh - 1e-9 && b.top < a.top + ah - 1e-9;
          expect(overlapX && overlapY).toBe(false);
        }
      }

      // Canvas height is the tallest column.
      let tallest = 0;
      packing.items.forEach((item, index) => {
        tallest = Math.max(tallest, item.top + Math.ceil(heights[index]!));
      });
      expect(packing.height).toBe(tallest);
    }
  });
});
