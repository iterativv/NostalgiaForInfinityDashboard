// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  type LayoutNodeId,
  LayoutNodeId as LayoutNodeIdSchema,
  type LayoutNode,
  type PanelId,
  PanelId as PanelIdSchema,
  type Workspace,
  decodeWorkspace,
} from "@nfi/api-contract";
import {
  getLayoutMinHeight,
  getLayoutMinWidth,
  getMasonryItemMinHeight,
} from "./layout.js";
import {
  collectPanelIds,
  createMasonry,
  findEnclosingContainer,
  findEnclosingMasonry,
  findMasonryItemById,
  findNodeById,
  findTabsWithPanel,
  integrityErrors,
  movePanelToTabs,
  normalizeMasonryLayout,
  prunePanelsFromLayout,
  replaceTabsSubtree,
  setMasonryItemSize,
} from "./operations.js";
import { createWidgetRegistry, defineWidget } from "./widgets.js";

const Table = defineWidget({
  type: "test.table",
  title: "Table",
  description: "test",
  configSchema: Schema.Struct({}),
  defaultConfig: {},
  component: () => null,
  minWidth: 560,
  minHeight: 300,
});

const Stat = defineWidget({
  type: "test.stat",
  title: "Stat",
  description: "test",
  configSchema: Schema.Struct({}),
  defaultConfig: {},
  component: () => null,
  minWidth: 280,
  minHeight: 120,
});

const registry = createWidgetRegistry([Table, Stat]);

const lookup = (type: string) => registry.getWidget(type);

const panelId = (id: string): PanelId => Schema.decodeSync(PanelIdSchema)(id);

const nodeId = (id: string): LayoutNodeId =>
  Schema.decodeSync(LayoutNodeIdSchema)(id);

const panels = {
  a: { widgetType: "test.table" },
  b: { widgetType: "test.stat" },
};

const tabs = (id: string, ...ids: string[]): LayoutNode => ({
  type: "tabs",
  id: nodeId(id),
  panels: ids.map(panelId),
  activePanelId: ids[0] === undefined ? null : panelId(ids[0]),
});

function makeMasonryWorkspace(): Workspace {
  return decodeWorkspace({
    id: "ws-masonry",
    name: "Masonry",
    schemaVersion: 1,
    version: 0,
    layout: {
      type: "masonry",
      id: "masonry-1",
      columnWidth: 320,
      items: [
        {
          type: "masonry-item",
          id: "card-a",
          height: 320,
          child: {
            type: "tabs",
            id: "tabs-a",
            panels: ["panel-a"],
            activePanelId: "panel-a",
          },
        },
        {
          type: "masonry-item",
          id: "card-b",
          height: 200,
          child: {
            type: "tabs",
            id: "tabs-b",
            panels: ["panel-b"],
            activePanelId: "panel-b",
          },
        },
      ],
    },
    panels: {
      "panel-a": {
        id: "panel-a",
        widgetType: "test.table",
        widgetConfig: {},
      },
      "panel-b": {
        id: "panel-b",
        widgetType: "test.stat",
        widgetConfig: {},
      },
    },
    activePanelId: "panel-a",
  });
}

describe("masonry layout helpers", () => {
  it("derives card minimum heights from widget hints plus tab chrome", () => {
    const tableTabs = tabs("t", "a");
    // Widget minimums measure the panel body; the outer card box adds the
    // tab-strip chrome (MASONRY_ITEM_CHROME_PX = 28).
    expect(getMasonryItemMinHeight(tableTabs, panels, lookup)).toBe(328);

    const statTabs = tabs("t2", "b");
    // Absolute masonry floor wins when the hint plus chrome is smaller
    // (120 + 28 = 148 < 140 is false here, so the hint applies).
    expect(getMasonryItemMinHeight(statTabs, panels, lookup)).toBe(148);
  });

  it("computes subtree minimums through masonry containers", () => {
    const masonry: LayoutNode = {
      type: "masonry",
      id: nodeId("m"),
      columnWidth: 320,
      items: [
        {
          type: "masonry-item",
          id: nodeId("c1"),
          height: 300,
          span: 1,
          child: tabs("t1", "a"),
        },
        {
          type: "masonry-item",
          id: nodeId("c2"),
          height: 200,
          span: 1,
          child: tabs("t2", "b"),
        },
      ],
    };

    // Column packing: only the widest/tallest card must fit.
    expect(getLayoutMinWidth(masonry, panels, lookup)).toBe(560);
    expect(getLayoutMinHeight(masonry, panels, lookup)).toBe(300);
  });
});

