// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { SqlClient } from "@effect/sql";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, SettingsRepo, SettingsRepoLive } from "./index.js";

/**
 * SettingsRepo round trip against real SQLite (temp file) — the storage
 * behind the root-configurable sensitivity criteria.
 */

const DB_PATH = join(tmpdir(), `nfi-desk-settings-test-${process.pid}.db`);

const SqlLive = SqliteClient.layer({ filename: DB_PATH });
const RepoLive = SettingsRepoLive.pipe(Layer.provide(SqlLive));
const TestLive = Layer.mergeAll(RepoLive, SqlLive);

const runTest = <A, E>(
  effect: Effect.Effect<A, E, SettingsRepo | SqlClient.SqlClient>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(TestLive)));

beforeAll(async () => {
  await Effect.runPromise(migrate.pipe(Effect.provide(SqlLive)));
});

afterAll(async () => {
  await rm(DB_PATH, { force: true });
});

describe("SettingsRepo", () => {
  it("returns null for a never-saved key", async () => {
    const value = await runTest(
      Effect.flatMap(SettingsRepo, (repo) =>
        repo.getSetting("sensitive-info-kinds"),
      ),
    );
    expect(value).toBeNull();
  });

  it("saves and overwrites a JSON document", async () => {
    const save = (value: string) =>
      runTest(
        Effect.flatMap(SettingsRepo, (repo) =>
          repo.saveSetting("sensitive-info-kinds", value),
        ),
      );
    await save(JSON.stringify(["absolute-balance"]));
    await runTest(
      Effect.flatMap(SettingsRepo, (repo) =>
        repo.getSetting("sensitive-info-kinds"),
      ),
    ).then((value) => expect(JSON.parse(value!)).toEqual(["absolute-balance"]));
    // Upsert, not insert-or-crash.
    await save(JSON.stringify(["absolute-balance", "market-data"]));
    await runTest(
      Effect.flatMap(SettingsRepo, (repo) =>
        repo.getSetting("sensitive-info-kinds"),
      ),
    ).then((value) => expect(JSON.parse(value!)).toHaveLength(2));
  });
});
