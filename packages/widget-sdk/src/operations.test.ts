// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  decodeWorkspace,
  type PanelId,
  type TabsLayoutNode,
  type Workspace,
} from "@nfi/api-contract";
import {
  activatePanel,
  activateTab,
  closePanel,
  collectPanelIds,
  createPanelInstance,
  cycleTab,
  findTabsById,
  findTabsWithPanel,
  integrityErrors,
  movePanelToTabs,
  openWidget,
  replaceTabsSubtree,
  replaceWorkspaceLayout,
  setGridTracks,
  setPanelConfig,
  setPanelTitle,
  splitGridCell,
} from "./operations.js";
import { defineWidget } from "./widgets.js";

/** Minimal deterministic fixture: one tab group with two panels. */
function makeWorkspace(): Workspace {
  return decodeWorkspace({
    id: "ws-test",
    name: "Test",
    schemaVersion: 1,
    version: 0,
    layout: {
      type: "tabs",
      id: "tabs-1",
      panels: ["panel-a", "panel-b"],
      activePanelId: "panel-a",
    },
    panels: {
      "panel-a": {
        id: "panel-a",
        widgetType: "development.inspector",
        widgetConfig: { title: "A", value: "1" },
      },
      "panel-b": {
        id: "panel-b",
        widgetType: "development.log",
        widgetConfig: { source: "x" },
      },
    },
    activePanelId: "panel-a",
  });
}

describe("openWidget", () => {
  it("opens into the active tab group and focuses the new panel", () => {
    const prev = makeWorkspace();
    const { workspace, panelId } = openWidget(
      prev,
      "development.welcome",
      {},
      { panelId: "panel-c" },
    );
    expect(panelId).toBe("panel-c");
    expect(workspace.panels["panel-c"]).toMatchObject({
      widgetType: "development.welcome",
    });
    const group = findTabsWithPanel(workspace.layout, "panel-c");
    expect(group?.panels).toEqual(["panel-a", "panel-b", "panel-c"]);
    expect(group?.activePanelId).toBe("panel-c");
    expect(workspace.activePanelId).toBe("panel-c");
    expect(workspace.version).toBe(prev.version + 1);
    expect(integrityErrors(workspace)).toEqual([]);
  });

  it("targets an explicit (possibly empty) tab group", () => {
    const prev = makeWorkspace();
    const emptied = closePanel(closePanel(prev, "panel-a"), "panel-b");
    expect(emptied.layout).toEqual({
      type: "tabs",
      id: expect.any(String),
      panels: [],
      activePanelId: null,
    });
    const tabsId = emptied.layout.type === "tabs" ? emptied.layout.id : "";
    const { workspace } = openWidget(
      emptied,
      "development.welcome",
      {},
      { panelId: "panel-c", targetTabsId: tabsId },
    );
    expect(workspace.layout).toMatchObject({
      panels: ["panel-c"],
      activePanelId: "panel-c",
    });
    expect(integrityErrors(workspace)).toEqual([]);
  });
});

describe("closePanel", () => {
  it("removes the panel and moves focus to the next sibling", () => {
    const prev = makeWorkspace();
    const next = closePanel(prev, "panel-a");
    expect("panel-a" in next.panels).toBe(false);
    expect(next.activePanelId).toBe("panel-b");
    expect(next.layout).toMatchObject({
      panels: ["panel-b"],
      activePanelId: "panel-b",
    });
    expect(integrityErrors(next)).toEqual([]);
  });

  it("closing the last panel leaves a valid empty root tab group", () => {
    const prev = makeWorkspace();
    const next = closePanel(closePanel(prev, "panel-a"), "panel-b");
    expect(Object.keys(next.panels)).toEqual([]);
    expect(next.activePanelId).toBeNull();
    expect(next.layout.type).toBe("tabs");
    expect(integrityErrors(next)).toEqual([]);
  });

  it("keeps emptied cells instead of collapsing the grid", () => {
    const prev = makeWorkspace();
    const { workspace: split } = splitGridCell(
      prev,
      "panel-a",
      "horizontal",
      { widgetType: "development.welcome", config: {} },
      { panelId: "panel-c", nodeId: "grid-1" },
    );
    // Group was split as a whole: grid(tabs[a,b], welcome[c]).
    const closed = closePanel(split, "panel-c");
    expect(collectPanelIds(closed.layout)).toEqual(["panel-a", "panel-b"]);
    // The emptied cell stays: geometry is stable, the placeholder refills it.
    expect(closed.layout.type).toBe("grid");
    if (closed.layout.type === "grid") {
      expect(closed.layout.items).toHaveLength(2);
      expect(closed.layout.columns).toHaveLength(2);
      const emptied = closed.layout.items[1]!.child;
      expect(emptied.type).toBe("tabs");
      expect(emptied.type === "tabs" && emptied.panels).toEqual([]);
    }
    expect(integrityErrors(closed)).toEqual([]);
  });

  it("is a no-op for unknown panels", () => {
    const prev = makeWorkspace();
    expect(closePanel(prev, "nope")).toBe(prev);
  });
});

