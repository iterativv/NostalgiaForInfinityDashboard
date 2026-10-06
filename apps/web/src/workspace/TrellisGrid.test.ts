// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { builtinWidgets } from "@nfi/widgets";
import { packBentoRows, TRELLIS_GRID_ROW_UNITS } from "./TrellisWorkspace";
import { PRESET_PAGES } from "./pages";
import { buildDefaultWorkspace } from "./defaultWorkspace";

const widgetMin = new Map(
  builtinWidgets.map((definition) => [
    definition.type,
    { minWidth: definition.minWidth, minHeight: definition.minHeight },
  ]),
);

/**
 * Stage width every grid row must fit: a 1440px viewport leaves ~1400px
 * for the Trellis stage after shell chrome. Rows pack side-by-side cards
 * with span-proportional weights, so a row needs
 * `units * max(minWidth / span)` — not just the min sum. Below 56rem the
 * CSS stacks every panel into a scrolling column, so narrow screens are
 * covered without per-row checks.
 */
const MAX_ROW_STAGE_PX = 1400;

function rowStageNeed(
  mins: ReadonlyArray<number>,
  spans: ReadonlyArray<number>,
): number {
  const total = spans.reduce((sum, s) => sum + s, 0);
  const perUnit = Math.max(...mins.map((min, i) => min / spans[i]!));

  return total * perUnit;
}

describe("packBentoRows", () => {
  it("packs 3+2 pairs into full rows", () => {
    expect(packBentoRows([3, 2, 3, 2, 3, 2])).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
  });

  it("never shares a row between two wide tables (3+3 splits)", () => {
    expect(packBentoRows([3, 2, 2, 2, 3, 3])).toEqual([
      [0, 1],
      [2, 3],
      [4],
      [5],
    ]);
  });

  it("packs narrow pairs and leaves wide cards full-width", () => {
    expect(packBentoRows([2, 2, 2, 2, 3, 3])).toEqual([
      [0, 1],
      [2, 3],
      [4],
      [5],
    ]);
  });

  it("handles edge inputs without empty rows", () => {
    expect(packBentoRows([])).toEqual([]);
    expect(packBentoRows([3])).toEqual([[0]]);
    // Three 2-unit cards exceed the 5-unit row budget: the pair packs,
    // the third opens its own row.
    expect(packBentoRows([2, 2, 2])).toEqual([[0, 1], [2]]);
    expect(packBentoRows([5, 5])).toEqual([[0], [1]]);
    // Degenerate spans coerce instead of collapsing the grid.
    expect(packBentoRows([0, -1, Number.NaN])).toEqual([[0, 1, 2]]);
    expect(packBentoRows([6, 6])).toEqual([[0], [1]]);
  });

  it("covers every card exactly once", () => {
    const spans = [3, 2, 2, 3, 2, 3];

    expect(packBentoRows(spans).flat().sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  it("keeps the row budget at five units", () => {
    expect(TRELLIS_GRID_ROW_UNITS).toBe(5);
  });
});

describe("preset grids", () => {
  it("packs every preset into side-by-side rows (never all full-width)", () => {
    for (const preset of PRESET_PAGES) {
      const workspace = preset.build();
      expect(workspace.layout.type).toBe("auto");

      if (workspace.layout.type !== "auto") continue;

      const spans = workspace.layout.items.map((item) => item.span);
      const rows = packBentoRows(spans);

      // At least one row holds two cards side by side — the proper grid.
      expect(rows.some((row) => row.length >= 2)).toBe(true);

      // No row overflows the unit budget.
      for (const row of rows) {
        const units = row.reduce((sum, i) => sum + spans[i]!, 0);
        expect(units).toBeLessThanOrEqual(TRELLIS_GRID_ROW_UNITS);
      }
    }
  });

  it("fits every preset row on a desktop stage (no fresh-page warnings)", () => {
    for (const preset of PRESET_PAGES) {
      const workspace = preset.build();
      expect(workspace.layout.type).toBe("auto");

      if (workspace.layout.type !== "auto") continue;

      const spans = workspace.layout.items.map((item) => item.span);

      const mins = workspace.layout.items.map((item) => {
        if (item.child.type !== "tabs" || item.child.panels.length !== 1)
          throw new Error(`${preset.id}: expected one widget per card`);
        const panel = workspace.panels[item.child.panels[0]!];
        const min = widgetMin.get(panel?.widgetType ?? "");

        if (!min) throw new Error(`${preset.id}: unknown widget`);

        return min.minWidth;
      });

      const rows = packBentoRows(spans);

      for (const row of rows) {
        if (row.length < 2) continue; // full-width rows always fit

        const need = rowStageNeed(
          row.map((i) => mins[i]!),
          row.map((i) => spans[i]!),
        );

        expect(need).toBeLessThanOrEqual(MAX_ROW_STAGE_PX);
      }
    }
  });

  it("packs the curated row shapes", () => {
    const spansOf = (id: string): number[] => {
      const preset = PRESET_PAGES.find((p) => p.id === id)!;
      const workspace = preset.build();
      expect(workspace.layout.type).toBe("auto");

      if (workspace.layout.type !== "auto") throw new Error("expected auto");

      return workspace.layout.items.map((item) => item.span);
    };

    // Trading: chart+ticker, locks+trades, then open and closed full-width.
    expect(packBentoRows(spansOf("page-preset-trading"))).toEqual([
      [0, 1],
      [2, 3],
      [4],
      [5],
    ]);
    // Portfolio: two paired rows, then wallet and open full-width.
    expect(packBentoRows(spansOf("page-preset-portfolio"))).toEqual([
      [0, 1],
      [2, 3],
      [4],
      [5],
    ]);
    // Performance and risk: three paired rows.
    expect(packBentoRows(spansOf("page-preset-performance"))).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
    expect(packBentoRows(spansOf("page-preset-risk"))).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
    ]);
    // Market: two paired rows, then chart and universe full-width.
    expect(packBentoRows(spansOf("page-preset-market"))).toEqual([
      [0, 1],
      [2, 3],
      [4],
      [5],
    ]);
  });
});

describe("home grid", () => {
  it("pairs the first two rows and keeps the wide tables full-width", () => {
    const workspace = buildDefaultWorkspace();
    expect(workspace.layout.type).toBe("auto");

    if (workspace.layout.type !== "auto") return;

    const spans = workspace.layout.items.map((item) => item.span);
    expect(packBentoRows(spans)).toEqual([[0, 1], [2, 3], [4], [5]]);
  });
});
