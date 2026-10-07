// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import type { LayoutNode, PanelNode, SplitNode } from "@danfessler/trellis";
import {
  TETRIS_COLUMNS,
  TETRIS_GAP_PX,
  packTetrisRows,
  panelWidthFractions,
  tetrisSpanAtOffset,
  tetrisSpanForMinWidth,
  tetrisSpanFromFraction,
} from "./tetris";

const panel = (id: string): PanelNode => ({
  kind: "panel",
  id,
  views: [`view-${id}`],
  selected: `view-${id}`,
});

const split = (
  axis: "x" | "y",
  children: LayoutNode[],
  weights?: number[],
): SplitNode => ({
  kind: "split",
  id: `split-${Math.random()}`,
  axis,
  children,
  weights: weights ?? [],
});

const stage = (child?: SplitNode | PanelNode): LayoutNode => ({
  kind: "stage",
  id: "stage",
  child,
});

describe("tetrisSpanFromFraction", () => {
  it("maps full width to a full row and halves to pairs", () => {
    expect(tetrisSpanFromFraction(1)).toBe(TETRIS_COLUMNS);
    expect(tetrisSpanFromFraction(0.5)).toBe(3);
    expect(tetrisSpanFromFraction(0.25)).toBe(2);
  });

  it("rounds to the nearest sixth and clamps to 1..columns", () => {
    expect(tetrisSpanFromFraction(0.7)).toBe(4);
    expect(tetrisSpanFromFraction(0.34)).toBe(2);
    expect(tetrisSpanFromFraction(0.01)).toBe(1);
    expect(tetrisSpanFromFraction(4)).toBe(TETRIS_COLUMNS);
  });

  it("degenerate fractions read as one column", () => {
    expect(tetrisSpanFromFraction(0)).toBe(1);
    expect(tetrisSpanFromFraction(-1)).toBe(1);
    expect(tetrisSpanFromFraction(Number.NaN)).toBe(1);
  });
});

describe("tetrisSpanForMinWidth", () => {
  it("gives a wide widget enough columns at the live stage size", () => {
    // 1200px stage, 6 columns, 8px gaps -> ~193px steps: a 640px chart needs 4.
    expect(tetrisSpanForMinWidth(640, 1200)).toBe(4);
    expect(tetrisSpanForMinWidth(370, 1200)).toBe(2);
    expect(tetrisSpanForMinWidth(280, 1200)).toBe(2);
  });

  it("never exceeds the grid and keeps zero minimums at span 1", () => {
    expect(tetrisSpanForMinWidth(5000, 1200)).toBe(TETRIS_COLUMNS);
    expect(tetrisSpanForMinWidth(0, 1200)).toBe(1);
    expect(tetrisSpanForMinWidth(Number.NaN, 1200)).toBe(1);
  });

  it("unmeasured stages read as span 1", () => {
    expect(tetrisSpanForMinWidth(640, 0)).toBe(1);
  });
});

describe("tetrisSpanAtOffset", () => {
  // 1200px stage, 6 columns, 8px gaps -> ~193px steps. The right edge of
  // span k sits at exactly k steps + (k-1) gaps from the block's left edge.
  const step = (1200 - 5 * TETRIS_GAP_PX) / TETRIS_COLUMNS;
  const edge = (k: number) => k * step + (k - 1) * TETRIS_GAP_PX;

  it("snaps the pointer to the nearest column line", () => {
    expect(tetrisSpanAtOffset(0, 1200)).toBe(1);
    expect(tetrisSpanAtOffset(edge(1), 1200)).toBe(1);
    expect(tetrisSpanAtOffset(edge(3) + 1, 1200)).toBe(3);
    expect(tetrisSpanAtOffset(edge(3) + (step + TETRIS_GAP_PX) / 2 + 1, 1200)).toBe(
      4,
    );
    expect(tetrisSpanAtOffset(edge(6), 1200)).toBe(TETRIS_COLUMNS);
  });

  it("clamps runaway drags and degenerate inputs", () => {
    expect(tetrisSpanAtOffset(9999, 1200)).toBe(TETRIS_COLUMNS);
    expect(tetrisSpanAtOffset(-80, 1200)).toBe(1);
    expect(tetrisSpanAtOffset(Number.NaN, 1200)).toBe(1);
    expect(tetrisSpanAtOffset(100, 0)).toBe(1);
  });
});

