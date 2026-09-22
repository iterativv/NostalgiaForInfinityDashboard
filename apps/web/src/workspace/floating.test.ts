// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { collectPanelIds, findTabsById, integrityErrors } from "@nfi/widget-sdk";
import type { TabsLayoutNode } from "@nfi/api-contract";
import {
  FLOATING_MIN_HEIGHT,
  FLOATING_MIN_WIDTH,
  addFloatingTab,
  cascadePosition,
  clampSize,
  floatWindowSize,
  floatingTabsForPage,
  removeFloatingTab,
  sanitizeFloatingState,
  setFloatingWidgetConfig,
} from "./floating";
import {
  dockFloatingTab,
  openWidgetPanel,
  pinTabToFloating,
  updatePanelConfig,
  workspaceStore,
} from "./store";

/** All tab-group nodes of the store's current workspace, tree order. */
function allGroups(): TabsLayoutNode[] {
  const out: TabsLayoutNode[] = [];
  const visit = (node: (typeof workspaceStore.state.workspace)["layout"]): void => {
    if (node.type === "tabs") out.push(node);
    else if (node.type === "split") {
      visit(node.first);
      visit(node.second);
    } else if (node.type === "grid") {
      for (const item of node.items) visit(item.child);
    }
  };
  visit(workspaceStore.state.workspace.layout);
  return out;
}

describe("floating helpers", () => {
  it("clamps sizes to positive floating minimums", () => {
    expect(clampSize(FLOATING_MIN_WIDTH, 0)).toBe(FLOATING_MIN_WIDTH);
    expect(clampSize(FLOATING_MIN_WIDTH, -50)).toBe(FLOATING_MIN_WIDTH);
    expect(clampSize(FLOATING_MIN_WIDTH, Number.NaN)).toBe(FLOATING_MIN_WIDTH);
    expect(clampSize(FLOATING_MIN_WIDTH, 123.6)).toBe(FLOATING_MIN_WIDTH);
    expect(clampSize(FLOATING_MIN_WIDTH, 300.6)).toBe(301);
    expect(clampSize(FLOATING_MIN_HEIGHT, 10)).toBe(FLOATING_MIN_HEIGHT);
  });

  it("cascades window positions in a wrap-around diagonal", () => {
    expect(cascadePosition(0)).toEqual({ x: 64, y: 64 });
    const second = cascadePosition(1);
    expect(second.x).toBe(96);
    expect(second.y).toBe(96);
    // Wraps instead of drifting off-screen.
    expect(cascadePosition(8)).toEqual(cascadePosition(0));
  });

  it("persists the window's own border-box size, so persisting is idempotent", () => {
    // Regression: the resize observer used to measure the BODY's content
    // box (header + borders excluded) and write it back as the window size,
    // shrinking the window on every persist until it hit the minimums.
    // The persisted size must be the element's border box — exactly what
    // the inline style sets — so re-measuring a persisted size is a no-op.
    const el = { offsetWidth: 420, offsetHeight: 300 } as HTMLElement;
    const measured = floatWindowSize(el);
    expect(measured).toEqual({ width: 420, height: 300 });
    // Sub-integer boxes round; sub-minimum boxes clamp instead of shrinking
    // below the floor.
    expect(
      floatWindowSize({ offsetWidth: 300.4, offsetHeight: 199.6 } as HTMLElement),
    ).toEqual({ width: 300, height: 200 });
    expect(
      floatWindowSize({ offsetWidth: 10, offsetHeight: 10 } as HTMLElement),
    ).toEqual({ width: FLOATING_MIN_WIDTH, height: FLOATING_MIN_HEIGHT });
  });

  it("sanitizes persisted state, dropping junk and clamping geometry", () => {
    const clean = sanitizeFloatingState({
      "page-home": [
        {
          id: "float-1",
          panelId: "panel-1",
          widgetType: "profit",
          widgetConfig: { instanceId: "all" },
          x: 10,
          y: 20,
          width: 999999,
          height: 1,
        },
        { junk: true },
        "nope",
      ],
      broken: "not-an-array",
      alsoBroken: 42,
    });
    expect(Object.keys(clean)).toEqual(["page-home"]);
    const [tab] = clean["page-home"] ?? [];
    expect(tab).toMatchObject({
      id: "float-1",
      panelId: "panel-1",
      widgetType: "profit",
      widgetConfig: { instanceId: "all" },
      x: 10,
      y: 20,
      height: FLOATING_MIN_HEIGHT,
    });
    expect(tab?.width).toBeGreaterThan(FLOATING_MIN_WIDTH);
    expect(sanitizeFloatingState(null)).toEqual({});
    expect(sanitizeFloatingState("junk")).toEqual({});
  });
});