describe("activatePanel / activateTab / cycleTab", () => {
  it("activates a panel and its tab group", () => {
    const prev = makeWorkspace();
    const next = activatePanel(prev, "panel-b");
    expect(next.activePanelId).toBe("panel-b");
    expect(next.layout).toMatchObject({ activePanelId: "panel-b" });
  });

  it("ignores unknown panels", () => {
    const prev = makeWorkspace();
    expect(activatePanel(prev, "nope")).toBe(prev);
  });

  it("activateTab validates group membership", () => {
    const prev = makeWorkspace();
    expect(activateTab(prev, "tabs-1", "panel-b").activePanelId).toBe(
      "panel-b",
    );
    expect(activateTab(prev, "tabs-1", "nope")).toBe(prev);
    expect(activateTab(prev, "nope", "panel-b")).toBe(prev);
  });

  it("cycles tabs forward and backward with wraparound", () => {
    const prev = makeWorkspace();
    expect(cycleTab(prev, 1).activePanelId).toBe("panel-b");
    expect(cycleTab(prev, -1).activePanelId).toBe("panel-b");
    const twoTabs = cycleTab(prev, 1);
    expect(cycleTab(twoTabs, 1).activePanelId).toBe("panel-a");
  });
});

describe("splitGridCell", () => {
  it("wraps a tab group in a 2-column nested grid, focusing the new panel", () => {
    const prev = makeWorkspace();
    const { workspace, panelId } = splitGridCell(
      prev,
      "panel-a",
      "horizontal",
      { widgetType: "development.welcome", config: {} },
      { panelId: "panel-c", nodeId: "grid-1" },
    );
    expect(panelId).toBe("panel-c");
    expect(workspace.layout).toMatchObject({
      type: "grid",
      id: "grid-1",
      columns: [1, 1],
      rows: [1],
      items: [
        {
          col: 1,
          row: 1,
          colSpan: 1,
          rowSpan: 1,
          child: { type: "tabs", id: "tabs-1" },
        },
        {
          col: 2,
          row: 1,
          colSpan: 1,
          rowSpan: 1,
          child: { type: "panel", panelId: "panel-c" },
        },
      ],
    });
    expect(workspace.activePanelId).toBe("panel-c");
    expect(integrityErrors(workspace)).toEqual([]);
  });

  it("splits a bare panel leaf vertically", () => {
    const prev = makeWorkspace();
    const leafFirst: Workspace = {
      ...prev,
      layout: { type: "panel", panelId: "panel-a" as PanelId },
      panels: { "panel-a": prev.panels["panel-a"]! },
      activePanelId: "panel-a" as PanelId,
    };
    const { workspace } = splitGridCell(
      leafFirst,
      "panel-a",
      "vertical",
      { widgetType: "development.log", config: { source: "y" } },
      { panelId: "panel-c", nodeId: "grid-2" },
    );
    expect(workspace.layout).toMatchObject({
      type: "grid",
      columns: [1],
      rows: [1, 1],
      items: [
        { col: 1, row: 1, child: { type: "panel", panelId: "panel-a" } },
        { col: 1, row: 2, child: { type: "panel", panelId: "panel-c" } },
      ],
    });
    expect(integrityErrors(workspace)).toEqual([]);
  });

  it("supports multi-nested grids and keeps emptied cells", () => {
    const prev = makeWorkspace();
    const first = splitGridCell(
      prev,
      "panel-a",
      "horizontal",
      { widgetType: "development.welcome", config: {} },
      { panelId: "panel-c", nodeId: "grid-1" },
    ).workspace;
    // Split the freshly created cell again — grid inside grid.
    const second = splitGridCell(
      first,
      "panel-c",
      "vertical",
      { widgetType: "development.log", config: {} },
      { panelId: "panel-d", nodeId: "grid-2" },
    ).workspace;
    expect(second.layout.type).toBe("grid");
    const nested =
      second.layout.type === "grid" ? second.layout.items[1]?.child : undefined;
    expect(nested?.type).toBe("grid");
    expect(collectPanelIds(second.layout)).toEqual([
      "panel-a",
      "panel-b",
      "panel-c",
      "panel-d",
    ]);
    expect(integrityErrors(second)).toEqual([]);
    // Closing the split-away panels keeps every (now empty) cell in place.
    const closed = closePanel(closePanel(second, "panel-d"), "panel-c");
    expect(closed.layout.type).toBe("grid");
    expect(collectPanelIds(closed.layout)).toEqual(["panel-a", "panel-b"]);
    expect(integrityErrors(closed)).toEqual([]);
  });
});

