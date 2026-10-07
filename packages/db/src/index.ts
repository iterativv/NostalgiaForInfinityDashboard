// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { SqliteClient as NodeSqliteClient } from "@effect/sql-sqlite-node";
import { SqlClient, SqlError } from "@effect/sql";
import {
  Config,
  ConfigError,
  Context,
  Effect,
  Either,
  Layer,
  Schema,
} from "effect";
import type { ParseError } from "effect/ParseResult";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  BalanceHistoryResponse,
  ProfitHistoryResponse,
  type BalanceHistoryBucket,
  type BalanceResponse,
  type ProfitSummary,
} from "@nfi/api-contract";

export {
  migrateWorkspaces,
  WorkspaceRepo,
  WorkspaceRepoLive,
  type WorkspaceRepoService,
} from "./workspaces.js";

export {
  migrateInstances,
  InstanceRepo,
  InstanceRepoLive,
  type InstanceRepoService,
  type StoredInstance,
} from "./instances.js";

export {
  migrateSettings,
  SettingsRepo,
  SettingsRepoLive,
  type SettingsRepoService,
} from "./settings.js";

export {
  migrateUsers,
  UserRepo,
  UserRepoLive,
  hashPassword,
  verifyPassword,
  type StoredUser,
  type StoredUserWithHash,
  type UserRepoService,
} from "./users.js";

export {
  migrateSessions,
  SessionRepo,
  SessionRepoLive,
  type SessionRepoService,
  type StoredSession,
} from "./sessions.js";

export {
  migrateTrades,
  TradesRepo,
  TradesRepoLive,
  type AggregateArgs,
  type AggregateExtreme,
  type AggregateGroupBy,
  type AggregateResult,
  type AggregateRow,
  type AggregateTotals,
  type ClosedListResult,
  type ClosedPercentStats,
  type ClosedPercentStatsArgs,
  type CumulativeProfitArgs,
  type CumulativeProfitResult,
  type CumulativeProfitRow,
  type CumulativeProfitTotal,
  type ListClosedArgs,
  type ListOpenArgs,
  type LocksArgs,
  type MirrorClosedPosition,
  type MirrorOpenPosition,
  type OpenListResult,
  type OpenSummary,
  type OpenSummaryArgs,
  type OpenSummaryPairRow,
  type OpenSummaryResult,
  type PairListArgs,
  type PairWatchArgs,
  type PairWatchResultRow,
  type PerformanceStats,
  type PerformanceStatsArgs,
  type TapeArgs,
  type TradesRepoService,
  type TradeSyncState,
  type TradedPairRow,
  type TradedPairsArgs,
} from "./trades.js";

import { migrateWorkspaces } from "./workspaces.js";
import { migrateInstances } from "./instances.js";
import { migrateSettings } from "./settings.js";
import { migrateUsers } from "./users.js";
import { migrateSessions } from "./sessions.js";
import { migrateTrades } from "./trades.js";

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
  readonly filename: string;
}

export class DbConfigTag extends Context.Tag("nfi/DbConfig")<
  DbConfigTag,
  DbConfig
>() {}

export const DbConfigLive: Layer.Layer<DbConfigTag, ConfigError.ConfigError> =
  Layer.effect(
    DbConfigTag,
    // Runtime data lives in the gitignored `<repo-root>/.data/` folder, never
    // in the source tree. The server runs with CWD `apps/server`, so the
    // default resolves there; `SQLITE_PATH` (absolute or CWD-relative) always
    // wins when set.
    Effect.map(
      Config.string("SQLITE_PATH").pipe(
        Config.withDefault("../../.data/nfi-desk.db"),
      ),
      (filename): DbConfig => ({
        filename,
      }),
    ),
  );

export const SqliteLive = Layer.unwrapEffect(
  Effect.gen(function* () {
    const { filename } = yield* DbConfigTag;
    // better-sqlite3 creates the file but not parent directories.
    yield* Effect.promise(() => mkdir(dirname(filename), { recursive: true }));

    // One layer per runtime: better-sqlite3 under Node, bun:sqlite under Bun
    // (the compiled single-binary release). Both clients implement the same
    // `@effect/sql` interface, so nothing above this layer changes. The Bun
    // module must be imported lazily — Node cannot even resolve `bun:sqlite`
    // — while importing @effect/sql-sqlite-node under Bun is harmless because
    // better-sqlite3 only dlopens when a Database is constructed.
    const SqliteClient =
      "Bun" in globalThis
        ? yield* Effect.promise(() =>
            import("@effect/sql-sqlite-bun").then((m) => m.SqliteClient),
          )
        : NodeSqliteClient;

    return SqliteClient.layer({ filename });
  }),
);