describe("packTetrisRows", () => {
  it("pairs even blocks and aligns every row at the top", () => {
    const wall = packTetrisRows([3, 3, 3, 3]);

    expect(wall).toEqual([
      { row: 1, column: 1, span: 3 },
      { row: 1, column: 4, span: 3 },
      { row: 2, column: 1, span: 3 },
      { row: 2, column: 4, span: 3 },
    ]);
  });

  it("wraps a block that no longer fits, keeping widths verbatim", () => {
    const wall = packTetrisRows([4, 2, 4, 2]);

    expect(wall).toEqual([
      { row: 1, column: 1, span: 4 },
      { row: 1, column: 5, span: 2 },
      { row: 2, column: 1, span: 4 },
      { row: 2, column: 5, span: 2 },
    ]);
  });

  it("backfills earlier pockets with later small blocks", () => {
    // A 4 leaves a 2-wide pocket; the next 2 fills it before a 3 opens a new row.
    const wall = packTetrisRows([4, 3, 2]);

    expect(wall).toEqual([
      { row: 1, column: 1, span: 4 },
      { row: 2, column: 1, span: 3 },
      { row: 1, column: 5, span: 2 },
    ]);
  });

  it("gives full-width blocks their own row", () => {
    const wall = packTetrisRows([6, 3, 3, 6]);

    expect(wall).toEqual([
      { row: 1, column: 1, span: 6 },
      { row: 2, column: 1, span: 3 },
      { row: 2, column: 4, span: 3 },
      { row: 3, column: 1, span: 6 },
    ]);
  });

  it("clamps runaway spans and coaxes degenerate ones to 1", () => {
    const wall = packTetrisRows([99, 0, 2.9]);

    expect(wall).toEqual([
      { row: 1, column: 1, span: TETRIS_COLUMNS },
      { row: 2, column: 1, span: 1 },
      { row: 2, column: 2, span: 2 },
    ]);
  });

  it("always fills every row exactly (no overflow, no holes it could fill)", () => {
    const spans = Array.from({ length: 40 }, (_, i) => (i % 7) + 1);

    for (const placement of packTetrisRows(spans)) {
      expect(placement.column).toBeGreaterThanOrEqual(1);
      expect(placement.column + placement.span - 1).toBeLessThanOrEqual(
        TETRIS_COLUMNS,
      );
      expect(placement.row).toBeGreaterThanOrEqual(1);
    }
  });

  it("packs an empty wall without rows", () => {
    expect(packTetrisRows([])).toEqual([]);
  });
});

describe("panelWidthFractions", () => {
  it("splits widths by weight along x and passes them down along y", () => {
    const fractions = panelWidthFractions(
      stage(split("y", [split("x", [panel("a"), panel("b")], [0.75, 0.25]), panel("c")])),
    );

    expect(fractions.get("a")).toBeCloseTo(0.75);
    expect(fractions.get("b")).toBeCloseTo(0.25);
    expect(fractions.get("c")).toBeCloseTo(1);
  });

  it("treats missing weights evenly and skips nothing", () => {
    const fractions = panelWidthFractions(
      stage(split("x", [panel("a"), panel("b"), panel("c")])),
    );

    expect(fractions.get("a")).toBeCloseTo(1 / 3);
    expect(fractions.get("b")).toBeCloseTo(1 / 3);
    expect(fractions.get("c")).toBeCloseTo(1 / 3);
  });

  it("maps a lone panel and an empty root", () => {
    expect(panelWidthFractions(stage(panel("a"))).get("a")).toBe(1);
    expect(panelWidthFractions(stage()).size).toBe(0);
    expect(panelWidthFractions(null).size).toBe(0);
  });
});