describe("setGridTracks", () => {
  it("replaces one axis of a grid and validates the values", () => {
    const prev = makeWorkspace();
    const { workspace } = splitGridCell(
      prev,
      "panel-a",
      "horizontal",
      { widgetType: "development.welcome", config: {} },
      { panelId: "panel-c", nodeId: "grid-1" },
    );
    expect(
      setGridTracks(workspace, "grid-1", "columns", [3, 1]).layout,
    ).toMatchObject({
      columns: [3, 1],
    });
    // Wrong track count, non-positive or non-finite values are refused.
    expect(setGridTracks(workspace, "grid-1", "columns", [1])).toBe(workspace);
    expect(setGridTracks(workspace, "grid-1", "columns", [1, 0])).toBe(
      workspace,
    );
    expect(setGridTracks(workspace, "grid-1", "columns", [1, Number.NaN])).toBe(
      workspace,
    );
    expect(setGridTracks(workspace, "missing", "columns", [1, 1])).toBe(
      workspace,
    );
  });
});

describe("setPanelConfig", () => {
  it("replaces a panel's config and bumps the version", () => {
    const prev = makeWorkspace();
    const next = setPanelConfig(prev, "panel-a", { title: "X", value: "2" });
    expect(next.panels["panel-a"]?.widgetConfig).toEqual({
      title: "X",
      value: "2",
    });
    expect(next.version).toBe(prev.version + 1);
    expect(setPanelConfig(prev, "nope", {})).toBe(prev);
  });
});

describe("movePanelToTabs", () => {
  /** tabs-1[a] | tabs-2[b]: split root with two single-panel groups. */
  function makeSplitWorkspace(): Workspace {
    const rebuilt = decodeWorkspace({
      id: "ws-test",
      name: "Test",
      schemaVersion: 1,
      version: 0,
      layout: {
        type: "split",
        id: "split-1",
        direction: "horizontal",
        ratio: 0.5,
        first: {
          type: "tabs",
          id: "tabs-1",
          panels: ["panel-a"],
          activePanelId: "panel-a",
        },
        second: {
          type: "tabs",
          id: "tabs-2",
          panels: ["panel-b"],
          activePanelId: "panel-b",
        },
      },
      panels: {
        "panel-a": {
          id: "panel-a",
          widgetType: "development.inspector",
          widgetConfig: { title: "A", value: "1" },
        },
        "panel-b": {
          id: "panel-b",
          widgetType: "development.log",
          widgetConfig: { source: "x" },
        },
      },
      activePanelId: "panel-a",
    });
    expect(integrityErrors(rebuilt)).toEqual([]);
    return rebuilt;
  }

  it("moves a panel across groups and focuses it", () => {
    const next = movePanelToTabs(makeSplitWorkspace(), "panel-a", "tabs-2");
    expect(findTabsById(next.layout, "tabs-2")?.panels).toEqual([
      "panel-b",
      "panel-a",
    ]);
    expect(findTabsById(next.layout, "tabs-2")?.activePanelId).toBe("panel-a");
    expect(next.activePanelId).toBe("panel-a");
    expect(integrityErrors(next)).toEqual([]);
  });

  it("inserts at an explicit index", () => {
    const next = movePanelToTabs(makeSplitWorkspace(), "panel-a", "tabs-2", 0);
    expect(findTabsById(next.layout, "tabs-2")?.panels).toEqual([
      "panel-a",
      "panel-b",
    ]);
    // Out-of-range indices clamp instead of corrupting the group.
    const clamped = movePanelToTabs(
      makeSplitWorkspace(),
      "panel-a",
      "tabs-2",
      99,
    );
    expect(findTabsById(clamped.layout, "tabs-2")?.panels).toEqual([
      "panel-b",
      "panel-a",
    ]);
    expect(integrityErrors(next)).toEqual([]);
    expect(integrityErrors(clamped)).toEqual([]);
  });

  it("reorders within the same group", () => {
    const prev = makeWorkspace();
    const next = movePanelToTabs(prev, "panel-b", "tabs-1", 0);
    expect(findTabsById(next.layout, "tabs-1")?.panels).toEqual([
      "panel-b",
      "panel-a",
    ]);
    expect(next.activePanelId).toBe("panel-b");
    expect(integrityErrors(next)).toEqual([]);
  });

  it("is a no-op for unknown panels, targets, or a lone-panel workspace", () => {
    const prev = makeSplitWorkspace();
    expect(movePanelToTabs(prev, "nope", "tabs-2")).toBe(prev);
    expect(movePanelToTabs(prev, "panel-a", "nope")).toBe(prev);
    const lone = decodeWorkspace({
      ...(JSON.parse(JSON.stringify(prev)) as Record<string, unknown>),
      layout: { type: "panel", panelId: "panel-a" },
      panels: { "panel-a": prev.panels["panel-a"] },
      activePanelId: "panel-a",
    });
    expect(movePanelToTabs(lone, "panel-a", "tabs-2")).toBe(lone);
  });
});

