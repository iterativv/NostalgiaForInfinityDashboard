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
import { getAutoItemMinHeight, getLayoutMinWidth } from "./layout.js";
import {
  appendAutoItemCard,
  collectPanelIds,
  createAuto,
  findAutoItemById,
  findEnclosingAuto,
  findEnclosingContainer,
  findNodeById,
  findTabsWithPanel,
  integrityErrors,
  moveAutoItem,
  normalizeAutoLayout,
  openWidget,
  prunePanelsFromLayout,
  replaceTabsSubtree,
  setAutoItemSize,
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
  defaultWidth: 640,
  defaultHeight: 420,
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

function makeAutoWorkspace(): Workspace {
  return decodeWorkspace({
    id: "ws-auto",
    name: "Auto",
    schemaVersion: 1,
    version: 0,
    layout: {
      type: "auto",
      id: "auto-1",
      columnWidth: 320,
      items: [
        {
          type: "auto-item",
          id: "card-a",
          height: 320,
          span: 2,
          child: {
            type: "tabs",
            id: "tabs-a",
            panels: ["panel-a"],
            activePanelId: "panel-a",
          },
        },
        {
          type: "auto-item",
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

describe("auto layout helpers", () => {
  it("derives card minimum heights from widget hints plus tab chrome", () => {
    const tableTabs = tabs("t", "a");

    // Widget minimums measure the panel body; the outer card box adds the
    // tab-strip chrome (AUTO_ITEM_CHROME_PX = 28).
    expect(getAutoItemMinHeight(tableTabs, panels, lookup)).toBe(328);

    const statTabs = tabs("t2", "b");
    // 120 + 28 = 148 > the absolute auto floor (140), so the hint applies.
    expect(getAutoItemMinHeight(statTabs, panels, lookup)).toBe(148);
  });

  it("computes subtree minimums through auto containers", () => {
    const auto: LayoutNode = {
      type: "auto",
      id: nodeId("a"),
      columnWidth: 320,
      items: [
        { type: "auto-item", id: nodeId("c1"), height: 300, span: 1, child: tabs("t1", "a") },
        { type: "auto-item", id: nodeId("c2"), height: 200, span: 2, child: tabs("t2", "b") },
      ],
    };

    // Row packing wraps: only the widest card must fit.
    expect(getLayoutMinWidth(auto, panels, lookup)).toBe(560);
  });
});

describe("auto operations", () => {
  it("creates and normalizes autos (single and empty cards stay)", () => {
    const auto = createAuto(320, [
      { height: 300, span: 2, child: tabs("t1", "a") },
      { height: 200, child: tabs("t2", "b") },
    ]);

    expect(auto.type).toBe("auto");
    expect(auto.columnWidth).toBe(320);
    expect(auto.items).toHaveLength(2);
    expect(auto.items[0]).toMatchObject({ height: 300, span: 2 });
    expect(auto.items[1]).toMatchObject({ height: 200, span: 1 });
    expect(collectPanelIds(auto).map(String)).toEqual(["a", "b"]);

    // Bento is a page mode: a lone card — even zero cards — stays an auto
    // so the page never silently leaves bento mode and adds append cards.
    const solo = createAuto(320, [{ height: 300, child: tabs("t1", "a") }]);
    expect(normalizeAutoLayout(solo).type).toBe("auto");

    const emptied = normalizeAutoLayout({ ...auto, items: [] });
    expect(emptied.type).toBe("auto");

    if (emptied.type === "auto") expect(emptied.items).toHaveLength(0);

    // Invalid spans coerce to 1 during normalization.
    const badSpan = createAuto(320, [
      { height: 300, span: 0, child: tabs("t1", "a") },
      { height: 200, child: tabs("t2", "b") },
    ]);

    const fixed = normalizeAutoLayout(badSpan);

    if (fixed.type === "auto") expect(fixed.items[0]!.span).toBe(1);
  });

  it("finds autos, cards, containers and tabs through nesting", () => {
    const ws = makeAutoWorkspace();

    expect(findNodeById(ws.layout, "auto-1")?.type).toBe("auto");
    expect(findAutoItemById(ws.layout, "card-a")?.height).toBe(320);
    expect(findAutoItemById(ws.layout, "card-a")?.span).toBe(2);
    // Pre-span encoded documents decode with the default span.
    expect(findAutoItemById(ws.layout, "card-b")?.span).toBe(1);
    expect(findEnclosingAuto(ws.layout, "tabs-a")?.id).toBe("auto-1");
    expect(findEnclosingContainer(ws.layout, "tabs-a")?.id).toBe("auto-1");
    expect(findTabsWithPanel(ws.layout, "panel-b")?.panels.map(String)).toEqual(
      ["panel-b"],
    );
  });

  it("resizes a card height and span with validation", () => {
    const ws = makeAutoWorkspace();

    const resized = setAutoItemSize(ws, "auto-1", "card-a", 480, 3);
    expect(resized).not.toBe(ws);
    expect(findAutoItemById(resized.layout, "card-a")).toMatchObject({
      height: 480,
      span: 3,
    });
    expect(integrityErrors(resized)).toEqual([]);

    // Omitting the span keeps the persisted one.
    const heightOnly = setAutoItemSize(resized, "auto-1", "card-a", 360);
    expect(findAutoItemById(heightOnly.layout, "card-a")).toMatchObject({
      height: 360,
      span: 3,
    });

    // Fractional spans persist stepless drags (finite ≥ 1).
    const fractional = setAutoItemSize(ws, "auto-1", "card-a", 320, 1.5);
    expect(fractional).not.toBe(ws);
    expect(findAutoItemById(fractional.layout, "card-a")).toMatchObject({
      span: 1.5,
    });
    expect(integrityErrors(fractional)).toEqual([]);

    // Non-positive heights, invalid spans and unknown ids are no-ops.
    expect(setAutoItemSize(ws, "auto-1", "card-a", 0)).toBe(ws);
    expect(setAutoItemSize(ws, "auto-1", "card-a", 320, 0)).toBe(ws);
    expect(setAutoItemSize(ws, "auto-1", "card-a", 320, 0.5)).toBe(ws);
    expect(setAutoItemSize(ws, "auto-1", "card-a", 320, NaN)).toBe(ws);
    expect(setAutoItemSize(ws, "auto-1", "missing", 480, 2)).toBe(ws);
    expect(setAutoItemSize(ws, "missing", "card-a", 480, 2)).toBe(ws);
  });

  it("reorders cards and focuses the moved card's panel", () => {
    const ws = makeAutoWorkspace();

    const moved = moveAutoItem(ws, "auto-1", "card-b", 0);
    expect(moved).not.toBe(ws);

    if (moved.layout.type === "auto") {
      expect(moved.layout.items.map((item) => item.id)).toEqual([
        "card-b",
        "card-a",
      ]);
    }

    expect(moved.activePanelId).toBe(ws.panels["panel-b"]!.id);

    // No-ops: same position, unknown ids, non-finite target.
    expect(moveAutoItem(ws, "auto-1", "card-a", 0)).toBe(ws);
    expect(moveAutoItem(ws, "auto-1", "missing", 1)).toBe(ws);
    expect(moveAutoItem(ws, "missing", "card-a", 1)).toBe(ws);
    expect(moveAutoItem(ws, "auto-1", "card-a", Number.NaN)).toBe(ws);

    // Out-of-range targets clamp into the array.
    const clamped = moveAutoItem(ws, "auto-1", "card-a", 99);

    if (clamped.layout.type === "auto") {
      expect(clamped.layout.items.map((item) => item.id)).toEqual([
        "card-b",
        "card-a",
      ]);
    }
  });

  it("appends new cards for palette opens and falls back to openWidget", () => {
    const ws = makeAutoWorkspace();

    const { workspace, panelId: placed } = appendAutoItemCard(
      ws,
      "test.stat",
      {},
      { panelId: "panel-c", height: 200, span: 2 },
    );

    if (workspace.layout.type === "auto") {
      expect(workspace.layout.items).toHaveLength(3);
      const card = workspace.layout.items[2]!;
      expect(card).toMatchObject({ height: 200, span: 2 });
      expect(collectPanelIds(card.child).map(String)).toEqual(["panel-c"]);
    }

    expect(workspace.panels["panel-c"]).toBeDefined();
    expect(workspace.activePanelId).toBe(placed);
    expect(integrityErrors(workspace)).toEqual([]);

    // Non-auto roots fall back to openWidget (tabs into the first group).
    const gridish: Workspace = {
      ...ws,
      layout: tabs("root", "panel-a"),
      panels: { "panel-a": ws.panels["panel-a"]! },
      activePanelId: panelId("panel-a"),
    };

    const fallback = appendAutoItemCard(gridish, "test.stat", {}, {
      panelId: "panel-d",
    });

    expect(fallback.workspace.layout.type).toBe("tabs");
    expect(fallback.workspace.panels["panel-d"]).toBeDefined();

    // Size options clamp to structural sanity.
    const defaulted = appendAutoItemCard(ws, "test.stat", {}, {
      panelId: "panel-e",
      height: -5,
      span: 0,
    });

    if (defaulted.workspace.layout.type === "auto") {
      const card = defaulted.workspace.layout.items.at(-1)!;
      expect(card.height).toBe(280);
      expect(card.span).toBe(1);
    }
  });

  it("replaces a card's subtree through its wrapper id", () => {
    const ws = makeAutoWorkspace();

    // Same membership (panel-a), different group id: the card's child is
    // swapped while the persisted card size survives on the wrapper.
    const next = replaceTabsSubtree(ws, "card-a", tabs("fresh", "panel-a"));
    expect(next).not.toBe(ws);
    const item = findAutoItemById(next.layout, "card-a");
    expect(item).toMatchObject({ height: 320, span: 2 });
    expect(item?.child).toEqual(tabs("fresh", "panel-a"));

    // Different membership is refused.
    const wrong = replaceTabsSubtree(ws, "card-a", tabs("solo", "panel-b"));
    expect(wrong).toBe(ws);
  });

  it("drops emptied cards but keeps the auto (bento pages never collapse)", () => {
    const ws = makeAutoWorkspace();
    const pruned = prunePanelsFromLayout(ws.layout, new Set(["panel-a"]));

    // The emptied card is GONE (cards are widgets, not bookable slots)…
    expect(pruned?.type).toBe("auto");

    if (pruned?.type === "auto") {
      expect(pruned.items).toHaveLength(1);
      expect(
        collectPanelIds(pruned).some((id) => String(id) === "panel-a"),
      ).toBe(false);
    }

    // …and emptying the LAST card still leaves the auto root standing.
    const emptied = prunePanelsFromLayout(pruned!, new Set(["panel-b"]));

    if (emptied?.type === "auto") {
      expect(emptied.items).toHaveLength(0);

      const emptyPage: Workspace = {
        ...ws,
        layout: emptied,
        panels: {},
        activePanelId: null,
      };

      expect(integrityErrors(emptyPage)).toEqual([]);
    }
  });

  it("flags corrupt auto payloads", () => {
    const ws = makeAutoWorkspace();
    expect(integrityErrors(ws)).toEqual([]);

    const bad: Workspace = {
      ...ws,
      layout: {
        type: "auto",
        id: nodeId("auto-1"),
        columnWidth: 320,
        items: [
          { type: "auto-item", id: nodeId("card-a"), height: 0, span: 1, child: tabs("tabs-a", "panel-a") },
          { type: "auto-item", id: nodeId("card-b"), height: 200, span: 0, child: tabs("tabs-b", "panel-b") },
        ],
      },
    };

    const errors = integrityErrors(bad);
    expect(errors.some((e) => e.includes("non-positive height"))).toBe(true);
    expect(errors.some((e) => e.includes("invalid span"))).toBe(true);

    const badWidth: Workspace = {
      ...ws,
      layout: {
        type: "auto",
        id: nodeId("auto-1"),
        columnWidth: -1,
        items: ws.layout.type === "auto" ? ws.layout.items : [],
      },
    };

    expect(
      integrityErrors(badWidth).some((e) =>
        e.includes("non-positive column width"),
      ),
    ).toBe(true);

    const single: Workspace = {
      ...ws,
      layout: {
        type: "auto",
        id: nodeId("auto-1"),
        columnWidth: 320,
        items: [
          { type: "auto-item", id: nodeId("card-a"), height: 320, span: 1, child: tabs("tabs-a", "panel-a") },
        ],
      },
      panels: { "panel-a": ws.panels["panel-a"]! },
      activePanelId: panelId("panel-a"),
    };

    // Single- and zero-card autos are VALID bento page states now (the
    // "should be unwrapped" rule only applies to flow and masonry).
    expect(integrityErrors(single)).toEqual([]);

    const zero: Workspace = {
      ...single,
      layout: {
        type: "auto",
        id: nodeId("auto-1"),
        columnWidth: 320,
        items: [],
      },
      panels: {},
      activePanelId: null,
    };

    expect(integrityErrors(zero)).toEqual([]);
  });

  it("openWidget into an auto still targets tab groups (card appends use appendAutoItemCard)", () => {
    const ws = makeAutoWorkspace();

    const opened = openWidget(ws, "test.stat", {}, {
      panelId: "panel-x",
      targetTabsId: "tabs-a",
    });

    // The tab landed inside card-a's group, NOT a new card.
    if (opened.workspace.layout.type === "auto") {
      expect(opened.workspace.layout.items).toHaveLength(2);
    }

    expect(findTabsWithPanel(opened.workspace.layout, "panel-x")?.id).toBe(
      "tabs-a",
    );
  });
});