// ---------------------------------------------------------------------------
// Migration (idempotent — safe to run on every boot and poller tick)
// ---------------------------------------------------------------------------

export const migrate: Effect.Effect<
  void,
  SqlError.SqlError,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
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
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS balance_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recorded_at TEXT NOT NULL,
      stake_currency TEXT NOT NULL,
      total_stake REAL NOT NULL,
      instance_id TEXT NOT NULL DEFAULT 'default'
    )
  `;
  // Pre-existing databases predate per-instance snapshots; the default
  // instance owns every row recorded before the column existed.
  yield* sql`ALTER TABLE profit_snapshots ADD COLUMN instance_id TEXT NOT NULL DEFAULT 'default'`.pipe(
    Effect.catchIf(isDuplicateColumn, () => Effect.void),
  );
  yield* sql`ALTER TABLE balance_snapshots ADD COLUMN instance_id TEXT NOT NULL DEFAULT 'default'`.pipe(
    Effect.catchIf(isDuplicateColumn, () => Effect.void),
  );
  yield* sql`CREATE INDEX IF NOT EXISTS idx_profit_recorded_at ON profit_snapshots (recorded_at)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_balance_recorded_at ON balance_snapshots (recorded_at)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_profit_instance_recorded ON profit_snapshots (instance_id, recorded_at)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_balance_instance_recorded ON balance_snapshots (instance_id, recorded_at)`;
  yield* migrateWorkspaces;
  // Page metadata (icon, provenance) — pre-existing workspace tables predate
  // these columns; NULL means "no icon" / "not user-added" exactly like an
  // absent optional schema field.
  yield* sql`ALTER TABLE workspaces ADD COLUMN icon TEXT`.pipe(
    Effect.catchIf(isDuplicateColumn, () => Effect.void),
  );
  yield* sql`ALTER TABLE workspaces ADD COLUMN origin TEXT`.pipe(
    Effect.catchIf(isDuplicateColumn, () => Effect.void),
  );
  // Panel renames (user tab titles) — NULL = the widget's registry title.
  yield* sql`ALTER TABLE workspace_panels ADD COLUMN title TEXT`.pipe(
    Effect.catchIf(isDuplicateColumn, () => Effect.void),
  );
  // Shared Trellis layout document (opaque JSON from `getDocument()`). NULL =
  // no shared arrangement yet — renderers fall back to compiling the NFI
  // `layout` tree. Without this column every browser keeps its own Trellis
  // arrangement in localStorage, so "Save layout for anonymous" can never
  // make incognito identical.
  yield* sql`ALTER TABLE workspaces ADD COLUMN trellis_json TEXT`.pipe(
    Effect.catchIf(isDuplicateColumn, () => Effect.void),
  );
  // Masonry stack page mode (panes at natural height in one scrolling
  // column) — 0/1 with 0 = absent exactly like the optional schema field.
  yield* sql`ALTER TABLE workspaces ADD COLUMN stacked INTEGER NOT NULL DEFAULT 0`.pipe(
    Effect.catchIf(isDuplicateColumn, () => Effect.void),
  );
  // Manual Tetris wall block widths (panelId → column span JSON). NULL = no
  // manual widths — the wall falls back to the pane's tiled width fraction.
  yield* sql`ALTER TABLE workspaces ADD COLUMN tetris_spans_json TEXT`.pipe(
    Effect.catchIf(isDuplicateColumn, () => Effect.void),
  );
  yield* migrateInstances;
  yield* migrateSettings;
  yield* migrateUsers;
  yield* migrateSessions;
  yield* migrateTrades;
}).pipe(Effect.asVoid);

/** One link of a driver error's `cause` chain: an optional message plus the next link. */
const ErrorCauseLink = Schema.Struct({
  message: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Unknown),
});

/** SQLite has no `ADD COLUMN IF NOT EXISTS` — tolerate a rerun. */
const isDuplicateColumn = (cause: unknown): boolean => {
  const link = Schema.decodeUnknownEither(ErrorCauseLink)(cause);

  if (Either.isLeft(link)) return false;
  const { message, cause: next } = link.right;

  if (message !== undefined && /duplicate column/i.test(message)) return true;

  return next === undefined ? false : isDuplicateColumn(next);
};

// ---------------------------------------------------------------------------
// Snapshot repository
// ---------------------------------------------------------------------------

export interface SnapshotRepoService {
  readonly recordProfit: (
    instanceId: string,
    profit: ProfitSummary,
  ) => Effect.Effect<void, SqlError.SqlError>;
  readonly recordBalance: (
    instanceId: string,
    balance: BalanceResponse,
  ) => Effect.Effect<void, SqlError.SqlError>;
  readonly profitHistory: (
    instanceId: string,
    limit: number,
  ) => Effect.Effect<ProfitHistoryResponse, SqlError.SqlError | ParseError>;
  readonly balanceHistory: (
    instanceId: string,
    limit: number,
    /**
     * Time bucket for aggregated reads: one point per bucket carrying the
     * LAST sample inside it (a balance is a level, not a flow). Aggregates
     * SQL-side so a daily/weekly curve spans weeks of per-minute snapshots.
     */
    bucket?: BalanceHistoryBucket,
  ) => Effect.Effect<BalanceHistoryResponse, SqlError.SqlError | ParseError>;
  /**
   * Underwater curve + drawdown scalars computed in SQL over the FULL
   * snapshot history (running peak via a window function — never a
   * windowed JS scan, which would cap max drawdown at the fetched slice).
   */
  readonly drawdown: (
    args: DrawdownArgs,
  ) => Effect.Effect<DrawdownResult, SqlError.SqlError>;
}

/** Drawdown read: `instanceId: null` = fleet (per-minute sums, every instance). */
export interface DrawdownArgs {
  readonly instanceId: string | null;
  /** Newest N curve points returned (the scalars always cover all history). */
  readonly limit: number;
}

export interface DrawdownPoint {
  readonly recordedAt: string;
  /** Percent below the running peak (<= 0; 0 while the peak is not positive). */
  readonly drawdown: number;
}

export interface DrawdownResult {
  readonly points: ReadonlyArray<DrawdownPoint>;
  /** Deepest drawdown over the FULL history (percent, <= 0). */
  readonly maxDrawdown: number;
  /** Newest point's drawdown (percent, <= 0; 0 with no history). */
  readonly currentDrawdown: number;
  /** All-time equity peak (profit_all_coin high-water mark). */
  readonly peakValue: number;
}

export class SnapshotRepo extends Context.Tag("nfi/SnapshotRepo")<
  SnapshotRepo,
  SnapshotRepoService
>() {}

// SAFETY: @effect/sql returns untyped rows; the drawdown statements SELECT
// exactly the aliased columns of T (statement and type sit together at the
// call site), and NULL/non-finite values are re-coerced downstream.
const sqlRows = <T>(rows: ReadonlyArray<unknown>): T[] => rows as T[];

// SAFETY: first row of a statement whose SELECT list is exactly T's aliased
// columns; the scalar aggregate (no GROUP BY) always yields one row.
const firstRow = <T>(rows: ReadonlyArray<unknown>): T | undefined =>
  rows[0] as T | undefined;

export const SnapshotRepoLive: Layer.Layer<
  SnapshotRepo,
  never,
  SqlClient.SqlClient
> = Layer.effect(
  SnapshotRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    /**
     * Newest raw samples scanned per bucketed read (per-minute snapshots →
     * roughly three weeks of depth; enough for readable daily/weekly runs
     * without shipping the whole table through the GROUP BY).
     */
    const BUCKET_RAW_WINDOW = 30_000;

    // One static statement per bucket (no dynamic SQL fragments): GROUP BY
    // the bucket key, MAX(recorded_at) picks each bucket's last sample —
    // SQLite's documented bare-column behavior carries that row's
    // total_stake / stake_currency along.
    /**
     * GROUP BY expression per bucket — static, trusted SQL text (never
     * caller input). Weeks anchor on Monday (`%w`: 0=Sun → days-since-Mon).
     */
    const BUCKET_GROUP_BY: Record<BalanceHistoryBucket, string> = {
      "6h": "strftime('%Y-%m-%dT', recorded_at) || printf('%02d', (CAST(strftime('%H', recorded_at) AS INTEGER) / 6) * 6)",
      day: "strftime('%Y-%m-%dT00:00:00', recorded_at)",
      week: "date(recorded_at, '-' || ((CAST(strftime('%w', recorded_at) AS INTEGER) + 6) % 7) || ' days')",
    };

    const bucketedBalanceRows = (
      instanceId: string,
      limit: number,
      bucket: BalanceHistoryBucket,
    ) => {
      const groupBy = sql.literal(BUCKET_GROUP_BY[bucket]);

      return sql`
        SELECT
          MAX(recorded_at) AS recordedAt,
          total_stake AS totalStake,
          stake_currency AS stakeCurrency
        FROM (
          SELECT recorded_at, total_stake, stake_currency
          FROM balance_snapshots
          WHERE instance_id = ${instanceId}
          ORDER BY recorded_at DESC
          LIMIT ${BUCKET_RAW_WINDOW}
        )
        GROUP BY ${groupBy}
        ORDER BY recordedAt DESC
        LIMIT ${limit}
      `;
    };

    /**
     * Underwater curve over the FULL snapshot history, all in SQL:
     * `running` carries each row's running peak (window MAX), `dd` the
     * distance below it. The fleet variant merges instances per minute
     * first (ISO-8601 prefixes sort chronologically), mirroring the
     * fleet profit-history merge — but over every recorded row, not a
     * per-instance window.
     */
    const drawdownQueries = (instanceId: string | null, limit: number) => {
      // `id` (insertion order) breaks same-millisecond ties so the running
      // peak stays monotonic in recording order; the fleet merge has one
      // row per minute, so its tiebreaker is inert (NULL).
      const base =
        instanceId === null
          ? sql`
            SELECT NULL AS id,
                   substr(recorded_at, 1, 16) || ':00.000Z' AS recorded_at,
                   SUM(profit_all_coin) AS profit_all_coin
            FROM profit_snapshots
            GROUP BY substr(recorded_at, 1, 16)
          `
          : sql`
            SELECT id, recorded_at, profit_all_coin
            FROM profit_snapshots
            WHERE instance_id = ${instanceId}
          `;

      const windowed = sql`
        WITH running AS (
          SELECT id,
                 recorded_at AS recordedAt,
                 profit_all_coin AS equity,
                 MAX(profit_all_coin) OVER (
                   ORDER BY recorded_at, id ROWS UNBOUNDED PRECEDING
                 ) AS peak
          FROM (${base})
        ),
        dd AS (
          SELECT recordedAt, id, peak,
                 CASE WHEN peak > 0
                   THEN (equity - peak) / peak * 100.0
                   ELSE 0
                 END AS drawdown
          FROM running
        )
      `;

      return {
        scalars: sql`
          ${windowed}
          SELECT COALESCE(MIN(drawdown), 0) AS maxDrawdown,
                 COALESCE(MAX(peak), 0) AS peakValue
          FROM dd
        `,
        curve: sql`
          ${windowed}
          SELECT recordedAt, drawdown
          FROM dd
          ORDER BY recordedAt DESC, id DESC
          LIMIT ${limit}
        `,
      };
    };

    return {
      recordProfit: (instanceId, profit) =>
        Effect.gen(function* () {
          const now = new Date().toISOString();
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
          `;
        }).pipe(Effect.asVoid),

      recordBalance: (instanceId, balance) =>
        Effect.gen(function* () {
          const now = new Date().toISOString();
          yield* sql`
            INSERT INTO balance_snapshots (recorded_at, stake_currency, total_stake, instance_id)
            VALUES (${now}, ${balance.stakeCurrency}, ${balance.totalStake}, ${instanceId})
          `;
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
          `;

          const ascending = [...rows].reverse();

          return yield* Schema.decodeUnknown(ProfitHistoryResponse)({
            points: ascending,
          });
        }),

      balanceHistory: (instanceId, limit, bucket) =>
        Effect.gen(function* () {
          // Bucketed reads: newest raw samples, grouped per bucket with
          // SQLite's MAX() bare-column semantics (total_stake and
          // stake_currency come from the row carrying the bucket's latest
          // recorded_at — the last balance seen in the bucket). The raw
          // window stays bounded so decade-old tables still aggregate fast.
          const rows = bucket
            ? yield* bucketedBalanceRows(instanceId, limit, bucket)
            : yield* sql`
              SELECT
                recorded_at AS recordedAt,
                total_stake AS totalStake,
                stake_currency AS stakeCurrency
              FROM balance_snapshots
              WHERE instance_id = ${instanceId}
              ORDER BY recorded_at DESC
              LIMIT ${limit}
            `;

          const ascending = [...rows].reverse();

          return yield* Schema.decodeUnknown(BalanceHistoryResponse)({
            points: ascending,
          });
        }),

      drawdown: (args) =>
        Effect.gen(function* () {
          const { scalars, curve } = drawdownQueries(
            args.instanceId,
            args.limit,
          );

          const scalarRow = firstRow<{
            maxDrawdown: number;
            peakValue: number;
          }>(yield* scalars);

          const newest = sqlRows<{
            recordedAt: string;
            drawdown: number;
          }>(yield* curve);

          // Newest-first from SQL; the chart wants chronological order.
          const points = [...newest].reverse().map((row) => ({
            recordedAt: row.recordedAt,
            drawdown: Number.isFinite(row.drawdown) ? row.drawdown : 0,
          }));

          const last = points[points.length - 1];

          return {
            points,
            maxDrawdown: scalarRow?.maxDrawdown ?? 0,
            currentDrawdown: last?.drawdown ?? 0,
            peakValue: scalarRow?.peakValue ?? 0,
          };
        }),
    } satisfies SnapshotRepoService;
  }),
);