describe("replaceWorkspaceLayout", () => {
  it("swaps the tree when every instance is placed exactly once", () => {
    const prev = makeWorkspace();
    const layout = {
      type: "split",
      id: "split-9",
      direction: "horizontal",
      ratio: 0.5,
      first: {
        type: "tabs",
        id: "g-1",
        panels: ["panel-a"],
        activePanelId: null,
      },
      second: {
        type: "tabs",
        id: "g-2",
        panels: ["panel-b"],
        activePanelId: "panel-b",
      },
    } as const;
    const next = replaceWorkspaceLayout(prev, layout as never);
    expect(next.layout).toMatchObject({
      type: "split",
      first: { panels: ["panel-a"], activePanelId: "panel-a" },
      second: { panels: ["panel-b"], activePanelId: "panel-b" },
    });
    expect(next.activePanelId).toBe("panel-a");
    expect(next.version).toBe(prev.version + 1);
    expect(integrityErrors(next)).toEqual([]);
  });

  it("refuses partial, duplicated, or dangling placements", () => {
    const prev = makeWorkspace();
    const single = {
      type: "tabs",
      id: "g-1",
      panels: ["panel-a"],
      activePanelId: "panel-a",
    } as const;
    expect(replaceWorkspaceLayout(prev, single as never)).toBe(prev);
    const dup = {
      type: "tabs",
      id: "g-1",
      panels: ["panel-a", "panel-a", "panel-b"],
      activePanelId: "panel-a",
    } as const;
    expect(replaceWorkspaceLayout(prev, dup as never)).toBe(prev);
    const dangling = {
      type: "tabs",
      id: "g-1",
      panels: ["panel-a", "ghost"],
      activePanelId: "panel-a",
    } as const;
    expect(replaceWorkspaceLayout(prev, dangling as never)).toBe(prev);
  });
});

describe("replaceTabsSubtree", () => {
  it("swaps one group for a subtree with the same panels", () => {
    const prev = makeWorkspace();
    const layout = {
      type: "split",
      id: "split-9",
      direction: "horizontal",
      ratio: 0.5,
      first: {
        type: "tabs",
        id: "g-1",
        panels: ["panel-a"],
        activePanelId: null,
      },
      second: {
        type: "tabs",
        id: "g-2",
        panels: ["panel-b"],
        activePanelId: "panel-b",
      },
    } as const;
    const next = replaceTabsSubtree(prev, "tabs-1", layout as never);
    expect(next).not.toBe(prev);
    expect(next.layout).toMatchObject({
      type: "split",
      first: { panels: ["panel-a"], activePanelId: "panel-a" },
      second: { panels: ["panel-b"], activePanelId: "panel-b" },
    });
    expect(next.activePanelId).toBe(prev.activePanelId);
    expect(next.version).toBe(prev.version + 1);
    expect(integrityErrors(next)).toEqual([]);
  });

  it("refuses unknown groups and membership changes", () => {
    const prev = makeWorkspace();
    const single = {
      type: "tabs",
      id: "g-1",
      panels: ["panel-a", "panel-b"],
      activePanelId: "panel-a",
    } as const;
    expect(replaceTabsSubtree(prev, "nope", single as never)).toBe(prev);
    const partial = {
      type: "tabs",
      id: "g-1",
      panels: ["panel-a"],
      activePanelId: "panel-a",
    } as const;
    expect(replaceTabsSubtree(prev, "tabs-1", partial as never)).toBe(prev);
    const dup = {
      type: "tabs",
      id: "g-1",
      panels: ["panel-a", "panel-a", "panel-b", "panel-b"],
      activePanelId: "panel-a",
    } as const;
    expect(replaceTabsSubtree(prev, "tabs-1", dup as never)).toBe(prev);
    const foreign = {
      type: "tabs",
      id: "g-1",
      panels: ["panel-a", "ghost"],
      activePanelId: "panel-a",
    } as const;
    expect(replaceTabsSubtree(prev, "tabs-1", foreign as never)).toBe(prev);
  });
});

