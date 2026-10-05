// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import type { ViewInfo } from "@danfessler/trellis-react";
import {
  GRID_PRESETS,
  distributeSlots,
  ensureNonEmptyPreset,
  groupStageViews,
  isPresetUsable,
  nodeToSpec,
  previewForPreset,
  previewSummary,
  type PresetNode,
  type ViewGroup,
} from "./TrellisPresets";

const view = (
  id: string,
  panelId: string,
  opts?: Partial<ViewInfo>,
): ViewInfo => ({
  id,
  type: "widget",
  params: { panelId: id },
  title: id,
  panelId,
  placement: "docked",
  selected: false,
  ...opts,
});

const makeGroups = (count: number): ViewGroup[] =>
  Array.from({ length: count }, (_, i) => ({
    views: [
      {
        id: `view-${i}`,
        type: "widget",
        params: { panelId: `p${i}` },
        title: `p${i}`,
        selected: true,
      },
    ],
  }));

/** Total tabs across every cell of a preset tree. */
const tabsIn = (node: PresetNode): number =>
  node.kind === "cell"
    ? node.groups.reduce((s, g) => s + g.views.length, 0)
    : node.children.reduce((s, c) => s + tabsIn(c), 0);

/** Cell tab counts in tree order (0 = empty slot). */
const cellsIn = (node: PresetNode): number[] =>
  node.kind === "cell"
    ? [node.groups.reduce((s, g) => s + g.views.length, 0)]
    : node.children.flatMap(cellsIn);

const preset = (id: string) => GRID_PRESETS.find((p) => p.id === id)!;

describe("groupStageViews", () => {
  it("keeps tab stacks together in first-seen order", () => {
    const groups = groupStageViews([
      view("v1", "panel-a", { selected: true }),
      view("v2", "panel-b"),
      view("v3", "panel-a"),
    ]);

    expect(groups.map((g) => g.views.map((v) => v.id))).toEqual([
      ["v1", "v3"],
      ["v2"],
    ]);
    expect(groups[0]?.views[0]?.selected).toBe(true);
  });

  it("drops floating, hidden and slot placeholder views", () => {
    const groups = groupStageViews([
      view("v1", "panel-a"),
      view("v2", "panel-b", { placement: "floating" }),
      view("v3", "panel-c", { placement: "hidden" }),
      view("v4", "panel-d", { placement: "stage" }),
      {
        ...view("slot-0", "panel-e"),
        type: "slot",
        params: { slot: "slot-0" },
      },
    ]);

    expect(groups.map((g) => g.views.map((v) => v.id))).toEqual([
      ["v1"],
      ["v4"],
    ]);
  });
});

describe("distributeSlots", () => {
  it("pads missing groups with empty slots", () => {
    expect(distributeSlots(makeGroups(1), 2).map((c) => c.length)).toEqual([
      1, 0,
    ]);
    expect(distributeSlots(makeGroups(1), 4).map((c) => c.length)).toEqual([
      1, 0, 0, 0,
    ]);
  });

  it("merges overflow into the last cell, keeping the shape fixed", () => {
    expect(distributeSlots(makeGroups(3), 2).map((c) => c.length)).toEqual([
      1, 2,
    ]);
    expect(distributeSlots(makeGroups(5), 4).map((c) => c.length)).toEqual([
      1, 1, 1, 2,
    ]);
    expect(distributeSlots(makeGroups(2), 2).map((c) => c.length)).toEqual([
      1, 1,
    ]);
  });

  it("never emits more cells than slots", () => {
    expect(distributeSlots([], 3)).toEqual([[], [], []]);
    expect(distributeSlots(makeGroups(2), 0)).toEqual([]);
  });
});

