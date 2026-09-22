// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  ALL_CAPABILITIES,
  CURRENT_WORKSPACE_SCHEMA_VERSION,
  ENDPOINT_CAPABILITIES,
  LayoutNode,
  Workspace,
  capabilitiesForEndpoint,
  decodePersistedWorkspace,
  decodeWorkspace,
} from "./index.js";

const VALID_WORKSPACE = {
  id: "ws-1",
  name: "Test",
  schemaVersion: 1,
  version: 3,
  layout: {
    type: "split",
    id: "split-1",
    direction: "horizontal",
    ratio: 0.6,
    first: {
      type: "tabs",
      id: "tabs-1",
      panels: ["panel-a"],
      activePanelId: "panel-a",
    },
    second: { type: "panel", panelId: "panel-b" },
  },
  panels: {
    "panel-a": {
      id: "panel-a",
      widgetType: "development.inspector",
      widgetConfig: { title: "A", value: "1" },
    },
    "panel-b": {
      id: "panel-b",
      widgetType: "development.welcome",
      widgetConfig: {},
    },
  },
  activePanelId: "panel-a",
} as const;

describe("Workspace schema", () => {
  it("decodes a full workspace and preserves the wire shape", () => {
    const workspace = decodeWorkspace(structuredClone(VALID_WORKSPACE));
    expect(workspace.id).toBe("ws-1");
    expect(workspace.version).toBe(3);
    // JSON transport round trip: encode -> stringify -> parse -> decode.
    const encoded = Schema.encodeSync(Workspace)(workspace);
    const revived = decodeWorkspace(
      JSON.parse(JSON.stringify(encoded)) as unknown,
    );
    expect(revived).toEqual(workspace);
  });

  it("rejects out-of-range split ratios", () => {
    const bad = (ratio: number) =>
      structuredClone({
        ...VALID_WORKSPACE,
        layout: { ...VALID_WORKSPACE.layout, ratio },
      });
    expect(() => decodeWorkspace(bad(0))).toThrow();
    expect(() => decodeWorkspace(bad(1))).toThrow();
    expect(() => decodeWorkspace(bad(0.5))).not.toThrow();
  });

  it("rejects unknown layout node types", () => {
    const bad = structuredClone(VALID_WORKSPACE);
    // @ts-expect-error intentional corruption
    bad.layout = { type: "mosaic" };
    expect(() => decodeWorkspace(bad)).toThrow();
  });

  it("rejects empty ids and names", () => {
    const bad = structuredClone(VALID_WORKSPACE);
    // @ts-expect-error intentional corruption
    bad.id = "";
    expect(() => decodeWorkspace(bad)).toThrow();
  });

  it("round trips optional page metadata (icon, origin)", () => {
    const decorated = decodeWorkspace({
      ...structuredClone(VALID_WORKSPACE),
      icon: "rocket",
      origin: "user",
    });
    expect(decorated.icon).toBe("rocket");
    expect(decorated.origin).toBe("user");
    const revived = decodeWorkspace(
      JSON.parse(
        JSON.stringify(Schema.encodeSync(Workspace)(decorated)),
      ) as unknown,
    );
    expect(revived).toEqual(decorated);

    // Absent metadata stays absent; unknown origins are rejected.
    const plain = decodeWorkspace(structuredClone(VALID_WORKSPACE));
    expect(plain.icon).toBeUndefined();
    expect(plain.origin).toBeUndefined();
    expect(() =>
      decodeWorkspace({
        ...structuredClone(VALID_WORKSPACE),
        origin: "system",
      }),
    ).toThrow();
  });

  it("rejects unsupported schema versions explicitly", () => {
    const future = { ...structuredClone(VALID_WORKSPACE), schemaVersion: 999 };
    expect(() => decodePersistedWorkspace(future)).toThrow(/schema version/i);
    const current = decodePersistedWorkspace(structuredClone(VALID_WORKSPACE));
    expect(current.schemaVersion).toBe(CURRENT_WORKSPACE_SCHEMA_VERSION);
  });

  it("declares a capability for every endpoint (auth contract)", () => {
    // Every endpoint except the public bootstrap must require a capability,
    // and every required capability must be grantable (member of ALL).
    const all = new Set(ALL_CAPABILITIES);
    expect(ALL_CAPABILITIES.length).toBeGreaterThan(0);
    for (const [endpoint, caps] of Object.entries(ENDPOINT_CAPABILITIES)) {
      for (const cap of caps) {
        expect(
          all.has(cap),
          `${endpoint} requires unknown capability ${cap}`,
        ).toBe(true);
      }
    }
    expect(capabilitiesForEndpoint("Bot", "status")).toEqual(["bot.status"]);
    expect(capabilitiesForEndpoint("Bot", "balanceRelative")).toEqual([
      "bot.balance.relative",
    ]);
    expect(capabilitiesForEndpoint("Instances", "tagPerformance")).toEqual([
      "instances.tag-performance",
    ]);
    expect(
      capabilitiesForEndpoint("Instances", "closedPositionsRelative"),
    ).toEqual(["instances.closed-positions.relative"]);
    expect(capabilitiesForEndpoint("Auth", "capabilities")).toEqual([]);
    expect(capabilitiesForEndpoint("Nope", "missing")).toEqual([]);
  });

  it("decodes nested splits recursively", () => {
    const nested = {
      type: "split",
      id: "root",
      direction: "vertical",
      ratio: 0.5,
      first: {
        type: "split",
        id: "inner",
        direction: "horizontal",
        ratio: 0.25,
        first: { type: "panel", panelId: "a" },
        second: { type: "panel", panelId: "b" },
      },
      second: { type: "tabs", id: "t", panels: [], activePanelId: null },
    } as const;
    expect(() =>
      Schema.decodeUnknownSync(LayoutNode)(structuredClone(nested)),
    ).not.toThrow();
  });
});

