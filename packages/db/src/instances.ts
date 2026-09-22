// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { SqlClient, SqlError } from "@effect/sql"
import { Context, Effect, Layer, Schema } from "effect"
import type { ParseError } from "effect/ParseResult"
import { randomUUID } from "node:crypto"
import { FreqtradeInstance } from "@nfi/api-contract"

/**
 * Durable freqtrade instance storage (multi-bot support).
 *
 * ```text
 * freqtrade_instances
 * -------------------
 * id          TEXT PRIMARY KEY
 * name        TEXT NOT NULL UNIQUE
 * base_url    TEXT NOT NULL
 * username    TEXT NOT NULL
 * password    TEXT NOT NULL  -- stored server-side only, never sent to browsers
 * created_at  TEXT NOT NULL
 * updated_at  TEXT NOT NULL
 * ```
 *
 * Passwords never leave this process: the repo returns full rows internally,
 * but the HTTP boundary maps to `FreqtradeInstance` (with `hasPassword`)
 * before responding.
 */

export const migrateInstances: Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient> = Effect.gen(
  function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      CREATE TABLE IF NOT EXISTS freqtrade_instances (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        base_url TEXT NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `
    yield* sql`CREATE INDEX IF NOT EXISTS idx_freqtrade_instances_name ON freqtrade_instances (name)`
  },
).pipe(Effect.asVoid)

const InstanceRow = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  baseUrl: Schema.String,
  username: Schema.String,
  password: Schema.String,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
type InstanceRow = typeof InstanceRow.Type

export interface StoredInstance extends InstanceRow {}

const toPublic = (row: InstanceRow): FreqtradeInstance => ({
  id: row.id,
  name: row.name,
  baseUrl: row.baseUrl,
  username: row.username,
  hasPassword: row.password.length > 0,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export interface InstanceRepoService {
  readonly listInstances: () => Effect.Effect<ReadonlyArray<FreqtradeInstance>, SqlError.SqlError | ParseError>
  readonly getInstance: (id: string) => Effect.Effect<StoredInstance | null, SqlError.SqlError | ParseError>
  readonly createInstance: (input: {
    readonly name: string
    readonly baseUrl: string
    readonly username: string
    readonly password: string
  }) => Effect.Effect<FreqtradeInstance, SqlError.SqlError | ParseError>
  readonly updateInstance: (
    id: string,
    input: { readonly name?: string; readonly baseUrl?: string; readonly username?: string; readonly password?: string },
  ) => Effect.Effect<FreqtradeInstance | null, SqlError.SqlError | ParseError>
  readonly deleteInstance: (id: string) => Effect.Effect<boolean, SqlError.SqlError>
}

export class InstanceRepo extends Context.Tag("nfi/InstanceRepo")<InstanceRepo, InstanceRepoService>() {}

export const InstanceRepoLive: Layer.Layer<InstanceRepo, never, SqlClient.SqlClient> = Layer.effect(
  InstanceRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    const decodeRows = Schema.decodeUnknown(Schema.Array(InstanceRow))

    return {
      listInstances: () =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT id, name, base_url AS baseUrl, username, password, created_at AS createdAt, updated_at AS updatedAt
            FROM freqtrade_instances
            ORDER BY name ASC
          `
          const decoded = yield* decodeRows(rows)
          return decoded.map(toPublic)
        }),

      getInstance: (id) =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT id, name, base_url AS baseUrl, username, password, created_at AS createdAt, updated_at AS updatedAt
            FROM freqtrade_instances
            WHERE id = ${id}
            LIMIT 1
          `
          const decoded = yield* decodeRows(rows)
          return decoded[0] ?? null
        }),

      createInstance: (input) =>
        Effect.gen(function* () {
          const now = new Date().toISOString()
          const id = `ft-${randomUUID()}`
          const baseUrl = input.baseUrl.trim().replace(/\/$/, "")
          yield* sql`
            INSERT INTO freqtrade_instances (id, name, base_url, username, password, created_at, updated_at)
            VALUES (${id}, ${input.name.trim()}, ${baseUrl}, ${input.username}, ${input.password}, ${now}, ${now})
          `
          return toPublic({
            id,
            name: input.name.trim(),
            baseUrl,
            username: input.username,
            password: input.password,
            createdAt: now,
            updatedAt: now,
          })
        }),

      updateInstance: (id, input) =>
        Effect.gen(function* () {
          const existing = yield* sql`
            SELECT id, name, base_url AS baseUrl, username, password, created_at AS createdAt, updated_at AS updatedAt
            FROM freqtrade_instances
            WHERE id = ${id}
            LIMIT 1
          `
          const decoded = yield* decodeRows(existing)
          const current = decoded[0]
          if (!current) return null
          const next = {
            ...current,
            name: input.name !== undefined ? input.name.trim() : current.name,
            baseUrl:
              input.baseUrl !== undefined ? input.baseUrl.trim().replace(/\/$/, "") : current.baseUrl,
            username: input.username !== undefined ? input.username : current.username,
            // Empty/omitted password keeps the stored secret.
            password:
              input.password !== undefined && input.password.length > 0 ? input.password : current.password,
            updatedAt: new Date().toISOString(),
          }
          yield* sql`
            UPDATE freqtrade_instances
            SET name = ${next.name}, base_url = ${next.baseUrl}, username = ${next.username},
                password = ${next.password}, updated_at = ${next.updatedAt}
            WHERE id = ${id}
          `
          return toPublic(next)
        }),

      deleteInstance: (id) =>
        Effect.gen(function* () {
          yield* sql`DELETE FROM freqtrade_instances WHERE id = ${id}`
          return true
        }),
    } satisfies InstanceRepoService
  }),
)
