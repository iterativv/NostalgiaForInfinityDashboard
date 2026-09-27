// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { SqlClient } from "@effect/sql";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeWorkspace, type Workspace } from "@nfi/api-contract";
import { WorkspaceRepo, WorkspaceRepoLive, migrate } from "./index.js";

/**
 * WorkspaceRepo persistence round trip against real SQLite (temp file, so
 * the migration and the repo share one database even across connections).
 */

const DB_PATH = join(tmpdir(), `nfi-desk-workspace-test-${process.pid}.db`);

const SqlLive = SqliteClient.layer({ filename: DB_PATH });

const RepoLive = WorkspaceRepoLive.pipe(Layer.provide(SqlLive));

const TestLive = Layer.mergeAll(RepoLive, SqlLive);

const runTest = <A, E>(
  effect: Effect.Effect<A, E, WorkspaceRepo | SqlClient.SqlClient>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(TestLive)));

/**
 * Raw fixture document, shaped exactly like the persisted JSON. Every variant
 * below spreads and overrides it, then runs through `decodeWorkspace` — the
 * same strict boundary the server uses — so branded ids are never asserted.
 */
const FIXTURE_INPUT = {
  id: "ws-roundtrip",
  name: "Round trip",
  schemaVersion: 1,
  version: 7,
  layout: {
    type: "split",
    id: "split-1",
    direction: "horizontal",
    ratio: 0.6,
    first: {
      type: "tabs",
      id: "tabs-1",
      panels: ["panel-a", "panel-b"],
      activePanelId: "panel-b",
    },
    second: { type: "panel", panelId: "panel-c" },
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
      widgetConfig: { source: "s" },
    },
    "panel-c": {
      id: "panel-c",
      widgetType: "development.welcome",
      widgetConfig: {},
    },
  },
  activePanelId: "panel-b",
};

const FIXTURE: Workspace = decodeWorkspace(FIXTURE_INPUT);

