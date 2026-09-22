// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import type { GridLayoutNode, LayoutNode } from "@nfi/api-contract";
import {
  chooseSplitDirection,
  clampRatioForMinWidths,
  clampTrackFractions,
  effectiveSplitDirection,
  getGridStackedMinWidth,
  getLayoutMinWidth,
  gridColumnMinWidths,
  GRID_GUTTER_PX,
  shouldStackGrid,
} from "./layout.js";
import { createWidgetRegistry, defineWidget } from "./widgets.js";
import { Schema } from "effect";

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

const panels = {
  a: { id: "a", widgetType: "test.table", widgetConfig: {} },
  b: { id: "b", widgetType: "test.stat", widgetConfig: {} },
} as unknown as Record<string, { widgetType: string }>;

const panel = (id: string): LayoutNode => ({
  type: "panel",
  panelId: id as never,
});
const tabs = (id: string, ...ids: string[]): LayoutNode => ({
  type: "tabs",
  id: id as never,
  panels: ids as never[],
  activePanelId: (ids[0] ?? null) as never,
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
  id: "g" as never,
  columns,
  rows,
  items: cells.map((cell, i) => ({
    type: "item",
    id: `g-${i}` as never,
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
      id: "s" as never,
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