describe("masonry operations", () => {
  it("creates and normalizes masonries (single card unwraps)", () => {
    const masonry = createMasonry(320, [
      { height: 300, child: tabs("t1", "a") },
      { height: 200, child: tabs("t2", "b") },
    ]);

    expect(masonry.type).toBe("masonry");
    expect(masonry.columnWidth).toBe(320);
    expect(masonry.items).toHaveLength(2);
    expect(collectPanelIds(masonry).map(String)).toEqual(["a", "b"]);

    const solo = createMasonry(320, [{ height: 300, child: tabs("t1", "a") }]);
    expect(normalizeMasonryLayout(solo)?.type).toBe("tabs");
    expect(normalizeMasonryLayout({ ...masonry, items: [] })).toBeNull();
  });

  it("finds masonries, cards, containers and tabs through nesting", () => {
    const ws = makeMasonryWorkspace();
    expect(findNodeById(ws.layout, "masonry-1")?.type).toBe("masonry");
    expect(findMasonryItemById(ws.layout, "card-a")?.height).toBe(320);
    // Pre-span encoded documents decode with the default span.
    expect(findMasonryItemById(ws.layout, "card-a")?.span).toBe(1);
    expect(findEnclosingMasonry(ws.layout, "tabs-a")?.id).toBe("masonry-1");
    expect(findEnclosingContainer(ws.layout, "tabs-a")?.id).toBe("masonry-1");
    expect(findTabsWithPanel(ws.layout, "panel-b")?.panels.map(String)).toEqual(
      ["panel-b"],
    );
  });

  it("resizes a card height and validates it", () => {
    const ws = makeMasonryWorkspace();
    const resized = setMasonryItemSize(ws, "masonry-1", "card-a", 480);
    expect(resized).not.toBe(ws);
    const item = findMasonryItemById(resized.layout, "card-a");
    expect(item).toMatchObject({ height: 480 });

    // Non-positive / unknown ids are no-ops.
    expect(setMasonryItemSize(ws, "masonry-1", "card-a", 0)).toBe(ws);
    expect(setMasonryItemSize(ws, "masonry-1", "missing", 480)).toBe(ws);
    expect(setMasonryItemSize(ws, "missing", "card-a", 480)).toBe(ws);
    expect(integrityErrors(resized)).toEqual([]);
  });

  it("resizes a card's column span and validates it", () => {
    const ws = makeMasonryWorkspace();
    const resized = setMasonryItemSize(ws, "masonry-1", "card-a", 320, 2);
    expect(resized).not.toBe(ws);
    expect(findMasonryItemById(resized.layout, "card-a")).toMatchObject({
      height: 320,
      span: 2,
    });
    // Omitting the span keeps the persisted one.
    const heightOnly = setMasonryItemSize(resized, "masonry-1", "card-a", 360);
    expect(findMasonryItemById(heightOnly.layout, "card-a")).toMatchObject({
      height: 360,
      span: 2,
    });
    expect(integrityErrors(resized)).toEqual([]);

    // Fractional spans persist stepless drags (same as auto).
    const fractional = setMasonryItemSize(ws, "masonry-1", "card-a", 320, 1.5);
    expect(fractional).not.toBe(ws);
    expect(findMasonryItemById(fractional.layout, "card-a")).toMatchObject({
      span: 1.5,
    });
    expect(integrityErrors(fractional)).toEqual([]);

    // Invalid spans (< 1, NaN, unknown ids) are no-ops.
    expect(setMasonryItemSize(ws, "masonry-1", "card-a", 320, 0)).toBe(ws);
    expect(setMasonryItemSize(ws, "masonry-1", "card-a", 320, -2)).toBe(ws);
    expect(setMasonryItemSize(ws, "masonry-1", "card-a", 320, NaN)).toBe(ws);
    expect(setMasonryItemSize(ws, "masonry-1", "missing", 320, 2)).toBe(ws);
  });

  it("replaces a card's subtree through its wrapper id", () => {
    const ws = makeMasonryWorkspace();
    // Same membership (panel-a), different group id: the card's child is
    // swapped while the persisted card height survives on the wrapper.
    const next = replaceTabsSubtree(ws, "card-a", tabs("fresh", "panel-a"));
    expect(next).not.toBe(ws);
    const item = findMasonryItemById(next.layout, "card-a");
    expect(item).toMatchObject({ height: 320 });
    expect(item?.child).toEqual(tabs("fresh", "panel-a"));

    // Different membership is refused.
    const wrong = replaceTabsSubtree(ws, "card-a", tabs("solo", "panel-b"));
    expect(wrong).toBe(ws);
  });

  it("moves a panel between masonry cards", () => {
    const ws = makeMasonryWorkspace();
    const moved = movePanelToTabs(ws, "panel-a", "tabs-b");
    expect(moved).not.toBe(ws);
    expect(findTabsWithPanel(moved.layout, "panel-a")?.id).toBe("tabs-b");
    // The emptied card stays (height preserved).
    expect(findMasonryItemById(moved.layout, "card-a")).toBeDefined();
  });

  it("keeps emptied cards instead of collapsing the masonry", () => {
    const ws = makeMasonryWorkspace();
    const pruned = prunePanelsFromLayout(ws.layout, new Set(["panel-a"]));
    expect(pruned?.type).toBe("masonry");

    if (pruned?.type === "masonry") {
      expect(pruned.items).toHaveLength(2);
      expect(pruned.items[0]!.child.type).toBe("tabs");
      expect(
        pruned.items[0]!.child.type === "tabs" && pruned.items[0]!.child.panels,
      ).toEqual([]);
      // The dragged height of the emptied card survives.
      expect(pruned.items[0]!.height).toBe(320);
    }
  });

  it("flags corrupt masonry payloads", () => {
    const ws = makeMasonryWorkspace();
    expect(integrityErrors(ws)).toEqual([]);

    const badHeight: Workspace = {
      ...ws,
      layout: {
        type: "masonry",
        id: nodeId("masonry-1"),
        columnWidth: 320,
        items: [
          {
            type: "masonry-item",
            id: nodeId("card-a"),
            height: 0,
            span: 1,
            child: tabs("tabs-a", "panel-a"),
          },
          {
            type: "masonry-item",
            id: nodeId("card-b"),
            height: 200,
            span: 1,
            child: tabs("tabs-b", "panel-b"),
          },
        ],
      },
    };

    expect(
      integrityErrors(badHeight).some((e) => e.includes("non-positive height")),
    ).toBe(true);

    const badSpan: Workspace = {
      ...ws,
      layout: {
        type: "masonry",
        id: nodeId("masonry-1"),
        columnWidth: 320,
        items: [
          {
            type: "masonry-item",
            id: nodeId("card-a"),
            height: 320,
            span: 0,
            child: tabs("tabs-a", "panel-a"),
          },
          {
            type: "masonry-item",
            id: nodeId("card-b"),
            height: 200,
            span: 1,
            child: tabs("tabs-b", "panel-b"),
          },
        ],
      },
    };

    expect(
      integrityErrors(badSpan).some((e) => e.includes("invalid span")),
    ).toBe(true);

    const badColumnWidth: Workspace = {
      ...ws,
      layout: {
        type: "masonry",
        id: nodeId("masonry-1"),
        columnWidth: -1,
        items: ws.layout.type === "masonry" ? ws.layout.items : [],
      },
    };

    expect(
      integrityErrors(badColumnWidth).some((e) =>
        e.includes("non-positive column width"),
      ),
    ).toBe(true);

    const single: Workspace = {
      ...ws,
      layout: {
        type: "masonry",
        id: nodeId("masonry-1"),
        columnWidth: 320,
        items: [
          {
            type: "masonry-item",
            id: nodeId("card-a"),
            height: 320,
            span: 1,
            child: tabs("tabs-a", "panel-a"),
          },
        ],
      },
      panels: { "panel-a": ws.panels["panel-a"]! },
      activePanelId: panelId("panel-a"),
    };

    expect(
      integrityErrors(single).some((e) =>
        e.includes("single item (should be unwrapped)"),
      ),
    ).toBe(true);
  });
});