describe("WorkspaceRepo (sqlite)", () => {
  beforeAll(async () => {
    await rm(DB_PATH, { force: true });
    await runTest(migrate);
  });

  afterAll(async () => {
    await rm(DB_PATH, { force: true });
  });

  it("saves and loads a workspace with layout, panels and focus intact", async () => {
    await runTest(
      Effect.flatMap(WorkspaceRepo, (repo) =>
        repo.saveWorkspace(structuredClone(FIXTURE)),
      ),
    );

    const loaded = await runTest(
      Effect.flatMap(WorkspaceRepo, (repo) =>
        repo.loadWorkspace("ws-roundtrip"),
      ),
    );

    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(FIXTURE);
  });

  it("lists workspaces with summaries", async () => {
    const summaries = await runTest(
      Effect.flatMap(WorkspaceRepo, (repo) => repo.listWorkspaces()),
    );

    expect(summaries.map((s) => s.id)).toContain("ws-roundtrip");
    const entry = summaries.find((s) => s.id === "ws-roundtrip");
    expect(entry?.name).toBe("Round trip");
    expect(entry?.updatedAt).toEqual(expect.any(String));
  });

  it("updates panel configs on re-save and replaces removed panels", async () => {
    const updated: Workspace = decodeWorkspace({
      ...FIXTURE_INPUT,
      version: 8,
      panels: {
        "panel-a": {
          id: "panel-a",
          widgetType: "development.inspector",
          widgetConfig: { title: "CHANGED", value: "2" },
        },
      },
      layout: { type: "panel", panelId: "panel-a" },
      activePanelId: "panel-a",
    });

    await runTest(
      Effect.flatMap(WorkspaceRepo, (repo) => repo.saveWorkspace(updated)),
    );

    const loaded = await runTest(
      Effect.flatMap(WorkspaceRepo, (repo) =>
        repo.loadWorkspace("ws-roundtrip"),
      ),
    );

    expect(Object.keys(loaded?.panels ?? {})).toEqual(["panel-a"]);
    expect(loaded?.panels["panel-a"]?.widgetConfig).toEqual({
      title: "CHANGED",
      value: "2",
    });
    expect(loaded?.version).toBe(8);
  });

  it("returns null for unknown ids and deletes explicitly", async () => {
    const missing = await runTest(
      Effect.flatMap(WorkspaceRepo, (repo) => repo.loadWorkspace("nope")),
    );

    expect(missing).toBeNull();

    const deleted = await runTest(
      Effect.flatMap(WorkspaceRepo, (repo) =>
        repo.deleteWorkspace("ws-roundtrip"),
      ),
    );

    expect(deleted).toBe("ws-roundtrip");

    const after = await runTest(
      Effect.flatMap(WorkspaceRepo, (repo) =>
        repo.loadWorkspace("ws-roundtrip"),
      ),
    );

    expect(after).toBeNull();
  });

  it("creates empty workspaces by name", async () => {
    const created = await runTest(
      Effect.flatMap(WorkspaceRepo, (repo) =>
        repo.createWorkspace({ name: "Fresh" }),
      ),
    );

    expect(created.name).toBe("Fresh");
    expect(created.layout.type).toBe("tabs");
    await runTest(
      Effect.flatMap(WorkspaceRepo, (repo) => repo.deleteWorkspace(created.id)),
    );
  });

  it("persists page icon and origin, and survives their absence", async () => {
    const decorated: Workspace = decodeWorkspace({
      ...FIXTURE_INPUT,
      id: "ws-decorated",
      icon: "rocket",
      origin: "user",
    });

    const plain: Workspace = decodeWorkspace({
      ...FIXTURE_INPUT,
      id: "ws-plain",
      layout: {
        type: "tabs",
        id: "tabs-plain",
        panels: [],
        activePanelId: null,
      },
      panels: {},
      activePanelId: null,
    });

    // One program keeps the whole scenario on a single connection.
    await runTest(
      Effect.gen(function* () {
        const repo = yield* WorkspaceRepo;
        yield* repo.saveWorkspace(structuredClone(decorated));
        let loaded = yield* repo.loadWorkspace("ws-decorated");
        expect(loaded?.icon).toBe("rocket");
        expect(loaded?.origin).toBe("user");

        // A re-save without the fields clears stale metadata.
        yield* repo.saveWorkspace({
          ...decorated,
          version: 8,
          icon: undefined,
          origin: undefined,
        });
        loaded = yield* repo.loadWorkspace("ws-decorated");
        expect(loaded?.icon).toBeUndefined();
        expect(loaded?.origin).toBeUndefined();
        expect(loaded?.version).toBe(8);

        // Legacy rows (columns NULL) decode as absent optional fields. The
        // blank page owns no panel rows — panel ids are globally unique
        // (PRIMARY KEY), so a second workspace must not reuse fixture ids.
        yield* repo.saveWorkspace(structuredClone(plain));
        const bare = yield* repo.loadWorkspace("ws-plain");
        expect(bare?.icon).toBeUndefined();
        expect(bare?.origin).toBeUndefined();

        // Panel renames (tab titles) persist through the panels table.
        yield* repo.saveWorkspace(
          decodeWorkspace({
            ...FIXTURE_INPUT,
            id: "ws-decorated",
            icon: "rocket",
            origin: "user",
            version: 10,
            panels: {
              "panel-a": {
                ...FIXTURE_INPUT.panels["panel-a"],
                title: "My trades",
              },
            },
            layout: { type: "panel", panelId: "panel-a" },
            activePanelId: "panel-a",
          }),
        );
        const titled = yield* repo.loadWorkspace("ws-decorated");
        expect(titled?.panels["panel-a"]?.title).toBe("My trades");
        expect(titled?.panels["panel-a"]?.widgetConfig).toEqual(
          decorated.panels["panel-a"]?.widgetConfig,
        );
        // Clearing the title persists as absent.
        yield* repo.saveWorkspace(
          decodeWorkspace({
            ...FIXTURE_INPUT,
            id: "ws-decorated",
            icon: "rocket",
            origin: "user",
            version: 11,
            panels: {
              "panel-a": {
                ...FIXTURE_INPUT.panels["panel-a"],
                title: undefined,
              },
            },
            layout: { type: "panel", panelId: "panel-a" },
            activePanelId: "panel-a",
          }),
        );
        const untitled = yield* repo.loadWorkspace("ws-decorated");
        expect(untitled?.panels["panel-a"]?.title).toBeUndefined();

        yield* repo.deleteWorkspace("ws-decorated");
        yield* repo.deleteWorkspace("ws-plain");
      }),
    );
  });

  it("scopes panel identity to the workspace: two pages may share a panel id", async () => {
    // The production incident this migration exists for: preset pages carry
    // stable panel ids (`panel-chart`, …) that older databases rejected
    // whenever ANY other workspace (the shared Home dashboard) already had a
    // panel row with the same id — the global PRIMARY KEY made every preset
    // save fail forever. With the composite `(workspace_id, id)` key the
    // same insert is ordinary data.
    const keyColumns = await runTest(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) =>
          sql`
          SELECT name, pk FROM pragma_table_info ('workspace_panels') WHERE pk > 0 ORDER BY pk
        `,
      ),
    );

    expect(keyColumns).toEqual([
      { name: "workspace_id", pk: 1 },
      { name: "id", pk: 2 },
    ]);

    // A second document reusing FIXTURE's panel ids must save cleanly.
    const clone = decodeWorkspace({
      ...FIXTURE_INPUT,
      id: "ws-same-ids",
    });

    await runTest(
      Effect.flatMap(WorkspaceRepo, (repo) => repo.saveWorkspace(clone)),
    );

    const loaded = await runTest(
      Effect.flatMap(WorkspaceRepo, (repo) =>
        repo.loadWorkspace("ws-same-ids"),
      ),
    );

    expect(loaded).not.toBeNull();
    expect(loaded?.panels["panel-a"]).toBeTruthy();

    // A THIRD document with the same panel ids saves too — one panel row
    // per workspace, no cross-workspace clobber.
    const clone2 = decodeWorkspace({
      ...FIXTURE_INPUT,
      id: "ws-same-ids-2",
    });

    await runTest(
      Effect.flatMap(WorkspaceRepo, (repo) => repo.saveWorkspace(clone2)),
    );

    const rows = await runTest(
      Effect.flatMap(
        SqlClient.SqlClient,
        (sql) =>
          sql`SELECT workspace_id FROM workspace_panels WHERE id = 'panel-a' ORDER BY workspace_id`,
      ),
    );

    expect(rows).toEqual([
      { workspace_id: "ws-same-ids" },
      { workspace_id: "ws-same-ids-2" },
    ]);
  });
  it("rebuilds a legacy global-key panels table in place (auto-migration)", async () => {
    // Simulate a pre-migration deployment: the old `id`-only PRIMARY KEY
    // table. Boot-time migration converges the schema without losing rows.
    await runTest(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`ALTER TABLE workspace_panels RENAME TO workspace_panels_legacy`;
        yield* sql`
          CREATE TABLE workspace_panels (
            id TEXT PRIMARY KEY,
            workspace_id TEXT NOT NULL REFERENCES workspaces (id),
            widget_type TEXT NOT NULL,
            widget_config_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `;
        yield* sql`
          INSERT INTO workspaces (id, name, schema_version, version, layout_json, active_panel_id, created_at, updated_at)
          VALUES ('ws-legacy', 'Legacy', 1, 0, '{}', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
        `;
        yield* sql`
          INSERT INTO workspace_panels (id, workspace_id, widget_type, widget_config_json, created_at, updated_at)
          VALUES ('shared-panel', 'ws-legacy', 'development.log', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
        `;
        yield* sql`DROP TABLE workspace_panels_legacy`;
        yield* migrate;

        const keyColumns = yield* sql`
          SELECT name, pk FROM pragma_table_info ('workspace_panels') WHERE pk > 0 ORDER BY pk
        `;

        expect(keyColumns).toEqual([
          { name: "workspace_id", pk: 1 },
          { name: "id", pk: 2 },
        ]);

        const shared = yield* sql`
          SELECT workspace_id FROM workspace_panels WHERE id = 'shared-panel'
        `;

        expect(shared).toEqual([{ workspace_id: "ws-legacy" }]);
      }),
    );
  });
});
