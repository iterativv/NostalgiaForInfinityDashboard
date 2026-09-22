// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { SqlClient, SqlError } from "@effect/sql"
import { Context, Effect, Layer, Schema } from "effect"
import type { ParseError } from "effect/ParseResult"
import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import {
  ALL_CAPABILITIES,
  ANONYMOUS_USER_ID,
  Capability,
  NON_SENSITIVE_CAPABILITIES,
  ROOT_USER_ID,
} from "@nfi/api-contract"

/**
 * Durable user + anonymous-grant storage (auth plane).
 *
 * ```text
 * users
 * -------------------
 * id             TEXT PRIMARY KEY    -- 'usr-<uuid>' | fixed 'anonymous' | fixed 'root'
 * username       TEXT NOT NULL UNIQUE
 * password_hash  TEXT NOT NULL       -- 'scrypt:<salt>:<hash>'; '' = cannot log in
 * role           TEXT NOT NULL       -- 'root' | 'user' | 'anonymous'
 * capabilities   TEXT NOT NULL       -- JSON array of capability ids
 * created_at     TEXT NOT NULL
 * updated_at     TEXT NOT NULL
 * ```
 *
 * The root user is usually NOT a row: it is configured from env (see
 * `apps/server/src/auth/`) and resolved virtually. When the operator skips
 * env configuration, `Auth.setupRoot` provisions a stored root row (fixed
 * id, role 'root', always holding every capability — grants are resolved,
 * never read from the row) that is otherwise treated identically. The
 * `anonymous` row is real but can never log in (empty hash) — it only
 * stores the public grant edited on the Manage users page; migration seeds
 * it with `NON_SENSITIVE_CAPABILITIES` (non-sensitive only: no absolute
 * amounts, no infrastructure or user data).
 *
 * Password hashing (scrypt) lives HERE on purpose: this package is
 * server-only (never bundled to browsers, unlike `@nfi/capabilities` which
 * the web shell imports), so `node:crypto` never reaches a browser bundle.
 */

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>

const SCRYPT_KEYLEN = 64

/** Hash a password: `scrypt:<salt-b64url>:<hash-b64url>` (random 16-byte salt). */
export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, SCRYPT_KEYLEN)
  return `scrypt:${salt.toString("base64url")}:${hash.toString("base64url")}`
}

