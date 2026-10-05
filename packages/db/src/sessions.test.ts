// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { SqlClient } from "@effect/sql";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, SessionRepo, SessionRepoLive } from "./index.js";

/**
 * SessionRepo persistence round trip against real SQLite (temp file):
 * create/get/touch/delete plus expiry sweeping — the backing store that
 * keeps logins alive across restarts and redeploys.
 */

const DB_PATH = join(tmpdir(), `nfi-desk-sessions-test-${process.pid}.db`);

const SqlLive = SqliteClient.layer({ filename: DB_PATH });

const RepoLive = SessionRepoLive.pipe(Layer.provide(SqlLive));

const TestLive = Layer.mergeAll(RepoLive, SqlLive);

const runTest = <A, E>(
  effect: Effect.Effect<A, E, SessionRepo | SqlClient.SqlClient>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(TestLive)));

beforeAll(async () => {
  await Effect.runPromise(migrate.pipe(Effect.provide(SqlLive)));
});

afterAll(async () => {
  await rm(DB_PATH, { force: true });
});

describe("SessionRepo", () => {
  it("creates and reads a session back", async () => {
    await runTest(
      Effect.flatMap(SessionRepo, (repo) =>
        repo.createSession({
          tokenHash: "hash-alice",
          userId: "usr-alice",
          expiresAt: Date.now() + 3_600_000,
        }),
      ),
    );

    const stored = await runTest(
      Effect.flatMap(SessionRepo, (repo) => repo.getSession("hash-alice")),
    );

    expect(stored?.userId).toBe("usr-alice");
    expect(stored!.expiresAt).toBeGreaterThan(Date.now());
  });

  it("returns null for unknown tokens", async () => {
    const stored = await runTest(
      Effect.flatMap(SessionRepo, (repo) => repo.getSession("hash-nobody")),
    );

    expect(stored).toBeNull();
  });

  it("extends expiry on touch", async () => {
    const before = await runTest(
      Effect.flatMap(SessionRepo, (repo) => repo.getSession("hash-alice")),
    );

    const later = (before?.expiresAt ?? 0) + 60_000;
    await runTest(
      Effect.flatMap(SessionRepo, (repo) => repo.touchSession("hash-alice", later)),
    );

    const after = await runTest(
      Effect.flatMap(SessionRepo, (repo) => repo.getSession("hash-alice")),
    );

    expect(after?.expiresAt).toBe(later);
  });

  it("deletes on logout and sweeps expired rows", async () => {
    const now = Date.now();
    await runTest(
      Effect.flatMap(SessionRepo, (repo) =>
        repo.createSession({
          tokenHash: "hash-dead",
          userId: "usr-gone",
          expiresAt: now - 1_000,
        }),
      ),
    );
    await runTest(
      Effect.flatMap(SessionRepo, (repo) =>
        repo.createSession({
          tokenHash: "hash-logout",
          userId: "usr-bob",
          expiresAt: now + 3_600_000,
        }),
      ),
    );

    await runTest(
      Effect.flatMap(SessionRepo, (repo) => repo.deleteSession("hash-logout")),
    );

    await expect(
      runTest(
        Effect.flatMap(SessionRepo, (repo) => repo.getSession("hash-logout")),
      ),
    ).resolves.toBeNull();

    // Expired rows are still readable until swept (expiry enforced by the
    // caller), then the sweep removes them.
    await expect(
      runTest(
        Effect.flatMap(SessionRepo, (repo) => repo.getSession("hash-dead")),
      ),
    ).resolves.not.toBeNull();

    await runTest(
      Effect.flatMap(SessionRepo, (repo) => repo.sweepExpired(now)),
    );

    await expect(
      runTest(
        Effect.flatMap(SessionRepo, (repo) => repo.getSession("hash-dead")),
      ),
    ).resolves.toBeNull();

    // The live session from the first test survives the sweep.
    await expect(
      runTest(
        Effect.flatMap(SessionRepo, (repo) => repo.getSession("hash-alice")),
      ),
    ).resolves.not.toBeNull();
  });
});