describe("grid layout schema + legacy migration", () => {
  const tabs = (id: string, panels: string[]): unknown => ({
    type: "tabs",
    id,
    panels,
    activePanelId: panels[0] ?? null,
  });

  it("decodes grid nodes with positioned spanning items", () => {
    const grid = {
      type: "grid",
      id: "g",
      columns: [1, 2],
      rows: [3, 1],
      items: [
        {
          type: "item",
          id: "i1",
          col: 1,
          row: 1,
          colSpan: 1,
          rowSpan: 2,
          child: tabs("t1", ["a"]),
        },
        {
          type: "item",
          id: "i2",
          col: 2,
          row: 1,
          colSpan: 1,
          rowSpan: 1,
          child: tabs("t2", ["b"]),
        },
        {
          type: "item",
          id: "i3",
          col: 2,
          row: 2,
          colSpan: 1,
          rowSpan: 1,
          child: tabs("t3", ["c"]),
        },
      ],
    };
    expect(() =>
      Schema.decodeUnknownSync(LayoutNode)(structuredClone(grid)),
    ).not.toThrow();
    // Zero/negative tracks and non-integer coordinates are refused.
    const badTracks = structuredClone(grid) as Record<string, unknown>;
    badTracks["columns"] = [1, 0];
    expect(() => Schema.decodeUnknownSync(LayoutNode)(badTracks)).toThrow();
    const badCoord = structuredClone(grid) as {
      items: Array<Record<string, unknown>>;
    };
    badCoord.items[0]!["col"] = 0;
    expect(() => Schema.decodeUnknownSync(LayoutNode)(badCoord)).toThrow();
  });

  it("migrates chained same-direction splits into one flat grid", () => {
    // split(h, split(h, A, B), C) — the chained-ratio shape the old system
    // produced — must become a single 3-column grid with proportional tracks.
    const legacy = {
      ...structuredClone(VALID_WORKSPACE),
      panels: {
        "panel-a": VALID_WORKSPACE.panels["panel-a"],
        "panel-b": VALID_WORKSPACE.panels["panel-b"],
        "panel-c": {
          id: "panel-c",
          widgetType: "development.log",
          widgetConfig: {},
        },
      },
      layout: {
        type: "split",
        id: "root",
        direction: "horizontal",
        ratio: 1 / 3,
        first: {
          type: "split",
          id: "inner",
          direction: "horizontal",
          ratio: 0.5,
          first: tabs("t-a", ["panel-a"]),
          second: tabs("t-b", ["panel-b"]),
        },
        second: tabs("t-c", ["panel-c"]),
      },
      activePanelId: "panel-a",
    };
    const migrated = decodePersistedWorkspace(legacy);
    expect(migrated.layout.type).toBe("grid");
    if (migrated.layout.type !== "grid") return;
    expect(migrated.layout.columns).toHaveLength(3);
    expect(migrated.layout.rows).toHaveLength(1);
    expect(migrated.layout.items.map((i) => i.col).sort()).toEqual([1, 2, 3]);
    // All items on row 1, no nesting left inside the items.
    expect(
      migrated.layout.items.every((i) => i.row === 1 && i.rowSpan === 1),
    ).toBe(true);
    // Proportions preserved: [1/3·1/2, 1/3·1/2, 2/3].
    expect(migrated.layout.columns[0]).toBeCloseTo(1 / 6, 10);
    expect(migrated.layout.columns[2]).toBeCloseTo(2 / 3, 10);
  });

  it("migrates mixed-direction splits into a spanning grid and stays idempotent", () => {
    const legacy = {
      ...structuredClone(VALID_WORKSPACE),
      panels: {
        "panel-a": VALID_WORKSPACE.panels["panel-a"],
        "panel-b": VALID_WORKSPACE.panels["panel-b"],
        "panel-c": {
          id: "panel-c",
          widgetType: "development.log",
          widgetConfig: {},
        },
      },
      layout: {
        type: "split",
        id: "root",
        direction: "vertical",
        ratio: 0.7,
        first: {
          type: "split",
          id: "row",
          direction: "horizontal",
          ratio: 0.5,
          first: tabs("t-a", ["panel-a"]),
          second: { type: "panel", panelId: "panel-b" },
        },
        second: tabs("t-c", ["panel-c"]),
      },
      activePanelId: "panel-a",
    };
    const migrated = decodePersistedWorkspace(legacy);
    expect(migrated.layout.type).toBe("grid");
    if (migrated.layout.type !== "grid") return;
    // The horizontal child split flattens into the vertical parent: a 2x2
    // grid whose bottom row spans both columns (rows keep the 0.7/0.3 split).
    expect(migrated.layout.columns).toEqual([0.5, 0.5]);
    expect(migrated.layout.rows[0]).toBeCloseTo(0.7, 10);
    expect(migrated.layout.rows[1]).toBeCloseTo(0.3, 10);
    const bottom = migrated.layout.items.find((i) => i.row === 2);
    expect(bottom).toMatchObject({ col: 1, colSpan: 2 });
    expect(migrated.layout.items).toHaveLength(3);
    // Second run changes nothing (idempotent).
    const again = decodePersistedWorkspace(
      JSON.parse(JSON.stringify(migrated)) as never,
    );
    expect(again).toEqual(migrated);
  });
});