/** Timing-safe password check against a stored `scrypt:` hash. */
export const verifyPassword = async (
  storedHash: string,
  password: string,
): Promise<boolean> => {
  const parts = storedHash.split(":")
  if (parts.length !== 3 || parts[0] !== "scrypt") return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[1]!, "base64url")
    expected = Buffer.from(parts[2]!, "base64url")
  } catch {
    return false
  }
  // Guard the degenerate case: invalid base64url decodes to an EMPTY buffer,
  // and two empty buffers are timing-safe-equal — anything would "verify".
  if (expected.length === 0 || salt.length === 0) return false
  const actual = await scrypt(password, salt, expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export const migrateUsers: Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient> =
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        capabilities TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `
    yield* sql`CREATE INDEX IF NOT EXISTS idx_users_role ON users (role)`
    // Seed the anonymous grant once with the safe relative-only set. Existing
    // installations keep whatever root has configured.
    yield* sql`
      INSERT OR IGNORE INTO users (id, username, password_hash, role, capabilities, created_at, updated_at)
      VALUES (
        ${ANONYMOUS_USER_ID},
        ${ANONYMOUS_USER_ID},
        '',
        'anonymous',
        ${JSON.stringify(NON_SENSITIVE_CAPABILITIES)},
        ${new Date().toISOString()},
        ${new Date().toISOString()}
      )
    `
  }).pipe(Effect.asVoid)

/** Internal row shape — carries the hash; NEVER serialized over the wire. */
export interface StoredUser {
  readonly id: string
  readonly username: string
  readonly role: "root" | "user" | "anonymous"
  readonly capabilities: ReadonlyArray<Capability>
  readonly hasPassword: boolean
  readonly createdAt: string
  readonly updatedAt: string
}

const StoredUserSchema = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  role: Schema.Literal("root", "user", "anonymous"),
  capabilities: Schema.Array(Capability),
  hasPassword: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})

/** Internal row carrying the password hash (login path only). */
export interface StoredUserWithHash extends StoredUser {
  readonly passwordHash: string
}

const decodeRow = (row: unknown): StoredUser => {
  const raw = row as Record<string, unknown>
  // SQLite has no booleans (SELECT emits 0/1) and no arrays (capabilities is
  // a JSON string). Unknown ids (e.g. removed in a newer contract) are
  // dropped instead of failing the whole row.
  let capabilities: unknown = raw["capabilities"]
  if (typeof capabilities === "string") {
    try {
      capabilities = JSON.parse(capabilities)
    } catch {
      capabilities = []
    }
  }
  if (Array.isArray(capabilities)) {
    const known = new Set<string>(ALL_CAPABILITIES)
    capabilities = capabilities.filter((id): id is Capability => typeof id === "string" && known.has(id))
  }
  return Schema.decodeUnknownSync(StoredUserSchema)({
    ...raw,
    capabilities,
    hasPassword: Number(raw["hasPassword"]) !== 0,
  })
}

export interface UserRepoService {
  readonly listUsers: () => Effect.Effect<ReadonlyArray<StoredUser>, SqlError.SqlError | ParseError>
  readonly getUser: (id: string) => Effect.Effect<StoredUser | null, SqlError.SqlError | ParseError>
  /** Login lookup — returns the internal row including the password hash. */
  readonly getUserByUsername: (
    username: string,
  ) => Effect.Effect<StoredUserWithHash | null, SqlError.SqlError | ParseError>
  readonly createUser: (input: {
    readonly username: string
    readonly password: string
    readonly capabilities: ReadonlyArray<Capability>
  }) => Effect.Effect<StoredUser, SqlError.SqlError | ParseError>
  /**
   * Provision the fixed root row (`Auth.setupRoot` path). Fails with the raw
   * sqlite error on the id/username UNIQUE constraints — callers race-check
   * first and map the failure to a friendly conflict.
   */
  readonly createRootUser: (input: {
    readonly username: string
    readonly password: string
  }) => Effect.Effect<StoredUser, SqlError.SqlError | ParseError>
  readonly updateUser: (
    id: string,
    input: {
      /** Plain password; hashed here. Undefined = keep the stored hash. */
      readonly password?: string
      readonly capabilities?: ReadonlyArray<Capability>
    },
  ) => Effect.Effect<StoredUser | null, SqlError.SqlError | ParseError>
  readonly deleteUser: (id: string) => Effect.Effect<boolean, SqlError.SqlError>
}

export class UserRepo extends Context.Tag("nfi/UserRepo")<UserRepo, UserRepoService>() {}

export const UserRepoLive: Layer.Layer<UserRepo, never, SqlClient.SqlClient> = Layer.effect(
  UserRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const decodeRows = (rows: ReadonlyArray<unknown>): StoredUser[] =>
      rows.map((row) => decodeRow(row))

    return {
      listUsers: () =>
        Effect.gen(function* () {
          const rows = yield* sql`SELECT id, username, role, capabilities, CASE WHEN password_hash = '' THEN 0 ELSE 1 END AS hasPassword, created_at AS createdAt, updated_at AS updatedAt FROM users ORDER BY username ASC`
          return decodeRows(rows as ReadonlyArray<unknown>)
        }),

      getUser: (id) =>
        Effect.gen(function* () {
          const rows = yield* sql`SELECT id, username, role, capabilities, CASE WHEN password_hash = '' THEN 0 ELSE 1 END AS hasPassword, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE id = ${id} LIMIT 1`
          return decodeRows(rows as ReadonlyArray<unknown>)[0] ?? null
        }),

      getUserByUsername: (username) =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT id, username, role, capabilities, CASE WHEN password_hash = '' THEN 0 ELSE 1 END AS hasPassword, created_at AS createdAt, updated_at AS updatedAt, password_hash AS passwordHash
            FROM users WHERE username = ${username} LIMIT 1
          `
          const rows_ = rows as ReadonlyArray<unknown>
          if (rows_.length === 0) return null
          const raw = rows_[0] as Record<string, unknown>
          return { ...decodeRow(raw), passwordHash: String(raw["passwordHash"] ?? "") }
        }),

      createUser: (input) =>
        Effect.gen(function* () {
          const now = new Date().toISOString()
          const id = `usr-${randomUUID()}`
          const passwordHash = yield* Effect.promise(() => hashPassword(input.password))
          yield* sql`
            INSERT INTO users (id, username, password_hash, role, capabilities, created_at, updated_at)
            VALUES (${id}, ${input.username}, ${passwordHash}, 'user', ${JSON.stringify(input.capabilities)}, ${now}, ${now})
          `
          return {
            id,
            username: input.username,
            role: "user",
            capabilities: input.capabilities,
            hasPassword: true,
            createdAt: now,
            updatedAt: now,
          } satisfies StoredUser
        }),

        createRootUser: (input) =>
          Effect.gen(function* () {
            const now = new Date().toISOString()
            const passwordHash = yield* Effect.promise(() => hashPassword(input.password))
            // Grants are not stored for root: the role always resolves to
            // every capability (see session + users.list).
            yield* sql`
              INSERT INTO users (id, username, password_hash, role, capabilities, created_at, updated_at)
              VALUES (${ROOT_USER_ID}, ${input.username}, ${passwordHash}, 'root', ${JSON.stringify([])}, ${now}, ${now})
            `
            return {
              id: ROOT_USER_ID,
              username: input.username,
              role: "root",
              capabilities: ALL_CAPABILITIES,
              hasPassword: true,
              createdAt: now,
              updatedAt: now,
            } satisfies StoredUser
          }),

      updateUser: (id, input) =>
        Effect.gen(function* () {
          const rows = yield* sql`SELECT id, username, role, capabilities, CASE WHEN password_hash = '' THEN 0 ELSE 1 END AS hasPassword, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE id = ${id} LIMIT 1`
          const current = decodeRows(rows as ReadonlyArray<unknown>)[0]
          if (!current) return null
          const now = new Date().toISOString()
          const capabilities =
            input.capabilities !== undefined ? input.capabilities : current.capabilities
          const newPassword =
            input.password !== undefined && input.password.length > 0 ? input.password : null
          const passwordHash =
            newPassword !== null ? yield* Effect.promise(() => hashPassword(newPassword)) : null
          yield* sql`
            UPDATE users
            SET
              capabilities = ${JSON.stringify(capabilities)},
              updated_at = ${now}
              ${passwordHash !== null ? sql`, password_hash = ${passwordHash}` : sql``}
            WHERE id = ${id}
          `
          return {
            ...current,
            capabilities,
            hasPassword: passwordHash !== null ? true : current.hasPassword,
            updatedAt: now,
          } satisfies StoredUser
        }),

      deleteUser: (id) =>
        Effect.gen(function* () {
          yield* sql`DELETE FROM users WHERE id = ${id}`
          return true
        }),
    } satisfies UserRepoService
  }),
)
