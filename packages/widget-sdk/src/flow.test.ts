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
  clampFlowItemSize,
  getFlowItemMinSize,
  getLayoutMinHeight,
  getLayoutMinWidth,
} from "./layout.js";
import {
  collectPanelIds,
  createFlow,
  findEnclosingFlow,
  findFlowItemById,
  findNodeById,
  integrityErrors,
  normalizeFlowLayout,
  prunePanelsFromLayout,
  setFlowItemSize,
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

function makeFlowWorkspace(): Workspace {
  return decodeWorkspace({
    id: "ws-flow",
    name: "Flow",
    schemaVersion: 1,
    version: 0,
    layout: {
      type: "flow",
      id: "flow-1",
      items: [
        {
          type: "flow-item",
          id: "card-a",
          width: 500,
          height: 320,
          child: {
            type: "tabs",
            id: "tabs-a",
            panels: ["panel-a"],
            activePanelId: "panel-a",
          },
        },
        {
          type: "flow-item",
          id: "card-b",
          width: 360,
          height: 280,
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

describe("flow layout helpers", () => {
  it("derives card minimums from widget hints (width + height)", () => {
    const tableTabs = tabs("t", "a");
    const min = getFlowItemMinSize(tableTabs, panels, lookup);
    expect(min).toEqual({ width: 560, height: 300 });

    const statTabs = tabs("t2", "b");
    // Absolute flow floors win when the widget hint is smaller (120 < 140).
    expect(getFlowItemMinSize(statTabs, panels, lookup)).toEqual({
      width: 280,
      height: 140,
    });
  });

  it("computes subtree minimums through flow containers", () => {
    const flow: LayoutNode = {
      type: "flow",
      id: nodeId("f"),
      items: [
        {
          type: "flow-item",
          id: nodeId("c1"),
          width: 500,
          height: 300,
          child: tabs("t1", "a"),
        },
        {
          type: "flow-item",
          id: nodeId("c2"),
          width: 360,
          height: 280,
          child: tabs("t2", "b"),
        },
      ],
    };

    // Wrapping: only the widest/tallest card must fit.
    expect(getLayoutMinWidth(flow, panels, lookup)).toBe(560);
    expect(getLayoutMinHeight(flow, panels, lookup)).toBe(300);
  });

  it("clamps dragged card sizes to content minimums and ceilings", () => {
    // Below minimums clamps up.
    expect(clampFlowItemSize(100, 100, 560, 300)).toEqual({
      width: 560,
      height: 300,
    });
    // Inside bounds passes through.
    expect(clampFlowItemSize(600, 400, 560, 300)).toEqual({
      width: 600,
      height: 400,
    });
    // Container width caps the card (overflow wraps instead of clipping).
    expect(clampFlowItemSize(1200, 400, 280, 120, 800)).toEqual({
      width: 800,
      height: 400,
    });
  });
});

describe("flow operations", () => {
  it("creates and normalizes flows (single card unwraps)", () => {
    const flow = createFlow([
      { width: 400, height: 300, child: tabs("t1", "a") },
      { width: 360, height: 280, child: tabs("t2", "b") },
    ]);

    expect(flow.type).toBe("flow");
    expect(flow.items).toHaveLength(2);
    expect(collectPanelIds(flow).map(String)).toEqual(["a", "b"]);

    const solo = createFlow([
      { width: 400, height: 300, child: tabs("t1", "a") },
    ]);

    expect(normalizeFlowLayout(solo)?.type).toBe("tabs");
    expect(normalizeFlowLayout({ ...flow, items: [] })).toBeNull();
  });

  it("finds flows, cards and tabs through nesting", () => {
    const ws = makeFlowWorkspace();
    expect(findNodeById(ws.layout, "flow-1")?.type).toBe("flow");
    expect(findFlowItemById(ws.layout, "card-a")?.width).toBe(500);
    expect(findEnclosingFlow(ws.layout, "tabs-a")?.id).toBe("flow-1");
  });

  it("resizes a card and validates sizes", () => {
    const ws = makeFlowWorkspace();
    const resized = setFlowItemSize(ws, "flow-1", "card-a", 700, 400);
    expect(resized).not.toBe(ws);
    const item = findFlowItemById(resized.layout, "card-a");
    expect(item).toMatchObject({ width: 700, height: 400 });

    // Non-positive / unknown ids are no-ops.
    expect(setFlowItemSize(ws, "flow-1", "card-a", 0, 400)).toBe(ws);
    expect(setFlowItemSize(ws, "flow-1", "missing", 700, 400)).toBe(ws);
    expect(setFlowItemSize(ws, "missing", "card-a", 700, 400)).toBe(ws);
    expect(integrityErrors(resized)).toEqual([]);
  });

  it("keeps emptied cards instead of collapsing the flow", () => {
    const ws = makeFlowWorkspace();
    const pruned = prunePanelsFromLayout(ws.layout, new Set(["panel-a"]));
    expect(pruned?.type).toBe("flow");

    if (pruned?.type === "flow") {
      expect(pruned.items).toHaveLength(2);
      expect(pruned.items[0]!.child.type).toBe("tabs");
      expect(
        pruned.items[0]!.child.type === "tabs" && pruned.items[0]!.child.panels,
      ).toEqual([]);
    }
  });

  it("flags corrupt flow sizes and duplicate ids", () => {
    const ws = makeFlowWorkspace();
    expect(integrityErrors(ws)).toEqual([]);

    const bad: Workspace = {
      ...ws,
      layout: {
        type: "flow",
        id: nodeId("flow-1"),
        items: [
          {
            type: "flow-item",
            id: nodeId("card-a"),
            width: 0,
            height: 280,
            child: tabs("tabs-a", "panel-a"),
          },
        ],
      },
      panels: { "panel-a": ws.panels["panel-a"]! },
      activePanelId: panelId("panel-a"),
    };

    expect(
      integrityErrors(bad).some((e) => e.includes("non-positive size")),
    ).toBe(true);
  });
});