describe("preset arrangement", () => {
  it("covers every tab exactly once for 1..10 groups", () => {
    for (const p of GRID_PRESETS) {
      for (let n = 1; n <= 10; n++) {
        expect(tabsIn(p.arrange(makeGroups(n)))).toBe(n);
      }
    }
  });

  it("carries a unique id, section and minimum on every preset", () => {
    expect(new Set(GRID_PRESETS.map((p) => p.id)).size).toBe(
      GRID_PRESETS.length,
    );

    for (const p of GRID_PRESETS) {
      expect(p.section.length).toBeGreaterThan(0);
      expect(p.minGroups).toBeGreaterThanOrEqual(1);
    }
  });

  it("lays pro terminal slots with watchlist-chart-ticket weights", () => {
    const node = preset("pro-terminal").arrange(makeGroups(2));

    expect(node).toMatchObject({
      kind: "row",
      weights: [0.22, 0.56, 0.22],
    });
    expect(cellsIn(node)).toEqual([1, 1, 0]);
  });

  it("parks chart-desk extras in a fixed two-slot ticket column", () => {
    expect(cellsIn(preset("chart-desk").arrange(makeGroups(1)))).toEqual([
      1, 0, 0,
    ]);
    expect(cellsIn(preset("chart-desk").arrange(makeGroups(4)))).toEqual([
      1, 1, 2,
    ]);
  });

  it("builds video walls with exact slot counts", () => {
    expect(cellsIn(preset("desk-6").arrange(makeGroups(7)))).toEqual([
      1, 1, 1, 1, 1, 2,
    ]);
    expect(cellsIn(preset("wall-8").arrange(makeGroups(2)))).toEqual([
      1, 1, 0, 0, 0, 0, 0, 0,
    ]);
    expect(cellsIn(preset("wall-9").arrange(makeGroups(9)))).toEqual([
      1, 1, 1, 1, 1, 1, 1, 1, 1,
    ]);
  });

  it("frames terminal-classic and tape strip around the hero", () => {
    expect(
      cellsIn(preset("terminal-classic").arrange(makeGroups(2))),
    ).toEqual([1, 1, 0, 0]);
    expect(cellsIn(preset("chart-strip").arrange(makeGroups(3)))).toEqual([
      1, 2,
    ]);
    expect(cellsIn(preset("chart-strip").arrange(makeGroups(1)))).toEqual([
      1, 0,
    ]);
  });
  it("side-by-side always makes two slots, padding the empty one", () => {
    expect(cellsIn(preset("side-by-side").arrange(makeGroups(1)))).toEqual([
      1, 0,
    ]);
    expect(cellsIn(preset("side-by-side").arrange(makeGroups(3)))).toEqual([
      1, 2,
    ]);
  });

  it("grids 2x2 with empties padded and overflow merged last", () => {
    expect(cellsIn(preset("grid-2x2").arrange(makeGroups(1)))).toEqual([
      1, 0, 0, 0,
    ]);

    const node = preset("grid-2x2").arrange(makeGroups(5));

    expect(node.kind).toBe("column");
    expect(cellsIn(node)).toEqual([1, 1, 1, 2]);

    if (node.kind === "column") {
      expect(node.children.length).toBe(2);
      expect(node.children.every((c) => c.kind === "row")).toBe(true);
    }
  });

  it("parks the first group wide left with an empty sidebar when alone", () => {
    const node = preset("main-left").arrange(makeGroups(1));

    expect(node).toMatchObject({ kind: "row", weights: [0.68, 0.32] });
    expect(cellsIn(node)).toEqual([1, 0]);
  });

  it("stacks the sidebar without merging", () => {
    const node = preset("main-left").arrange(makeGroups(4));

    expect(cellsIn(node)).toEqual([1, 1, 1, 1]);
  });

  it("stacks two slots vertically", () => {
    const node = preset("split-vertical").arrange(makeGroups(1));

    expect(node.kind).toBe("column");
    expect(cellsIn(node)).toEqual([1, 0]);
    expect(
      previewSummary(previewForPreset(preset("split-vertical"), makeGroups(3))),
    ).toBe("1 + 2");
  });

  it("stacks three slots in one column", () => {
    expect(cellsIn(preset("triple-stack").arrange(makeGroups(2)))).toEqual([
      1, 1, 0,
    ]);
  });

  it("lays five slots across one row", () => {
    expect(cellsIn(preset("five-across").arrange(makeGroups(2)))).toEqual([
      1, 1, 0, 0, 0,
    ]);
  });

  it("builds a twelve-slot video wall", () => {
    expect(cellsIn(preset("wall-12").arrange(makeGroups(2)))).toEqual([
      1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(cellsIn(preset("wall-12").arrange(makeGroups(13)))).toEqual([
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2,
    ]);
  });

  it("decks two columns across three rows", () => {
    const node = preset("triple-deck").arrange(makeGroups(2));

    expect(node.kind).toBe("column");
    expect(cellsIn(node)).toEqual([1, 1, 0, 0, 0, 0]);
  });

  it("frames a hero over a 2 × 2 quad", () => {
    expect(cellsIn(preset("hero-quad").arrange(makeGroups(1)))).toEqual([
      1, 0, 0, 0, 0,
    ]);
    expect(cellsIn(preset("hero-quad").arrange(makeGroups(6)))).toEqual([
      1, 1, 1, 1, 2,
    ]);
  });

  it("splits the corner cell of a 2 × 2 into five slots", () => {
    expect(cellsIn(preset("corner-office").arrange(makeGroups(2)))).toEqual([
      1, 1, 0, 0, 0,
    ]);
    expect(cellsIn(preset("corner-office").arrange(makeGroups(6)))).toEqual([
      1, 1, 1, 1, 2,
    ]);
  });

  it("flanks the main act with two stacks per side", () => {
    expect(cellsIn(preset("center-stage").arrange(makeGroups(1)))).toEqual([
      0, 0, 1, 0, 0,
    ]);
    expect(cellsIn(preset("center-stage").arrange(makeGroups(5)))).toEqual([
      1, 1, 1, 1, 1,
    ]);
    expect(cellsIn(preset("center-stage").arrange(makeGroups(7)))).toEqual([
      1, 2, 1, 1, 2,
    ]);
  });

  it("parks the first two groups left and tabs the rest right", () => {
    expect(cellsIn(preset("sidecar-tabs").arrange(makeGroups(1)))).toEqual([
      1, 0, 0,
    ]);
    expect(cellsIn(preset("sidecar-tabs").arrange(makeGroups(4)))).toEqual([
      1, 1, 2,
    ]);
    expect(
      previewSummary(previewForPreset(preset("sidecar-tabs"), makeGroups(4))),
    ).toBe("1 + 1 + 2");
  });

  it("triples across three slots", () => {
    expect(cellsIn(preset("triple").arrange(makeGroups(2)))).toEqual([
      1, 1, 0,
    ]);
  });

  it("merges everything into one tab stack", () => {
    const node = preset("tabs").arrange(makeGroups(3));

    expect(node.kind).toBe("cell");
    expect(cellsIn(node)).toEqual([3]);
  });

  it("stack keeps one row per group with no empties", () => {
    expect(cellsIn(preset("stack").arrange(makeGroups(3)))).toEqual([1, 1, 1]);
  });

  it("lays four slots across one row", () => {
    expect(cellsIn(preset("four-across").arrange(makeGroups(2)))).toEqual([
      1, 1, 0, 0,
    ]);
    expect(
      previewSummary(previewForPreset(preset("four-across"), makeGroups(2))),
    ).toBe("1 + 1 + empty × 2");
  });

  it("mirrors the sidebar right with matching weights", () => {
    const node = preset("main-right").arrange(makeGroups(1));

    expect(node).toMatchObject({ kind: "row", weights: [0.32, 0.68] });
    expect(cellsIn(node)).toEqual([0, 1]);
    expect(
      previewSummary(previewForPreset(preset("main-right"), makeGroups(1))),
    ).toBe("empty + 1");
  });

  it("puts the hero on top with two slots below", () => {
    const node = preset("main-top").arrange(makeGroups(1));

    expect(node).toMatchObject({ kind: "column", weights: [0.55, 0.45] });
    expect(cellsIn(node)).toEqual([1, 0, 0]);
    expect(
      previewSummary(previewForPreset(preset("main-top"), makeGroups(1))),
    ).toBe("1 + empty × 2");
    expect(cellsIn(preset("main-top").arrange(makeGroups(4)))).toEqual([
      1, 1, 2,
    ]);
  });

  it("puts two slots on top with the hero below", () => {
    const node = preset("main-bottom").arrange(makeGroups(1));

    expect(node).toMatchObject({ kind: "column", weights: [0.45, 0.55] });
    expect(cellsIn(node)).toEqual([0, 0, 1]);
    expect(
      previewSummary(previewForPreset(preset("main-bottom"), makeGroups(1))),
    ).toBe("empty × 2 + 1");
  });

  it("every preset yields at least one fillable slot on an empty page", () => {
    for (const p of GRID_PRESETS) {
      if (p.id === "stack") continue; // degenerate by design; wrapped at apply

      const cells = cellsIn(p.arrange([]));

      expect(cells.length).toBeGreaterThan(0);
      expect(cells.every((c) => c === 0)).toBe(true);
    }

    // The stack degenerate (zero children) becomes one empty slot.
    const wrapped = ensureNonEmptyPreset(preset("stack").arrange([]));

    expect(cellsIn(wrapped)).toEqual([0]);
  });

  it("leaves non-empty trees untouched", () => {
    const node = preset("side-by-side").arrange(makeGroups(1));

    expect(ensureNonEmptyPreset(node)).toBe(node);
  });
});

describe("nodeToSpec", () => {
  it("compiles rows/columns 1:1 with weights carried over", () => {
    const spec = nodeToSpec(preset("main-left").arrange(makeGroups(3)));

    expect(spec).toMatchObject({ kind: "split", axis: "x" });
  });

  it("emits fillable slot views for empty cells", () => {
    const spec = nodeToSpec(preset("side-by-side").arrange(makeGroups(1)));

    expect(spec).toMatchObject({ kind: "split", axis: "x" });

    if (spec.kind === "split") {
      const [filled, empty] = spec.children;
      expect(filled).toMatchObject({ kind: "view", type: "widget" });
      expect(empty).toMatchObject({
        kind: "view",
        type: "slot",
        id: "slot-0",
        title: "Empty pane",
      });
    }
  });

  it("keeps the selected tab index inside merged panels", () => {
    const groups: ViewGroup[] = [
      {
        views: [
          {
            id: "a",
            type: "widget",
            params: {},
            title: "a",
            selected: false,
          },
          {
            id: "b",
            type: "widget",
            params: {},
            title: "b",
            selected: true,
          },
        ],
      },
    ];

    const spec = nodeToSpec(preset("tabs").arrange(groups));

    expect(spec).toMatchObject({ kind: "panel", selected: 1 });
  });
});

describe("preset preview", () => {
  it("enables every preset on an empty stage (all yield fillable slots)", () => {
    for (const p of GRID_PRESETS) {
      expect(isPresetUsable(p, 0)).toBe(true);
    }

    expect(isPresetUsable(preset("tabs"), 1)).toBe(false);
    expect(isPresetUsable(preset("tabs"), 2)).toBe(true);
    expect(isPresetUsable(preset("stack"), 1)).toBe(true);
  });

  it("wraps the degenerate empty stack into one fillable slot", () => {
    expect(
      previewSummary(previewForPreset(preset("stack"), [])),
    ).toBe("empty");
    expect(
      previewSummary(previewForPreset(preset("side-by-side"), [])),
    ).toBe("empty × 2");
  });
  it("mirrors the applied cell distribution, empties included", () => {
    expect(
      previewSummary(previewForPreset(preset("side-by-side"), makeGroups(1))),
    ).toBe("1 + empty");
    expect(
      previewSummary(previewForPreset(preset("grid-2x2"), makeGroups(1))),
    ).toBe("1 + empty × 3");
    expect(
      previewSummary(previewForPreset(preset("grid-2x2"), makeGroups(5))),
    ).toBe("1 + 1 + 1 + 2");
    expect(
      previewSummary(previewForPreset(preset("tabs"), makeGroups(3))),
    ).toBe("3");
    expect(
      previewSummary(previewForPreset(preset("main-left"), makeGroups(1))),
    ).toBe("1 + empty");
  });
});
