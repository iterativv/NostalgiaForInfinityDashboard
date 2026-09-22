// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { SqliteClient as NodeSqliteClient } from "@effect/sql-sqlite-node"
import { SqlClient, SqlError } from "@effect/sql"
import { Config, ConfigError, Context, Effect, Layer, Schema } from "effect"
import type { ParseError } from "effect/ParseResult"
import { mkdir } from "node:fs/promises"
import { dirname } from "node:path"
import {
  BalanceHistoryResponse,
  ProfitHistoryResponse,
  type BalanceResponse,
  type ProfitSummary,
} from "@nfi/api-contract"

export { migrateWorkspaces, WorkspaceRepo, WorkspaceRepoLive, type WorkspaceRepoService } from "./workspaces.js"
export { migrateInstances, InstanceRepo, InstanceRepoLive, type InstanceRepoService, type StoredInstance } from "./instances.js"
export {
  migrateSettings,
  SettingsRepo,
  SettingsRepoLive,
  type SettingsRepoService,
} from "./settings.js"
export {
  migrateUsers,
  UserRepo,
  UserRepoLive,
  hashPassword,
  verifyPassword,
  type StoredUser,
  type StoredUserWithHash,
  type UserRepoService,
} from "./users.js"
import { migrateWorkspaces } from "./workspaces.js"
import { migrateInstances } from "./instances.js"
import { migrateSettings } from "./settings.js"
import { migrateUsers } from "./users.js"

/**
 * @nfi/db
 *
 * SQLite persistence for nfi-desk, built on Effect (`@effect/sql`).
 * The backend records profit/balance snapshots on an interval so the
 * terminal can chart history even when freqtrade is unreachable.
 *
 * Runtime-agnostic by design: Node today via `@effect/sql-sqlite-node`,
 * Bun tomorrow via `@effect/sql-sqlite-bun` — same `@effect/sql` API,
 * only the `SqliteLive` layer changes.
 */

// ---------------------------------------------------------------------------
// Config + client layer
// ---------------------------------------------------------------------------

export interface DbConfig {
  readonly filename: string
}

export class DbConfigTag extends Context.Tag("nfi/DbConfig")<DbConfigTag, DbConfig>() {}

export const DbConfigLive: Layer.Layer<DbConfigTag, ConfigError.ConfigError> = Layer.effect(
  DbConfigTag,
  // Runtime data lives in the gitignored `<repo-root>/.data/` folder, never
  // in the source tree. The server runs with CWD `apps/server`, so the
  // default resolves there; `SQLITE_PATH` (absolute or CWD-relative) always
  // wins when set.
  Effect.map(Config.string("SQLITE_PATH").pipe(Config.withDefault("../../.data/nfi-desk.db")), (filename): DbConfig => ({
    filename,
  })),
)

export const SqliteLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const { filename } = yield* DbConfigTag
    // better-sqlite3 creates the file but not parent directories.
    yield* Effect.promise(() => mkdir(dirname(filename), { recursive: true }))
    // One layer per runtime: better-sqlite3 under Node, bun:sqlite under Bun
    // (the compiled single-binary release). Both clients implement the same
    // `@effect/sql` interface, so nothing above this layer changes. The Bun
    // module must be imported lazily — Node cannot even resolve `bun:sqlite`
    // — while importing @effect/sql-sqlite-node under Bun is harmless because
    // better-sqlite3 only dlopens when a Database is constructed.
    const SqliteClient = (globalThis as { Bun?: unknown }).Bun !== undefined
      ? yield* Effect.promise(() => import("@effect/sql-sqlite-bun").then((m) => m.SqliteClient))
      : NodeSqliteClient
    return SqliteClient.layer({ filename })
  }),
)

// ---------------------------------------------------------------------------
// Migration (idempotent — safe to run on every boot and poller tick)
// ---------------------------------------------------------------------------

