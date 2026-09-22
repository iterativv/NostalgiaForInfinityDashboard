// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest"
import { Effect, Either } from "effect"
import type { Capability, ManagedUser } from "@nfi/api-contract"
import type { StoredUser, UserRepoService } from "@nfi/db"
import { AuthCapabilitiesCapability } from "./auth-capabilities.js"
import { UsersCreateCapability } from "./users-create.js"
import { UsersListCapability } from "./users-list.js"
import { UsersRemoveCapability } from "./users-remove.js"
import { UsersUpdateCapability } from "./users-update.js"
import type { CapabilityContext, Principal } from "./definition.js"

/**
 * users.* authorization guards: no privilege escalation, immutable root,
 * password-less anonymous, and the auth.capabilities principal reflection.
 * These run the capability `run` directly with a stub context — the HTTP
 * choke point (`runCapabilityForHttp`) is exercised in the server app.
 */

const ROOT_USERNAME = "admin"

type MutableUser = { -readonly [K in keyof StoredUser]: StoredUser[K] }

const makeUsersRepo = (rows: MutableUser[] = []): UserRepoService => {
  const byUsername = (username: string) => rows.find((row) => row.username === username)
  return {
    listUsers: () => Effect.succeed([...rows]),
    getUser: (id: string) => Effect.succeed(rows.find((row) => row.id === id) ?? null),
    getUserByUsername: (username: string) => {
      const row = byUsername(username)
      return Effect.succeed(row ? { ...row, passwordHash: "scrypt:x:y" } : null)
    },
    createUser: (input: {
      username: string
      password: string
      capabilities: ReadonlyArray<Capability>
    }) => {
      const now = new Date().toISOString()
      const user: MutableUser = {
        id: `usr-${input.username}`,
        username: input.username,
        role: "user",
        capabilities: [...input.capabilities],
        hasPassword: input.password.length > 0,
        createdAt: now,
        updatedAt: now,
      }
      rows.push(user)
      return Effect.succeed(user)
    },
    createRootUser: (input: { username: string; password: string }) => {
      const now = new Date().toISOString()
      const user: MutableUser = {
        id: "root",
        username: input.username,
        role: "root",
        capabilities: [],
        hasPassword: input.password.length > 0,
        createdAt: now,
        updatedAt: now,
      }
      rows.push(user)
      return Effect.succeed(user)
    },
    updateUser: (
      id: string,
      input: { password?: string; capabilities?: ReadonlyArray<Capability> },
    ) => {
      const row = rows.find((r) => r.id === id)
      if (!row) return Effect.succeed(null)
      if (input.capabilities !== undefined) row.capabilities = [...input.capabilities]
      if (input.password !== undefined && input.password.length > 0) row.hasPassword = true
      row.updatedAt = new Date().toISOString()
      return Effect.succeed(row)
    },
    deleteUser: (id: string) => {
      const index = rows.findIndex((r) => r.id === id)
      if (index >= 0) rows.splice(index, 1)
      return Effect.succeed(true)
    },
  }
}

const makeContext = (principal: Principal, repo: UserRepoService): CapabilityContext =>
  ({
    principal,
    users: repo,
    rootUsername: ROOT_USERNAME,
  }) as unknown as CapabilityContext

