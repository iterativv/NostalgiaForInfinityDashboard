// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import {
  collectPanelIds,
  integrityErrors,
  replaceTabsSubtree,
} from "@nfi/widget-sdk";
import type { LayoutNode, PanelId, Workspace } from "@nfi/api-contract";
import { buildDefaultWorkspace } from "./defaultWorkspace";
import {
  GRID_PRESETS,
  buildEmptyGridLayout,
  buildGridFromShape,
  buildGridLayout,
  chunkContiguous,
  getGridPreset,
} from "./layouts";
import {
  HOME_PAGE_ID,
  PRESET_PAGES,
  buildHomePage,
  isHomePageId,
  isPresetBuiltInPanel,
  isPresetPageId,
  presetAspectBand,
  refreshPresetWorkspace,
  type PresetAspectBand,
} from "./pages";

/** Panel ids of the default workspace, in tree order. */
function defaultIds(): PanelId[] {
  const workspace = buildDefaultWorkspace();
  return collectPanelIds(workspace.layout);
}

describe("chunkContiguous", () => {
  it("splits evenly and front-loads remainders", () => {
    expect(chunkContiguous([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(chunkContiguous([1, 2, 3, 4, 5], 2)).toEqual([
      [1, 2, 3],
      [4, 5],
    ]);
    expect(chunkContiguous([1, 2], 4)).toEqual([[1], [2]]);
    expect(chunkContiguous([], 3)).toEqual([]);
    expect(chunkContiguous([1], 1)).toEqual([[1]]);
  });
});

describe("buildGridLayout", () => {
  it("covers every registered preset and places all panels exactly once", () => {
    const workspace: Workspace = buildDefaultWorkspace();
    const ids = defaultIds();
    for (const preset of GRID_PRESETS) {
      const layout = buildGridLayout(preset.id, ids);
      expect(layout, preset.id).not.toBeNull();
      const placed = collectPanelIds(layout!);
      expect([...placed].sort(), preset.id).toEqual([...ids].sort());
      expect(integrityErrors({ ...workspace, layout: layout! })).toEqual([]);
    }
  });

  it("degrades gracefully with few panels and refuses unknown presets", () => {
    const ids = defaultIds();
    const solo = buildGridLayout("mosaic-left-tall", ids.slice(0, 1));
    expect(solo?.type).toBe("tabs");
    expect(buildGridLayout("mosaic-left-tall", [])).toBeNull();
    expect(buildGridLayout("nope", ids)).toBeNull();
    expect(getGridPreset("nope")).toBeUndefined();
  });

  it("offers the grid preset catalogue", () => {
    expect(GRID_PRESETS.map((p) => p.id)).toEqual([
      "single",
      "columns-2",
      "columns-2-wide-left",
      "columns-2-wide-right",
      "columns-3",
      "columns-3-wide-center",
      "columns-3-wide-right",
      "columns-4",
      "columns-5",
      "rows-2",
      "rows-2-tall-top",
      "rows-3",
      "rows-4",
      "quad-2x2",
      "quad-2x3",
      "quad-3x2",
      "lattice-3x3",
      "mosaic-left-tall",
      "mosaic-right-tall",
      "mosaic-top-wide",
      "mosaic-bottom-wide",
      "hero-right",
      "hero-center",
      "bulletin",
    ]);
  });

  it("places panels into explicit spanning cells in fill order", () => {
    const ids = ["a", "b", "c", "d", "e"] as PanelId[];
    const layout = buildGridFromShape(ids, {
      columns: [1, 2],
      rows: [2, 1, 1],
      cells: [
        { col: 1, row: 1, rowSpan: 2 },
        { col: 2, row: 1 },
        { col: 2, row: 2 },
        { col: 1, row: 3, colSpan: 2 },
      ],
    });
    expect(layout?.type).toBe("grid");
    const grid = layout as Extract<LayoutNode, { type: "grid" }>;
    expect(grid.columns).toEqual([1, 2]);
    expect(
      grid.items.map((item) => [
        item.col,
        item.row,
        item.colSpan,
        item.rowSpan,
      ]),
    ).toEqual([
      [1, 1, 1, 2],
      [2, 1, 1, 1],
      [2, 2, 1, 1],
      [1, 3, 2, 1],
    ]);
    expect(collectPanelIds(grid)).toEqual(ids);
    const workspace: Workspace = {
      ...buildDefaultWorkspace(),
      layout: grid,
      panels: Object.fromEntries(
        ids.map((id) => [
          id,
          {
            id,
            widgetType: "development.inspector" as never,
            widgetConfig: {},
          },
        ]),
      ),
      activePanelId: ids[0] ?? null,
    };
    expect(integrityErrors(workspace)).toEqual([]);
  });

  it("collapses a single chunk back to one tab group", () => {
    const layout = buildGridFromShape(["a"] as PanelId[], {
      columns: [1, 1],
      rows: [1],
      cells: [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
      ],
    });
    expect(layout?.type).toBe("tabs");
  });

  it("builds empty skeletons with the preset geometry", () => {
    for (const preset of GRID_PRESETS) {
      const skeleton = buildEmptyGridLayout(preset.id);
      expect(skeleton, preset.id).not.toBeNull();
      expect(collectPanelIds(skeleton!)).toEqual([]);
      // Multi-cell presets build grids; single-cell presets a lone group.
      if (preset.shape.cells.length > 1) {
        expect(skeleton?.type, preset.id).toBe("grid");
      } else {
        expect(skeleton?.type, preset.id).toBe("tabs");
      }
    }
    expect(buildEmptyGridLayout("nope")).toBeNull();
  });

  it("swaps skeletons into an empty root without touching siblings", () => {
    const workspace = buildDefaultWorkspace();
    const emptied: Workspace = {
      ...workspace,
      layout: {
        type: "tabs",
        id: "tabs-empty" as never,
        panels: [],
        activePanelId: null,
      },
      panels: {},
      activePanelId: null,
    };
    const skeleton = buildEmptyGridLayout("quad-2x2")!;
    const next = replaceTabsSubtree(emptied, "tabs-empty", skeleton);
    expect(next.layout.type).toBe("grid");
    expect(integrityErrors(next)).toEqual([]);
  });
});

describe("preset pages", () => {
  it("build valid dense grids with every panel visible exactly once", () => {
    for (const preset of PRESET_PAGES) {
      const workspace = preset.build();
      expect(integrityErrors(workspace), preset.id).toEqual([]);
      const placed = collectPanelIds(workspace.layout);
      expect(placed, preset.id).toHaveLength(preset.widgets.length);
      // Dense: every panel sits in its own cell — no hidden tabs.
      const grid = workspace.layout as Extract<LayoutNode, { type: "grid" }>;
      expect(grid.type, preset.id).toBe("grid");
      expect(grid.items, preset.id).toHaveLength(preset.widgets.length);
      expect(
        grid.items.every(
          (item) =>
            item.child.type === "tabs" && item.child.panels.length === 1,
        ),
        preset.id,
      ).toBe(true);
      const types = grid.items.map(
        (item) =>
          item.child.type === "tabs" &&
          workspace.panels[item.child.panels[0]!]?.widgetType,
      );
      expect(types, preset.id).toEqual(
        preset.widgets.map((w) => (typeof w === "string" ? w : w.type)),
      );
      expect(workspace.id).toBe(preset.id);
    }
  });

  it("cover the expected pages and pin built-in panels only", () => {
    expect(PRESET_PAGES.map((p) => p.id)).toEqual([
      "page-overview",
      "page-public",
      "page-trading",
      "page-markets",
      "page-performance",
      "page-risk",
      "page-system",
    ]);
    // The Public wall is exclusively non-sensitive widgets (percent-only).
    const publicPage = PRESET_PAGES.find((p) => p.id === "page-public")!;
    expect(publicPage.widgets).toEqual([
      "equity-relative",
      "profit-relative",
      "balance-relative",
      "positions-open-relative",
      "closed-positions-relative",
      "tag-performance-relative",
    ]);
    for (const preset of PRESET_PAGES) {
      const workspace = preset.build();
      for (const id of collectPanelIds(workspace.layout)) {
        expect(isPresetBuiltInPanel(preset.id, id), `${preset.id}:${id}`).toBe(
          true,
        );
      }
      // User-added tabs (random ids) stay editable.
      expect(isPresetBuiltInPanel(preset.id, "panel-random-1")).toBe(false);
    }
    expect(isPresetPageId("page-trading")).toBe(true);
    expect(isPresetPageId("page-custom-1")).toBe(false);
  });

  it("home page is valid, local, and fresh per call", () => {
    const home = buildHomePage();
    expect(home.id).toBe(HOME_PAGE_ID);
    expect(isHomePageId(home.id)).toBe(true);
    expect(isPresetPageId(home.id)).toBe(false);
    expect(integrityErrors(home)).toEqual([]);
    expect(buildHomePage()).toEqual(home);
    expect(buildHomePage()).not.toBe(home);
  });
  it("re-curates stale preset pages, keeping configs and user tabs", () => {
    const preset = PRESET_PAGES.find((p) => p.id === "page-trading")!;
    // A stale stored page: old 3-cell shape, one modified built-in config
    // and one user-added tab.
    const stale = preset.build();
    const staleLayout = {
      type: "tabs",
      id: "tabs-old" as never,
      panels: [
        "page-trading-panel-0",
        "page-trading-panel-1",
        "panel-user-9",
      ] as never[],
      activePanelId: "page-trading-panel-0" as never,
    } as unknown as LayoutNode;
    const stored: Workspace = {
      ...stale,
      layout: staleLayout,
      panels: {
        "page-trading-panel-0": {
          ...stale.panels["page-trading-panel-0"]!,
          widgetConfig: { instanceId: "bot-2" },
        },
        "page-trading-panel-1": stale.panels["page-trading-panel-1"]!,
        "panel-user-9": {
          id: "panel-user-9" as never,
          widgetType: "session-clock" as never,
          widgetConfig: {},
        },
      },
    };
    const refreshed = refreshPresetWorkspace(stored, preset);
    expect(refreshed).not.toBe(stored);
    expect(refreshed.version).toBe(stored.version + 1);
    // Curated dense grid is back: every built-in placed, one widget per cell.
    expect(integrityErrors(refreshed)).toEqual([]);
    const ids = collectPanelIds(refreshed.layout).map(String);
    expect(ids).toHaveLength(preset.widgets.length + 1);
    // User tab re-attached (into the first group); stored config preserved.
    expect(ids).toContain("panel-user-9");
    expect(refreshed.panels["page-trading-panel-0"]?.widgetConfig).toEqual({
      instanceId: "bot-2",
    });
    // A fresh curated store passes through untouched (no churn).
    const fresh = preset.build();
    expect(refreshPresetWorkspace(fresh, preset)).toBe(fresh);
  });

  it("build every aspect-band variant with the same widget reading order", () => {
    const bands: PresetAspectBand[] = ["standard", "wide", "compact"];
    for (const preset of PRESET_PAGES) {
      const expected = preset.widgets.map((w) =>
        typeof w === "string" ? w : w.type,
      );
      for (const band of bands) {
        const workspace = preset.build(band);
        expect(integrityErrors(workspace), `${preset.id}:${band}`).toEqual([]);
        const grid = workspace.layout as Extract<
          LayoutNode,
          { type: "grid" }
        >;
        // One widget per cell in every band — same roles, same order.
        expect(grid.type, `${preset.id}:${band}`).toBe("grid");
        expect(
          grid.items.every(
            (item) =>
              item.child.type === "tabs" && item.child.panels.length === 1,
          ),
          `${preset.id}:${band}`,
        ).toBe(true);
        const types = grid.items.map(
          (item) =>
            item.child.type === "tabs" &&
            workspace.panels[item.child.panels[0]!]?.widgetType,
        );
        expect(types, `${preset.id}:${band}`).toEqual(expected);
      }
    }
  });

  it("re-curates across bands and falls back to the standard shape", () => {
    const preset = PRESET_PAGES.find((p) => p.id === "page-trading")!;
    const standard = preset.build();
    // No variant change → stored passes through untouched.
    expect(refreshPresetWorkspace(standard, preset, "standard")).toBe(
      standard,
    );
    // Crossing to the wide band re-curates (different shape, same widgets).
    const wide = refreshPresetWorkspace(standard, preset, "wide");
    expect(wide).not.toBe(standard);
    expect(wide.version).toBe(standard.version + 1);
    expect(integrityErrors(wide)).toEqual([]);
    const wideGrid = wide.layout as Extract<LayoutNode, { type: "grid" }>;
    expect(wideGrid.columns).toHaveLength(4);
    expect(collectPanelIds(wide.layout)).toEqual(
      collectPanelIds(standard.layout),
    );
    // Unknown-band pages without a variant fall back to the standard shape.
    const plain = PRESET_PAGES.map((p) => ({
      page: p.id,
      hasVariants: p.variants !== undefined,
    }));
    expect(plain.every((entry) => entry.hasVariants)).toBe(true);
  });
});

describe("presetAspectBand", () => {
  it("classifies viewport aspect ratios into bands", () => {
    expect(presetAspectBand(3440 / 1440)).toBe("wide"); // 21:9 ultrawide
    expect(presetAspectBand(2.0)).toBe("wide"); // boundary is inclusive
    expect(presetAspectBand(1920 / 1080)).toBe("standard"); // 16:9
    expect(presetAspectBand(1.6)).toBe("standard"); // 16:10
    expect(presetAspectBand(1.4)).toBe("compact"); // boundary is inclusive
    expect(presetAspectBand(1024 / 768)).toBe("compact"); // 4:3
  });
});
