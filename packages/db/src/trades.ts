// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { SqlClient, SqlError } from "@effect/sql";
import { Context, Effect, Either, Layer, Match, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";
import {
  BlacklistedPair,
  ClosedPosition,
  OpenPosition,
  PairLock,
  TradeOrder,
  type TapeEvent,
} from "@nfi/api-contract";

/**
 * Freqtrade trades mirror — the SQL home of every table filter.
 *
 * freqtrade's REST API has no filter parameters (only limit/offset), so
 * before this mirror existed, table filtering happened in capability JS
 * over fetched windows (search scans capped at a few thousand rows) or in
 * widget JS over limited loads — both silently dropped matches outside the
 * window. The mirror (`ft_trades`, synced by the server's trades sync)
 * holds the FULL per-instance trade history plus the live open positions,
 * so every table query can push its filter down to SQL: WHERE clauses cover
 * the complete dataset, COUNT(*) returns true filtered totals, GROUP BY
 * aggregates whole history, and LIMIT/OFFSET slice exactly the requested
 * window.
 *
 * Search is one OR/LIKE predicate over pair, strategy, enter tag, exit
 * reason, the trade id and every order id (`json_each` over `orders_json`)
 * — the same field set the old capability-side helper matched. Needles are
 * sanitized (%, _ and backslash stripped) so plain LIKE needs no ESCAPE.
 *
 * Aggregation dimensions group the closed side; wins/losses split on the
 * signed close profit. Per-instance data always rides result rows so fleet
 * handlers can tag instance names without a second lookup.
 */

// ---------------------------------------------------------------------------
// Schema (migration)
// ---------------------------------------------------------------------------

export const migrateTrades = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS ft_trades (
      instance_id TEXT NOT NULL,
      trade_id INTEGER NOT NULL,
      pair TEXT NOT NULL,
      is_open INTEGER NOT NULL DEFAULT 0,
      is_short INTEGER,
      exchange TEXT,
      amount REAL,
      stake_amount REAL,
      open_rate REAL,
      close_rate REAL,
      profit_abs REAL,
      profit_pct REAL,
      close_profit_abs REAL,
      close_profit_pct REAL,
      realized_profit REAL,
      open_date TEXT,
      close_date TEXT,
      duration_s INTEGER,
      strategy TEXT,
      timeframe TEXT,
      enter_tag TEXT,
      exit_reason TEXT,
      leverage REAL,
      funding_fees REAL,
      nr_of_entries INTEGER,
      nr_of_exits INTEGER,
      orders_json TEXT,
      current_rate REAL,
      max_stake_amount REAL,
      profit_fiat REAL,
      liquidation_price REAL,
      has_open_orders INTEGER,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (instance_id, trade_id)
    )
  `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_ft_trades_instance_close ON ft_trades (instance_id, close_date)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_ft_trades_instance_open ON ft_trades (instance_id, is_open, open_date)`;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_ft_trades_instance_pair ON ft_trades (instance_id, pair)`;
  yield* sql`
    CREATE TABLE IF NOT EXISTS ft_pair_lists (
      instance_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      position INTEGER NOT NULL,
      pair TEXT NOT NULL,
      reason TEXT,
      PRIMARY KEY (instance_id, kind, pair)
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS ft_locks (
      instance_id TEXT NOT NULL,
      id INTEGER NOT NULL,
      pair TEXT NOT NULL,
      lock_time TEXT,
      lock_end_time TEXT,
      reason TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      side TEXT,
      PRIMARY KEY (instance_id, id)
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS ft_sync_state (
      instance_id TEXT PRIMARY KEY,
      backfill_done INTEGER NOT NULL DEFAULT 0,
      last_tail_at TEXT,
      last_total INTEGER
    )
  `;
}).pipe(Effect.asVoid);

// ---------------------------------------------------------------------------
// Repo
// ---------------------------------------------------------------------------

/** Mirror sync bookkeeping for one instance. */
export interface TradeSyncState {
  readonly backfillDone: boolean;
  readonly lastTailAt: string | null;
  readonly lastTotal: number | null;
}

/** Closed trade as stored, carrying its owning instance (fleet queries). */
export type MirrorClosedPosition = ClosedPosition & { instanceId: string };

/** Open position as stored, carrying its owning instance (fleet queries). */
export type MirrorOpenPosition = OpenPosition & { instanceId: string };

export interface ListClosedArgs {
  /** `null` = fleet (every instance). */
  readonly instanceId: string | null;
  /** Fleet search: instance ids whose NAME matched the needle —
   * their rows match too (names live outside the mirror). */
  readonly matchInstanceIds?: ReadonlyArray<string>;
  /** Relative reads: restrict the search predicate to non-sensitive fields. */
  readonly searchNonSensitiveOnly?: boolean;
  readonly search: string | null;
  readonly limit: number;
  readonly offset: number;
}

export interface ClosedListResult {
  readonly positions: MirrorClosedPosition[];
  /** SQL COUNT(*) over the same WHERE — the true filtered total. */
  readonly total: number;
}

export interface ListOpenArgs {
  readonly instanceId: string | null;
  /** Fleet search: instance ids whose NAME matched the needle —
   * their rows match too (names live outside the mirror). */
  readonly matchInstanceIds?: ReadonlyArray<string>;
  /** Relative reads: restrict the search predicate to non-sensitive fields. */
  readonly searchNonSensitiveOnly?: boolean;
  readonly search: string | null;
  /** Sort key; absent keeps open-date order (newest first). */
  readonly sort: "profitPct" | null;
  readonly dir: "asc" | "desc";
  /** Sign partition on the live profit percent. */
  readonly filter: "gain" | "loss" | null;
  readonly limit: number;
}

export interface OpenListResult {
  readonly positions: MirrorOpenPosition[];
  readonly total: number;
}

/** Aggregation dimension over the closed side of the mirror. */
export type AggregateGroupBy = "enter" | "exit" | "pair" | "strategy";

export interface AggregateArgs {
  readonly instanceId: string | null;
  /** Fleet search: instance ids whose NAME matched the needle —
   * their rows match too (names live outside the mirror). */
  readonly matchInstanceIds?: ReadonlyArray<string>;
  /** Relative reads: restrict the search predicate to non-sensitive fields. */
  readonly searchNonSensitiveOnly?: boolean;
  readonly groupBy: AggregateGroupBy;
  readonly search: string | null;
  /** HAVING COUNT(*) >= minTrades (null = no HAVING). */
  readonly minTrades: number | null;
  /** ORDER BY key: trades | wins | losses | winrate | profitAbs | profitPctAvg. */
  readonly sortBy: string | null;
  readonly sortDir: "asc" | "desc" | null;
  readonly limit: number;
  /** Group by (dimension, instance) instead of the dimension alone. */
  readonly perInstance: boolean;
  /** Best-edge gate: max avg-% dimension needs >= this many trades (null = off). */
  readonly bestEdgeMinTrades: number | null;
}

export interface AggregateRow {
  readonly tag: string;
  readonly instanceId: string | null;
  readonly trades: number;
  readonly wins: number;
  readonly losses: number;
  readonly winrate: number;
  readonly profitAbs: number;
  readonly profitPctAvg: number;
}

/** One-dimensional extreme (best/worst dimension value + its metric). */
export interface AggregateExtreme {
  readonly tag: string;
  readonly value: number;
}

/** Full-history scalars over the same WHERE the grouped rows filter. */
export interface AggregateTotals {
  readonly trades: number;
  readonly wins: number;
  readonly losses: number;
  /** wins / trades (0 when no trades). */
  readonly winrate: number;
  /** Σ close profit over the FULL matching set (not just grouped rows). */
  readonly profitAbs: number;
  /** Mean close profit % over the full matching set. */
  readonly profitPctAvg: number;
}

export interface AggregateResult {
  readonly rows: AggregateRow[];
  /** Closed trades matching the WHERE (before HAVING/LIMIT). */
  readonly totalMatching: number;
  /** Full-set totals — footer sums that must not stop at the row LIMIT. */
  readonly totals: AggregateTotals;
  /** Highest-profit dimension value (HAVING-aware; null when no groups). */
  readonly best: AggregateExtreme | null;
  /** Lowest-profit dimension value (HAVING-aware; null when no groups). */
  readonly worst: AggregateExtreme | null;
  /** Highest avg-% dimension value gated by `bestEdgeMinTrades`. */
  readonly bestEdge: AggregateExtreme | null;
}

export interface PerformanceStatsArgs {
  /** `null` = fleet (every instance's closed trades). */
  readonly instanceId: string | null;
}

/** Headline closed-trade metrics — one SQL aggregate over the FULL mirror. */
export interface PerformanceStats {
  readonly trades: number;
  readonly wins: number;
  readonly losses: number;
  readonly grossWin: number;
  readonly grossLoss: number;
  readonly best: number;
  readonly worst: number;
}

export interface CumulativeProfitArgs {
  /** `null` = fleet (one series per instance). */
  readonly instanceId: string | null;
  /** Newest N points kept per series (the running sum itself is full-history). */
  readonly limit: number;
}

/** One point of a cumulative-profit series (running sum computed in SQL). */
export interface CumulativeProfitRow {
  readonly instanceId: string;
  readonly at: string;
  readonly profit: number;
  readonly cumulative: number;
}

/** Full-history per-instance totals for a cumulative series. */
export interface CumulativeProfitTotal {
  readonly instanceId: string;
  readonly trades: number;
  readonly totalProfit: number;
}

export interface CumulativeProfitResult {
  readonly rows: CumulativeProfitRow[];
  readonly totals: CumulativeProfitTotal[];
}

export interface OpenSummaryArgs {
  /** `null` = fleet (every instance's open positions). */
  readonly instanceId: string | null;
}

/** Fleet/per-instance open-book metrics — one SQL aggregate over the mirror. */
export interface OpenSummary {
  readonly positions: number;
  readonly deployed: number;
  readonly unrealized: number;
  readonly maxLeverage: number;
  readonly longs: number;
  readonly shorts: number;
  readonly largestStake: number;
  readonly pairs: number;
  /** Mean live profit percent across the open book. */
  readonly avgProfitPct: number;
}

/** Per-pair allocation row over the open book. */
export interface OpenSummaryPairRow {
  readonly pair: string;
  readonly positions: number;
  readonly stake: number;
  readonly unrealized: number;
  /** Stake share of the deployed total (0..1, SQL-computed). */
  readonly share: number;
}

export interface OpenSummaryResult {
  readonly summary: OpenSummary;
  readonly rows: OpenSummaryPairRow[];
}

export interface TradedPairsArgs {
  /** `null` = fleet (every instance's rows in one GROUP BY). */
  readonly instanceId: string | null;
}

/** One pair that actually has trades in the mirror (open or closed). */
export interface TradedPairRow {
  readonly pair: string;
  /** Open + closed trades on the pair (full history). */
  readonly trades: number;
  readonly openTrades: number;
  readonly closedTrades: number;
  /** Most recent trade event (close date for closes, else open date). */
  readonly lastAt: string;
}

export interface ClosedPercentStatsArgs {
  readonly instanceId: string;
  /** Relative reads: restrict the search predicate to non-sensitive fields. */
  readonly searchNonSensitiveOnly?: boolean;
  readonly search: string | null;
}

/**
 * Percent-only stats over EVERY closed trade matching the search — the
 * shareable footer behind the relative closed table (win rate, mean, best
 * and worst percent; no absolute values anywhere).
 */
export interface ClosedPercentStats {
  readonly withPnl: number;
  readonly wins: number;
  /** wins / withPnl * 100 (0 when none). */
  readonly winRatePct: number;
  readonly avgProfitPct: number;
  readonly bestPct: number;
  readonly worstPct: number;
}

export interface TapeArgs {
  readonly instanceId: string | null;
  /** Fleet search: instance ids whose NAME matched the needle —
   * their rows match too (names live outside the mirror). */
  readonly matchInstanceIds?: ReadonlyArray<string>;
  readonly limit: number;
  readonly opens: boolean;
  readonly closes: boolean;
}

export interface PairWatchArgs {
  readonly instanceId: string | null;
  readonly pairs: ReadonlyArray<string>;
  readonly showOnlyOpen: boolean;
}

export interface PairWatchResultRow {
  readonly pair: string;
  readonly open: MirrorOpenPosition | null;
  readonly lastPct: number | null;
  readonly lastProfit: number | null;
  readonly lastCloseDate: string | null;
}

export interface PairListArgs {
  readonly instanceId: string;
  readonly search: string | null;
}

export interface LocksArgs {
  readonly instanceId: string;
  readonly includeExpired: boolean;
}

export interface TradesRepoService {
  /** Upsert closed trades (is_open = 0) for one instance. */
  readonly upsertClosed: (
    instanceId: string,
    positions: ReadonlyArray<ClosedPosition>,
  ) => Effect.Effect<void, SqlError.SqlError>;
  /** Upsert live open positions (is_open = 1) for one instance. */
  readonly upsertOpen: (
    instanceId: string,
    positions: ReadonlyArray<OpenPosition>,
  ) => Effect.Effect<void, SqlError.SqlError>;
  /** Replace one instance's whitelist (position order preserved). */
  readonly replaceWhitelist: (
    instanceId: string,
    pairs: ReadonlyArray<string>,
  ) => Effect.Effect<void, SqlError.SqlError>;
  /** Replace one instance's blacklist. */
  readonly replaceBlacklist: (
    instanceId: string,
    pairs: ReadonlyArray<BlacklistedPair>,
  ) => Effect.Effect<void, SqlError.SqlError>;
  /** Replace one instance's pair locks. */
  readonly replaceLocks: (
    instanceId: string,
    locks: ReadonlyArray<PairLock>,
  ) => Effect.Effect<void, SqlError.SqlError>;
  /** Drop every mirrored row for an instance (called on instance removal). */
  readonly deleteInstanceData: (
    instanceId: string,
  ) => Effect.Effect<void, SqlError.SqlError>;
  readonly getSyncState: (
    instanceId: string,
  ) => Effect.Effect<TradeSyncState | null, SqlError.SqlError>;
  readonly setSyncState: (
    instanceId: string,
    state: TradeSyncState,
  ) => Effect.Effect<void, SqlError.SqlError>;
  /** Closed trades in the mirror for one instance (sync reconciliation). */
  readonly countClosed: (
    instanceId: string,
  ) => Effect.Effect<number, SqlError.SqlError>;
  /**
   * Drop the closed rows of one instance (open rows survive): the first
   * step of a drift repair, so a re-backfill converges even when freqtrade
   * itself deleted trades the mirror still holds.
   */
  readonly clearClosed: (
    instanceId: string,
  ) => Effect.Effect<void, SqlError.SqlError>;

  readonly listClosed: (
    args: ListClosedArgs,
  ) => Effect.Effect<ClosedListResult, SqlError.SqlError>;
  readonly listOpen: (
    args: ListOpenArgs,
  ) => Effect.Effect<OpenListResult, SqlError.SqlError>;
  readonly aggregate: (
    args: AggregateArgs,
  ) => Effect.Effect<AggregateResult, SqlError.SqlError>;
  /** Headline closed-trade metrics over the FULL mirror (one SQL row). */
  readonly performanceStats: (
    args: PerformanceStatsArgs,
  ) => Effect.Effect<PerformanceStats, SqlError.SqlError>;
  /** Cumulative closed profit as SQL running sums (full history, newest tail). */
  readonly cumulativeProfit: (
    args: CumulativeProfitArgs,
  ) => Effect.Effect<CumulativeProfitResult, SqlError.SqlError>;
  /** Open-book metrics + per-pair allocation over the mirror (one scan each). */
  readonly openSummary: (
    args: OpenSummaryArgs,
  ) => Effect.Effect<OpenSummaryResult, SqlError.SqlError>;
  /** Every pair with trades in the mirror, most recently active first. */
  readonly tradedPairs: (
    args: TradedPairsArgs,
  ) => Effect.Effect<ReadonlyArray<TradedPairRow>, SqlError.SqlError>;
  /** Percent-only stats over the full closed set (relative footers). */
  readonly closedPercentStats: (
    args: ClosedPercentStatsArgs,
  ) => Effect.Effect<ClosedPercentStats, SqlError.SqlError>;
  readonly tape: (
    args: TapeArgs,
  ) => Effect.Effect<ReadonlyArray<TapeEvent>, SqlError.SqlError>;
  readonly pairWatch: (
    args: PairWatchArgs,
  ) => Effect.Effect<ReadonlyArray<PairWatchResultRow>, SqlError.SqlError>;
  readonly listWhitelist: (
    args: PairListArgs,
  ) => Effect.Effect<
    { pairs: ReadonlyArray<string>; length: number },
    SqlError.SqlError
  >;
  readonly listBlacklist: (
    args: PairListArgs,
  ) => Effect.Effect<
    { pairs: ReadonlyArray<BlacklistedPair>; length: number },
    SqlError.SqlError | ParseError
  >;
  readonly listLocks: (
    args: LocksArgs,
  ) => Effect.Effect<
    { locks: ReadonlyArray<PairLock>; countOnRecord: number },
    SqlError.SqlError
  >;
}

export class TradesRepo extends Context.Tag("nfi/TradesRepo")<
  TradesRepo,
  TradesRepoService
>() {}

/** SQL row shape of `ft_trades` (aliased reads). */
interface TradeRow {
  instance_id: string;
  trade_id: number;
  pair: string;
  is_open: number;
  is_short: number | null;
  exchange: string | null;
  amount: number | null;
  stake_amount: number | null;
  open_rate: number | null;
  close_rate: number | null;
  profit_abs: number | null;
  profit_pct: number | null;
  close_profit_abs: number | null;
  close_profit_pct: number | null;
  realized_profit: number | null;
  open_date: string | null;
  close_date: string | null;
  duration_s: number | null;
  strategy: string | null;
  timeframe: string | null;
  enter_tag: string | null;
  exit_reason: string | null;
  leverage: number | null;
  funding_fees: number | null;
  nr_of_entries: number | null;
  nr_of_exits: number | null;
  orders_json: string | null;
  current_rate: number | null;
  max_stake_amount: number | null;
  profit_fiat: number | null;
  liquidation_price: number | null;
  has_open_orders: number | null;
}

const num = (value: number | null | undefined): number | undefined =>
  value != null && Number.isFinite(value) ? value : undefined;

const text = (value: string | null | undefined): string | undefined =>
  value != null && value.length > 0 ? value : undefined;

const bool = (value: number | null | undefined): boolean | undefined =>
  value != null ? value !== 0 : undefined;

const parseOrders = (json: string | null): TradeOrder[] => {
  if (!json) return [];

  try {
    const parsed: unknown = JSON.parse(json);

    if (!Array.isArray(parsed)) return [];

    const orders: TradeOrder[] = [];

    for (const element of parsed) {
      const decoded = Schema.decodeUnknownEither(TradeOrder)(element);

      if (Either.isRight(decoded)) orders.push(decoded.right);
    }

    return orders;
  } catch {
    return [];
  }
};

// SAFETY: @effect/sql returns untyped rows; every call site SELECTs exactly
// the aliased columns of T (statement and type sit together at the site),
// and nullable fields are re-coerced through num/text/bool downstream.
const sqlRows = <T>(rows: ReadonlyArray<unknown>): T[] => rows as T[];

// SAFETY: first row of a statement whose SELECT list is exactly T's aliased
// columns; LIMIT 1 over no rows reads as undefined.
const firstRow = <T>(rows: ReadonlyArray<unknown>): T | undefined =>
  rows[0] as T | undefined;

const countOf = (rows: ReadonlyArray<unknown>): number => {
  // SAFETY: every caller SELECTs `COUNT(*) AS n`; SQLite counts are
  // integers and COUNT over no rows still yields exactly one row.
  const row = rows[0] as { readonly n: number } | undefined;

  return row?.n ?? 0;
};

const toClosedPosition = (row: TradeRow): ClosedPosition => ({
  tradeId: row.trade_id,
  pair: row.pair,
  isOpen: false,
  amount: row.amount ?? 0,
  stakeAmount: row.stake_amount ?? 0,
  openRate: row.open_rate ?? 0,
  openDate: row.open_date ?? "",
  isShort: bool(row.is_short) ?? false,
  exchange: text(row.exchange),
  closeRate: num(row.close_rate),
  profitAbs: num(row.profit_abs),
  profitPct: num(row.profit_pct),
  closeProfitAbs: num(row.close_profit_abs),
  closeProfitPct: num(row.close_profit_pct),
  realizedProfit: num(row.realized_profit),
  closeDate: text(row.close_date),
  tradeDurationSeconds: num(row.duration_s),
  strategy: text(row.strategy),
  timeframe: text(row.timeframe),
  enterTag: text(row.enter_tag),
  exitReason: text(row.exit_reason),
  leverage: num(row.leverage),
  fundingFees: num(row.funding_fees),
  nrOfEntries: num(row.nr_of_entries),
  nrOfExits: num(row.nr_of_exits),
  orders: parseOrders(row.orders_json),
});

const toOpenPosition = (row: TradeRow): OpenPosition => ({
  tradeId: row.trade_id,
  pair: row.pair,
  isOpen: true,
  amount: row.amount ?? 0,
  stakeAmount: row.stake_amount ?? 0,
  openRate: row.open_rate ?? 0,
  openDate: row.open_date ?? "",
  isShort: bool(row.is_short) ?? false,
  exchange: text(row.exchange),
  currentRate: num(row.current_rate),
  maxStakeAmount: num(row.max_stake_amount),
  profitAbs: num(row.profit_abs),
  profitPct: num(row.profit_pct),
  profitFiat: num(row.profit_fiat),
  realizedProfit: num(row.realized_profit),
  strategy: text(row.strategy),
  timeframe: text(row.timeframe),
  enterTag: text(row.enter_tag),
  exitReason: text(row.exit_reason),
  leverage: num(row.leverage),
  liquidationPrice: num(row.liquidation_price),
  fundingFees: num(row.funding_fees),
  nrOfEntries: num(row.nr_of_entries),
  nrOfExits: num(row.nr_of_exits),
  hasOpenOrders: bool(row.has_open_orders) ?? false,
  orders: parseOrders(row.orders_json),
});

/**
 * Strip LIKE wildcards/backslashes from a search needle so plain `LIKE`
 * needs no ESCAPE clause — a substring match with literal % or _ is
 * meaningless for these fields anyway.
 */
const sanitizeNeedle = (search: string): string =>
  search.replace(/[%_\\]/g, "").trim();

export const TradesRepoLive: Layer.Layer<
  TradesRepo,
  never,
  SqlClient.SqlClient
> = Layer.effect(
  TradesRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const now = () => new Date().toISOString();

    /** Aliased column list shared by every full-row read (no params). */
    const tradeColumns = () =>
      sql`instance_id, trade_id, pair, is_open, is_short, exchange, amount, stake_amount,
      open_rate, close_rate, profit_abs, profit_pct, close_profit_abs, close_profit_pct,
      realized_profit, open_date, close_date, duration_s, strategy, timeframe,
      enter_tag, exit_reason, leverage, funding_fees, nr_of_entries, nr_of_exits,
      orders_json, current_rate, max_stake_amount, profit_fiat, liquidation_price,
      has_open_orders`;

    /**
     * Search predicate fragment (always preceded by WHERE/AND in the
     * caller): one OR/LIKE over the same field set the old capability-side
     * helper matched — pair, strategy, enter tag, exit reason, trade id and
     * every order id (json_each over orders_json). Sanitized needles need
     * no ESCAPE; LIKE is case-insensitive for ASCII in SQLite.
     */
    const searchFilter = (search: string | null, includeIds = true) => {
      const needle = search === null ? null : sanitizeNeedle(search);

      if (needle === null || needle.length === 0) return sql``;
      const like = `%${needle}%`;

      // Relative (public-shareable) capabilities restrict the predicate to
      // non-sensitive fields — trade/order ids must not match there.
      const idClauses = includeIds
        ? sql`
          OR CAST(trade_id AS TEXT) LIKE ${like}
          OR EXISTS (
            SELECT 1 FROM json_each(COALESCE(ft_trades.orders_json, '[]')) je
            WHERE CAST(json_extract(je.value, '$.orderId') AS TEXT) LIKE ${like}
          )`
        : sql``;

      return sql`
        AND (
          pair LIKE ${like}
          OR COALESCE(strategy, '') LIKE ${like}
          OR COALESCE(enter_tag, '') LIKE ${like}
          OR COALESCE(exit_reason, '') LIKE ${like}${idClauses}
        )
      `;
    };

    const instanceFilter = (instanceId: string | null) =>
      instanceId === null ? sql`` : sql`AND instance_id = ${instanceId}`;

    /** Fleet-name alternates: `OR instance_id IN (...)` fragment. */
    const nameFilter = (ids: ReadonlyArray<string> | undefined) => {
      if (!ids || ids.length === 0) return sql``;
      const list = sql.join(", ", false)(ids.map((id) => sql`${id}`));

      return sql`OR instance_id IN (${list})`;
    };

    /** Fleet WHERE: per-instance exact; fleet = any row, or just the
     * instances whose NAME matched the search needle. */
    const fleetInstanceFilter = (
      instanceId: string | null,
      matchIds: ReadonlyArray<string> | undefined,
    ) => {
      if (instanceId !== null) return instanceFilter(instanceId);

      if (!matchIds || matchIds.length === 0) return sql``;

      return sql`AND (1 = 0 ${nameFilter(matchIds)})`;
    };

    const upsertTradeSql = (
      instanceId: string,
      row: Record<string, string | number | null>,
    ) =>
      sql`
        INSERT INTO ft_trades (
          instance_id, trade_id, pair, is_open, is_short, exchange, amount, stake_amount,
          open_rate, close_rate, profit_abs, profit_pct, close_profit_abs, close_profit_pct,
          realized_profit, open_date, close_date, duration_s, strategy, timeframe,
          enter_tag, exit_reason, leverage, funding_fees, nr_of_entries, nr_of_exits,
          orders_json, current_rate, max_stake_amount, profit_fiat, liquidation_price,
          has_open_orders, updated_at
        ) VALUES (
          ${instanceId}, ${row.trade_id}, ${row.pair}, ${row.is_open}, ${row.is_short},
          ${row.exchange}, ${row.amount}, ${row.stake_amount}, ${row.open_rate},
          ${row.close_rate}, ${row.profit_abs}, ${row.profit_pct}, ${row.close_profit_abs},
          ${row.close_profit_pct}, ${row.realized_profit}, ${row.open_date}, ${row.close_date},
          ${row.duration_s}, ${row.strategy}, ${row.timeframe}, ${row.enter_tag},
          ${row.exit_reason}, ${row.leverage}, ${row.funding_fees}, ${row.nr_of_entries},
          ${row.nr_of_exits}, ${row.orders_json}, ${row.current_rate},
          ${row.max_stake_amount}, ${row.profit_fiat}, ${row.liquidation_price},
          ${row.has_open_orders}, ${row.updated_at}
        )
        ON CONFLICT (instance_id, trade_id) DO UPDATE SET
          pair = excluded.pair,
          is_open = excluded.is_open,
          is_short = excluded.is_short,
          exchange = excluded.exchange,
          amount = excluded.amount,
          stake_amount = excluded.stake_amount,
          open_rate = excluded.open_rate,
          close_rate = excluded.close_rate,
          profit_abs = excluded.profit_abs,
          profit_pct = excluded.profit_pct,
          close_profit_abs = excluded.close_profit_abs,
          close_profit_pct = excluded.close_profit_pct,
          realized_profit = excluded.realized_profit,
          open_date = excluded.open_date,
          close_date = excluded.close_date,
          duration_s = excluded.duration_s,
          strategy = excluded.strategy,
          timeframe = excluded.timeframe,
          enter_tag = excluded.enter_tag,
          exit_reason = excluded.exit_reason,
          leverage = excluded.leverage,
          funding_fees = excluded.funding_fees,
          nr_of_entries = excluded.nr_of_entries,
          nr_of_exits = excluded.nr_of_exits,
          orders_json = excluded.orders_json,
          current_rate = excluded.current_rate,
          max_stake_amount = excluded.max_stake_amount,
          profit_fiat = excluded.profit_fiat,
          liquidation_price = excluded.liquidation_price,
          has_open_orders = excluded.has_open_orders,
          updated_at = excluded.updated_at
      `;

    const boolInt = (value: boolean | undefined): number | null =>
      value === undefined ? null : value ? 1 : 0;

    return {
      upsertClosed: (instanceId, positions) =>
        Effect.gen(function* () {
          const stamp = now();

          yield* sql.withTransaction(
            Effect.forEach(
              positions,
              (p) =>
                upsertTradeSql(instanceId, {
                  trade_id: p.tradeId,
                  pair: p.pair,
                  is_open: 0,
                  is_short: boolInt(p.isShort),
                  exchange: p.exchange ?? null,
                  amount: p.amount ?? null,
                  stake_amount: p.stakeAmount ?? null,
                  open_rate: p.openRate ?? null,
                  close_rate: p.closeRate ?? null,
                  profit_abs: p.profitAbs ?? null,
                  profit_pct: p.profitPct ?? null,
                  close_profit_abs: p.closeProfitAbs ?? null,
                  close_profit_pct: p.closeProfitPct ?? null,
                  realized_profit: p.realizedProfit ?? null,
                  open_date: p.openDate ?? null,
                  close_date: p.closeDate ?? null,
                  duration_s: p.tradeDurationSeconds ?? null,
                  strategy: p.strategy ?? null,
                  timeframe: p.timeframe ?? null,
                  enter_tag: p.enterTag ?? null,
                  exit_reason: p.exitReason ?? null,
                  leverage: p.leverage ?? null,
                  funding_fees: p.fundingFees ?? null,
                  nr_of_entries: p.nrOfEntries ?? null,
                  nr_of_exits: p.nrOfExits ?? null,
                  orders_json:
                    p.orders === undefined ? null : JSON.stringify(p.orders),
                  current_rate: null,
                  max_stake_amount: null,
                  profit_fiat: null,
                  liquidation_price: null,
                  has_open_orders: null,
                  updated_at: stamp,
                }),
              { discard: true },
            ),
          );
        }).pipe(Effect.asVoid),

      upsertOpen: (instanceId, positions) =>
        Effect.gen(function* () {
          const stamp = now();

          yield* sql.withTransaction(
            Effect.forEach(
              positions,
              (p) =>
                upsertTradeSql(instanceId, {
                  trade_id: p.tradeId,
                  pair: p.pair,
                  is_open: 1,
                  is_short: boolInt(p.isShort),
                  exchange: p.exchange ?? null,
                  amount: p.amount ?? null,
                  stake_amount: p.stakeAmount ?? null,
                  open_rate: p.openRate ?? null,
                  close_rate: null,
                  profit_abs: p.profitAbs ?? null,
                  profit_pct: p.profitPct ?? null,
                  close_profit_abs: null,
                  close_profit_pct: null,
                  realized_profit: p.realizedProfit ?? null,
                  open_date: p.openDate ?? null,
                  close_date: null,
                  duration_s: null,
                  strategy: p.strategy ?? null,
                  timeframe: p.timeframe ?? null,
                  enter_tag: p.enterTag ?? null,
                  exit_reason: p.exitReason ?? null,
                  leverage: p.leverage ?? null,
                  funding_fees: p.fundingFees ?? null,
                  nr_of_entries: p.nrOfEntries ?? null,
                  nr_of_exits: p.nrOfExits ?? null,
                  orders_json:
                    p.orders === undefined ? null : JSON.stringify(p.orders),
                  current_rate: p.currentRate ?? null,
                  max_stake_amount: p.maxStakeAmount ?? null,
                  profit_fiat: p.profitFiat ?? null,
                  liquidation_price: p.liquidationPrice ?? null,
                  has_open_orders: boolInt(p.hasOpenOrders),
                  updated_at: stamp,
                }),
              { discard: true },
            ),
          );
        }).pipe(Effect.asVoid),

      replaceWhitelist: (instanceId, pairs) =>
        Effect.gen(function* () {
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`DELETE FROM ft_pair_lists WHERE instance_id = ${instanceId} AND kind = 'whitelist'`;

              yield* Effect.forEach(
                pairs,
                (pair, position) =>
                  sql`
                    INSERT INTO ft_pair_lists (instance_id, kind, position, pair, reason)
                    VALUES (${instanceId}, 'whitelist', ${position}, ${pair}, NULL)
                  `,
                { discard: true },
              );
            }),
          );
        }).pipe(Effect.asVoid),

      replaceBlacklist: (instanceId, pairs) =>
        Effect.gen(function* () {
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`DELETE FROM ft_pair_lists WHERE instance_id = ${instanceId} AND kind = 'blacklist'`;

              yield* Effect.forEach(
                pairs,
                (entry, position) =>
                  sql`
                    INSERT INTO ft_pair_lists (instance_id, kind, position, pair, reason)
                    VALUES (${instanceId}, 'blacklist', ${position}, ${entry.pair}, ${entry.reason ?? null})
                  `,
                { discard: true },
              );
            }),
          );
        }).pipe(Effect.asVoid),

      replaceLocks: (instanceId, locks) =>
        Effect.gen(function* () {
          yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`DELETE FROM ft_locks WHERE instance_id = ${instanceId}`;

              yield* Effect.forEach(
                locks,
                (lock) =>
                  sql`
                    INSERT INTO ft_locks (instance_id, id, pair, lock_time, lock_end_time, reason, active, side)
                    VALUES (${instanceId}, ${lock.id}, ${lock.pair}, ${lock.lockTime ?? null},
                            ${lock.lockEndTime ?? null}, ${lock.reason ?? null},
                            ${lock.active ? 1 : 0}, ${lock.side ?? null})
                  `,
                { discard: true },
              );
            }),
          );
        }).pipe(Effect.asVoid),

      deleteInstanceData: (instanceId) =>
        Effect.gen(function* () {
          yield* sql`DELETE FROM ft_trades WHERE instance_id = ${instanceId}`;
          yield* sql`DELETE FROM ft_pair_lists WHERE instance_id = ${instanceId}`;
          yield* sql`DELETE FROM ft_locks WHERE instance_id = ${instanceId}`;
          yield* sql`DELETE FROM ft_sync_state WHERE instance_id = ${instanceId}`;
        }).pipe(Effect.asVoid),

      getSyncState: (instanceId) =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT backfill_done, last_tail_at AS lastTailAt, last_total AS lastTotal
            FROM ft_sync_state
            WHERE instance_id = ${instanceId}
            LIMIT 1
          `;

          const row = firstRow<{
            backfill_done: number;
            lastTailAt: string | null;
            lastTotal: number | null;
          }>(rows);

          if (!row) return null;

          return {
            backfillDone: row.backfill_done !== 0,
            lastTailAt: row.lastTailAt,
            lastTotal: row.lastTotal,
          };
        }),

      setSyncState: (instanceId, state) =>
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO ft_sync_state (instance_id, backfill_done, last_tail_at, last_total)
            VALUES (${instanceId}, ${state.backfillDone ? 1 : 0}, ${state.lastTailAt}, ${state.lastTotal})
            ON CONFLICT (instance_id) DO UPDATE SET
              backfill_done = excluded.backfill_done,
              last_tail_at = excluded.last_tail_at,
              last_total = excluded.last_total
          `;
        }).pipe(Effect.asVoid),

      countClosed: (instanceId) =>
        Effect.gen(function* () {
          const rows = yield* sql`
            SELECT COUNT(*) AS n FROM ft_trades
            WHERE instance_id = ${instanceId} AND is_open = 0
          `;

          return countOf(rows);
        }),

      clearClosed: (instanceId) =>
        sql`DELETE FROM ft_trades WHERE instance_id = ${instanceId} AND is_open = 0`.pipe(
          Effect.asVoid,
        ),

      listClosed: (args) =>
        Effect.gen(function* () {
          const search = searchFilter(
            args.search,
            !args.searchNonSensitiveOnly,
          );

          const instance = fleetInstanceFilter(
            args.instanceId,
            args.matchInstanceIds,
          );

          const rows = sqlRows<TradeRow>(yield* sql`
            SELECT ${tradeColumns()}
            FROM ft_trades
            WHERE is_open = 0 ${instance} ${search}
            ORDER BY COALESCE(close_date, open_date) DESC, trade_id DESC
            LIMIT ${args.limit} OFFSET ${args.offset}
          `);

          const countRows = yield* sql`
            SELECT COUNT(*) AS n FROM ft_trades
            WHERE is_open = 0 ${instance} ${search}
          `;

          const total = countOf(countRows);

          return {
            positions: rows.map((row) => ({
              ...toClosedPosition(row),
              instanceId: row.instance_id,
            })),
            total,
          };
        }),

      listOpen: (args) =>
        Effect.gen(function* () {
          const search = searchFilter(
            args.search,
            !args.searchNonSensitiveOnly,
          );

          const instance = fleetInstanceFilter(
            args.instanceId,
            args.matchInstanceIds,
          );

          const sign = Match.value(args.filter).pipe(
            Match.when("gain", () => sql`AND COALESCE(profit_pct, 0) >= 0`),
            Match.when("loss", () => sql`AND COALESCE(profit_pct, 0) < 0`),
            Match.orElse(() => sql``),
          );

          const order =
            args.sort === "profitPct"
              ? sql`ORDER BY COALESCE(profit_pct, 0) ${sql.literal(args.dir === "asc" ? "ASC" : "DESC")}, trade_id DESC`
              : sql`ORDER BY COALESCE(open_date, '') DESC, trade_id DESC`;

          const rows = sqlRows<TradeRow>(yield* sql`
            SELECT ${tradeColumns()}
            FROM ft_trades
            WHERE is_open = 1 ${instance} ${search} ${sign}
            ${order}
            LIMIT ${args.limit}
          `);

          const countRows = yield* sql`
            SELECT COUNT(*) AS n FROM ft_trades
            WHERE is_open = 1 ${instance} ${search} ${sign}
          `;

          const total = countOf(countRows);

          return {
            positions: rows.map((row) => ({
              ...toOpenPosition(row),
              instanceId: row.instance_id,
            })),
            total,
          };
        }),

      aggregate: (args) =>
        Effect.gen(function* () {
          const search = searchFilter(
            args.search,
            !args.searchNonSensitiveOnly,
          );

          const instance = fleetInstanceFilter(
            args.instanceId,
            args.matchInstanceIds,
          );

          const dimension = Match.value(args.groupBy).pipe(
            Match.when("enter", () => "COALESCE(enter_tag, '')"),
            Match.when("exit", () => "COALESCE(exit_reason, '')"),
            Match.when("pair", () => "pair"),
            Match.orElse(() => "COALESCE(strategy, '')"),
          );

          const groupBy = sql.literal(
            args.perInstance ? `${dimension}, instance_id` : dimension,
          );

          const having =
            args.minTrades === null
              ? sql``
              : sql`HAVING COUNT(*) >= ${args.minTrades}`;

          const SORT_KEYS = [
            "trades",
            "wins",
            "losses",
            "winrate",
            "profitAbs",
            "profitPctAvg",
          ] as const;

          const SORT_EXPR: Record<(typeof SORT_KEYS)[number], string> = {
            trades: "COUNT(*)",
            wins: "wins",
            losses: "losses",
            winrate: "winrate",
            profitAbs: "profitAbs",
            profitPctAvg: "profitPctAvg",
          };

          // Unknown keys (arbitrary strings ride `sortBy`) fall back to
          // profitAbs — the find both validates and narrows to the key set.
          const sortKey =
            SORT_KEYS.find((key) => key === args.sortBy) ?? "profitAbs";

          const sortExpr = sql.literal(SORT_EXPR[sortKey]);

          const dir = sql.literal(args.sortDir === "asc" ? "ASC" : "DESC");

          const rows = sqlRows<{
            tagValue: string;
            instanceId: string;
            trades: number;
            wins: number;
            losses: number;
            winrate: number;
            profitAbs: number;
            profitPctAvg: number;
          }>(yield* sql`
            SELECT
              ${sql.literal(dimension)} AS tagValue,
              instance_id AS instanceId,
              COUNT(*) AS trades,
              SUM(CASE WHEN COALESCE(close_profit_abs, profit_abs, 0) > 0 THEN 1 ELSE 0 END) AS wins,
              SUM(CASE WHEN COALESCE(close_profit_abs, profit_abs, 0) < 0 THEN 1 ELSE 0 END) AS losses,
              CAST(SUM(CASE WHEN COALESCE(close_profit_abs, profit_abs, 0) > 0 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) AS winrate,
              SUM(COALESCE(close_profit_abs, profit_abs, 0)) AS profitAbs,
              AVG(COALESCE(close_profit_pct, profit_pct, 0)) AS profitPctAvg
            FROM ft_trades
            WHERE is_open = 0 ${instance} ${search}
            GROUP BY ${groupBy}
            ${having}
            ORDER BY ${sortExpr} ${dir}, tagValue ASC
            LIMIT ${args.limit}
          `);

          const countRows = yield* sql`
            SELECT COUNT(*) AS n FROM ft_trades
            WHERE is_open = 0 ${instance} ${search}
          `;

          const totalMatching = countOf(countRows);

          // Footer totals over the FULL matching set: the grouped rows above
          // are LIMITed, so summing them client-side would silently drop
          // every dimension past the window. Same WHERE, no GROUP BY.
          const totalsRow = firstRow<{
            trades: number;
            wins: number;
            losses: number;
            winrate: number | null;
            profitAbs: number;
            profitPctAvg: number | null;
          }>(yield* sql`
            SELECT
              COUNT(*) AS trades,
              COALESCE(SUM(CASE WHEN COALESCE(close_profit_abs, profit_abs, 0) > 0 THEN 1 ELSE 0 END), 0) AS wins,
              COALESCE(SUM(CASE WHEN COALESCE(close_profit_abs, profit_abs, 0) < 0 THEN 1 ELSE 0 END), 0) AS losses,
              CAST(COALESCE(SUM(CASE WHEN COALESCE(close_profit_abs, profit_abs, 0) > 0 THEN 1 ELSE 0 END), 0) AS REAL) / COUNT(*) AS winrate,
              COALESCE(SUM(COALESCE(close_profit_abs, profit_abs, 0)), 0) AS profitAbs,
              COALESCE(AVG(COALESCE(close_profit_pct, profit_pct, 0)), 0) AS profitPctAvg
            FROM ft_trades
            WHERE is_open = 0 ${instance} ${search}
          `);

          // Best/worst dimension by absolute profit, HAVING-aware (they label
          // the same population the grouped rows show). Best edge ranks by
          // avg % behind its own min-trades gate.
          const extreme = (orderExpr: string, minTrades: number | null) =>
            sql`
              SELECT ${sql.literal(dimension)} AS tagValue,
                     SUM(COALESCE(close_profit_abs, profit_abs, 0)) AS profit,
                     AVG(COALESCE(close_profit_pct, profit_pct, 0)) AS pctAvg
              FROM ft_trades
              WHERE is_open = 0 ${instance} ${search}
              GROUP BY ${groupBy}
              ${minTrades === null ? sql`` : sql`HAVING COUNT(*) >= ${minTrades}`}
              ORDER BY ${sql.literal(orderExpr)} DESC
              LIMIT 1
            `;

          const bestRow = firstRow<{ tagValue: string; profit: number }>(
            yield* extreme("profit", args.minTrades),
          );

          const worstRow = firstRow<{ tagValue: string; profit: number }>(
            yield* sql`
              SELECT ${sql.literal(dimension)} AS tagValue,
                     SUM(COALESCE(close_profit_abs, profit_abs, 0)) AS profit
              FROM ft_trades
              WHERE is_open = 0 ${instance} ${search}
              GROUP BY ${groupBy}
              ${having}
              ORDER BY profit ASC
              LIMIT 1
            `,
          );

          const edgeRow = firstRow<{
            tagValue: string;
            pctAvg: number | null;
          }>(yield* extreme("pctAvg", args.bestEdgeMinTrades));

          return {
            rows: rows.map((row) => ({
              tag: row.tagValue,
              instanceId: args.perInstance ? row.instanceId : null,
              trades: row.trades ?? 0,
              wins: row.wins ?? 0,
              losses: row.losses ?? 0,
              winrate: Number.isFinite(row.winrate) ? row.winrate : 0,
              profitAbs: row.profitAbs ?? 0,
              profitPctAvg: row.profitPctAvg ?? 0,
            })),
            totalMatching,
            totals: {
              trades: totalsRow?.trades ?? 0,
              wins: totalsRow?.wins ?? 0,
              losses: totalsRow?.losses ?? 0,
              winrate:
                totalsRow?.winrate != null &&
                Number.isFinite(totalsRow.winrate)
                  ? totalsRow.winrate
                  : 0,
              profitAbs: totalsRow?.profitAbs ?? 0,
              profitPctAvg:
                totalsRow?.profitPctAvg != null &&
                Number.isFinite(totalsRow.profitPctAvg)
                  ? totalsRow.profitPctAvg
                  : 0,
            },
            best:
              bestRow === undefined
                ? null
                : { tag: bestRow.tagValue, value: bestRow.profit ?? 0 },
            worst:
              worstRow === undefined
                ? null
                : { tag: worstRow.tagValue, value: worstRow.profit ?? 0 },
            bestEdge:
              edgeRow === undefined || edgeRow.pctAvg === null
                ? null
                : { tag: edgeRow.tagValue, value: edgeRow.pctAvg },
          };
        }),

      performanceStats: (args) =>
        Effect.gen(function* () {
          const instance = instanceFilter(args.instanceId);

          const row = firstRow<{
            trades: number;
            wins: number;
            losses: number;
            grossWin: number;
            grossLoss: number;
            best: number;
            worst: number;
          }>(yield* sql`
            SELECT
              COUNT(*) AS trades,
              COALESCE(SUM(CASE WHEN COALESCE(close_profit_abs, profit_abs, 0) > 0 THEN 1 ELSE 0 END), 0) AS wins,
              COALESCE(SUM(CASE WHEN COALESCE(close_profit_abs, profit_abs, 0) < 0 THEN 1 ELSE 0 END), 0) AS losses,
              COALESCE(SUM(CASE WHEN COALESCE(close_profit_abs, profit_abs, 0) > 0 THEN COALESCE(close_profit_abs, profit_abs, 0) ELSE 0 END), 0) AS grossWin,
              COALESCE(SUM(CASE WHEN COALESCE(close_profit_abs, profit_abs, 0) < 0 THEN -COALESCE(close_profit_abs, profit_abs, 0) ELSE 0 END), 0) AS grossLoss,
              COALESCE(MAX(COALESCE(close_profit_abs, profit_abs, 0)), 0) AS best,
              COALESCE(MIN(COALESCE(close_profit_abs, profit_abs, 0)), 0) AS worst
            FROM ft_trades
            WHERE is_open = 0 ${instance}
          `);

          return {
            trades: row?.trades ?? 0,
            wins: row?.wins ?? 0,
            losses: row?.losses ?? 0,
            grossWin: row?.grossWin ?? 0,
            grossLoss: row?.grossLoss ?? 0,
            best: row?.best ?? 0,
            worst: row?.worst ?? 0,
          };
        }),

      cumulativeProfit: (args) =>
        Effect.gen(function* () {
          const instance = instanceFilter(args.instanceId);

          // Running sums are SQL window functions over the FULL closed
          // history ordered by close time; only the newest `limit` points
          // per instance leave the database. `rn` counts from the newest.
          const rows = sqlRows<{
            instanceId: string;
            at: string;
            profit: number;
            cumulative: number;
          }>(yield* sql`
            WITH closed AS (
              SELECT instance_id, trade_id,
                     COALESCE(close_date, open_date, '') AS at,
                     COALESCE(close_profit_abs, profit_abs, 0) AS profit
              FROM ft_trades
              WHERE is_open = 0 ${instance}
            ),
            running AS (
              SELECT instance_id, trade_id, at, profit,
                     SUM(profit) OVER (
                       PARTITION BY instance_id ORDER BY at, trade_id
                       ROWS UNBOUNDED PRECEDING
                     ) AS cumulative,
                     ROW_NUMBER() OVER (
                       PARTITION BY instance_id ORDER BY at DESC, trade_id DESC
                     ) AS rn
              FROM closed
            )
            SELECT instance_id AS instanceId, at, profit, cumulative
            FROM running
            WHERE rn <= ${args.limit}
            ORDER BY instanceId ASC, at ASC, trade_id ASC
          `);

          const totals = sqlRows<{
            instanceId: string;
            trades: number;
            totalProfit: number;
          }>(yield* sql`
            SELECT instance_id AS instanceId,
                   COUNT(*) AS trades,
                   COALESCE(SUM(COALESCE(close_profit_abs, profit_abs, 0)), 0) AS totalProfit
            FROM ft_trades
            WHERE is_open = 0 ${instance}
            GROUP BY instance_id
          `);

          return {
            rows: rows.map((row) => ({
              instanceId: row.instanceId,
              at: row.at,
              profit: row.profit ?? 0,
              cumulative: row.cumulative ?? 0,
            })),
            totals: totals.map((row) => ({
              instanceId: row.instanceId,
              trades: row.trades ?? 0,
              totalProfit: row.totalProfit ?? 0,
            })),
          };
        }),

      openSummary: (args) =>
        Effect.gen(function* () {
          const instance = instanceFilter(args.instanceId);

          const summaryRow = firstRow<{
            positions: number;
            deployed: number;
            unrealized: number;
            maxLeverage: number;
            shorts: number;
            longs: number;
            largestStake: number;
            pairs: number;
            avgProfitPct: number | null;
          }>(yield* sql`
            SELECT
              COUNT(*) AS positions,
              COALESCE(SUM(COALESCE(stake_amount, 0)), 0) AS deployed,
              COALESCE(SUM(COALESCE(profit_abs, 0)), 0) AS unrealized,
              COALESCE(MAX(COALESCE(leverage, 1)), 1) AS maxLeverage,
              COALESCE(SUM(CASE WHEN COALESCE(is_short, 0) != 0 THEN 1 ELSE 0 END), 0) AS shorts,
              COALESCE(SUM(CASE WHEN COALESCE(is_short, 0) = 0 THEN 1 ELSE 0 END), 0) AS longs,
              COALESCE(MAX(COALESCE(stake_amount, 0)), 0) AS largestStake,
              COUNT(DISTINCT pair) AS pairs,
              COALESCE(AVG(COALESCE(profit_pct, 0)), 0) AS avgProfitPct
            FROM ft_trades
            WHERE is_open = 1 ${instance}
          `);

          // Per-pair allocation with the share computed in SQL: the window
          // SUM over the grouped rows is the deployed total, so the share
          // is exact even when the pair list is long.
          const pairRows = sqlRows<{
            pair: string;
            positions: number;
            stake: number;
            unrealized: number;
            share: number;
          }>(yield* sql`
            SELECT pair, positions, stake, unrealized,
                   CASE WHEN deployed > 0 THEN stake / deployed ELSE 0 END AS share
            FROM (
              SELECT pair,
                     COUNT(*) AS positions,
                     SUM(COALESCE(stake_amount, 0)) AS stake,
                     SUM(COALESCE(profit_abs, 0)) AS unrealized,
                     SUM(SUM(COALESCE(stake_amount, 0))) OVER () AS deployed
              FROM ft_trades
              WHERE is_open = 1 ${instance}
              GROUP BY pair
            )
            ORDER BY stake DESC, pair ASC
          `);

          return {
            summary: {
              positions: summaryRow?.positions ?? 0,
              deployed: summaryRow?.deployed ?? 0,
              unrealized: summaryRow?.unrealized ?? 0,
              maxLeverage: summaryRow?.maxLeverage ?? 1,
              longs: summaryRow?.longs ?? 0,
              shorts: summaryRow?.shorts ?? 0,
              largestStake: summaryRow?.largestStake ?? 0,
              pairs: summaryRow?.pairs ?? 0,
              avgProfitPct:
                summaryRow?.avgProfitPct != null &&
                Number.isFinite(summaryRow.avgProfitPct)
                  ? summaryRow.avgProfitPct
                  : 0,
            },
            rows: pairRows.map((row) => ({
              pair: row.pair,
              positions: row.positions ?? 0,
              stake: row.stake ?? 0,
              unrealized: row.unrealized ?? 0,
              share: row.share ?? 0,
            })),
          };
        }),

      tradedPairs: (args) =>
        Effect.gen(function* () {
          const instance = instanceFilter(args.instanceId);

          // One GROUP BY over the WHOLE mirror (open + closed sides): the
          // result is exactly the pairs with trade history — nothing that
          // was merely whitelisted — most recently active first.
          const rows = sqlRows<{
            pair: string;
            trades: number;
            openTrades: number;
            closedTrades: number;
            lastAt: string | null;
          }>(yield* sql`
            SELECT pair,
                   COUNT(*) AS trades,
                   COALESCE(SUM(CASE WHEN is_open = 1 THEN 1 ELSE 0 END), 0) AS openTrades,
                   COALESCE(SUM(CASE WHEN is_open = 0 THEN 1 ELSE 0 END), 0) AS closedTrades,
                   MAX(COALESCE(close_date, open_date, '')) AS lastAt
            FROM ft_trades
            WHERE 1 = 1 ${instance}
            GROUP BY pair
            ORDER BY lastAt DESC, pair ASC
          `);

          return rows.map((row) => ({
            pair: row.pair,
            trades: row.trades ?? 0,
            openTrades: row.openTrades ?? 0,
            closedTrades: row.closedTrades ?? 0,
            lastAt: row.lastAt ?? "",
          }));
        }),

      closedPercentStats: (args) =>
        Effect.gen(function* () {
          const instance = instanceFilter(args.instanceId);

          const search = searchFilter(
            args.search,
            !args.searchNonSensitiveOnly,
          );

          const row = firstRow<{
            withPnl: number;
            wins: number;
            winRate: number | null;
            avgPct: number | null;
            bestPct: number;
            worstPct: number;
          }>(yield* sql`
            SELECT COUNT(*) AS withPnl,
                   COALESCE(SUM(CASE WHEN COALESCE(close_profit_pct, profit_pct, 0) > 0 THEN 1 ELSE 0 END), 0) AS wins,
                   CAST(COALESCE(SUM(CASE WHEN COALESCE(close_profit_pct, profit_pct, 0) > 0 THEN 1 ELSE 0 END), 0) AS REAL)
                     / COUNT(*) AS winRate,
                   COALESCE(AVG(COALESCE(close_profit_pct, profit_pct, 0)), 0) AS avgPct,
                   COALESCE(MAX(COALESCE(close_profit_pct, profit_pct, 0)), 0) AS bestPct,
                   COALESCE(MIN(COALESCE(close_profit_pct, profit_pct, 0)), 0) AS worstPct
            FROM ft_trades
            WHERE is_open = 0
              AND COALESCE(close_profit_pct, profit_pct) IS NOT NULL
              ${instance} ${search}
          `);

          return {
            withPnl: row?.withPnl ?? 0,
            wins: row?.wins ?? 0,
            winRatePct:
              row?.winRate != null && Number.isFinite(row.winRate)
                ? row.winRate * 100
                : 0,
            avgProfitPct:
              row?.avgPct != null && Number.isFinite(row.avgPct)
                ? row.avgPct
                : 0,
            bestPct: row?.bestPct ?? 0,
            worstPct: row?.worstPct ?? 0,
          };
        }),

      tape: (args) =>
        Effect.gen(function* () {
          const instance = fleetInstanceFilter(
            args.instanceId,
            args.matchInstanceIds,
          );

          // Per-side SQL selection of the newest n rows; the merged slice
          // below is pure assembly — the true overall top-n is always
          // within the union of the per-side top-n.
          const perSide = args.limit;

          const openRows = args.opens
            ? sqlRows<TapeRow>(yield* sql`
                SELECT 'open' AS kind, trade_id, pair, COALESCE(open_date, '') AS at,
                       is_short, open_rate, enter_tag, NULL AS exit_reason,
                       NULL AS profit_abs, instance_id
                FROM ft_trades
                WHERE is_open = 1 ${instance}
                ORDER BY COALESCE(open_date, '') DESC, trade_id DESC
                LIMIT ${perSide}
              `)
            : [];

          const closeRows = args.closes
            ? sqlRows<TapeRow>(yield* sql`
                SELECT 'close' AS kind, trade_id, pair,
                       COALESCE(close_date, open_date, '') AS at,
                       is_short, open_rate, enter_tag, exit_reason,
                       COALESCE(close_profit_abs, profit_abs) AS profit_abs,
                       instance_id
                FROM ft_trades
                WHERE is_open = 0 ${instance}
                ORDER BY COALESCE(close_date, open_date, '') DESC, trade_id DESC
                LIMIT ${perSide}
              `)
            : [];

          const merged = [...openRows, ...closeRows]
            .sort((a, b) => {
              const diff = (b.at ?? "").localeCompare(a.at ?? "");

              return diff !== 0 ? diff : b.trade_id - a.trade_id;
            })
            .slice(0, args.limit);

          return merged.map((row) => ({
            kind: row.kind,
            tradeId: row.trade_id,
            pair: row.pair,
            at: row.at,
            isShort: bool(row.is_short) ?? undefined,
            openRate: num(row.open_rate),
            enterTag: text(row.enter_tag),
            exitReason: text(row.exit_reason),
            profitAbs: num(row.profit_abs),
            instanceId: row.instance_id,
          }));
        }),

      pairWatch: (args) =>
        Effect.gen(function* () {
          const instance = instanceFilter(args.instanceId);

          const wanted = args.pairs
            .map((pair) => pair.trim().toUpperCase())
            .filter((pair) => pair.length > 0)
            .slice(0, 32);

          if (wanted.length === 0) return [];

          const upperPairs = wanted.map((pair) => pair.toUpperCase());

          // addParens=false: sql.join wraps in parentheses by default, and
          // `IN ((?, ?))` parses as a row value in SQLite, not a pair list.
          const pairList = sql.join(
            ", ",
            false,
          )(upperPairs.map((pair) => sql`${pair}`));

          const openRows = sqlRows<TradeRow>(yield* sql`
            SELECT ${tradeColumns()}
            FROM ft_trades
            WHERE is_open = 1 AND UPPER(pair) IN (${pairList}) ${instance}
            ORDER BY COALESCE(open_date, '') DESC
          `);

          // First-seen open row per pair (newest open wins).
          const openByPair = new Map<string, MirrorOpenPosition>();

          for (const row of openRows) {
            const key = row.pair.toUpperCase();

            if (!openByPair.has(key)) {
              openByPair.set(key, {
                ...toOpenPosition(row),
                instanceId: row.instance_id,
              });
            }
          }

          // Most recent close per pair: the max event date, then its row's
          // profit columns (SQLite bare-column semantics carry the row that
          // produced the MAX).
          const closeRows = sqlRows<{
            pair: string;
            lastAt: string | null;
            lastPct: number | null;
            lastProfit: number | null;
            lastCloseDate: string | null;
          }>(yield* sql`
            SELECT pair,
                   MAX(COALESCE(close_date, open_date, '')) AS lastAt,
                   COALESCE(close_profit_pct, profit_pct) AS lastPct,
                   COALESCE(close_profit_abs, profit_abs) AS lastProfit,
                   close_date AS lastCloseDate
            FROM ft_trades
            WHERE is_open = 0 AND UPPER(pair) IN (${pairList}) ${instance}
            GROUP BY UPPER(pair)
          `);

          const lastByPair = new Map<
            string,
            {
              lastPct: number | null;
              lastProfit: number | null;
              lastCloseDate: string | null;
            }
          >();

          for (const row of closeRows) {
            lastByPair.set(row.pair.toUpperCase(), {
              lastPct: num(row.lastPct) ?? null,
              lastProfit: num(row.lastProfit) ?? null,
              lastCloseDate: text(row.lastCloseDate) ?? null,
            });
          }

          const pairsOut = args.showOnlyOpen ? [...openByPair.keys()] : wanted;

          return pairsOut.map((pair) => {
            const key = pair.toUpperCase();
            const last = lastByPair.get(key);

            return {
              pair,
              open: openByPair.get(key) ?? null,
              lastPct: last?.lastPct ?? null,
              lastProfit: last?.lastProfit ?? null,
              lastCloseDate: last?.lastCloseDate ?? null,
            };
          });
        }),

      listWhitelist: (args) =>
        Effect.gen(function* () {
          const needle =
            args.search === null ? null : sanitizeNeedle(args.search);

          const like = needle && needle.length > 0 ? `%${needle}%` : null;
          const search = like === null ? sql`` : sql`AND pair LIKE ${like}`;

          const rows = sqlRows<{ pair: string }>(yield* sql`
            SELECT pair FROM ft_pair_lists
            WHERE instance_id = ${args.instanceId} AND kind = 'whitelist' ${search}
            ORDER BY position ASC
          `);

          const countRows = yield* sql`
            SELECT COUNT(*) AS n FROM ft_pair_lists
            WHERE instance_id = ${args.instanceId} AND kind = 'whitelist'
          `;

          const total = countOf(countRows);

          return { pairs: rows.map((row) => row.pair), length: total };
        }),

      listBlacklist: (args) =>
        Effect.gen(function* () {
          const needle =
            args.search === null ? null : sanitizeNeedle(args.search);

          const like = needle && needle.length > 0 ? `%${needle}%` : null;

          const search =
            like === null
              ? sql``
              : sql`AND (pair LIKE ${like} OR COALESCE(reason, '') LIKE ${like})`;

          const rows = sqlRows<{ pair: string; reason: string | null }>(
            yield* sql`
              SELECT pair, reason FROM ft_pair_lists
              WHERE instance_id = ${args.instanceId} AND kind = 'blacklist' ${search}
              ORDER BY position ASC
            `,
          );

          const countRows = yield* sql`
            SELECT COUNT(*) AS n FROM ft_pair_lists
            WHERE instance_id = ${args.instanceId} AND kind = 'blacklist'
          `;

          const total = countOf(countRows);

          const decoded = yield* Schema.decodeUnknown(
            Schema.Array(BlacklistedPair),
          )(
            rows.map((row) => ({
              pair: row.pair,
              reason: text(row.reason),
            })),
          );

          return { pairs: decoded, length: total };
        }),

      listLocks: (args) =>
        Effect.gen(function* () {
          const expired = args.includeExpired ? sql`` : sql`AND active = 1`;

          const rows = sqlRows<{
            id: number;
            pair: string;
            lockTime: string | null;
            lockEndTime: string | null;
            reason: string | null;
            active: number;
            side: string | null;
          }>(yield* sql`
            SELECT id, pair, lock_time AS lockTime, lock_end_time AS lockEndTime,
                   reason, active, side
            FROM ft_locks
            WHERE instance_id = ${args.instanceId} ${expired}
            ORDER BY lock_end_time ASC
          `);

          const countRows = yield* sql`
            SELECT COUNT(*) AS n FROM ft_locks
            WHERE instance_id = ${args.instanceId}
          `;

          const total = countOf(countRows);

          return {
            countOnRecord: total,
            locks: rows.map((row) => ({
              id: row.id,
              pair: row.pair,
              lockTime: row.lockTime ?? "",
              lockEndTime: row.lockEndTime ?? "",
              reason: row.reason ?? "",
              active: row.active !== 0,
              side: text(row.side),
            })),
          };
        }),
    } satisfies TradesRepoService;
  }),
);

interface TapeRow {
  kind: "open" | "close";
  trade_id: number;
  pair: string;
  at: string;
  is_short: number | null;
  open_rate: number | null;
  enter_tag: string | null;
  exit_reason: string | null;
  profit_abs: number | null;
  instance_id: string;
}