describe("integrityErrors", () => {
  it("flags dangling tab references and unplaced instances", () => {
    const prev = makeWorkspace();
    const dangling: Workspace = {
      ...prev,
      layout: {
        type: "tabs",
        id: "tabs-1" as TabsLayoutNode["id"],
        panels: ["panel-a" as PanelId, "ghost" as PanelId],
        activePanelId: "panel-a" as PanelId,
      },
    };
    const errors = integrityErrors(dangling);
    expect(errors.some((e) => e.includes("ghost"))).toBe(true);
    const unplaced: Workspace = {
      ...prev,
      panels: { ...prev.panels, ...{ orphan: createPanelInstance("x", {}) } },
    };
    expect(integrityErrors(unplaced).some((e) => e.includes("orphan"))).toBe(
      true,
    );
  });
});

describe("serialization", () => {
  it("round-trips through the canonical schema", () => {
    const prev = makeWorkspace();
    const encoded = Schema.encodeSync(Schema.parseJson())(JSON.stringify(prev));
    void encoded;
    const json = JSON.parse(JSON.stringify(prev)) as unknown;
    expect(decodeWorkspace(json)).toEqual(prev);
  });

  it("rejects malformed persisted state explicitly", () => {
    expect(() => decodeWorkspace({ nope: true })).toThrow();
    expect(() =>
      decodeWorkspace({
        id: "x",
        name: "x",
        schemaVersion: 1,
        version: 0,
        layout: { type: "bogus" },
        panels: {},
        activePanelId: null,
      }),
    ).toThrow();
    expect(() =>
      decodeWorkspace({
        id: "x",
        name: "x",
        schemaVersion: 1,
        version: 0,
        layout: { type: "panel", panelId: "p" },
        panels: {},
        activePanelId: null,
      }),
    ).not.toThrow(); // schema-valid shape; referential check is integrityErrors' job
    const dangling = decodeWorkspace({
      id: "x",
      name: "x",
      schemaVersion: 1,
      version: 0,
      layout: { type: "panel", panelId: "p" },
      panels: {},
      activePanelId: null,
    });
    expect(integrityErrors(dangling).length).toBeGreaterThan(0);
  });
});

describe("defineWidget", () => {
  const Inspector = defineWidget({
    type: "development.inspector",
    title: "Inspector",
    description: "test",
    configSchema: Schema.Struct({ title: Schema.String }),
    defaultConfig: { title: "A" },
    component: () => null,
  });

  it("decodes valid config and rejects invalid config", () => {
    expect(Inspector.decodeConfig({ title: "hi" })).toEqual({ title: "hi" });
    expect(() => Inspector.decodeConfig({ title: 42 })).toThrow();
    expect(() => Inspector.decodeConfig(null)).toThrow();
  });
});

describe("setPanelTitle", () => {
  it("sets a trimmed custom title and bumps the version", () => {
    const prev = makeWorkspace();
    const next = setPanelTitle(prev, "panel-a", "  My trades  ");
    expect(next.panels["panel-a"]?.title).toBe("My trades");
    expect(next.version).toBe(prev.version + 1);
    expect(integrityErrors(next)).toEqual([]);
  });

  it("clears the rename on empty or null, leaving no title key", () => {
    const prev = setPanelTitle(makeWorkspace(), "panel-a", "Renamed");
    const cleared = setPanelTitle(prev, "panel-a", "   ");
    expect(cleared.panels["panel-a"]).not.toHaveProperty("title");
    expect(setPanelTitle(prev, "panel-a", null).panels["panel-a"]).not.toHaveProperty("title");
  });

  it("is a no-op for unknown panels", () => {
    const prev = makeWorkspace();
    expect(setPanelTitle(prev, "nope", "X")).toBe(prev);
  });
});
