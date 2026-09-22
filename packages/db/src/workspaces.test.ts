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

const FIXTURE: Workspace = decodeWorkspace({
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
});

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
    expect(typeof entry?.updatedAt).toBe("string");
  });

  it("updates panel configs on re-save and replaces removed panels", async () => {
    const updated: Workspace = {
      ...FIXTURE,
      version: 8,
      panels: {
        "panel-a": {
          id: "panel-a",
          widgetType: "development.inspector",
          widgetConfig: { title: "CHANGED", value: "2" },
        } as Workspace["panels"][string],
      },
      layout: { type: "panel", panelId: "panel-a" as never },
      activePanelId: "panel-a" as never,
    };
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
    const decorated: Workspace = {
      ...FIXTURE,
      id: "ws-decorated" as Workspace["id"],
      icon: "rocket",
      origin: "user",
    };
    const plain: Workspace = {
      ...FIXTURE,
      id: "ws-plain" as Workspace["id"],
      layout: {
        type: "tabs",
        id: "tabs-plain" as never,
        panels: [],
        activePanelId: null,
      },
      panels: {},
      activePanelId: null,
    };
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
        yield* repo.saveWorkspace({
          ...decorated,
          version: 10,
          panels: {
            "panel-a": { ...decorated.panels["panel-a"]!, title: "My trades" },
          },
          layout: { type: "panel", panelId: "panel-a" as never },
          activePanelId: "panel-a" as never,
        });
        const titled = yield* repo.loadWorkspace("ws-decorated");
        expect(titled?.panels["panel-a"]?.title).toBe("My trades");
        expect(titled?.panels["panel-a"]?.widgetConfig).toEqual(
          decorated.panels["panel-a"]?.widgetConfig,
        );
        // Clearing the title persists as absent.
        yield* repo.saveWorkspace({
          ...decorated,
          version: 11,
          panels: {
            "panel-a": { ...decorated.panels["panel-a"]!, title: undefined },
          },
          layout: { type: "panel", panelId: "panel-a" as never },
          activePanelId: "panel-a" as never,
        });
        const untitled = yield* repo.loadWorkspace("ws-decorated");
        expect(untitled?.panels["panel-a"]?.title).toBeUndefined();

        yield* repo.deleteWorkspace("ws-decorated");
        yield* repo.deleteWorkspace("ws-plain");
      }),
    );
  });
});