export const migrate: Effect.Effect<void, SqlError.SqlError, SqlClient.SqlClient> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE IF NOT EXISTS profit_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at TEXT NOT NULL,
      profit_closed_coin REAL NOT NULL,
      profit_closed_percent REAL NOT NULL,
      profit_closed_fiat REAL NOT NULL,
      profit_all_coin REAL NOT NULL,
      profit_all_percent REAL NOT NULL,
      profit_all_fiat REAL NOT NULL,
      trade_count INTEGER NOT NULL,
      closed_trade_count INTEGER NOT NULL,
      stake_currency TEXT NOT NULL,
      fiat_currency TEXT NOT NULL,
      instance_id TEXT NOT NULL DEFAULT 'default'
    )
  `
  yield* sql`
    CREATE TABLE IF NOT EXISTS balance_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at TEXT NOT NULL,
      stake_currency TEXT NOT NULL,
      total_stake REAL NOT NULL,
      instance_id TEXT NOT NULL DEFAULT 'default'
    )
  `
  // Pre-existing databases predate per-instance snapshots; the default
  // instance owns every row recorded before the column existed.
  yield* sql`ALTER TABLE profit_snapshots ADD COLUMN instance_id TEXT NOT NULL DEFAULT 'default'`.pipe(
    Effect.catchIf(isDuplicateColumn, () => Effect.void),
  )
  yield* sql`ALTER TABLE balance_snapshots ADD COLUMN instance_id TEXT NOT NULL DEFAULT 'default'`.pipe(
    Effect.catchIf(isDuplicateColumn, () => Effect.void),
  )
  yield* sql`CREATE INDEX IF NOT EXISTS idx_profit_recorded_at ON profit_snapshots (recorded_at)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_balance_recorded_at ON balance_snapshots (recorded_at)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_profit_instance_recorded ON profit_snapshots (instance_id, recorded_at)`
  yield* sql`CREATE INDEX IF NOT EXISTS idx_balance_instance_recorded ON balance_snapshots (instance_id, recorded_at)`
  yield* migrateWorkspaces
  // Page metadata (icon, provenance) — pre-existing workspace tables predate
  // these columns; NULL means "no icon" / "not user-added" exactly like an
  // absent optional schema field.
  yield* sql`ALTER TABLE workspaces ADD COLUMN icon TEXT`.pipe(
    Effect.catchIf(isDuplicateColumn, () => Effect.void),
  )
  yield* sql`ALTER TABLE workspaces ADD COLUMN origin TEXT`.pipe(
    Effect.catchIf(isDuplicateColumn, () => Effect.void),
  )
  // Panel renames (user tab titles) — NULL = the widget's registry title.
  yield* sql`ALTER TABLE workspace_panels ADD COLUMN title TEXT`.pipe(
    Effect.catchIf(isDuplicateColumn, () => Effect.void),
  )
  yield* migrateInstances
  yield* migrateSettings
  yield* migrateUsers
}).pipe(Effect.asVoid)

/** SQLite has no `ADD COLUMN IF NOT EXISTS` — tolerate a rerun. */
const isDuplicateColumn = (cause: unknown): boolean => {
  let node: unknown = cause
  while (typeof node === "object" && node !== null) {
    const record = node as Record<string, unknown>
    if (typeof record["message"] === "string" && /duplicate column/i.test(record["message"])) return true
    node = record["cause"]
  }
  return false
}

// ---------------------------------------------------------------------------
// Snapshot repository
// ---------------------------------------------------------------------------

export interface SnapshotRepoService {
  readonly recordProfit: (instanceId: string, profit: ProfitSummary) => Effect.Effect<void, SqlError.SqlError>
  readonly recordBalance: (instanceId: string, balance: BalanceResponse) => Effect.Effect<void, SqlError.SqlError>
  readonly profitHistory: (instanceId: string, limit: number) => Effect.Effect<ProfitHistoryResponse, SqlError.SqlError | ParseError>
  readonly balanceHistory: (instanceId: string, limit: number) => Effect.Effect<BalanceHistoryResponse, SqlError.SqlError | ParseError>
}

export class SnapshotRepo extends Context.Tag("nfi/SnapshotRepo")<SnapshotRepo, SnapshotRepoService>() {}

export const SnapshotRepoLive: Layer.Layer<SnapshotRepo, never, SqlClient.SqlClient> = Layer.effect(
  SnapshotRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return {
      recordProfit: (instanceId, profit) =>
        Effect.gen(function* () {
          const now = new Date().toISOString()
          yield* sql`
            INSERT INTO profit_snapshots (
              recorded_at, profit_closed_coin, profit_closed_percent, profit_closed_fiat,
              profit_all_coin, profit_all_percent, profit_all_fiat,
              trade_count, closed_trade_count, stake_currency, fiat_currency, instance_id
            ) VALUES (
              ${now}, ${profit.profitClosedCoin}, ${profit.profitClosedPercent}, ${profit.profitClosedFiat},
              ${profit.profitAllCoin}, ${profit.profitAllPercent}, ${profit.profitAllFiat},
              ${profit.tradeCount}, ${profit.closedTradeCount}, ${profit.stakeCurrency}, ${profit.fiatCurrency},
              ${instanceId}
            )
          `
        }).pipe(Effect.asVoid),

      recordBalance: (instanceId, balance) =>
        Effect.gen(function* () {
          const now = new Date().toISOString()
          yield* sql`
            INSERT INTO balance_snapshots (recorded_at, stake_currency, total_stake, instance_id)
            VALUES (${now}, ${balance.stakeCurrency}, ${balance.totalStake}, ${instanceId})
          `
        }).pipe(Effect.asVoid),

      profitHistory: (instanceId, limit) =>
        Effect.gen(function* () {
          // ISO-8601 timestamps sort chronologically as strings.
          const rows = yield* sql`
            SELECT
              recorded_at AS recordedAt,
              profit_closed_coin AS profitClosedCoin,
              profit_all_coin AS profitAllCoin,
              trade_count AS tradeCount,
              stake_currency AS stakeCurrency
            FROM profit_snapshots
            WHERE instance_id = ${instanceId}
            ORDER BY recorded_at DESC
            LIMIT ${limit}
          `
          const ascending = [...(rows as ReadonlyArray<unknown>)].reverse()
          return yield* Schema.decodeUnknown(ProfitHistoryResponse)({
            points: ascending,
          })
        }),

      balanceHistory: (instanceId, limit) =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT
              recorded_at AS recordedAt,
              total_stake AS totalStake,
              stake_currency AS stakeCurrency
            FROM balance_snapshots
            WHERE instance_id = ${instanceId}
            ORDER BY recorded_at DESC
            LIMIT ${limit}
          `
          const ascending = [...(rows as ReadonlyArray<unknown>)].reverse()
          return yield* Schema.decodeUnknown(BalanceHistoryResponse)({
            points: ascending,
          })
        }),
    } satisfies SnapshotRepoService
  }),
)
