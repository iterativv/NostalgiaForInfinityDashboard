// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { collectPanelIds, integrityErrors } from "@nfi/widget-sdk";
import {
  DEFAULT_WORKSPACE_ID,
  buildDefaultWorkspace,
} from "./defaultWorkspace";
import { homeFingerprint, maybeUpgradeStoredHome } from "./pages";
import type { Workspace } from "@nfi/api-contract";

describe("default workspace", () => {
  it("is a valid, self-consistent workspace", () => {
    const workspace = buildDefaultWorkspace();
    expect(workspace.id).toBe(DEFAULT_WORKSPACE_ID);
    expect(integrityErrors(workspace)).toEqual([]);
  });

  it("mirrors the freq-ui fleet dashboard, not demo widgets", () => {
    const workspace = buildDefaultWorkspace();
    expect(workspace.layout.type).toBe("grid");
    const grid = workspace.layout as Extract<
      ReturnType<typeof buildDefaultWorkspace>["layout"],
      { type: "grid" }
    >;
    // Freqtrade-UI proportions: a wide fleet column and a narrow charts column.
    expect(grid.columns).toEqual([1.7, 1]);
    expect(grid.rows.length).toBe(3);
    // Every cell holds exactly one widget — nothing hidden behind tabs.
    expect(
      grid.items.every(
        (item) => item.child.type === "tabs" && item.child.panels.length === 1,
      ),
    ).toBe(true);
    const typeOf = (id: string): string | undefined =>
      workspace.panels[id]?.widgetType;
    const ids = collectPanelIds(workspace.layout).map(String);
    const types = new Set(ids.map(typeOf));
    // Left column: comparison + trade tables; right column: charts.
    for (const expected of [
      "fleet-overview",
      "open-positions",
      "closed-positions",
      "daily-profit",
      "cumulative-profit",
      "wallet-history",
    ]) {
      expect(types.has(expected)).toBe(true);
    }
    // Fleet tables subscribe to every instance, like freq-ui's comparison.
    expect(workspace.panels["panel-open"]?.widgetConfig).toMatchObject({
      instanceId: "all",
      showBot: true,
    });
    expect(workspace.panels["panel-closed"]?.widgetConfig).toMatchObject({
      instanceId: "all",
      showBot: true,
    });
    expect(workspace.panels["panel-daily"]?.widgetConfig).toMatchObject({
      instanceId: "all",
      bucket: "monthly",
    });
    // Demo fixtures stay reachable via the palette, not the default screen.
    expect([...types].some((t) => t?.startsWith("development."))).toBe(false);
  });

  it("returns fresh copies on every call", () => {
    const first = buildDefaultWorkspace();
    const second = buildDefaultWorkspace();
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.panels).not.toBe(second.panels);
  });
});

describe("home seed upgrade", () => {
  const v1Fingerprint =
    "grid:3x4:balance,bot-status,candle-chart,closed-positions,open-positions,profit,ticker-tape";

  const workspaceWithFingerprint = (fingerprint: string): Workspace => {
    const [shape = "", types = ""] = fingerprint.split(/:(?=[a-z])/);
    const panelList = types
      .split(",")
      .filter((t) => t.length > 0)
      .map((widgetType, index) => ({
        id: `panel-${index}`,
        widgetType,
        widgetConfig: {},
      }));
    const [layoutType, dims] = shape.split(":");
    const [cols, rows] = (dims ?? "1x1").split("x").map(Number);
    return {
      id: "page-home",
      name: "Home",
      schemaVersion: 1,
      version: 0,
      layout:
        layoutType === "grid"
          ? {
              type: "grid",
              id: "grid-root",
              columns: Array.from({ length: cols || 1 }, () => 1),
              rows: Array.from({ length: rows || 1 }, () => 1),
              items: [],
            }
          : { type: "tabs", id: "tabs-root", panels: [], activePanelId: null },
      panels: Object.fromEntries(panelList.map((p) => [p.id, p])),
      activePanelId: null,
    } as unknown as Workspace;
  };

  it("fingerprint describes grid shape plus widget multiset", () => {
    const workspace = buildDefaultWorkspace();
    expect(homeFingerprint(workspace)).toBe(
      "grid:2x3:closed-positions,cumulative-profit,daily-profit,fleet-overview,open-positions,wallet-history",
    );
  });

  it("upgrades an untouched v1 home to the new default", () => {
    const stored = workspaceWithFingerprint(v1Fingerprint);
    const upgraded = maybeUpgradeStoredHome(stored);
    expect(upgraded).not.toBeNull();
    expect(upgraded?.panels["panel-wallet"]?.widgetType).toBe(
      "wallet-history",
    );
  });

  it("keeps customized homes", () => {
    const customized = workspaceWithFingerprint(
      "grid:3x4:balance,bot-status,candle-chart,closed-positions,open-positions,profit",
    );
    expect(maybeUpgradeStoredHome(customized)).toBeNull();
    expect(
      maybeUpgradeStoredHome(workspaceWithFingerprint("tabs:")),
    ).toBeNull();
  });
});
