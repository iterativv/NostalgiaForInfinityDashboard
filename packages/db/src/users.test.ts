// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Effect, Layer } from "effect"
import { SqlClient } from "@effect/sql"
import { SqliteClient } from "@effect/sql-sqlite-node"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ANONYMOUS_USER_ID, NON_SENSITIVE_CAPABILITIES } from "@nfi/api-contract"
import {
  hashPassword,
  migrate,
  UserRepo,
  UserRepoLive,
  verifyPassword,
} from "./index.js"

/**
 * UserRepo persistence round trip against real SQLite (temp file), plus the
 * scrypt password hashing contract and the anonymous grant seed.
 */

const DB_PATH = join(tmpdir(), `nfi-desk-users-test-${process.pid}.db`)

const SqlLive = SqliteClient.layer({ filename: DB_PATH })
const RepoLive = UserRepoLive.pipe(Layer.provide(SqlLive))
const TestLive = Layer.mergeAll(RepoLive, SqlLive)

const runTest = <A, E>(
  effect: Effect.Effect<A, E, UserRepo | SqlClient.SqlClient>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(TestLive)))

beforeAll(async () => {
  await Effect.runPromise(migrate.pipe(Effect.provide(SqlLive)))
})

afterAll(async () => {
  await rm(DB_PATH, { force: true })
})

describe("password hashing (scrypt)", () => {
  it("round-trips a password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple")
    expect(hash.startsWith("scrypt:")).toBe(true)
    expect(hash).not.toContain("correct horse")
    await expect(verifyPassword(hash, "correct horse battery staple")).resolves.toBe(true)
    await expect(verifyPassword(hash, "wrong password")).resolves.toBe(false)
  })

  it("salts every hash and rejects malformed hashes", async () => {
    const a = await hashPassword("same")
    const b = await hashPassword("same")
    expect(a).not.toBe(b)
    await expect(verifyPassword("not-a-hash", "same")).resolves.toBe(false)
    await expect(verifyPassword("scrypt:!!:!!", "same")).resolves.toBe(false)
  })
})

describe("UserRepo", () => {
  it("seeds exactly one anonymous row with the public grant (no password)", async () => {
    const rows = await runTest(Effect.flatMap(UserRepo, (repo) => repo.listUsers()))
    const anonymous = rows.filter((row) => row.id === ANONYMOUS_USER_ID)
    expect(anonymous).toHaveLength(1)
    expect(anonymous[0]?.role).toBe("anonymous")
    expect(anonymous[0]?.hasPassword).toBe(false)
    expect([...anonymous[0]!.capabilities]).toEqual([...NON_SENSITIVE_CAPABILITIES])
  })

  it("creates, updates and deletes users with hashed passwords", async () => {
    const created = await runTest(
      Effect.flatMap(UserRepo, (repo) =>
        repo.createUser({ username: "trader", password: "secret", capabilities: ["bot.status"] }),
      ),
    )
    expect(created.role).toBe("user")
    expect(created.hasPassword).toBe(true)
    expect(created.capabilities).toEqual(["bot.status"])

    const withHash = await runTest(
      Effect.flatMap(UserRepo, (repo) => repo.getUserByUsername("trader")),
    )
    expect(withHash?.passwordHash.startsWith("scrypt:")).toBe(true)
    await expect(verifyPassword(withHash!.passwordHash, "secret")).resolves.toBe(true)

    const updated = await runTest(
      Effect.flatMap(UserRepo, (repo) =>
        repo.updateUser(created.id, {
          capabilities: ["bot.status", "bot.profit.relative"],
          password: "rotated",
        }),
      ),
    )
    expect(updated?.capabilities).toEqual(["bot.status", "bot.profit.relative"])
    const rotated = await runTest(
      Effect.flatMap(UserRepo, (repo) => repo.getUserByUsername("trader")),
    )
    await expect(verifyPassword(rotated!.passwordHash, "rotated")).resolves.toBe(true)
    await expect(verifyPassword(rotated!.passwordHash, "secret")).resolves.toBe(false)

    expect(await runTest(Effect.flatMap(UserRepo, (repo) => repo.deleteUser(created.id)))).toBe(
      true,
    )
    expect(
      await runTest(Effect.flatMap(UserRepo, (repo) => repo.getUser(created.id))),
    ).toBeNull()
  })
})