describe("floating tab round-trip", () => {
  it("opens one widget per group, pins it out, and docks it back", () => {
    expect(workspaceStore.state.activePageId).toBe("page-home");
    const groups = allGroups();
    expect(groups.length).toBeGreaterThan(1);
    const first = groups[0]!;
    const second = groups[1]!;

    // Same widget type into two different groups: both open.
    const firstPanel = openWidgetPanel("development.inspector", {
      title: "one",
    });
    expect(firstPanel).not.toBeNull();
    const secondPanel = openWidgetPanel(
      "development.inspector",
      { title: "two" },
      { targetTabsId: second.id },
    );
    expect(secondPanel).not.toBeNull();
    expect(secondPanel).not.toBe(firstPanel);
    let workspace = workspaceStore.state.workspace;
    const countType = () =>
      collectPanelIds(workspace.layout).filter(
        (id) => workspace.panels[id]?.widgetType === "development.inspector",
      ).length;
    expect(countType()).toBe(2);
    expect(integrityErrors(workspace)).toEqual([]);

    // Re-opening into the same group focuses instead of duplicating.
    const third = openWidgetPanel(
      "development.inspector",
      {},
      { targetTabsId: first.id },
    );
    expect(third).toBe(firstPanel);
    expect(countType()).toBe(2);

    // Pin the first instance: gone from the grid, present as a floating
    // entry with its captured config and panel id.
    const floatId = pinTabToFloating(firstPanel!);
    expect(floatId).not.toBeNull();
    workspace = workspaceStore.state.workspace;
    expect(workspace.panels[firstPanel as string]).toBeUndefined();
    expect(integrityErrors(workspace)).toEqual([]);
    const floats = floatingTabsForPage("page-home");
    const entry = floats.find((tab) => tab.id === floatId);
    expect(entry?.panelId).toBe(firstPanel);
    expect(entry?.widgetConfig).toEqual({ title: "one" });
    expect(entry?.widgetType).toBe("development.inspector");
    expect(countType()).toBe(1);

    // Config writes route to the floating entry while it is detached.
    updatePanelConfig(firstPanel as string, { title: "moved" });
    expect(
      floatingTabsForPage("page-home").find((tab) => tab.id === floatId)
        ?.widgetConfig,
    ).toEqual({ title: "moved" });

    // Docking restores the widget into the grid (fresh panel id, config
    // kept) and drops the floating window.
    expect(dockFloatingTab(floatId as string)).toBe(true);
    workspace = workspaceStore.state.workspace;
    expect(
      Object.values(workspace.panels).some(
        (panel) =>
          panel.widgetType === "development.inspector" &&
          (panel.widgetConfig as { title?: string } | undefined)?.title ===
            "moved",
      ),
    ).toBe(true);
    expect(floatingTabsForPage("page-home")).toEqual([]);
    expect(integrityErrors(workspace)).toEqual([]);

    // Clean the second instance so other suites start from the default.
    const leftover = collectPanelIds(workspace.layout).find(
      (id) => workspace.panels[id]?.widgetType === "development.inspector",
    );
    expect(leftover).toBeDefined();
    removeFloatingTab("page-home", "does-not-exist");
  });

  it("keeps floating entries isolated per page and refuses unknown ids", () => {
    addFloatingTab("page-test", {
      id: "float-x",
      panelId: "panel-x",
      widgetType: "log",
      widgetConfig: {},
      x: 0,
      y: 0,
      width: FLOATING_MIN_WIDTH,
      height: FLOATING_MIN_HEIGHT,
    });
    expect(floatingTabsForPage("page-home")).toEqual([]);
    expect(floatingTabsForPage("page-test")).toHaveLength(1);
    setFloatingWidgetConfig("page-test", "missing-panel", {});
    expect(dockFloatingTab("missing-float")).toBe(false);
    removeFloatingTab("page-test", "float-x");
    expect(floatingTabsForPage("page-test")).toEqual([]);
  });

  it("resolves tab groups by id after mutation", () => {
    const groups = allGroups();
    for (const group of groups) {
      expect(findTabsById(workspaceStore.state.workspace.layout, group.id)?.id).toBe(group.id);
    }
  });
});