const anonymousRow: MutableUser = {
  id: "anonymous",
  username: "anonymous",
  role: "anonymous",
  capabilities: ["bot.profit.relative", "system.health"],
  hasPassword: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

const manager: Principal = {
  kind: "user",
  userId: "usr-manager",
  username: "manager",
  role: "user",
  granted: [
    "bot.status",
    "bot.profit.relative",
    "users.list",
    "users.create",
    "users.update",
    "users.remove",
  ],
}

const root: Principal = {
  kind: "user",
  userId: "root",
  username: ROOT_USERNAME,
  role: "root",
  granted: ["bot.status"],
}

/** A user MORE privileged than `manager` (holds `bot.balance`). */
const privilegedUser: MutableUser = {
  id: "usr-privileged",
  username: "privileged",
  role: "user",
  capabilities: ["bot.balance", "bot.status"],
  hasPassword: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

/** A user whose grant is a strict subset of `manager`'s. */
const subordinateUser: MutableUser = {
  id: "usr-subordinate",
  username: "subordinate",
  role: "user",
  capabilities: ["bot.status"],
  hasPassword: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}

const run = <A, E>(effect: Effect.Effect<A, E>): Either.Either<A, E> =>
  Effect.runSync(Effect.either(effect))

describe("users.create guards", () => {
  it("rejects granting capabilities the caller does not hold", () => {
    const outcome = run(
      UsersCreateCapability.run(
        { username: "eve", password: "secret123", capabilities: ["bot.balance"] },
        makeContext(manager, makeUsersRepo()),
      ),
    )
    expect(Either.isLeft(outcome)).toBe(true)
    if (Either.isLeft(outcome)) {
      expect((outcome.left as { _tag: string })._tag).toBe("ForbiddenError")
    }
  })

  it("creates a user when the grant is a subset of the caller's", () => {
    const rows: MutableUser[] = []
    const outcome = run(
      UsersCreateCapability.run(
        { username: "viewer", password: "secret123", capabilities: ["bot.status"] },
        makeContext(manager, makeUsersRepo(rows)),
      ),
    )
    expect(Either.isRight(outcome)).toBe(true)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.capabilities).toEqual(["bot.status"])
  })

  it("rejects creating a user with the root username", () => {
    const outcome = run(
      UsersCreateCapability.run(
        { username: ROOT_USERNAME, password: "x".repeat(10), capabilities: ["bot.status"] },
        makeContext(root, makeUsersRepo()),
      ),
    )
    expect(Either.isLeft(outcome)).toBe(true)
  })

  it("rejects anonymous callers outright", () => {
    const outcome = run(
      UsersCreateCapability.run(
        { username: "eve", password: "secret123", capabilities: [] },
        makeContext({ kind: "anonymous", granted: [] }, makeUsersRepo()),
      ),
    )
    expect(Either.isLeft(outcome)).toBe(true)
  })
})

describe("users.update guards", () => {
  it("refuses to modify root", () => {
    const outcome = run(
      UsersUpdateCapability.run(
        { id: "root", capabilities: ["bot.status"] },
        makeContext(root, makeUsersRepo()),
      ),
    )
    expect(Either.isLeft(outcome)).toBe(true)
  })

  it("escapes no capability beyond the caller's grant", () => {
    const outcome = run(
      UsersUpdateCapability.run(
        { id: "anonymous", capabilities: ["bot.balance"] },
        makeContext(manager, makeUsersRepo([{ ...anonymousRow }])),
      ),
    )
    expect(Either.isLeft(outcome)).toBe(true)
  })

  it("updates the anonymous grant (capabilities only)", () => {
    const rows: MutableUser[] = [{ ...anonymousRow, capabilities: [...anonymousRow.capabilities] }]
    const outcome = run(
      UsersUpdateCapability.run(
        { id: "anonymous", capabilities: ["bot.profit.relative"], password: "nope" },
        makeContext(root, makeUsersRepo(rows)),
      ),
    )
    expect(Either.isRight(outcome)).toBe(true)
    const anonymous = rows[0]!
    expect(anonymous.capabilities).toEqual(["bot.profit.relative"])
    expect(anonymous.hasPassword).toBe(false)
  })

  it("blocks a limited manager from password-resetting a MORE privileged user", () => {
    // The escalation hole this guards: without the target-grant subset
    // check a bare password change (no capabilities payload) would hand
    // the manager an account holding capabilities they lack.
    const rows: MutableUser[] = [{ ...privilegedUser, capabilities: [...privilegedUser.capabilities] }]
    const outcome = run(
      UsersUpdateCapability.run(
        { id: "usr-privileged", password: "hijacked-password" },
        makeContext(manager, makeUsersRepo(rows)),
      ),
    )
    expect(Either.isLeft(outcome)).toBe(true)
    if (Either.isLeft(outcome)) {
      expect((outcome.left as { _tag: string })._tag).toBe("ForbiddenError")
    }
    expect(rows[0]!.hasPassword).toBe(true)
    expect(rows[0]!.username).toBe("privileged")
  })

  it("lets a limited manager update a subordinate (grant they fully hold)", () => {
    const rows: MutableUser[] = [
      { ...subordinateUser, capabilities: [...subordinateUser.capabilities] },
    ]
    const outcome = run(
      UsersUpdateCapability.run(
        { id: "usr-subordinate", password: "new-password", capabilities: ["bot.status"] },
        makeContext(manager, makeUsersRepo(rows)),
      ),
    )
    expect(Either.isRight(outcome)).toBe(true)
    expect(rows[0]!.capabilities).toEqual(["bot.status"])
  })

  it("root can password-reset anyone (subset rules do not apply)", () => {
    const rows: MutableUser[] = [
      { ...privilegedUser, capabilities: [...privilegedUser.capabilities] },
    ]
    const outcome = run(
      UsersUpdateCapability.run(
        { id: "usr-privileged", password: "admin-reset" },
        makeContext(root, makeUsersRepo(rows)),
      ),
    )
    expect(Either.isRight(outcome)).toBe(true)
  })
})

describe("users.remove guards", () => {
  it("protects root and anonymous", () => {
    for (const id of ["root", "anonymous"]) {
      const outcome = run(
        UsersRemoveCapability.run(
          { id },
          makeContext(root, makeUsersRepo([{ ...anonymousRow }])),
        ),
      )
      expect(Either.isLeft(outcome)).toBe(true)
    }
  })

  it("deletes a stored user", () => {
    const rows: MutableUser[] = [
      {
        id: "usr-temp",
        username: "temp",
        role: "user",
        capabilities: [],
        hasPassword: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]
    const outcome = run(UsersRemoveCapability.run({ id: "usr-temp" }, makeContext(root, makeUsersRepo(rows))))
    expect(Either.isRight(outcome)).toBe(true)
    expect(rows).toHaveLength(0)
  })

  it("blocks a limited manager from deleting a MORE privileged user", () => {
    const rows: MutableUser[] = [
      { ...privilegedUser, capabilities: [...privilegedUser.capabilities] },
    ]
    const outcome = run(
      UsersRemoveCapability.run({ id: "usr-privileged" }, makeContext(manager, makeUsersRepo(rows))),
    )
    expect(Either.isLeft(outcome)).toBe(true)
    if (Either.isLeft(outcome)) {
      expect((outcome.left as { _tag: string })._tag).toBe("ForbiddenError")
    }
    expect(rows).toHaveLength(1)
  })

  it("lets a limited manager delete a subordinate (grant they fully hold)", () => {
    const rows: MutableUser[] = [
      { ...subordinateUser, capabilities: [...subordinateUser.capabilities] },
    ]
    const outcome = run(
      UsersRemoveCapability.run({ id: "usr-subordinate" }, makeContext(manager, makeUsersRepo(rows))),
    )
    expect(Either.isRight(outcome)).toBe(true)
    expect(rows).toHaveLength(0)
  })
})

describe("users.list composition", () => {
  it("lists root (virtual, all capabilities), anonymous and stored users", () => {
    const outcome = run(
      UsersListCapability.run({}, makeContext(manager, makeUsersRepo([{ ...anonymousRow }]))),
    )
    expect(Either.isRight(outcome)).toBe(true)
    if (!Either.isRight(outcome)) return
    const users = (outcome.right as { users: ManagedUser[] }).users
    expect(users.map((u) => u.role)).toEqual(["root", "anonymous"])
    const rootUser = users[0]!
    expect(rootUser.id).toBe("root")
    expect(rootUser.username).toBe(ROOT_USERNAME)
    expect(rootUser.capabilities.length).toBeGreaterThan(users[1]!.capabilities.length)
  })
})

describe("auth.capabilities reflection", () => {
  it("reports the anonymous grant unauthenticated", () => {
    const outcome = run(
      AuthCapabilitiesCapability.run(
        {},
        makeContext({ kind: "anonymous", granted: ["bot.profit.relative"] }, makeUsersRepo()),
      ),
    )
    expect(Either.isRight(outcome)).toBe(true)
    if (!Either.isRight(outcome)) return
    const value = outcome.right as {
      capabilities: string[]
      authenticated: boolean
      role?: string
    }
    expect(value.capabilities).toEqual(["bot.profit.relative"])
    expect(value.authenticated).toBe(false)
    expect(value.role).toBe("anonymous")
  })

  it("reports the signed-in user's grant", () => {
    const outcome = run(
      AuthCapabilitiesCapability.run({}, makeContext(manager, makeUsersRepo())),
    )
    expect(Either.isRight(outcome)).toBe(true)
    if (!Either.isRight(outcome)) return
    const value = outcome.right as {
      authenticated: boolean
      username?: string
      role?: string
    }
    expect(value.authenticated).toBe(true)
    expect(value.username).toBe("manager")
    expect(value.role).toBe("user")
  })
})
