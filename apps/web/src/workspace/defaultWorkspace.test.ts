// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { collectPanelIds, integrityErrors } from "@nfi/widget-sdk";
import { builtinWidgets } from "@nfi/widgets";
import {
  DEFAULT_WORKSPACE_ID,
  buildDefaultWorkspace,
} from "./defaultWorkspace";
import { homeFingerprint, maybeUpgradeStoredHome } from "./pages";
import { decodeWorkspace, type Workspace } from "@nfi/api-contract";

const widgetMin = new Map(
  builtinWidgets.map((definition) => [
    definition.type,
    { minWidth: definition.minWidth, minHeight: definition.minHeight },
  ]),
);

describe("default workspace", () => {
  it("is a valid, self-consistent workspace", () => {
    const workspace = buildDefaultWorkspace();
    expect(workspace.id).toBe(DEFAULT_WORKSPACE_ID);
    expect(integrityErrors(workspace)).toEqual([]);
  });

  it("mirrors the freq-ui fleet dashboard, not demo widgets", () => {
    const workspace = buildDefaultWorkspace();
    expect(workspace.layout.type).toBe("auto");

    if (workspace.layout.type !== "auto")
      throw new Error("expected auto layout");
    const auto = workspace.layout;

    expect(auto.columnWidth).toBe(360);
    // Every card holds exactly one widget — nothing hidden behind tabs.
    expect(
      auto.items.every(
        (item) => item.child.type === "tabs" && item.child.panels.length === 1,
      ),
    ).toBe(true);

    const typeOf = (id: string): string | undefined =>
      workspace.panels[id]?.widgetType;

    const ids = collectPanelIds(workspace.layout).map(String);
    const types = new Set(ids.map(typeOf));

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
    expect([...types].some((t) => t?.startsWith("development."))).toBe(false);
  });

  it("matches the fleet screenshot: wide+narrow rows with freq-ui titles", () => {
    const workspace = buildDefaultWorkspace();
    expect(workspace.layout.type).toBe("auto");

    if (workspace.layout.type !== "auto")
      throw new Error("expected auto layout");

    // Three rows of 3/5 + 2/5: fleet+daily, open+cumulative, closed+wallet.
    expect(workspace.layout.items.map((item) => item.span)).toEqual([
      3, 2, 3, 2, 3, 2,
    ]);
    expect(workspace.panels["panel-fleet"]?.title).toBe("Bot Comparison");
    expect(workspace.panels["panel-daily"]?.title).toBe(
      "Profit Over Time Combined",
    );
    expect(workspace.panels["panel-open"]?.title).toBe("Open Trades");
    expect(workspace.panels["panel-cumulative"]?.title).toBe(
      "Cumulative Profit",
    );
    expect(workspace.panels["panel-closed"]?.title).toBe("Closed Trades");
    expect(workspace.panels["panel-wallet"]?.title).toBe("Wallet History");
  });

  it("starts every card at or above its widget minimum (no fresh-page warnings)", () => {
    const workspace = buildDefaultWorkspace();
    expect(workspace.layout.type).toBe("auto");

    if (workspace.layout.type !== "auto")
      throw new Error("expected auto layout");

    for (const item of workspace.layout.items) {
      if (item.child.type !== "tabs" || item.child.panels.length !== 1)
        throw new Error("expected one widget per card");
      const panelId = item.child.panels[0]!;
      const panel = workspace.panels[panelId];
      const min = widgetMin.get(panel?.widgetType ?? "");

      expect(min).toBeDefined();
      // Height clears the widget minimum + tab-strip chrome (28px).
      expect(item.height).toBeGreaterThanOrEqual(min!.minHeight + 28);
      // Width: span 3/2 on 360px columns (span 2 ≈ 728px, span 3 ≈ 1096px)
      // covers every home widget except Closed Positions (1250px) — the
      // auto renderer floors that card's rendered span via `minAutoSpan`,
      // so it still renders at or above its minimum without warnings.
      expect(item.span).toBeGreaterThanOrEqual(2);
    }
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
    const [template = "", types = ""] = fingerprint.split(/:(?=[a-z])/);

    const panelList = types
      .split(",")
      .filter((t) => t.length > 0)
      .map((widgetType, index) => ({
        id: `panel-${index}`,
        widgetType,
        widgetConfig: {},
      }));

    const [layoutType, dims] = template.split(":");
    const [cols, rows] = (dims ?? "1x1").split("x").map(Number);

    return decodeWorkspace({
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
    });
  };

  it("fingerprint describes auto shape plus widget multiset", () => {
    const workspace = buildDefaultWorkspace();
    expect(homeFingerprint(workspace)).toBe(
      "auto:6:closed-positions,cumulative-profit,daily-profit,fleet-overview,open-positions,wallet-history",
    );
  });

  it("upgrades an untouched v1 home to the new default", () => {
    const stored = workspaceWithFingerprint(v1Fingerprint);
    const upgraded = maybeUpgradeStoredHome(stored);
    expect(upgraded).not.toBeNull();
    expect(upgraded?.panels["panel-wallet"]?.widgetType).toBe("wallet-history");
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
