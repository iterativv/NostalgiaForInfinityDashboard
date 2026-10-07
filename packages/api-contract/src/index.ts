// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "@effect/platform";
import { Effect, Either, Schema } from "effect";

/**
 * @nfi/api-contract
 *
 * Single source of truth for data exchanged between the backend
 * (`apps/server`, Effect-TS) and any frontend shell (`apps/web` today,
 * desktop app tomorrow, Bun runtime later).
 *
 * Rules:
 * - Frontend NEVER imports `@nfi/freqtrade-client` and NEVER talks to
 *   freqtrade directly. It only consumes the DTOs below over HTTP from
 *   our backend, so no freqtrade URL is ever exposed and no CORS setup
 *   on freqtrade is required.
 * - Backend normalizes raw freqtrade REST payloads into these DTOs, so
 *   the UI is insulated from freqtrade version drift.
 */

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export const HealthStatus = Schema.Literal("ok");

export type HealthStatus = typeof HealthStatus.Type;

export const FreqtradeReachability = Schema.Literal(
  "reachable",
  "unreachable",
  "unknown",
);

export type FreqtradeReachability = typeof FreqtradeReachability.Type;

export const HealthResponse = Schema.Struct({
  status: HealthStatus,
  freqtrade: FreqtradeReachability,
  timestamp: Schema.String,
});

export type HealthResponse = typeof HealthResponse.Type;

export const BackendConfigResponse = Schema.Struct({
  /** Host portion only — never leak credentials or full internal URLs. */
  freqtradeHost: Schema.String,
  freqtradeConfigured: Schema.Boolean,
  /**
   * Whether the implicit `default` instance has real env credentials
   * (`FREQTRADE_PASSWORD` set). False means the operator has not connected
   * freqtrade yet — the first-run instance setup screen keys off this.
   */
  defaultInstanceConfigured: Schema.Boolean,
});

export type BackendConfigResponse = typeof BackendConfigResponse.Type;

// ---------------------------------------------------------------------------
// Bot domain DTOs (normalized by the backend)
// ---------------------------------------------------------------------------

export const BotStatus = Schema.Struct({
  state: Schema.String,
  strategy: Schema.optional(Schema.String),
  /**
   * Strategy implementation version (NFI `v18.0.119`, …).
   * Primary source is `GET /api/v1/show_config` (`strategy_version`);
   * older bots omit it, so the backend falls back to parsing the
   * `Bot heartbeat … version='…, strategy_version: …'` log line from
   * `GET /api/v1/logs` (and, last, the `/version` string itself).
   * Absent when no source yields one — never fails the status read.
   */
  strategyVersion: Schema.optional(Schema.String),
  exchange: Schema.optional(Schema.String),
  stakeCurrency: Schema.optional(Schema.String),
  dryRun: Schema.optional(Schema.Boolean),
  tradingMode: Schema.optional(Schema.String),
  /** Freqtrade version (`GET /api/v1/version`); absent when unreadable. */
  version: Schema.optional(Schema.String),
});

export type BotStatus = typeof BotStatus.Type;

export const CurrencyBalance = Schema.Struct({
  currency: Schema.String,
  free: Schema.Number,
  used: Schema.Number,
  total: Schema.Number,
});

export type CurrencyBalance = typeof CurrencyBalance.Type;

export const BalanceResponse = Schema.Struct({
  stakeCurrency: Schema.String,
  totalStake: Schema.Number,
  /** Wallet value when the bot started trading (freqtrade `starting_capital`). */
  startingCapital: Schema.optional(Schema.Number),
  currencies: Schema.Array(CurrencyBalance),
  /** Raw freqtrade note field, kept for display only. */
  note: Schema.optional(Schema.String),
});

export type BalanceResponse = typeof BalanceResponse.Type;

/** Units: `*Percent` fields are percentages (12.5 = 12.5%), coins are stake-currency amounts. */
export const ProfitSummary = Schema.Struct({
  profitClosedCoin: Schema.Number,
  profitClosedPercent: Schema.Number,
  profitClosedFiat: Schema.Number,
  profitAllCoin: Schema.Number,
  profitAllPercent: Schema.Number,
  profitAllFiat: Schema.Number,
  tradeCount: Schema.Number,
  closedTradeCount: Schema.Number,
  winningTrades: Schema.Number,
  losingTrades: Schema.Number,
  stakeCurrency: Schema.String,
  fiatCurrency: Schema.String,
});

export type ProfitSummary = typeof ProfitSummary.Type;

export const OpenTrade = Schema.Struct({
  tradeId: Schema.Number,
  pair: Schema.String,
  isOpen: Schema.Boolean,
  exchange: Schema.optional(Schema.String),
  amount: Schema.Number,
  stakeAmount: Schema.Number,
  openRate: Schema.Number,
  currentRate: Schema.optional(Schema.Number),
  profitAbs: Schema.optional(Schema.Number),
  profitPct: Schema.optional(Schema.Number),
  openDate: Schema.String,
  strategy: Schema.optional(Schema.String),
  timeframe: Schema.optional(Schema.String),
});

export type OpenTrade = typeof OpenTrade.Type;

export const OpenTradesResponse = Schema.Struct({
  trades: Schema.Array(OpenTrade),
});

export type OpenTradesResponse = typeof OpenTradesResponse.Type;

// --- Position detail (open + closed) with sub-orders ------------------------

export const TradeOrder = Schema.Struct({
  orderId: Schema.String,
  side: Schema.String,
  type: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  amount: Schema.optional(Schema.Number),
  price: Schema.optional(Schema.Number),
  cost: Schema.optional(Schema.Number),
  filled: Schema.optional(Schema.Number),
  remaining: Schema.optional(Schema.Number),
  isOpen: Schema.optional(Schema.Boolean),
  isEntry: Schema.optional(Schema.Boolean),
  tag: Schema.optional(Schema.String),
  timestamp: Schema.optional(Schema.Number),
  filledTimestamp: Schema.optional(Schema.Number),
});

export type TradeOrder = typeof TradeOrder.Type;

export const OpenPosition = Schema.Struct({
  tradeId: Schema.Number,
  pair: Schema.String,
  isOpen: Schema.Boolean,
  isShort: Schema.optional(Schema.Boolean),
  exchange: Schema.optional(Schema.String),
  amount: Schema.Number,
  stakeAmount: Schema.Number,
  maxStakeAmount: Schema.optional(Schema.Number),
  openRate: Schema.Number,
  currentRate: Schema.optional(Schema.Number),
  profitAbs: Schema.optional(Schema.Number),
  profitPct: Schema.optional(Schema.Number),
  profitFiat: Schema.optional(Schema.Number),
  realizedProfit: Schema.optional(Schema.Number),
  openDate: Schema.String,
  strategy: Schema.optional(Schema.String),
  timeframe: Schema.optional(Schema.String),
  enterTag: Schema.optional(Schema.String),
  exitReason: Schema.optional(Schema.String),
  leverage: Schema.optional(Schema.Number),
  liquidationPrice: Schema.optional(Schema.Number),
  fundingFees: Schema.optional(Schema.Number),
  nrOfEntries: Schema.optional(Schema.Number),
  nrOfExits: Schema.optional(Schema.Number),
  hasOpenOrders: Schema.optional(Schema.Boolean),
  orders: Schema.optional(Schema.Array(TradeOrder)),
});

export type OpenPosition = typeof OpenPosition.Type;

export const OpenPositionsResponse = Schema.Struct({
  positions: Schema.Array(OpenPosition),
});

export type OpenPositionsResponse = typeof OpenPositionsResponse.Type;

export const ClosedPosition = Schema.Struct({
  tradeId: Schema.Number,
  pair: Schema.String,
  isOpen: Schema.Boolean,
  isShort: Schema.optional(Schema.Boolean),
  exchange: Schema.optional(Schema.String),
  amount: Schema.Number,
  stakeAmount: Schema.Number,
  openRate: Schema.Number,
  closeRate: Schema.optional(Schema.Number),
  profitAbs: Schema.optional(Schema.Number),
  profitPct: Schema.optional(Schema.Number),
  closeProfitAbs: Schema.optional(Schema.Number),
  closeProfitPct: Schema.optional(Schema.Number),
  realizedProfit: Schema.optional(Schema.Number),
  openDate: Schema.String,
  closeDate: Schema.optional(Schema.String),
  tradeDurationSeconds: Schema.optional(Schema.Number),
  strategy: Schema.optional(Schema.String),
  timeframe: Schema.optional(Schema.String),
  enterTag: Schema.optional(Schema.String),
  exitReason: Schema.optional(Schema.String),
  leverage: Schema.optional(Schema.Number),
  fundingFees: Schema.optional(Schema.Number),
  nrOfEntries: Schema.optional(Schema.Number),
  nrOfExits: Schema.optional(Schema.Number),
  orders: Schema.optional(Schema.Array(TradeOrder)),
});

export type ClosedPosition = typeof ClosedPosition.Type;

export const ClosedPositionsResponse = Schema.Struct({
  positions: Schema.Array(ClosedPosition),
  tradesCount: Schema.optional(Schema.Number),
  totalTrades: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
});

export type ClosedPositionsResponse = typeof ClosedPositionsResponse.Type;

// --- Freqtrade instances (multi-bot support) ---------------------------------

export const FreqtradeInstanceId = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand("FreqtradeInstanceId"),
);

export type FreqtradeInstanceId = typeof FreqtradeInstanceId.Type;

export const FreqtradeInstance = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  baseUrl: Schema.String,
  username: Schema.String,
  /** Never expose the password — only whether one is stored. */
  hasPassword: Schema.Boolean,
  /**
   * Custom per-instance color (`#rrggbb`, lowercase). Absent = the UI's
   * automatic list-position assignment — the same hue everywhere the
   * instance's data appears.
   */
  color: Schema.optional(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type FreqtradeInstance = typeof FreqtradeInstance.Type;

export const ListInstancesResponse = Schema.Struct({
  instances: Schema.Array(FreqtradeInstance),
});

export type ListInstancesResponse = typeof ListInstancesResponse.Type;

export const CreateInstanceRequest = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)),
  baseUrl: Schema.String.pipe(Schema.minLength(1)),
  username: Schema.String,
  password: Schema.String,
  color: Schema.optional(Schema.String),
});

export type CreateInstanceRequest = typeof CreateInstanceRequest.Type;

export const CreateInstanceResponse = Schema.Struct({
  instance: FreqtradeInstance,
});

export type CreateInstanceResponse = typeof CreateInstanceResponse.Type;

export const UpdateInstanceRequest = Schema.Struct({
  name: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  baseUrl: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  username: Schema.optional(Schema.String),
  /** Omitted/empty = keep the stored password. */
  password: Schema.optional(Schema.String),
  /** Omitted = keep; null = back to automatic; string = custom `#rrggbb`. */
  color: Schema.optional(Schema.NullOr(Schema.String)),
});

export type UpdateInstanceRequest = typeof UpdateInstanceRequest.Type;

export const UpdateInstanceResponse = Schema.Struct({
  instance: FreqtradeInstance,
});

export type UpdateInstanceResponse = typeof UpdateInstanceResponse.Type;

export const DeleteInstanceResponse = Schema.Struct({
  id: Schema.String,
});

export type DeleteInstanceResponse = typeof DeleteInstanceResponse.Type;

export const InstanceHealthResponse = Schema.Struct({
  id: Schema.String,
  reachable: Schema.Boolean,
  version: Schema.optional(Schema.String),
  state: Schema.optional(Schema.String),
  botName: Schema.optional(Schema.String),
});

export type InstanceHealthResponse = typeof InstanceHealthResponse.Type;

export const ClosedPositionsQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  offset: Schema.optional(Schema.String),
  /**
   * Free-text filter applied at the SQL level (mirror WHERE clause), so it
   * always covers the FULL trade history and `totalTrades` reports the
   * filtered total — never a windowed scan.
   */
  search: Schema.optional(Schema.String),
});

export type ClosedPositionsQuery = typeof ClosedPositionsQuery.Type;

/**
 * Server-side free-text filter for full-list reads (open positions,
 * whitelists, blacklists): same SQL WHERE pushdown as
 * `ClosedPositionsQuery.search`.
 */
export const SearchQuery = Schema.Struct({
  search: Schema.optional(Schema.String),
});

export type SearchQuery = typeof SearchQuery.Type;

/**
 * Query for the open-position tables: free-text search plus SQL-level
 * ordering/selection so consumers (e.g. market movers) get exactly their
 * window from the database instead of filtering a fetched array.
 */
export const OpenPositionsQuery = Schema.Struct({
  search: Schema.optional(Schema.String),
  /** Sort key: absent keeps the source order (open date desc). */
  sort: Schema.optional(Schema.Literal("profitPct")),
  dir: Schema.optional(Schema.Literal("asc", "desc")),
  /** SQL LIMIT after sort/filter. */
  limit: Schema.optional(Schema.String),
  /** Sign partition: gainers (profit >= 0), losers (< 0), or both. */
  filter: Schema.optional(Schema.Literal("gain", "loss")),
});

export type OpenPositionsQuery = typeof OpenPositionsQuery.Type;

/** Snapshot-history window size, shared by the fleet balance-history reads. */
/**
 * Time bucket for aggregated balance-history reads: one point per bucket
 * carrying the LAST sample inside it (a balance is a level, not a flow) —
 * daily/weekly curves span weeks of per-minute snapshots.
 */
export const BalanceHistoryBucket = Schema.Literal("6h", "day", "week");

export type BalanceHistoryBucket = typeof BalanceHistoryBucket.Type;

export const BalanceHistoryQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  /** Aggregation bucket; absent = raw newest samples (no aggregation). */
  bucket: Schema.optional(BalanceHistoryBucket),
  /**
   * Fleet reads: restrict the response to ONE instance (SQL WHERE) instead
   * of every instance's history — the widget's instance picker selects the
   * slice server-side.
   */
  id: Schema.optional(Schema.String),
});

export type BalanceHistoryQuery = typeof BalanceHistoryQuery.Type;

// --- Trade tape (newest opens + closes as one SQL-ordered feed) --------------

/** One tape event: a position opening or closing, newest-first. */
export const TapeEvent = Schema.Struct({
  kind: Schema.Literal("open", "close"),
  tradeId: Schema.Number,
  pair: Schema.String,
  /** ISO-UTC event time (open_date for opens, close_date for closes). */
  at: Schema.String,
  isShort: Schema.optional(Schema.Boolean),
  openRate: Schema.optional(Schema.Number),
  enterTag: Schema.optional(Schema.String),
  exitReason: Schema.optional(Schema.String),
  /** Close profit in stake currency (closes only). */
  profitAbs: Schema.optional(Schema.Number),
  /** Fleet reads carry the owning instance. */
  instanceId: Schema.optional(Schema.String),
  instanceName: Schema.optional(Schema.String),
});

export type TapeEvent = typeof TapeEvent.Type;

export const TapeResponse = Schema.Struct({
  events: Schema.Array(TapeEvent),
});

export type TapeResponse = typeof TapeResponse.Type;

export const TapeQuery = Schema.Struct({
  /** Max events returned (SQL LIMIT over the merged feed). */
  limit: Schema.optional(Schema.String),
  opens: Schema.optional(Schema.String),
  closes: Schema.optional(Schema.String),
});

export type TapeQuery = typeof TapeQuery.Type;

// --- Pair watch (tracked pairs joined with live + last-closed state) ---------

/** One tracked pair: its live open position (if any) + last closed result. */
export const PairWatchRow = Schema.Struct({
  pair: Schema.String,
  open: Schema.optional(OpenPosition),
  /** Most recent close for the pair (any instance on fleet reads). */
  lastPct: Schema.optional(Schema.Number),
  lastProfit: Schema.optional(Schema.Number),
  lastCloseDate: Schema.optional(Schema.String),
  /** Fleet reads attribute the open position to its instance. */
  instanceId: Schema.optional(Schema.String),
  instanceName: Schema.optional(Schema.String),
});

export type PairWatchRow = typeof PairWatchRow.Type;

export const PairWatchResponse = Schema.Struct({
  rows: Schema.Array(PairWatchRow),
});

export type PairWatchResponse = typeof PairWatchResponse.Type;

export const PairWatchQuery = Schema.Struct({
  /** Comma-separated pair list (SQL `pair IN (...)`, up to 32). */
  pairs: Schema.optional(Schema.String),
  showOnlyOpen: Schema.optional(Schema.String),
});

export type PairWatchQuery = typeof PairWatchQuery.Type;

// --- NFI trade performance (aggregated closed-trade stats per dimension) -----

/**
 * Aggregation dimension over the closed-trade mirror, computed as one SQL
 * GROUP BY: enter/exit tags, trading pair, or strategy.
 */
export const TagGroupBy = Schema.Literal("enter", "exit", "pair", "strategy");

export type TagGroupBy = typeof TagGroupBy.Type;

export const TagPerformanceRow = Schema.Struct({
  /**
   * Dimension value: trimmed tag (`enter_tag` for `enter`, `exit_reason`
   * for `exit`), the pair, or the strategy name.
   */
  tag: Schema.String,
  trades: Schema.Number,
  wins: Schema.Number,
  losses: Schema.Number,
  /** Wins / trades (0 when no trades). */
  winrate: Schema.Number,
  /** Sum of close profit in stake currency. */
  profitAbs: Schema.Number,
  /** Mean of close profit percent. */
  profitPctAvg: Schema.Number,
  /** Set on fleet strategy breakdowns: one row per strategy per instance. */
  instanceId: Schema.optional(Schema.String),
  instanceName: Schema.optional(Schema.String),
});

export type TagPerformanceRow = typeof TagPerformanceRow.Type;

/**
 * Full-set scalars for grouped reads — one SQL aggregate over EVERY closed
 * trade matching the same WHERE, so footer sums never stop at the grouped
 * rows' LIMIT.
 */
export const AggregateTotals = Schema.Struct({
  trades: Schema.Number,
  wins: Schema.Number,
  losses: Schema.Number,
  /** Wins / trades (0 when no trades). */
  winrate: Schema.Number,
  /** Σ close profit in stake currency (absolute variant only). */
  profitAbs: Schema.Number,
  /** Mean close profit percent over the full matching set. */
  profitPctAvg: Schema.Number,
});

export type AggregateTotals = typeof AggregateTotals.Type;

/** One-dimensional extreme: the best (or worst) dimension value + metric. */
export const AggregateExtreme = Schema.Struct({
  tag: Schema.String,
  value: Schema.Number,
});

export type AggregateExtreme = typeof AggregateExtreme.Type;

/**
 * Percentages-only stats (relative variant of `AggregateTotals`) — no
 * absolute profit, so the shareable tag reads keep their guarantees.
 * Named `stats` like the other relative footers: "totals" reads
 * amount-shaped to the sensitivity audit.
 */
export const RelativeTagStats = Schema.Struct({
  trades: Schema.Number,
  wins: Schema.Number,
  losses: Schema.Number,
  winrate: Schema.Number,
  profitPctAvg: Schema.Number,
  /** Best avg-% dimension value behind a min-trades gate (SQL). */
  bestEdge: Schema.optional(AggregateExtreme),
});

export type RelativeTagStats = typeof RelativeTagStats.Type;

export const TagPerformanceResponse = Schema.Struct({
  groupBy: TagGroupBy,
  rows: Schema.Array(TagPerformanceRow),
  /** Closed trades actually aggregated (the full matching mirror set). */
  aggregatedTrades: Schema.Number,
  totalTrades: Schema.optional(Schema.Number),
  /**
   * Full-set scalars over EVERY matching closed trade (SQL, same WHERE —
   * immune to the row LIMIT): footer sums computed server-side.
   */
  totals: Schema.optional(AggregateTotals),
  /** Highest-profit dimension value (HAVING-aware, SQL ORDER BY … LIMIT 1). */
  best: Schema.optional(AggregateExtreme),
  /** Lowest-profit dimension value (HAVING-aware). */
  worst: Schema.optional(AggregateExtreme),
});

export type TagPerformanceResponse = typeof TagPerformanceResponse.Type;

export const TagPerformanceQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  groupBy: Schema.optional(Schema.String),
  /**
   * SQL HAVING: only dimensions with at least this many closed trades.
   * Pushed down so grouping always covers the FULL history.
   */
  minTrades: Schema.optional(Schema.String),
  /** SQL ORDER BY key for the grouped rows (best-first by default). */
  sortBy: Schema.optional(Schema.String),
  sortDir: Schema.optional(Schema.Literal("asc", "desc")),
  /**
   * Best-edge gate (relative reads): the `bestEdge` row only counts
   * dimensions with at least this many closed trades. Default 3.
   */
  bestEdgeMinTrades: Schema.optional(Schema.String),
});

export type TagPerformanceQuery = typeof TagPerformanceQuery.Type;

// --- Server-computed metrics (SQL aggregates over the FULL mirror) -----------
//
// One capability family per headline metric block. Every number below is
// computed by the database over the ENTIRE dataset — the frontend renders
// them verbatim and never aggregates loaded windows client-side (a fetched
// window cannot answer "what is my all-time profit factor").

/** Restrict a metric read to one instance; absent = fleet (all instances). */
export const MetricInstanceQuery = Schema.Struct({
  id: Schema.optional(Schema.String),
});

export type MetricInstanceQuery = typeof MetricInstanceQuery.Type;

/**
 * Headline closed-trade metrics: one SQL aggregate over every closed trade
 * in scope. `profitFactor` is `grossWin / grossLoss`, reported as 0 when
 * `grossLoss` is 0 — callers show ∞ when `grossLoss === 0 && wins > 0`
 * (JSON cannot carry Infinity).
 */
export const PerformanceStatsResponse = Schema.Struct({
  trades: Schema.Number,
  wins: Schema.Number,
  losses: Schema.Number,
  grossWin: Schema.Number,
  grossLoss: Schema.Number,
  net: Schema.Number,
  /** 0..100. */
  winrate: Schema.Number,
  profitFactor: Schema.Number,
  /** net / trades. */
  expectancy: Schema.Number,
  avgWin: Schema.Number,
  avgLoss: Schema.Number,
  /** Best / worst single trade in stake currency. */
  best: Schema.Number,
  worst: Schema.Number,
});

export type PerformanceStatsResponse = typeof PerformanceStatsResponse.Type;

export const PerformanceStatsQuery = MetricInstanceQuery;

export type PerformanceStatsQuery = typeof MetricInstanceQuery.Type;

/** One point of the underwater curve (drawdown percent below running peak). */
export const DrawdownPoint = Schema.Struct({
  recordedAt: Schema.String,
  /** Percent below the running peak (<= 0; 0 while the peak is not positive). */
  drawdown: Schema.Number,
});

export type DrawdownPoint = typeof DrawdownPoint.Type;

/**
 * Underwater curve + scalars computed in SQL over the FULL snapshot
 * history (running peak = window MAX): a small curve `limit` trims the
 * chart, never the metrics.
 */
export const DrawdownResponse = Schema.Struct({
  points: Schema.Array(DrawdownPoint),
  /** Deepest drawdown over the full history (percent, <= 0). */
  maxDrawdown: Schema.Number,
  /** Newest point's drawdown (percent, <= 0; 0 with no history). */
  currentDrawdown: Schema.Number,
  /** All-time equity peak (profit high-water mark). */
  peakValue: Schema.Number,
});

export type DrawdownResponse = typeof DrawdownResponse.Type;

export const DrawdownQuery = Schema.Struct({
  id: Schema.optional(Schema.String),
  /** Newest N curve points returned (scalars always cover all history). */
  limit: Schema.optional(Schema.String),
});

export type DrawdownQuery = typeof DrawdownQuery.Type;

/** One cumulative-profit point: SQL running sum up to and including the trade. */
export const CumulativeProfitPoint = Schema.Struct({
  /** Close time (ISO). */
  at: Schema.String,
  /** This trade's close profit. */
  profit: Schema.Number,
  /** Running sum over the FULL closed history at this trade. */
  cumulative: Schema.Number,
});

export type CumulativeProfitPoint = typeof CumulativeProfitPoint.Type;

/** One instance's cumulative series (fleet reads carry one per instance). */
export const CumulativeProfitSeries = Schema.Struct({
  instanceId: Schema.optional(Schema.String),
  instanceName: Schema.optional(Schema.String),
  points: Schema.Array(CumulativeProfitPoint),
  /** Final running sum over the instance's FULL closed history. */
  totalProfit: Schema.Number,
  /** Closed trades in the full history for this series. */
  trades: Schema.Number,
});

export type CumulativeProfitSeries = typeof CumulativeProfitSeries.Type;

export const CumulativeProfitResponse = Schema.Struct({
  series: Schema.Array(CumulativeProfitSeries),
});

export type CumulativeProfitResponse = typeof CumulativeProfitResponse.Type;

export const CumulativeProfitQuery = Schema.Struct({
  id: Schema.optional(Schema.String),
  /** Newest N points kept per series (running sums stay full-history). */
  limit: Schema.optional(Schema.String),
});

export type CumulativeProfitQuery = typeof CumulativeProfitQuery.Type;

/** Open-book guardrail metrics — one SQL aggregate over the open mirror. */
export const OpenRiskSummary = Schema.Struct({
  positions: Schema.Number,
  deployed: Schema.Number,
  unrealized: Schema.Number,
  maxLeverage: Schema.Number,
  longs: Schema.Number,
  shorts: Schema.Number,
  largestStake: Schema.Number,
  pairs: Schema.Number,
});

export type OpenRiskSummary = typeof OpenRiskSummary.Type;

/** Per-pair open allocation: stake sum + its share of deployed (0..1, SQL). */
export const ExposurePairRow = Schema.Struct({
  pair: Schema.String,
  positions: Schema.Number,
  stake: Schema.Number,
  unrealized: Schema.Number,
  share: Schema.Number,
});

export type ExposurePairRow = typeof ExposurePairRow.Type;

export const ExposureResponse = Schema.Struct({
  summary: OpenRiskSummary,
  rows: Schema.Array(ExposurePairRow),
});

export type ExposureResponse = typeof ExposureResponse.Type;

export const ExposureQuery = MetricInstanceQuery;

export type ExposureQuery = typeof MetricInstanceQuery.Type;

// --- Traded pairs (every pair with trade history, SQL over the mirror) -------

/** One pair the scope actually traded — open or closed, full history. */
export const TradedPairRow = Schema.Struct({
  pair: Schema.String,
  /** Open + closed trades on the pair. */
  trades: Schema.Number,
  openTrades: Schema.Number,
  closedTrades: Schema.Number,
  /** Most recent trade event (ISO; close date for closes, else open date). */
  lastAt: Schema.String,
});

export type TradedPairRow = typeof TradedPairRow.Type;

export const TradedPairsResponse = Schema.Struct({
  /** Most recently active first. */
  pairs: Schema.Array(TradedPairRow),
  /** Row count (distinct traded pairs). */
  length: Schema.Number,
});

export type TradedPairsResponse = typeof TradedPairsResponse.Type;

export const TradedPairsQuery = MetricInstanceQuery;

export type TradedPairsQuery = typeof MetricInstanceQuery.Type;

// --- Market / candle data (OHLCV, normalized by the backend) -----------------

export const Candle = Schema.Struct({
  /** Candle open time as unix milliseconds. */
  time: Schema.Number,
  open: Schema.Number,
  high: Schema.Number,
  low: Schema.Number,
  close: Schema.Number,
  volume: Schema.Number,
});

export type Candle = typeof Candle.Type;

export const CandlesResponse = Schema.Struct({
  pair: Schema.String,
  timeframe: Schema.String,
  candles: Schema.Array(Candle),
  /**
   * Where the candles came from: `analyzed` is freqtrade's `pair_candles`
   * (only the strategy timeframe has data); `exchange` is the public
   * exchange market-data fallback the backend serves for timeframes the
   * bot never analyzed. Absent on old snapshots — read as `analyzed`.
   */
  source: Schema.optional(Schema.Literal("analyzed", "exchange")),
});

export type CandlesResponse = typeof CandlesResponse.Type;

export const CandlesQuery = Schema.Struct({
  /** e.g. `BTC/USDT` (URL-encoded by the client). */
  pair: Schema.String.pipe(Schema.minLength(1)),
  /** Freqtrade timeframe, e.g. `5m`, `1h`, `1d`. Defaults to `15m`. */
  timeframe: Schema.optional(Schema.String),
  /** Last N candles. Defaults to 200, capped server-side. */
  limit: Schema.optional(Schema.String),
  /**
   * History paging (epoch MILLIS): return candles strictly OLDER than this
   * instant from the exchange's public klines, instead of the newest
   * window. Powers the charts' infinite scroll; exchanges without a
   * public fallback fail the call (history exhausted).
   */
  before: Schema.optional(Schema.String),
});

export type CandlesQuery = typeof CandlesQuery.Type;

export const AvailablePairsResponse = Schema.Struct({
  pairs: Schema.Array(Schema.String),
  length: Schema.optional(Schema.Number),
  stakeCurrency: Schema.optional(Schema.String),
});

export type AvailablePairsResponse = typeof AvailablePairsResponse.Type;

export const AvailablePairsQuery = Schema.Struct({
  timeframe: Schema.optional(Schema.String),
  stakeCurrency: Schema.optional(Schema.String),
});

export type AvailablePairsQuery = typeof AvailablePairsQuery.Type;

/**
 * Strategy indicator metadata from freqtrade `plot_config`: overlay names
 * for the main (price) pane plus named subplots. Values are computed
 * client-side from OHLCV (see `indicators.ts` in the web shell); this only
 * tells the chart which strategy indicators exist.
 */
export const PlotConfigResponse = Schema.Struct({
  strategy: Schema.optional(Schema.String),
  /** Indicator/overlay names for the main price pane (e.g. `sma`, `buy_tag`). */
  mainPlot: Schema.Array(Schema.String),
  /** Subplot name -> indicator names (e.g. `RSI` -> [`rsi`]). */
  subplots: Schema.Record({
    key: Schema.String,
    value: Schema.Array(Schema.String),
  }),
});

export type PlotConfigResponse = typeof PlotConfigResponse.Type;

export const PlotConfigQuery = Schema.Struct({
  strategy: Schema.optional(Schema.String),
});

export type PlotConfigQuery = typeof PlotConfigQuery.Type;

export const BotConfigSummary = Schema.Struct({
  strategy: Schema.optional(Schema.String),
  exchange: Schema.optional(Schema.String),
  stakeCurrency: Schema.optional(Schema.String),
  stakeAmount: Schema.optional(Schema.Unknown),
  maxOpenTrades: Schema.optional(Schema.Unknown),
  dryRun: Schema.optional(Schema.Boolean),
  tradingMode: Schema.optional(Schema.String),
  /**
   * Strategy timeframe (e.g. `"5m"`, from `GET /strategy/<name>`): the only
   * timeframe guaranteed to have live `pair_candles`. Candle widgets use it
   * to explain (and recover from) empty unanalyzed timeframes. Absent when
   * the strategy endpoint is unreachable — never fails the config read.
   */
  timeframe: Schema.optional(Schema.String),
});

export type BotConfigSummary = typeof BotConfigSummary.Type;

// --- Instance extras: pair locks, whitelist/blacklist, trade capacity ---------

/** Freqtrade pair lock (`GET /api/v1/locks`) — a pair temporarily not traded. */
export const PairLock = Schema.Struct({
  id: Schema.Number,
  pair: Schema.String,
  lockTime: Schema.String,
  lockEndTime: Schema.String,
  reason: Schema.String,
  active: Schema.Boolean,
  side: Schema.optional(Schema.String),
});

export type PairLock = typeof PairLock.Type;

export const LocksResponse = Schema.Struct({
  locks: Schema.Array(PairLock),
  /** Locks on record including expired ones (the unfiltered SQL COUNT). */
  countOnRecord: Schema.optional(Schema.Number),
});

export type LocksResponse = typeof LocksResponse.Type;

/**
 * Pair-lock read: `includeExpired` is the SQL WHERE — expired locks live in
 * the mirror but stay out of the response unless asked for.
 */
export const LocksQuery = Schema.Struct({
  includeExpired: Schema.optional(Schema.String),
});

export type LocksQuery = typeof LocksQuery.Type;

export const BlacklistedPair = Schema.Struct({
  pair: Schema.String,
  reason: Schema.optional(Schema.String),
});

export type BlacklistedPair = typeof BlacklistedPair.Type;

export const BlacklistResponse = Schema.Struct({
  pairs: Schema.Array(BlacklistedPair),
  /** Total blacklist length as reported by freqtrade (may exceed `pairs`). */
  length: Schema.Number,
});

export type BlacklistResponse = typeof BlacklistResponse.Type;

export const WhitelistResponse = Schema.Struct({
  pairs: Schema.Array(Schema.String),
  length: Schema.Number,
});

export type WhitelistResponse = typeof WhitelistResponse.Type;

/** One instance's pair lock, tagged with its source instance (fleet views). */
export const TaggedPairLock = Schema.Struct({
  ...PairLock.fields,
  instanceId: Schema.String,
  instanceName: Schema.String,
});

export type TaggedPairLock = typeof TaggedPairLock.Type;

export const FleetLocksResponse = Schema.Struct({
  locks: Schema.Array(TaggedPairLock),
  /** Locks on record including expired ones (the unfiltered SQL COUNT). */
  countOnRecord: Schema.optional(Schema.Number),
});

export type FleetLocksResponse = typeof FleetLocksResponse.Type;

/** One instance's blacklist entry, tagged with its source instance. */
export const TaggedBlacklistedPair = Schema.Struct({
  ...BlacklistedPair.fields,
  instanceId: Schema.String,
  instanceName: Schema.String,
});

export type TaggedBlacklistedPair = typeof TaggedBlacklistedPair.Type;

export const FleetBlacklistResponse = Schema.Struct({
  pairs: Schema.Array(TaggedBlacklistedPair),
  length: Schema.Number,
});

export type FleetBlacklistResponse = typeof FleetBlacklistResponse.Type;

/** One instance's whitelist inside the fleet response. */
export const FleetWhitelistInstance = Schema.Struct({
  instanceId: Schema.String,
  instanceName: Schema.String,
  pairs: Schema.Array(Schema.String),
  length: Schema.Number,
});

export type FleetWhitelistInstance = typeof FleetWhitelistInstance.Type;

export const FleetWhitelistResponse = Schema.Struct({
  instances: Schema.Array(FleetWhitelistInstance),
  /** Union of every instance's whitelist, sorted. */
  pairs: Schema.Array(Schema.String),
  length: Schema.Number,
});

export type FleetWhitelistResponse = typeof FleetWhitelistResponse.Type;

/** Open-trade capacity (`GET /api/v1/count`). `max` is null when unlimited. */
export const TradeCountResponse = Schema.Struct({
  current: Schema.Number,
  max: Schema.optional(Schema.Number),
});

export type TradeCountResponse = typeof TradeCountResponse.Type;

// --- Profit buckets (daily / weekly / monthly, `GET /api/v1/{daily,…}`) -------

export const ProfitBucketKind = Schema.Literal("daily", "weekly", "monthly");

export type ProfitBucketKind = typeof ProfitBucketKind.Type;

export const ProfitBucket = Schema.Struct({
  /** Bucket start date (freqtrade `YYYY-MM-DD`). */
  date: Schema.String,
  /** Absolute profit in stake currency. */
  profitAbs: Schema.Number,
  /** Relative profit as a fraction (0.01 = 1%). */
  profitRel: Schema.Number,
  profitFiat: Schema.Number,
  trades: Schema.Number,
});

export type ProfitBucket = typeof ProfitBucket.Type;

/** Window totals for a bucket series — computed server-side over the buckets. */
export const ProfitBucketTotals = Schema.Struct({
  profitAbs: Schema.Number,
  trades: Schema.Number,
  bestProfitAbs: Schema.Number,
  worstProfitAbs: Schema.Number,
});

export type ProfitBucketTotals = typeof ProfitBucketTotals.Type;

export const ProfitBucketsResponse = Schema.Struct({
  bucket: ProfitBucketKind,
  buckets: Schema.Array(ProfitBucket),
  /** Σ profit / trades + best & worst bucket, computed by the backend. */
  totals: Schema.optional(ProfitBucketTotals),
});

export type ProfitBucketsResponse = typeof ProfitBucketsResponse.Type;

export const ProfitDailyQuery = Schema.Struct({
  bucket: Schema.optional(Schema.String),
  /** Timescale (number of buckets). Default 30, capped server-side. */
  days: Schema.optional(Schema.String),
});

export type ProfitDailyQuery = typeof ProfitDailyQuery.Type;

// --- Fleet (all configured instances at once) ---------------------------------

export const FleetInstanceSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  reachable: Schema.Boolean,
  version: Schema.optional(Schema.String),
  /** Bot state from `show_config` (`running`, `stopped`, …). */
  state: Schema.optional(Schema.String),
  strategy: Schema.optional(Schema.String),
  /** Strategy implementation version (same source as `BotStatus.strategyVersion`). */
  strategyVersion: Schema.optional(Schema.String),
  dryRun: Schema.optional(Schema.Boolean),
  openCount: Schema.optional(Schema.Number),
  maxOpenTrades: Schema.optional(Schema.Number),
  profitClosedCoin: Schema.optional(Schema.Number),
  profitAllCoin: Schema.optional(Schema.Number),
  profitClosedPercent: Schema.optional(Schema.Number),
  profitAllPercent: Schema.optional(Schema.Number),
  closedTradeCount: Schema.optional(Schema.Number),
  tradeCount: Schema.optional(Schema.Number),
  /** Unrealized P&L across the instance's open trades (stake currency). */
  openProfitCoin: Schema.optional(Schema.Number),
  wins: Schema.optional(Schema.Number),
  losses: Schema.optional(Schema.Number),
  totalStake: Schema.optional(Schema.Number),
  stakeCurrency: Schema.optional(Schema.String),
  /** Per-instance fetch failure — the rest of the fleet still resolves. */
  error: Schema.optional(Schema.String),
});

export type FleetInstanceSummary = typeof FleetInstanceSummary.Type;

export const FleetOverviewResponse = Schema.Struct({
  instances: Schema.Array(FleetInstanceSummary),
  totals: Schema.Struct({
    instanceCount: Schema.Number,
    reachableCount: Schema.Number,
    openCount: Schema.Number,
    profitClosedCoin: Schema.Number,
    profitAllCoin: Schema.Number,
    openProfitCoin: Schema.Number,
    wins: Schema.Number,
    losses: Schema.Number,
    totalStake: Schema.Number,
    stakeCurrency: Schema.optional(Schema.String),
    /** Closed trades across the fleet (server-side sum; absent on old data). */
    closedTradeCount: Schema.optional(Schema.Number),
    /** Trades (open + closed) across the fleet (server-side sum). */
    tradeCount: Schema.optional(Schema.Number),
  }),
});

export type FleetOverviewResponse = typeof FleetOverviewResponse.Type;

/** One instance's open position, tagged with the instance it came from. */
export const TaggedOpenPosition = Schema.Struct({
  ...OpenPosition.fields,
  instanceId: Schema.String,
  instanceName: Schema.String,
});

export type TaggedOpenPosition = typeof TaggedOpenPosition.Type;

export const FleetOpenPositionsResponse = Schema.Struct({
  positions: Schema.Array(TaggedOpenPosition),
});

export type FleetOpenPositionsResponse = typeof FleetOpenPositionsResponse.Type;

/** One instance's closed position, tagged with the instance it came from. */
export const TaggedClosedPosition = Schema.Struct({
  ...ClosedPosition.fields,
  instanceId: Schema.String,
  instanceName: Schema.String,
});

export type TaggedClosedPosition = typeof TaggedClosedPosition.Type;

export const FleetClosedPositionsResponse = Schema.Struct({
  positions: Schema.Array(TaggedClosedPosition),
  tradesCount: Schema.optional(Schema.Number),
  /** Closed trades on record across the fleet (drives load-more in the UI). */
  totalTrades: Schema.optional(Schema.Number),
});

export type FleetClosedPositionsResponse =
  typeof FleetClosedPositionsResponse.Type;

// --- Persisted history (recorded by the backend into sqlite) ---

export const ProfitPoint = Schema.Struct({
  recordedAt: Schema.String,
  profitClosedCoin: Schema.Number,
  profitAllCoin: Schema.Number,
  tradeCount: Schema.Number,
  stakeCurrency: Schema.String,
});

export type ProfitPoint = typeof ProfitPoint.Type;

export const ProfitHistoryResponse = Schema.Struct({
  points: Schema.Array(ProfitPoint),
});

export type ProfitHistoryResponse = typeof ProfitHistoryResponse.Type;

export const BalancePoint = Schema.Struct({
  recordedAt: Schema.String,
  totalStake: Schema.Number,
  stakeCurrency: Schema.String,
});

export type BalancePoint = typeof BalancePoint.Type;

export const BalanceHistoryResponse = Schema.Struct({
  points: Schema.Array(BalancePoint),
});

export type BalanceHistoryResponse = typeof BalanceHistoryResponse.Type;

/** One instance's wallet history inside the fleet balance-history response. */
export const FleetBalanceInstance = Schema.Struct({
  instanceId: Schema.String,
  instanceName: Schema.String,
  points: Schema.Array(BalancePoint),
  /** Wallet value when the bot started trading (dashed reference line). */
  startingCapital: Schema.optional(Schema.Number),
  stakeCurrency: Schema.optional(Schema.String),
  /** Per-instance fetch failure — the rest of the fleet still resolves. */
  error: Schema.optional(Schema.String),
});

export type FleetBalanceInstance = typeof FleetBalanceInstance.Type;

export const FleetBalanceHistoryResponse = Schema.Struct({
  instances: Schema.Array(FleetBalanceInstance),
  /** Common stake currency when every instance agrees (e.g. `USDT`). */
  stakeCurrency: Schema.optional(Schema.String),
});

export type FleetBalanceHistoryResponse =
  typeof FleetBalanceHistoryResponse.Type;

// --- Macro / Fed funds rate (scraped public sources, no freqtrade) ---------------
//
// Current Federal Reserve policy stance scraped server-side from free public
// sources (no API key): the NY Fed Markets API (primary — EFFR + target
// range + SOFR/OBFR in one call) with FRED public CSVs as fallback
// (`DFF`, `DFEDTARU`, `DFEDTARL`, `SOFR`, `OBFR`). Field names stay in
// rate-domain (`rate`, `target`, `effective`, `sofr`, ...) so the default
// sensitivity policy keeps this capability non-sensitive (public macro data,
// like candles — no balances, no PnL, no stake sizes).

/** One daily observation of the effective rate + target range. */
export const FedRatePoint = Schema.Struct({
  /** Observation date (`YYYY-MM-DD`, NY Fed `effectiveDate`). */
  date: Schema.String,
  /** Effective Federal Funds Rate for the day (percent, e.g. 3.88). */
  effective: Schema.optional(Schema.Number),
  /** Lower bound of the FOMC target range (percent). */
  targetLower: Schema.optional(Schema.Number),
  /** Upper bound of the FOMC target range (percent). */
  targetUpper: Schema.optional(Schema.Number),
  /** Secured Overnight Financing Rate (percent). */
  sofr: Schema.optional(Schema.Number),
});

export type FedRatePoint = typeof FedRatePoint.Type;

/** Per-source fetch status (which upstream scrape fed this snapshot). */
export const FedRateSource = Schema.Struct({
  name: Schema.String,
  /** Link to the upstream endpoint (named `href`, not `url`, so the
   * sensitivity audit never mistakes public source links for infra
   * location — see the registry test's location-shaped-field walk). */
  href: Schema.String,
  ok: Schema.Boolean,
});

export type FedRateSource = typeof FedRateSource.Type;

export const FedRateResponse = Schema.Struct({
  /** Lower bound of the current FOMC target range (percent). */
  targetLower: Schema.Number,
  /** Upper bound of the current FOMC target range (percent). */
  targetUpper: Schema.Number,
  /** Latest Effective Federal Funds Rate (percent). */
  effective: Schema.optional(Schema.Number),
  /** Observation date of `effective` (`YYYY-MM-DD`). */
  effectiveDate: Schema.optional(Schema.String),
  /** Latest Secured Overnight Financing Rate (percent). */
  sofr: Schema.optional(Schema.Number),
  /** Latest Overnight Bank Funding Rate (percent). */
  obfr: Schema.optional(Schema.Number),
  /** Overnight volume behind the EFFR print (billions USD). */
  volumeBillions: Schema.optional(Schema.Number),
  /** Day-over-day change of the effective rate (percentage points). */
  effectiveChange: Schema.optional(Schema.Number),
  /** Recent daily history (oldest first, capped server-side). */
  history: Schema.Array(FedRatePoint),
  /** Which upstream scrapes fed this snapshot (NY Fed + FRED). */
  sources: Schema.Array(FedRateSource),
  /** Snapshot time (ISO). */
  updatedAt: Schema.String,
});

export type FedRateResponse = typeof FedRateResponse.Type;

// --- Relative (public-shareable) mirrors ------------------------------------
//
// Every schema below carries ONLY relative values: percentages, allocation
// weights (0..1) and histories rebased to an index whose first visible point
// is exactly 100. Absolute coin/fiat amounts, stake sizes, order prices and
// order amounts NEVER appear here — no matter which options a caller passes
// (any instance id, limit, offset, timeframe), the response cannot be used to
// calculate, derive or track down the underlying freqtrade absolute balance
// or absolute PnL. Currency *codes* (e.g. `USDT`) and trade *counts* are kept:
// they name units, not scale.
//
// The transforms live in `@nfi/capabilities` (`relative.ts`, pure functions)
// and are unit-tested to contain no absolute fields; the `.relative`
// capabilities serve these DTOs over dedicated endpoints + the live stream.

export const RelativeCurrencyWeight = Schema.Struct({
  currency: Schema.String,
  /** Share of total stake (0..1); sums to ~1 across `currencies`. */
  weight: Schema.Number,
  freeWeight: Schema.Number,
  usedWeight: Schema.Number,
});

export type RelativeCurrencyWeight = typeof RelativeCurrencyWeight.Type;

export const RelativeBalance = Schema.Struct({
  stakeCurrency: Schema.String,
  currencies: Schema.Array(RelativeCurrencyWeight),
});

export type RelativeBalance = typeof RelativeBalance.Type;

export const RelativeProfit = Schema.Struct({
  /** Percent fields only — never coin/fiat absolutes. */
  profitClosedPercent: Schema.Number,
  profitAllPercent: Schema.Number,
  tradeCount: Schema.Number,
  closedTradeCount: Schema.Number,
  stakeCurrency: Schema.String,
  fiatCurrency: Schema.String,
});

export type RelativeProfit = typeof RelativeProfit.Type;

export const RelativeTrade = Schema.Struct({
  tradeId: Schema.Number,
  pair: Schema.String,
  isOpen: Schema.Boolean,
  profitPct: Schema.optional(Schema.Number),
  openDate: Schema.String,
  strategy: Schema.optional(Schema.String),
  timeframe: Schema.optional(Schema.String),
});

export type RelativeTrade = typeof RelativeTrade.Type;

export const RelativeTradesResponse = Schema.Struct({
  trades: Schema.Array(RelativeTrade),
});

export type RelativeTradesResponse = typeof RelativeTradesResponse.Type;

export const RelativeProfitPoint = Schema.Struct({
  recordedAt: Schema.String,
  /** Rebased index: the first point of the returned window is exactly 100. */
  profitClosedIndex: Schema.Number,
  profitAllIndex: Schema.Number,
});

export type RelativeProfitPoint = typeof RelativeProfitPoint.Type;

export const RelativeProfitHistoryResponse = Schema.Struct({
  points: Schema.Array(RelativeProfitPoint),
});

export type RelativeProfitHistoryResponse =
  typeof RelativeProfitHistoryResponse.Type;

/** One instance's rebased profit index inside the fleet relative response. */
export const RelativeFleetProfitInstance = Schema.Struct({
  instanceId: Schema.String,
  instanceName: Schema.String,
  points: Schema.Array(RelativeProfitPoint),
  /** Per-instance fetch failure — the rest of the fleet still resolves. */
  error: Schema.optional(Schema.String),
});

export type RelativeFleetProfitInstance =
  typeof RelativeFleetProfitInstance.Type;

export const RelativeFleetProfitHistoryResponse = Schema.Struct({
  instances: Schema.Array(RelativeFleetProfitInstance),
});

export type RelativeFleetProfitHistoryResponse =
  typeof RelativeFleetProfitHistoryResponse.Type;

export const RelativeBalancePoint = Schema.Struct({
  recordedAt: Schema.String,
  /** Rebased index: the first point of the returned window is exactly 100. */
  balanceIndex: Schema.Number,
});

export type RelativeBalancePoint = typeof RelativeBalancePoint.Type;

export const RelativeBalanceHistoryResponse = Schema.Struct({
  points: Schema.Array(RelativeBalancePoint),
});

export type RelativeBalanceHistoryResponse =
  typeof RelativeBalanceHistoryResponse.Type;

/** One instance's rebased wallet history inside the fleet relative response. */
export const RelativeFleetBalanceInstance = Schema.Struct({
  instanceId: Schema.String,
  instanceName: Schema.String,
  points: Schema.Array(RelativeBalancePoint),
  error: Schema.optional(Schema.String),
});

export type RelativeFleetBalanceInstance =
  typeof RelativeFleetBalanceInstance.Type;

export const RelativeFleetBalanceHistoryResponse = Schema.Struct({
  instances: Schema.Array(RelativeFleetBalanceInstance),
});

export type RelativeFleetBalanceHistoryResponse =
  typeof RelativeFleetBalanceHistoryResponse.Type;

/** Sub-order with all absolute fields (price/amount/cost) stripped. */
export const RelativeOrder = Schema.Struct({
  side: Schema.String,
  status: Schema.optional(Schema.String),
  isEntry: Schema.optional(Schema.Boolean),
  tag: Schema.optional(Schema.String),
});

export type RelativeOrder = typeof RelativeOrder.Type;

export const RelativeOpenPosition = Schema.Struct({
  tradeId: Schema.Number,
  pair: Schema.String,
  isOpen: Schema.Boolean,
  isShort: Schema.optional(Schema.Boolean),
  /** Profit in percent — never an absolute amount. */
  profitPct: Schema.optional(Schema.Number),
  /** `stakeAmount / totalStake` at read time (0..1) — scale-free. */
  allocationWeight: Schema.optional(Schema.Number),
  openDate: Schema.String,
  strategy: Schema.optional(Schema.String),
  timeframe: Schema.optional(Schema.String),
  enterTag: Schema.optional(Schema.String),
  leverage: Schema.optional(Schema.Number),
  orders: Schema.optional(Schema.Array(RelativeOrder)),
});

export type RelativeOpenPosition = typeof RelativeOpenPosition.Type;

/** Percent/weight-only open-book stats (no absolute can be derived). */
export const RelativeOpenStats = Schema.Struct({
  /** Σ stakeAmount / totalStake (0..1+; the denominator stays secret). */
  deployedWeight: Schema.Number,
  /** Mean profit percent across the open book. */
  avgProfitPct: Schema.Number,
  /** Largest single-trade share of the wallet (0..1). */
  largestWeight: Schema.Number,
});

export type RelativeOpenStats = typeof RelativeOpenStats.Type;

export const RelativeOpenPositionsResponse = Schema.Struct({
  positions: Schema.Array(RelativeOpenPosition),
  /**
   * Full-book stats computed server-side (SQL over the mirror + the
   * never-exposed wallet total): deployed share, mean profit percent and
   * the largest single-trade share.
   */
  stats: Schema.optional(RelativeOpenStats),
});

export type RelativeOpenPositionsResponse =
  typeof RelativeOpenPositionsResponse.Type;

export const RelativeClosedPosition = Schema.Struct({
  tradeId: Schema.Number,
  pair: Schema.String,
  isOpen: Schema.Boolean,
  isShort: Schema.optional(Schema.Boolean),
  profitPct: Schema.optional(Schema.Number),
  closeProfitPct: Schema.optional(Schema.Number),
  openDate: Schema.String,
  closeDate: Schema.optional(Schema.String),
  tradeDurationSeconds: Schema.optional(Schema.Number),
  strategy: Schema.optional(Schema.String),
  timeframe: Schema.optional(Schema.String),
  enterTag: Schema.optional(Schema.String),
  exitReason: Schema.optional(Schema.String),
  leverage: Schema.optional(Schema.Number),
  orders: Schema.optional(Schema.Array(RelativeOrder)),
});

export type RelativeClosedPosition = typeof RelativeClosedPosition.Type;

/** Percentages-only closed-trade stats for the shareable table footer. */
export const RelativeClosedStats = Schema.Struct({
  /** Closed trades carrying a close percent (the full matching set). */
  withPnl: Schema.Number,
  wins: Schema.Number,
  /** wins / withPnl * 100 (0 when none). */
  winRatePct: Schema.Number,
  avgProfitPct: Schema.Number,
  bestPct: Schema.Number,
  worstPct: Schema.Number,
});

export type RelativeClosedStats = typeof RelativeClosedStats.Type;

export const RelativeClosedPositionsResponse = Schema.Struct({
  positions: Schema.Array(RelativeClosedPosition),
  tradesCount: Schema.optional(Schema.Number),
  totalTrades: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
  /**
   * Full-set stats computed in SQL over EVERY closed trade matching the
   * same search — win rate / avg / best / worst percent over the entire
   * history, not just the loaded page.
   */
  stats: Schema.optional(RelativeClosedStats),
});

export type RelativeClosedPositionsResponse =
  typeof RelativeClosedPositionsResponse.Type;

export const RelativeTagPerformanceRow = Schema.Struct({
  tag: Schema.String,
  trades: Schema.Number,
  wins: Schema.Number,
  losses: Schema.Number,
  /** Wins / trades (0 when no trades). */
  winrate: Schema.Number,
  /** Mean of close profit percent. No absolute profit — see `TagPerformanceRow`. */
  profitPctAvg: Schema.Number,
  /** Set on fleet strategy breakdowns: one row per strategy per instance. */
  instanceId: Schema.optional(Schema.String),
  instanceName: Schema.optional(Schema.String),
});

export type RelativeTagPerformanceRow = typeof RelativeTagPerformanceRow.Type;

export const RelativeTagPerformanceResponse = Schema.Struct({
  groupBy: TagGroupBy,
  rows: Schema.Array(RelativeTagPerformanceRow),
  aggregatedTrades: Schema.Number,
  totalTrades: Schema.optional(Schema.Number),
  /** Full-set percentages-only stats (SQL over every matching trade). */
  stats: Schema.optional(RelativeTagStats),
});

export type RelativeTagPerformanceResponse =
  typeof RelativeTagPerformanceResponse.Type;

// ---------------------------------------------------------------------------
// Declarative workspace model (App Shell <-> WorkspaceService contract)
//
// This is the ONLY thing persisted for layout: a serializable, React-free,
// Carbon-free AST describing workspace composition (splits, tab groups,
// panels) plus the panel instances (widget type + validated config payload).
// Individual React/Carbon elements are NEVER persisted — the frontend
// `WorkspaceRenderer` resolves `widgetType` through the `WidgetRegistry`
// into React components at render time.
//
// Schema versioning: `schemaVersion` is fixed at
// `CURRENT_WORKSPACE_SCHEMA_VERSION` today. Future model changes bump the
// literal and add an explicit migration at the decode boundary
// (`decodePersistedWorkspace`), never silent coercion.
// ---------------------------------------------------------------------------

/** Current version of the persisted workspace representation. Bump with migrations. */
export const CURRENT_WORKSPACE_SCHEMA_VERSION = 1 as const;

export const WorkspaceSchemaVersion = Schema.Literal(
  CURRENT_WORKSPACE_SCHEMA_VERSION,
);

export type WorkspaceSchemaVersion = typeof WorkspaceSchemaVersion.Type;

export const WorkspaceId = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand("WorkspaceId"),
);

export type WorkspaceId = typeof WorkspaceId.Type;

export const PanelId = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand("PanelId"),
);

export type PanelId = typeof PanelId.Type;

export const LayoutNodeId = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand("LayoutNodeId"),
);

export type LayoutNodeId = typeof LayoutNodeId.Type;

/** Stable widget type identifier (e.g. `development.inspector`). Never a component. */
export const WidgetType = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand("WidgetType"),
);

export type WidgetType = typeof WidgetType.Type;

export const SplitDirection = Schema.Literal("horizontal", "vertical");

export type SplitDirection = typeof SplitDirection.Type;

/**
 * LEGACY binary split node. The grid system (`GridLayoutNode`) replaced it;
 * `split` remains decodable so pre-grid persisted documents still load —
 * `migrateLegacyLayout` converts them to grids at the decode boundary and
 * every save afterwards persists a grid. New code must never create splits.
 */
export interface SplitLayoutNode {
  readonly type: "split";
  readonly id: LayoutNodeId;
  readonly direction: SplitDirection;
  /** Fraction (0..1, exclusive) of space given to `first`. Persisted. */
  readonly ratio: number;
  readonly first: LayoutNode;
  readonly second: LayoutNode;
}

export interface TabsLayoutNode {
  readonly type: "tabs";
  readonly id: LayoutNodeId;
  /** Panel ids shown as tabs in this group. */
  readonly panels: ReadonlyArray<PanelId>;
  /** Must be a member of `panels` when non-empty. */
  readonly activePanelId: PanelId | null;
}

export interface PanelLayoutNode {
  readonly type: "panel";
  readonly panelId: PanelId;
}

/**
 * One cell of a grid: places a child subtree (`tabs`, nested `grid` or a
 * bare `panel`) at a 1-based column/row with optional spans. Items must not
 * overlap and must stay inside the grid's track counts.
 */
export interface GridItemLayoutNode {
  readonly type: "item";
  readonly id: LayoutNodeId;
  /** 1-based column start. */
  readonly col: number;
  /** 1-based row start. */
  readonly row: number;
  readonly colSpan: number;
  readonly rowSpan: number;
  readonly child: LayoutNode;
}

/**
 * CSS-Grid-style layout container: `columns`/`rows` are relative track
 * fractions (`[1,2,1]` = 25%/50%/25%) and items address tracks by
 * 1-based index + span. Cells may host nested grids, enabling arbitrarily
 * deep, variably sized mosaics (split a cell = wrap its child in a 2-track
 * grid; closing panels auto-unwraps single-item grids).
 */
export interface GridLayoutNode {
  readonly type: "grid";
  readonly id: LayoutNodeId;
  readonly columns: ReadonlyArray<number>;
  readonly rows: ReadonlyArray<number>;
  readonly items: ReadonlyArray<GridItemLayoutNode>;
}

/**
 * One resizable card inside a flow container: an explicit pixel box
 * (`width` × `height`) hosting any child subtree (`tabs`, nested `grid` /
 * `flow` or a bare `panel`). Sizes persist so every tab keeps the exact
 * dimensions the user dragged it to; the renderer clamps them to the
 * child's content minimums and wraps overflowing cards onto the next row
 * (flex-wrap), so no measuring of siblings is ever needed.
 */
export interface FlowItemLayoutNode {
  readonly type: "flow-item";
  readonly id: LayoutNodeId;
  /** Desired outer width in px (persisted, clamped to content minimums). */
  readonly width: number;
  /** Desired outer height in px (persisted, clamped to content minimums). */
  readonly height: number;
  readonly child: LayoutNode;
}

/**
 * Freeform wrapping container: ordered resizable cards (`flow-item`) laid
 * out with flex-wrap and a fixed gap. Cards that do not fit the current
 * row automatically wrap onto the next one — the persisted sizes never
 * change, only the row breaks (render-only, like grid stacking). A flow
 * with a single item unwraps to its child (see `normalizeFlowLayout`).
 */
export interface FlowLayoutNode {
  readonly type: "flow";
  readonly id: LayoutNodeId;
  readonly items: ReadonlyArray<FlowItemLayoutNode>;
}

/**
 * One card inside a masonry container: a flexible height (persisted px,
 * clamped to the child's content minimums) hosting any child subtree. Width
 * is column-span driven — a card occupies `span` adjacent columns (columns
 * themselves stay uniform and stretch to fill the row), so the persisted
 * tree stays responsive: spans clamp to the live column count at render
 * time.
 */
export interface MasonryItemLayoutNode {
  readonly type: "masonry-item";
  readonly id: LayoutNodeId;
  /** Desired outer height in px (persisted, clamped to content minimums). */
  readonly height: number;
  /**
   * How many adjacent columns this card spans (persisted, ≥ 1; clamped to
   * the container's live column count when rendered).
   */
  readonly span: number;
  readonly child: LayoutNode;
}

/**
 * Column-packing container (`masonry`): ordered cards placed into the
 * currently shortest column so vertical gaps are always filled, while the
 * column count adapts to the container width. `columnWidth` is the TARGET
 * column density in px — the renderer derives the real count from the
 * container and stretches columns to fill the row. A masonry with a single
 * item unwraps to its child (see `normalizeMasonryLayout`).
 */
export interface MasonryLayoutNode {
  readonly type: "masonry";
  readonly id: LayoutNodeId;
  /** Target column width in px (persisted; actual columns adapt). */
  readonly columnWidth: number;
  readonly items: ReadonlyArray<MasonryItemLayoutNode>;
}

/**
 * One card inside an auto container: same two-number geometry as a masonry
 * item — a flexible height (persisted px, clamped to the child's content
 * minimums) and a column `span` that may be fractional (stepless pointer
 * drags persist fractions of a column, ≥ 1) — but the container packs ROWS
 * (see `AutoLayoutNode`). Every card renders its exact persisted size
 * (width = span × step − gap, height = own px); rows left-align and members
 * bottom-align, so a resize release re-renders pixel-identical.
 */
export interface AutoItemLayoutNode {
  readonly type: "auto-item";
  readonly id: LayoutNodeId;
  /** Desired outer height in px (persisted, clamped to content minimums). */
  readonly height: number;
  /**
   * Requested column span (persisted, finite ≥ 1, fractions welcome;
   * clamped to the container's live column count when packed, then possibly
   * grown by row justification).
   */
  readonly span: number;
  readonly child: LayoutNode;
}

/**
 * Row-packing container (`auto`, the bento layout): ordered cards packed
 * greedily into rows — no coordinates, no placement. Card array order IS
 * layout order (drag-to-reorder rewrites it); every card keeps its exact
 * persisted size, rows left-align (short rows leave trailing whitespace)
 * and members top-align within the row (the row advances by its tallest
 * member, so the next row slides up with no top gaps). `columnWidth` is
 * the TARGET column density in px, exactly like
 * masonry. Unlike flow/masonry, an auto keeps zero- and single-card shapes:
 * the bento mode is a page mode, and cards come and go freely (see
 * `normalizeAutoLayout`).
 */
export interface AutoLayoutNode {
  readonly type: "auto";
  readonly id: LayoutNodeId;
  /** Target column width in px (persisted; actual columns adapt). */
  readonly columnWidth: number;
  readonly items: ReadonlyArray<AutoItemLayoutNode>;
}

export type LayoutNode =
  | SplitLayoutNode
  | TabsLayoutNode
  | PanelLayoutNode
  | GridLayoutNode
  | FlowLayoutNode
  | MasonryLayoutNode
  | AutoLayoutNode;

// NOTE: struct schemas are annotated `Schema<X, any>` because branded ids
// (PanelId/WorkspaceId/…) differ between Type (branded) and Encoded (plain
// string) sides — `any` keeps the annotation honest without restating shapes.
const SplitLayoutNodeSchema: Schema.Schema<SplitLayoutNode, any> =
  Schema.Struct({
    type: Schema.Literal("split"),
    id: LayoutNodeId,
    direction: SplitDirection,
    ratio: Schema.Number.pipe(Schema.greaterThan(0), Schema.lessThan(1)),
    first: Schema.suspend((): Schema.Schema<LayoutNode> => LayoutNode),
    second: Schema.suspend((): Schema.Schema<LayoutNode> => LayoutNode),
  });

const TabsLayoutNodeSchema: Schema.Schema<TabsLayoutNode, any> = Schema.Struct({
  type: Schema.Literal("tabs"),
  id: LayoutNodeId,
  panels: Schema.Array(PanelId),
  activePanelId: Schema.NullOr(PanelId),
});

const PanelLayoutNodeSchema: Schema.Schema<PanelLayoutNode, any> =
  Schema.Struct({
    type: Schema.Literal("panel"),
    panelId: PanelId,
  });

const GridItemLayoutNodeSchema: Schema.Schema<GridItemLayoutNode, any> =
  Schema.Struct({
    type: Schema.Literal("item"),
    id: LayoutNodeId,
    col: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
    row: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
    colSpan: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
    rowSpan: Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
    child: Schema.suspend((): Schema.Schema<LayoutNode> => LayoutNode),
  });

const GridLayoutNodeSchema: Schema.Schema<GridLayoutNode, any> = Schema.Struct({
  type: Schema.Literal("grid"),
  id: LayoutNodeId,
  columns: Schema.Array(Schema.Number.pipe(Schema.greaterThan(0))),
  rows: Schema.Array(Schema.Number.pipe(Schema.greaterThan(0))),
  items: Schema.Array(GridItemLayoutNodeSchema),
});

const FlowItemLayoutNodeSchema: Schema.Schema<FlowItemLayoutNode, any> =
  Schema.Struct({
    type: Schema.Literal("flow-item"),
    id: LayoutNodeId,
    width: Schema.Number.pipe(Schema.greaterThan(0)),
    height: Schema.Number.pipe(Schema.greaterThan(0)),
    child: Schema.suspend((): Schema.Schema<LayoutNode> => LayoutNode),
  });

const FlowLayoutNodeSchema: Schema.Schema<FlowLayoutNode, any> = Schema.Struct({
  type: Schema.Literal("flow"),
  id: LayoutNodeId,
  items: Schema.Array(FlowItemLayoutNodeSchema),
});

const MasonryItemLayoutNodeSchema: Schema.Schema<MasonryItemLayoutNode, any> =
  Schema.Struct({
    type: Schema.Literal("masonry-item"),
    id: LayoutNodeId,
    height: Schema.Number.pipe(Schema.greaterThan(0)),
    // Optional on the encoded side so pre-span documents decode with the
    // default; the decoded (Type-side) tree always carries an integer ≥ 1.
    span: Schema.optionalWith(
      Schema.Number.pipe(Schema.int(), Schema.greaterThan(0)),
      { default: () => 1 },
    ),
    child: Schema.suspend((): Schema.Schema<LayoutNode> => LayoutNode),
  });

const MasonryLayoutNodeSchema: Schema.Schema<MasonryLayoutNode, any> =
  Schema.Struct({
    type: Schema.Literal("masonry"),
    id: LayoutNodeId,
    columnWidth: Schema.Number.pipe(Schema.greaterThan(0)),
    items: Schema.Array(MasonryItemLayoutNodeSchema),
  });

const AutoItemLayoutNodeSchema: Schema.Schema<AutoItemLayoutNode, any> =
  Schema.Struct({
    type: Schema.Literal("auto-item"),
    id: LayoutNodeId,
    height: Schema.Number.pipe(Schema.greaterThan(0)),
    // Same forward-compat pattern as the masonry span: optional on the
    // encoded side, always finite ≥ 1 after decode (fractions welcome —
    // stepless drags persist them; masonry stays integer-only).
    span: Schema.optionalWith(Schema.Number.pipe(Schema.greaterThan(0)), {
      default: () => 1,
    }),
    child: Schema.suspend((): Schema.Schema<LayoutNode> => LayoutNode),
  });

const AutoLayoutNodeSchema: Schema.Schema<AutoLayoutNode, any> = Schema.Struct({
  type: Schema.Literal("auto"),
  id: LayoutNodeId,
  columnWidth: Schema.Number.pipe(Schema.greaterThan(0)),
  items: Schema.Array(AutoItemLayoutNodeSchema),
});

export const LayoutNode: Schema.Schema<LayoutNode, any> = Schema.suspend(() =>
  Schema.Union(
    AutoLayoutNodeSchema,
    FlowLayoutNodeSchema,
    MasonryLayoutNodeSchema,
    GridLayoutNodeSchema,
    TabsLayoutNodeSchema,
    PanelLayoutNodeSchema,
    // Legacy pre-grid documents (see `migrateLegacyLayout`).
    SplitLayoutNodeSchema,
  ),
);

export type LayoutNodeType = typeof LayoutNode.Type;

/** A widget placed in the workspace: type + opaque validated config payload. */
export const PanelInstance = Schema.Struct({
  id: PanelId,
  widgetType: WidgetType,
  /** Validated per widget type at render time via the WidgetRegistry — never React. */
  widgetConfig: Schema.Unknown,
  /**
   * User-set tab title; absent = the widget's registry title. Tab strips
   * show this, while tooltips keep showing the widget name.
   */
  title: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
});

export type PanelInstance = typeof PanelInstance.Type;

/**
 * Manual Tetris wall block widths (panelId → column span on the wall's
 * 6-column grid), written by dragging a wall block's right edge. Exported
 * separately so the db layer can decode the persisted JSON column with the
 * exact same boundary the Workspace field uses.
 */
export const TetrisSpans = Schema.Record({
  key: Schema.String,
  value: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
});

export type TetrisSpans = typeof TetrisSpans.Type;

export const Workspace = Schema.Struct({
  id: WorkspaceId,
  name: Schema.String.pipe(Schema.minLength(1)),
  schemaVersion: WorkspaceSchemaVersion,
  /** Monotonic revision bumped on every save (optimistic-concurrency hook). */
  version: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  layout: LayoutNode,
  panels: Schema.Record({ key: Schema.String, value: PanelInstance }),
  activePanelId: Schema.NullOr(PanelId),
  /**
   * Shared Trellis layout document (opaque JSON: root/views/floating/hidden/
   * navigation as produced by `@danfessler/trellis` `getDocument()`).
   *
   * Trellis owns docking, splits, dividers and tabbing after mount — the NFI
   * `layout` tree only seeds the FIRST render (compiled via `toTrellis`).
   * Without a shared copy every browser keeps its own Trellis arrangement in
   * `localStorage` (`nfi-trellis-<page>`), so an admin arranging the dashboard
   * and hitting "Save layout for anonymous" never moves the anonymous view:
   * both stay on divergent local copies. Storing the Trellis document here
   * makes the backend the single source of truth — every visitor (including
   * signed-out/incognito via the public `page-home` load) renders the exact
   * arrangement the admin saved. Absent (older documents, fresh pages) falls
   * back to compiling `layout`.
   */
  trellis: Schema.optional(Schema.Unknown),
  /**
   * Pages-bar icon key (resolved by the web `PAGE_ICONS` map); absent pages
   * render without an icon. Custom pages choose one at creation; Home and
   * preset pages fall back to their built-in icons unless the user picked an
   * override (stored here via the page actions menu).
   */
  icon: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  /**
   * Masonry stack page mode: panes render as one scrolling column that may
   * exceed the viewport, each pane following its active tab widget's
   * natural content height (no internal scrollbar) instead of Trellis
   * tiling the stage into fixed one-screen cells. Absent/false keeps the
   * tiled stage. Applied via the "Masonry stack" grid preset; any tiled
   * preset turns it back off.
   */
  stacked: Schema.optional(Schema.Boolean),
  /**
   * Manual Tetris wall block widths (panelId → column span); see
   * `TetrisSpans`. Grid presets that rebuild the page shape clear the map;
   * "Tetris wall" (a mode-only re-pack) keeps it.
   */
  tetrisSpans: Schema.optional(TetrisSpans),
  /**
   * Page provenance: `"user"` marks pages explicitly added through the
   * Add-page picker. Preset workspaces seeded automatically by older builds
   * carry no origin and are cleaned up on hydrate; user-added ones — preset
   * or custom — persist.
   */
  origin: Schema.optional(Schema.Literal("user")),
});

export type Workspace = typeof Workspace.Type;

export const WorkspaceSummary = Schema.Struct({
  id: WorkspaceId,
  name: Schema.String,
  updatedAt: Schema.String,
});

export type WorkspaceSummary = typeof WorkspaceSummary.Type;

export const ListWorkspacesResponse = Schema.Struct({
  workspaces: Schema.Array(WorkspaceSummary),
});

export type ListWorkspacesResponse = typeof ListWorkspacesResponse.Type;

export const LoadWorkspaceResponse = Schema.Struct({
  workspace: Workspace,
});

export type LoadWorkspaceResponse = typeof LoadWorkspaceResponse.Type;

export const SaveWorkspaceRequest = Schema.Struct({
  workspace: Workspace,
});

export type SaveWorkspaceRequest = typeof SaveWorkspaceRequest.Type;

export const SaveWorkspaceResponse = Schema.Struct({
  workspace: Workspace,
});

export type SaveWorkspaceResponse = typeof SaveWorkspaceResponse.Type;

export const CreateWorkspaceRequest = Schema.Struct({
  name: Schema.optional(Schema.String),
  workspace: Schema.optional(Workspace),
});

export type CreateWorkspaceRequest = typeof CreateWorkspaceRequest.Type;

export const CreateWorkspaceResponse = Schema.Struct({
  workspace: Workspace,
});

export type CreateWorkspaceResponse = typeof CreateWorkspaceResponse.Type;

export const DeleteWorkspaceResponse = Schema.Struct({
  id: WorkspaceId,
});

export type DeleteWorkspaceResponse = typeof DeleteWorkspaceResponse.Type;

/** Strict decode for anything crossing the RPC/persistence boundary. */
export const decodeWorkspace = Schema.decodeUnknownSync(Workspace);

// ---------------------------------------------------------------------------
// Legacy split-tree -> grid migration
//
// Pre-grid documents persist binary `split` trees. `migrateLegacyLayout`
// converts them bottom-up: each split becomes a 2-track grid, then
// single-band child grids are flattened into their parent so the chained
// ratios of nested same-direction splits collapse into one flat track list
// (the exact skew the grid system fixes). Idempotent: documents without
// splits pass through untouched.
// ---------------------------------------------------------------------------

const asGrid = (node: LayoutNode): GridLayoutNode | undefined =>
  node.type === "grid" ? node : undefined;

/** True when every item sits on row 1 with span 1 — safe to merge columns. */
const isSingleRowBand = (grid: GridLayoutNode): boolean =>
  grid.rows.length === 1 &&
  grid.items.every((i) => i.row === 1 && i.rowSpan === 1);

/** True when every item sits on column 1 with span 1 — safe to merge rows. */
const isSingleColumnBand = (grid: GridLayoutNode): boolean =>
  grid.columns.length === 1 &&
  grid.items.every((i) => i.col === 1 && i.colSpan === 1);

/**
 * Merge `item`'s child grid into `grid` by splicing the child's columns into
 * the parent at the item's column. Siblings to the right shift; siblings
 * starting exactly at the same column widen to span the spliced tracks;
 * siblings whose span merely crosses the column abort the merge (null).
 */
const tryColumnMerge = (
  grid: GridLayoutNode,
  itemIndex: number,
): GridLayoutNode | null => {
  const item = grid.items[itemIndex]!;
  const child = asGrid(item.child);

  if (child === undefined || item.colSpan !== 1) return null;

  if (!isSingleRowBand(child) || child.columns.length < 2) return null;
  const c = item.col;
  const n = child.columns.length;
  const scale = grid.columns[c - 1] ?? 1;

  const columns = [
    ...grid.columns.slice(0, c - 1),
    ...child.columns.map((f) => f * scale),
    ...grid.columns.slice(c),
  ];

  const items: GridItemLayoutNode[] = [];

  for (const other of grid.items) {
    if (other === item) {
      for (const ci of child.items) {
        items.push({ ...ci, col: ci.col + c - 1, row: ci.row + item.row - 1 });
      }

      continue;
    }

    if (other.col > c) {
      items.push({ ...other, col: other.col + n - 1 });
      continue;
    }

    if (other.col === c) {
      items.push({ ...other, colSpan: other.colSpan + n - 1 });
      continue;
    }

    // other.col < c: crossing the spliced column would need a split span.
    if (other.col + Math.max(1, other.colSpan) - 1 >= c) return null;
    items.push(other);
  }

  return { ...grid, columns, items };
};

/** Row-axis mirror of `tryColumnMerge`. */
const tryRowMerge = (
  grid: GridLayoutNode,
  itemIndex: number,
): GridLayoutNode | null => {
  const item = grid.items[itemIndex]!;
  const child = asGrid(item.child);

  if (child === undefined || item.rowSpan !== 1) return null;

  if (!isSingleColumnBand(child) || child.rows.length < 2) return null;
  const r = item.row;
  const n = child.rows.length;
  const scale = grid.rows[r - 1] ?? 1;

  const rows = [
    ...grid.rows.slice(0, r - 1),
    ...child.rows.map((f) => f * scale),
    ...grid.rows.slice(r),
  ];

  const items: GridItemLayoutNode[] = [];

  for (const other of grid.items) {
    if (other === item) {
      for (const ci of child.items) {
        items.push({ ...ci, col: ci.col + item.col - 1, row: ci.row + r - 1 });
      }

      continue;
    }

    if (other.row > r) {
      items.push({ ...other, row: other.row + n - 1 });
      continue;
    }

    if (other.row === r) {
      items.push({ ...other, rowSpan: other.rowSpan + n - 1 });
      continue;
    }

    if (other.row + Math.max(1, other.rowSpan) - 1 >= r) return null;
    items.push(other);
  }

  return { ...grid, rows, items };
};

/** Absorb single-band child grids along either axis until nothing merges. */
const coalesceGrid = (grid: GridLayoutNode): GridLayoutNode => {
  let current = grid;
  let merged = true;

  while (merged) {
    merged = false;

    for (let i = 0; i < current.items.length && !merged; i++) {
      const next = tryColumnMerge(current, i) ?? tryRowMerge(current, i);

      if (next !== null) {
        current = next;
        merged = true;
      }
    }
  }

  return current;
};

/**
 * Derive a child id (`"<parent>-first"` / `"<parent>-second"`) from a parent
 * node id. The brand comes from decoding `LayoutNodeId`, which also re-proves
 * the non-empty invariant the parent id already carries — no blind assertion.
 */
const derivedNodeId = (parentId: LayoutNodeId, suffix: string): LayoutNodeId =>
  Schema.decodeSync(LayoutNodeId)(`${parentId}${suffix}`);

/** Convert legacy binary splits into (flattened) grids. Idempotent. */
export function migrateLegacyLayout(node: LayoutNode): LayoutNode {
  if (node.type !== "split") {
    if (node.type === "grid") {
      const items = node.items.map((item) => ({
        ...item,
        child: migrateLegacyLayout(item.child),
      }));

      return coalesceGrid({ ...node, items });
    }

    if (node.type === "flow") {
      const items = node.items.map((item) => ({
        ...item,
        child: migrateLegacyLayout(item.child),
      }));

      return { ...node, items };
    }

    if (node.type === "masonry") {
      const items = node.items.map((item) => ({
        ...item,
        child: migrateLegacyLayout(item.child),
      }));

      return { ...node, items };
    }

    if (node.type === "auto") {
      const items = node.items.map((item) => ({
        ...item,
        child: migrateLegacyLayout(item.child),
      }));

      return { ...node, items };
    }

    return node;
  }

  const horizontal = node.direction === "horizontal";
  const ratio = node.ratio;
  const first = migrateLegacyLayout(node.first);
  const second = migrateLegacyLayout(node.second);

  const grid: GridLayoutNode = {
    type: "grid",
    id: node.id,
    columns: horizontal ? [ratio, 1 - ratio] : [1],
    rows: horizontal ? [1] : [ratio, 1 - ratio],
    items: [
      {
        type: "item",
        id: derivedNodeId(node.id, "-first"),
        col: 1,
        row: 1,
        colSpan: 1,
        rowSpan: 1,
        child: first,
      },
      {
        type: "item",
        id: derivedNodeId(node.id, "-second"),
        col: horizontal ? 2 : 1,
        row: horizontal ? 1 : 2,
        colSpan: 1,
        rowSpan: 1,
        child: second,
      },
    ],
  };

  return coalesceGrid(grid);
}

/** Whole-workspace migration: converts any legacy splits in the layout. */
export function migrateWorkspace(workspace: Workspace): Workspace {
  const layout = migrateLegacyLayout(workspace.layout);

  if (layout === workspace.layout) return workspace;

  return { ...workspace, layout };
}

/**
 * Persisted JSON document `decodePersistedWorkspace` accepts: the workspace
 * wire shape with a not-yet-validated numeric `schemaVersion` — the version
 * gate inside names the supported literal. Nothing is trusted until decoded.
 */
export type PersistedWorkspaceDocument = Omit<
  typeof Workspace.Encoded,
  "schemaVersion"
> & { readonly schemaVersion: number };

const decodePersistedVersion = Schema.decodeUnknownEither(
  Schema.Struct({ schemaVersion: WorkspaceSchemaVersion }),
);

/**
 * Decode persisted documents with an explicit schema-version gate FIRST, so
 * a future `schemaVersion: 2` fails with a migration error (the place where
 * migrations will hook in) rather than a generic literal mismatch. Legacy
 * split trees are migrated to grids on the way through.
 */
export const decodePersistedWorkspace = (
  document: PersistedWorkspaceDocument,
): Workspace => {
  if (Either.isLeft(decodePersistedVersion(document))) {
    throw new Error(
      `Unsupported workspace schema version: ${String(document.schemaVersion)} (expected ${CURRENT_WORKSPACE_SCHEMA_VERSION})`,
    );
  }

  return migrateWorkspace(decodeWorkspace(document));
};

// ---------------------------------------------------------------------------
// Contract-first Effect HttpApi (frontend <-> backend type safety)
// ---------------------------------------------------------------------------
//
// `NfiApi` is the single source of truth for the wire protocol. The server
// implements it with `HttpApiBuilder`, shells consume it with
// `HttpApiClient` — endpoint paths, methods, success/error schemas and
// status codes are shared, so drift is a compile error, not a runtime bug.

// ---------------------------------------------------------------------------
// Capabilities (auth vocabulary: widget <-> backend authorization contract)
// ---------------------------------------------------------------------------
//
// A capability is a server-side function: it receives an option object and
// responds with a result. Auth limits which capabilities are available to a
// specific user: `Auth.capabilities` serves the caller's granted subset, and
// every widget declares the capabilities it needs (`capabilities` in
// `@nfi/widget-sdk`). A user missing one of a widget's requirements cannot
// enable that widget — the registry, command palette, sidebar and Panel all
// enforce the same pure check (`canEnableWidget`), so auth is a data change,
// not a UI rewrite.
//
// Capability granularity is one function per id. Every id below is
// hard-coded in three places that the typechecker + tests keep in sync:
// 1. this `Capability` union (the auth vocabulary served over the wire),
// 2. exactly one definition file in `@nfi/capabilities`
//    (`packages/capabilities/src/*.ts`) owning the option schema, result
//    schema, streaming cadence and server implementation — its registry is
//    typed `Record<Capability, ...>` so a missing or extra file is a compile
//    error,
// 3. `ENDPOINT_CAPABILITIES` mapping each `NfiApi` endpoint to its id.
//
// Call sites are generic over the registry (`callCapability` / `useCapability`
// in the web shell), so a typo'd id or mismatched options/result fails
// typecheck instead of reaching the network.
//
// Login: `Auth.login` exchanges username + password for an HttpOnly session
// cookie and returns the caller's identity + granted set; `Auth.capabilities`
// serves the same grant on every boot (the shell's bootstrap). Enforcement
// lives in the server (`apps/server`): every REST capability dispatch and
// every SSE stream subscription resolves the caller (root user | stored user
// | anonymous grant) and rejects ungranted capability ids with
// `ForbiddenError` — the frontend only mirrors the grant for visibility.
//
// User management: the `Users` group (capabilities `users.*`) lets a caller
// holding them list/create/update/remove users and edit the anonymous grant.
// Server-side guards: the root user (env-configured, virtual) is immutable
// and always holds every capability; grants may never exceed the editor's
// own grant (no privilege escalation); the anonymous row never gets a
// password.
//
// Sensitivity classification: capabilities do NOT carry a sensitivity
// verdict — each declares the KINDS of information it can expose
// (`exposes` in `@nfi/capabilities`). Which kinds count as sensitive is
// subjective, so the root user configures it (`System.sensitivityUpdate`,
// served back by `System.sensitivity`): a capability is sensitive iff it
// exposes at least one sensitive kind; a widget is non-sensitive iff every
// capability it uses is non-sensitive. The default policy: any
// information that can lead another user to derive absolute balances,
// absolute PnL, stake amounts, user location or similar private facts is
// sensitive — ids ending in `.relative` mirror the balance/PnL
// capabilities but only ever carry relative values (percentages, weights,
// rebased indices starting at 100), so no option combination can reveal
// the underlying freqtrade balance or PnL. The anonymous principal is
// granted a hand-curated subset of the non-sensitive ids (default seed:
// `NON_SENSITIVE_CAPABILITIES`).

export const Capability = Schema.Literal(
  "system.health",
  "system.backend-config",
  "system.page-defaults",
  "system.page-defaults.update",
  "macro.fed-rate",
  "bot.status",
  "bot.balance",
  "bot.profit",
  "bot.trades",
  "bot.config",
  "bot.profit-history",
  "bot.balance-history",
  "bot.balance.relative",
  "bot.profit.relative",
  "bot.trades.relative",
  "bot.profit-history.relative",
  "bot.balance-history.relative",
  "workspace.list",
  "workspace.load",
  "workspace.save",
  "workspace.create",
  "workspace.remove",
  "instances.list",
  "instances.create",
  "instances.update",
  "instances.remove",
  "instances.health",
  "instances.status",
  "instances.balance",
  "instances.profit",
  "instances.open-positions",
  "instances.closed-positions",
  "instances.tag-performance",
  "instances.tag-performance-all",
  "instances.pairs",
  "instances.candles",
  "instances.plot-config",
  "instances.balance.relative",
  "instances.profit.relative",
  "instances.open-positions.relative",
  "instances.closed-positions.relative",
  "instances.tag-performance.relative",
  "instances.config",
  "instances.locks",
  "instances.blacklist",
  "instances.whitelist",
  "instances.locks-all",
  "instances.blacklist-all",
  "instances.whitelist-all",
  "instances.trade-count",
  "instances.profit-daily",
  "instances.profit-history",
  "instances.profit-history-all",
  "instances.overview",
  "instances.positions-all",
  "instances.closed-all",
  "instances.profit-daily-all",
  "instances.balance-history",
  "instances.balance-history.relative",
  "instances.profit-history-all.relative",
  "instances.trade-tape",
  "instances.trade-tape-all",
  "instances.pair-watch",
  "instances.pair-watch-all",
  "instances.performance-stats",
  "instances.drawdown",
  "instances.cumulative-profit",
  "instances.exposure",
  "instances.traded-pairs",
  "users.list",
  "users.create",
  "users.update",
  "users.remove",
  "auth.capabilities",
);

export type Capability = typeof Capability.Type;

/** Open-mode grant: every known capability. Auth-disabled servers return this. */
export const ALL_CAPABILITIES: ReadonlyArray<Capability> = [
  "system.health",
  "system.backend-config",
  "system.page-defaults",
  "system.page-defaults.update",
  "macro.fed-rate",
  "bot.status",
  "bot.balance",
  "bot.profit",
  "bot.trades",
  "bot.config",
  "bot.profit-history",
  "bot.balance-history",
  "bot.balance.relative",
  "bot.profit.relative",
  "bot.trades.relative",
  "bot.profit-history.relative",
  "bot.balance-history.relative",
  "workspace.list",
  "workspace.load",
  "workspace.save",
  "workspace.create",
  "workspace.remove",
  "instances.list",
  "instances.create",
  "instances.update",
  "instances.remove",
  "instances.health",
  "instances.status",
  "instances.balance",
  "instances.profit",
  "instances.open-positions",
  "instances.closed-positions",
  "instances.tag-performance",
  "instances.tag-performance-all",
  "instances.pairs",
  "instances.candles",
  "instances.plot-config",
  "instances.balance.relative",
  "instances.profit.relative",
  "instances.open-positions.relative",
  "instances.closed-positions.relative",
  "instances.tag-performance.relative",
  "instances.config",
  "instances.locks",
  "instances.blacklist",
  "instances.whitelist",
  "instances.locks-all",
  "instances.blacklist-all",
  "instances.whitelist-all",
  "instances.trade-count",
  "instances.profit-daily",
  "instances.profit-history",
  "instances.profit-history-all",
  "instances.overview",
  "instances.positions-all",
  "instances.closed-all",
  "instances.profit-daily-all",
  "instances.balance-history",
  "instances.balance-history.relative",
  "instances.profit-history-all.relative",
  "instances.trade-tape",
  "instances.trade-tape-all",
  "instances.pair-watch",
  "instances.pair-watch-all",
  "instances.performance-stats",
  "instances.drawdown",
  "instances.cumulative-profit",
  "instances.exposure",
  "instances.traded-pairs",
  "users.list",
  "users.create",
  "users.update",
  "users.remove",
  "auth.capabilities",
];

/**
 * Anonymous seed grant: a hand-curated subset of the capabilities that are
 * non-sensitive under `DEFAULT_SENSITIVE_INFO_KINDS` — relative mirrors
 * (percentages, weights, rebased indices), statuses and neutral
 * market/system data only. A registry test in `@nfi/capabilities` keeps
 * every entry non-sensitive under the default criteria. Root may edit the
 * stored anonymous grant (Manage users page); this constant only seeds it.
 */
export const NON_SENSITIVE_CAPABILITIES: ReadonlyArray<Capability> = [
  "system.health",
  "system.page-defaults",
  "macro.fed-rate",
  "bot.status",
  "bot.balance.relative",
  "bot.profit.relative",
  "bot.trades.relative",
  "bot.profit-history.relative",
  "bot.balance-history.relative",
  "instances.status",
  "instances.balance.relative",
  "instances.profit.relative",
  "instances.open-positions.relative",
  "instances.closed-positions.relative",
  "instances.tag-performance.relative",
  "instances.pairs",
  "instances.candles",
  "instances.locks",
  "instances.blacklist",
  "instances.whitelist",
  "instances.locks-all",
  "instances.blacklist-all",
  "instances.whitelist-all",
  "instances.trade-count",
  "instances.balance-history.relative",
  "instances.profit-history-all.relative",
  "auth.capabilities",
];

// ---------------------------------------------------------------------------
// Information kinds (adjustable sensitivity criteria)
// ---------------------------------------------------------------------------
//
// What one operator is happy to share on a streamed desk, another calls a
// leak. So the vocabulary below names KINDS of information a capability can
// expose, and the root user checks off which kinds are sensitive — never
// per-capability verdicts. `System.sensitivity` (GET, public) serves the
// current criteria; `System.sensitivityUpdate` (PUT, root only) changes
// them (persisted server-side in `app_settings`).

/**
 * Kind of information a capability may expose:
 * - `absolute-balance` — total/equity/wallet balances and history (coin/fiat)
 * - `absolute-profit` — profit/PnL amounts, daily and aggregated
 * - `trade-details` — individual open/closed trades including amounts
 * - `stake-amount` — configured stake sizes
 * - `strategy-config` — strategy, exchange and run-mode configuration
 * - `infra-location` — hosts/base URLs that locate the operator's servers
 * - `user-accounts` — usernames, roles, capability grants
 * - `user-workspaces` — users' saved dashboards
 * - `relative-values` — percentages, weights, rebased indices
 * - `market-data` — candles, pairs, black/whitelists, plot layouts
 * - `bot-state` — status, health, locks, trade counts, versions
 * - `session-identity` — the caller's own identity + grant
 */
export const InfoKind = Schema.Literal(
  "absolute-balance",
  "absolute-profit",
  "trade-details",
  "stake-amount",
  "strategy-config",
  "infra-location",
  "user-accounts",
  "user-workspaces",
  "relative-values",
  "market-data",
  "bot-state",
  "session-identity",
);

export type InfoKind = typeof InfoKind.Type;

/**
 * Default criteria — the policy, stated once: ANY information that can
 * lead another user to derive absolute balances, absolute PnL, stake
 * amounts, user location or similar private facts is sensitive by
 * default. That is exactly the kinds below. The excluded four provably
 * cannot lead there: `relative-values` are percentages/weights/rebased
 * indices with no absolute anchor (the `.relative` transforms drop every
 * coin/fiat figure — no option combination reveals an amount),
 * `market-data` is public exchange data (candles, pair lists),
 * `bot-state` is run-state (status, health, locks, counts — the stake
 * *currency* names a coin, never an amount), and `session-identity` is
 * the caller's own login. A registry test in `@nfi/capabilities` walks
 * every result schema and enforces this mechanically: a capability whose
 * result carries amount- or location-shaped fields may never be
 * non-sensitive by default. Root may still adjust the set
 * (`System.sensitivityUpdate`).
 */
export const DEFAULT_SENSITIVE_INFO_KINDS: ReadonlyArray<InfoKind> = [
  "absolute-balance",
  "absolute-profit",
  "trade-details",
  "stake-amount",
  "strategy-config",
  "infra-location",
  "user-accounts",
  "user-workspaces",
];

/** Current root-configured criteria + the built-in defaults for reset. */
export const SensitivitySettingsResponse = Schema.Struct({
  sensitiveKinds: Schema.Array(InfoKind),
  defaults: Schema.Array(InfoKind),
});

export type SensitivitySettingsResponse =
  typeof SensitivitySettingsResponse.Type;

export const UpdateSensitivityRequest = Schema.Struct({
  /** New set of sensitive kinds (empty = nothing is sensitive). */
  sensitiveKinds: Schema.Array(InfoKind),
});

export type UpdateSensitivityRequest = typeof UpdateSensitivityRequest.Type;

// ---------------------------------------------------------------------------
// Page defaults (per-user landing page + visible pages + default tabs)
// ---------------------------------------------------------------------------
//
// Who lands where: `globalDefaultPageId` is the deployment-wide landing page
// (null/absent = Home). A per-user entry overrides it for one user id or the
// `anonymous` role: `defaultPageId` (null = follow the global), `visiblePageIds`
// (null = every page) and `defaultPanels` (page id -> panel id activated on
// landing). Page/panel ids are opaque UI strings — no balances, stakes or
// locations — so the read capability stays non-sensitive (`session-identity`).
// (Named `defaultPanels`, not `defaultTabs`: the registry audit flags any
// result field containing `abs` — as in "tabs" — as amount-shaped.)

export const PageDefaultsConfig = Schema.Struct({
  /** Landing page for the entry (null = follow the global default). */
  defaultPageId: Schema.NullOr(Schema.String),
  /** Pages shown in the header (null = every page). */
  visiblePageIds: Schema.NullOr(Schema.Array(Schema.String)),
  /** Preferred active tab per page (page id -> panel id). */
  defaultPanels: Schema.Record({ key: Schema.String, value: Schema.String }),
});

export type PageDefaultsConfig = typeof PageDefaultsConfig.Type;

export const GetPageDefaultsRequest = Schema.Struct({
  /** Identity to read (defaults to the caller: user id or `anonymous`). */
  userId: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
});

export type GetPageDefaultsRequest = typeof GetPageDefaultsRequest.Type;

export const GetPageDefaultsResponse = Schema.Struct({
  /** Resolved identity (`anonymous` for visitors, `root`, or `usr-*`). */
  userId: Schema.String,
  /** Deployment-wide landing page (null = Home). */
  globalDefaultPageId: Schema.NullOr(Schema.String),
  /** Per-identity override (null = follow the global default). */
  defaults: Schema.NullOr(PageDefaultsConfig),
});

export type GetPageDefaultsResponse = typeof GetPageDefaultsResponse.Type;

export const UpdatePageDefaultsRequest = Schema.Struct({
  /** Patch the global landing page (undefined = no change, null = Home). */
  globalDefaultPageId: Schema.optional(Schema.NullOr(Schema.String)),
  /** Identity to patch (`anonymous`, `root`, or `usr-*`). */
  userId: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  /**
   * Replace the identity's override (undefined = no per-user change,
   * null = clear the entry back to global-following).
   */
  defaults: Schema.optional(Schema.NullOr(PageDefaultsConfig)),
});

export type UpdatePageDefaultsRequest = typeof UpdatePageDefaultsRequest.Type;

export const UpdatePageDefaultsResponse = GetPageDefaultsResponse;

export type UpdatePageDefaultsResponse = typeof UpdatePageDefaultsResponse.Type;

// ---------------------------------------------------------------------------
// Appearance defaults (root-owned, deployment-wide).
// ---------------------------------------------------------------------------
//
// The "Appearance & layout" settings tab (theme, accent, time format,
// color-blind palette, contrast, widget-minimum guard) otherwise lives in
// per-browser localStorage — a fresh incognito window would render the
// hardcoded defaults while root sees their own choices (e.g. warnings root
// disabled still walling anonymous). The root user snapshots their current
// appearance here once; every browser WITHOUT its own stored values seeds
// from this document on boot, so visitors match root by default while anyone
// who touches a setting keeps their own override. UI-only values (never
// balances, credentials or grants), so the read is public like sensitivity
// and only root may write.
//
// Literals are duplicated here (not imported from the web/widgets packages —
// the contract cannot depend on them): they are stable ids also hardcoded in
// the web prefs schema. Unknown future values decode as absent per key, so
// an old client never chokes on a newer default.

export const AppearanceDefaults = Schema.Struct({
  /** Carbon base theme (`white`, `g10`, `g90`, `g100`). */
  colorTheme: Schema.optional(Schema.Literal("white", "g10", "g90", "g100")),
  /** Accent color family. */
  accentColor: Schema.optional(
    Schema.Literal(
      "blue",
      "cyan",
      "teal",
      "green",
      "purple",
      "magenta",
      "red",
      "orange",
    ),
  ),
  /** Time-format preset id (validated against the widgets catalog client-side). */
  timeFormat: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
  /** Color-blind safe (blue/orange) palette. */
  colorBlindSafe: Schema.optional(Schema.Boolean),
  /** High-contrast theme layer. */
  highContrast: Schema.optional(Schema.Boolean),
  /** Render widgets below their minimum readable size (no "needs more room" wall). */
  disableWidgetMinSize: Schema.optional(Schema.Boolean),
});

export type AppearanceDefaults = typeof AppearanceDefaults.Type;

export const AppearanceDefaultsResponse = Schema.Struct({
  /** Root's snapshot (null = never saved: browsers use hardcoded defaults). */
  defaults: Schema.NullOr(AppearanceDefaults),
});

export type AppearanceDefaultsResponse = typeof AppearanceDefaultsResponse.Type;

export const UpdateAppearanceDefaultsRequest = Schema.Struct({
  /** Full replacement snapshot of the shared defaults. */
  defaults: AppearanceDefaults,
});

export type UpdateAppearanceDefaultsRequest =
  typeof UpdateAppearanceDefaultsRequest.Type;

export const UserRole = Schema.Literal("root", "user", "anonymous");

export type UserRole = typeof UserRole.Type;

export const CapabilitiesResponse = Schema.Struct({
  /** Granted capabilities for the caller (root = every capability). */
  capabilities: Schema.Array(Capability),
  /** Present once login exists; today the server is unauthenticated. */
  userId: Schema.optional(Schema.String),
  /** False while not signed in (anonymous grant applies). */
  authenticated: Schema.optional(Schema.Boolean),
  /** Identity of the caller when signed in; `anonymous` otherwise. */
  username: Schema.optional(Schema.String),
  role: Schema.optional(UserRole),
  /**
   * Whether an always-privileged root account exists (env-configured, or
   * created through `Auth.setupRoot`). False means the deployment has no
   * admin yet — the first-run root setup screen keys off this.
   */
  rootProvisioned: Schema.optional(Schema.Boolean),
});

export type CapabilitiesResponse = typeof CapabilitiesResponse.Type;

export type ApiGroupName =
  "System" | "Macro" | "Bot" | "Workspace" | "Instances" | "Users" | "Auth";

export type ApiEndpointName = string;

const ENDPOINT_CAPABILITY_TABLE = {
  "System.health": ["system.health"],
  "System.backendConfig": ["system.backend-config"],
  "Macro.fedRate": ["macro.fed-rate"],
  // Not capabilities: readable by everyone, root-guarded in the handler.
  "System.sensitivity": [],
  "System.sensitivityUpdate": [],
  "System.appearance": [],
  "System.appearanceUpdate": [],
  "Bot.status": ["bot.status"],
  "Bot.balance": ["bot.balance"],
  "Bot.profit": ["bot.profit"],
  "Bot.trades": ["bot.trades"],
  "Bot.config": ["bot.config"],
  "Bot.profitHistory": ["bot.profit-history"],
  "Bot.balanceHistory": ["bot.balance-history"],
  "Bot.balanceRelative": ["bot.balance.relative"],
  "Bot.profitRelative": ["bot.profit.relative"],
  "Bot.tradesRelative": ["bot.trades.relative"],
  "Bot.profitHistoryRelative": ["bot.profit-history.relative"],
  "Bot.balanceHistoryRelative": ["bot.balance-history.relative"],
  "Workspace.list": ["workspace.list"],
  "Workspace.load": ["workspace.load"],
  "Workspace.save": ["workspace.save"],
  "Workspace.create": ["workspace.create"],
  "Workspace.remove": ["workspace.remove"],
  "Instances.list": ["instances.list"],
  "Instances.create": ["instances.create"],
  "Instances.update": ["instances.update"],
  "Instances.remove": ["instances.remove"],
  "Instances.health": ["instances.health"],
  "Instances.status": ["instances.status"],
  "Instances.balance": ["instances.balance"],
  "Instances.profit": ["instances.profit"],
  "Instances.openPositions": ["instances.open-positions"],
  "Instances.closedPositions": ["instances.closed-positions"],
  "Instances.tagPerformance": ["instances.tag-performance"],
  "Instances.pairs": ["instances.pairs"],
  "Instances.candles": ["instances.candles"],
  "Instances.plotConfig": ["instances.plot-config"],
  "Instances.balanceRelative": ["instances.balance.relative"],
  "Instances.profitRelative": ["instances.profit.relative"],
  "Instances.openPositionsRelative": ["instances.open-positions.relative"],
  "Instances.closedPositionsRelative": ["instances.closed-positions.relative"],
  "Instances.tagPerformanceRelative": ["instances.tag-performance.relative"],
  "Instances.config": ["instances.config"],
  "Instances.locks": ["instances.locks"],
  "Instances.blacklist": ["instances.blacklist"],
  "Instances.whitelist": ["instances.whitelist"],
  "Instances.locksAll": ["instances.locks-all"],
  "Instances.blacklistAll": ["instances.blacklist-all"],
  "Instances.whitelistAll": ["instances.whitelist-all"],
  "Instances.tradeCount": ["instances.trade-count"],
  "Instances.profitDaily": ["instances.profit-daily"],
  "Instances.profitHistory": ["instances.profit-history"],
  "Instances.overview": ["instances.overview"],
  "Instances.positionsAll": ["instances.positions-all"],
  "Instances.closedAll": ["instances.closed-all"],
  "Instances.profitDailyAll": ["instances.profit-daily-all"],
  "Instances.balanceHistoryAll": ["instances.balance-history"],
  "Instances.balanceHistoryAllRelative": ["instances.balance-history.relative"],
  "Instances.profitHistoryAllRelative": [
    "instances.profit-history-all.relative",
  ],
  "Instances.profitHistoryAll": ["instances.profit-history-all"],
  "Instances.tagPerformanceAll": ["instances.tag-performance-all"],
  "Instances.tradeTape": ["instances.trade-tape"],
  "Instances.tradeTapeAll": ["instances.trade-tape-all"],
  "Instances.pairWatch": ["instances.pair-watch"],
  "Instances.pairWatchAll": ["instances.pair-watch-all"],
  "Instances.performanceStats": ["instances.performance-stats"],
  "Instances.drawdown": ["instances.drawdown"],
  "Instances.cumulativeProfit": ["instances.cumulative-profit"],
  "Instances.exposure": ["instances.exposure"],
  "Instances.tradedPairs": ["instances.traded-pairs"],
  "Users.list": ["users.list"],
  "Users.create": ["users.create"],
  "Users.update": ["users.update"],
  "Users.remove": ["users.remove"],
  "System.pageDefaults": ["system.page-defaults"],
  "System.pageDefaultsUpdate": ["system.page-defaults.update"],
  "Auth.capabilities": [],
  "Auth.login": [],
  "Auth.setupRoot": [],
  "Auth.logout": [],
} as const satisfies Record<string, ReadonlyArray<Capability>>;

/** `"<Group>.<endpoint>"` id of every endpoint declared in `NfiApi`. */
export type EndpointId = keyof typeof ENDPOINT_CAPABILITY_TABLE;

/**
 * Backend endpoint -> required capability (one function per id).
 * `capabilitiesForEndpoint` is the single reader so widgets never hardcode
 * endpoint strings.
 */
export const ENDPOINT_CAPABILITIES: Readonly<
  Record<EndpointId, ReadonlyArray<Capability>>
> = ENDPOINT_CAPABILITY_TABLE;

const endpointCapabilities = new Map<string, ReadonlyArray<Capability>>(
  Object.entries(ENDPOINT_CAPABILITY_TABLE),
);

export function capabilitiesForEndpoint(
  group: string,
  endpoint: string,
): ReadonlyArray<Capability> {
  return endpointCapabilities.get(`${group}.${endpoint}`) ?? [];
}

export const BackendError = Schema.Struct({
  _tag: Schema.tag("BackendError"),
  error: Schema.String,
  detail: Schema.optional(Schema.String),
});

export type BackendError = typeof BackendError.Type;

/**
 * Caller is not permitted to use a capability. Raised by the server's
 * authorization choke points (REST capability dispatch + the SSE stream)
 * and by the users.* capabilities' escalation guards.
 */
export const ForbiddenError = Schema.Struct({
  _tag: Schema.tag("ForbiddenError"),
  error: Schema.String,
  detail: Schema.optional(Schema.String),
});

export type ForbiddenError = typeof ForbiddenError.Type;

/** Login failed (unknown user or wrong password). */
export const UnauthorizedError = Schema.Struct({
  _tag: Schema.tag("UnauthorizedError"),
  error: Schema.String,
  detail: Schema.optional(Schema.String),
});

export type UnauthorizedError = typeof UnauthorizedError.Type;

// ---------------------------------------------------------------------------
// Users & auth (management plane — never part of NON_SENSITIVE_CAPABILITIES)
// ---------------------------------------------------------------------------

/** Fixed id of the env-configured root user (virtual, never a sqlite row). */
export const ROOT_USER_ID = "root";

/**
 * Fixed id of the anonymous principal row (everyone not signed in). A real
 * sqlite row with an empty password hash — it can never log in, it only
 * stores the public grant edited on the Manage users page.
 */
export const ANONYMOUS_USER_ID = "anonymous";

/** A user as seen by the Manage users page. Password hashes never appear. */
export const ManagedUser = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  role: UserRole,
  /** Granted capability ids (`root` = every capability). */
  capabilities: Schema.Array(Capability),
  /** Whether a password is set (always true for root, false for anonymous). */
  hasPassword: Schema.Boolean,
  /** Absent for the virtual root user (it has no storage lifetime). */
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
});

export type ManagedUser = typeof ManagedUser.Type;

export const ListUsersResponse = Schema.Struct({
  users: Schema.Array(ManagedUser),
});

export type ListUsersResponse = typeof ListUsersResponse.Type;

export const CreateUserRequest = Schema.Struct({
  username: Schema.String.pipe(Schema.minLength(1)),
  password: Schema.String.pipe(Schema.minLength(1)),
  capabilities: Schema.Array(Capability),
});

export type CreateUserRequest = typeof CreateUserRequest.Type;

export const CreateUserResponse = Schema.Struct({
  user: ManagedUser,
});

export type CreateUserResponse = typeof CreateUserResponse.Type;

export const UpdateUserRequest = Schema.Struct({
  /** Omitted/empty = keep the stored password. Ignored for `anonymous`. */
  password: Schema.optional(Schema.String),
  capabilities: Schema.optional(Schema.Array(Capability)),
});

export type UpdateUserRequest = typeof UpdateUserRequest.Type;

export const UpdateUserResponse = Schema.Struct({
  user: ManagedUser,
});

export type UpdateUserResponse = typeof UpdateUserResponse.Type;

export const DeleteUserResponse = Schema.Struct({
  id: Schema.String,
});

export type DeleteUserResponse = typeof DeleteUserResponse.Type;

export const LoginRequest = Schema.Struct({
  username: Schema.String.pipe(Schema.minLength(1)),
  password: Schema.String.pipe(Schema.minLength(1)),
});

export type LoginRequest = typeof LoginRequest.Type;

/**
 * First-run root provisioning (only while no root exists): creates the
 * always-privileged root account and signs the caller in as root.
 *
 * The password floor (`MIN_ROOT_PASSWORD_LENGTH`) is enforced at the wire
 * schema AND in `SessionAuth.setupRoot` (clear error for direct callers):
 * the setup screen is reachable by whoever arrives first, so short secrets
 * must not slip through. `setupToken` is the one-time token the server
 * prints to its log on first boot — required so an exposed first boot
 * cannot be claimed by a stranger on the network.
 */
export const MIN_ROOT_PASSWORD_LENGTH = 12;

export const SetupRootRequest = Schema.Struct({
  username: Schema.String.pipe(Schema.minLength(1)),
  password: Schema.String.pipe(Schema.minLength(MIN_ROOT_PASSWORD_LENGTH)),
  setupToken: Schema.optional(Schema.String),
});

export type SetupRootRequest = typeof SetupRootRequest.Type;

export const LoginResponse = Schema.Struct({
  userId: Schema.String,
  username: Schema.String,
  role: UserRole,
  capabilities: Schema.Array(Capability),
});

export type LoginResponse = typeof LoginResponse.Type;

export const LogoutResponse = Schema.Struct({
  ok: Schema.Literal(true),
});

export type LogoutResponse = typeof LogoutResponse.Type;

export const NfiApi = HttpApi.make("NfiPanelApi")
  .add(
    HttpApiGroup.make("System")
      .addError(ForbiddenError, { status: 403 })
      .add(
        HttpApiEndpoint.get("health", "/api/health")
          .addSuccess(HealthResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("backendConfig", "/api/backend/config")
          .addSuccess(BackendConfigResponse)
          .addError(BackendError, { status: 502 }),
      )
      // Sensitivity criteria are meta-info like the auth bootstrap, not a
      // capability: everyone reads them (UI marks depend on them), only the
      // root principal may change them (enforced in the handler).
      .add(
        HttpApiEndpoint.get("sensitivity", "/api/sensitivity")
          .addSuccess(SensitivitySettingsResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.put("sensitivityUpdate", "/api/sensitivity")
          .addSuccess(SensitivitySettingsResponse)
          .addError(BackendError, { status: 502 })
          .setPayload(UpdateSensitivityRequest),
      )
      .add(
        HttpApiEndpoint.get("pageDefaults", "/api/system/page-defaults")
          .setUrlParams(GetPageDefaultsRequest)
          .addSuccess(GetPageDefaultsResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.put("pageDefaultsUpdate", "/api/system/page-defaults")
          .setPayload(UpdatePageDefaultsRequest)
          .addSuccess(UpdatePageDefaultsResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("appearance", "/api/system/appearance")
          .addSuccess(AppearanceDefaultsResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.put("appearanceUpdate", "/api/system/appearance")
          .addSuccess(AppearanceDefaultsResponse)
          .addError(BackendError, { status: 502 })
          .setPayload(UpdateAppearanceDefaultsRequest),
      ),
  )
  .add(
    HttpApiGroup.make("Macro")
      .addError(ForbiddenError, { status: 403 })
      .add(
        HttpApiEndpoint.get("fedRate", "/api/macro/fed-rate")
          .addSuccess(FedRateResponse)
          .addError(BackendError, { status: 502 }),
      ),
  )
  .add(
    HttpApiGroup.make("Bot")
      .addError(ForbiddenError, { status: 403 })
      .add(
        HttpApiEndpoint.get("status", "/api/bot/status")
          .addSuccess(BotStatus)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("balance", "/api/bot/balance")
          .addSuccess(BalanceResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("profit", "/api/bot/profit")
          .addSuccess(ProfitSummary)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("trades", "/api/bot/trades")
          .addSuccess(OpenTradesResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("config", "/api/bot/config")
          .addSuccess(BotConfigSummary)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("profitHistory", "/api/bot/profit/history")
          .addSuccess(ProfitHistoryResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("balanceHistory", "/api/bot/balance/history")
          .addSuccess(BalanceHistoryResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("balanceRelative", "/api/bot/balance/relative")
          .addSuccess(RelativeBalance)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("profitRelative", "/api/bot/profit/relative")
          .addSuccess(RelativeProfit)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("tradesRelative", "/api/bot/trades/relative")
          .addSuccess(RelativeTradesResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "profitHistoryRelative",
          "/api/bot/profit/history/relative",
        )
          .addSuccess(RelativeProfitHistoryResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "balanceHistoryRelative",
          "/api/bot/balance/history/relative",
        )
          .addSuccess(RelativeBalanceHistoryResponse)
          .addError(BackendError, { status: 502 }),
      ),
  )
  .add(
    HttpApiGroup.make("Workspace")
      .addError(ForbiddenError, { status: 403 })
      .add(
        HttpApiEndpoint.get("list", "/api/workspaces")
          .addSuccess(ListWorkspacesResponse)
          .addError(BackendError, {
            status: 502,
          }),
      )
      .add(
        HttpApiEndpoint.get(
          "load",
        )`/api/workspaces/${HttpApiSchema.param("id", Schema.String)}`
          .addSuccess(LoadWorkspaceResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.put(
          "save",
        )`/api/workspaces/${HttpApiSchema.param("id", Schema.String)}`
          .setPayload(SaveWorkspaceRequest)
          .addSuccess(SaveWorkspaceResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.post("create", "/api/workspaces")
          .setPayload(CreateWorkspaceRequest)
          .addSuccess(CreateWorkspaceResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.del(
          "remove",
        )`/api/workspaces/${HttpApiSchema.param("id", Schema.String)}`
          .addSuccess(DeleteWorkspaceResponse)
          .addError(BackendError, { status: 502 }),
      ),
  )
  .add(
    HttpApiGroup.make("Auth")
      .addError(ForbiddenError, { status: 403 })
      .add(
        HttpApiEndpoint.get("capabilities", "/api/auth/capabilities")
          .addSuccess(CapabilitiesResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.post("login", "/api/auth/login")
          .setPayload(LoginRequest)
          .addSuccess(LoginResponse)
          .addError(UnauthorizedError, { status: 401 })
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.post("setupRoot", "/api/auth/setup")
          .setPayload(SetupRootRequest)
          .addSuccess(LoginResponse)
          .addError(ForbiddenError, { status: 403 })
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.post("logout", "/api/auth/logout")
          .addSuccess(LogoutResponse)
          .addError(BackendError, { status: 502 }),
      ),
  )
  .add(
    HttpApiGroup.make("Users")
      .addError(ForbiddenError, { status: 403 })
      .add(
        HttpApiEndpoint.get("list", "/api/users")
          .addSuccess(ListUsersResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.post("create", "/api/users")
          .setPayload(CreateUserRequest)
          .addSuccess(CreateUserResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.put(
          "update",
        )`/api/users/${HttpApiSchema.param("id", Schema.String)}`
          .setPayload(UpdateUserRequest)
          .addSuccess(UpdateUserResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.del(
          "remove",
        )`/api/users/${HttpApiSchema.param("id", Schema.String)}`
          .addSuccess(DeleteUserResponse)
          .addError(BackendError, { status: 502 }),
      ),
  )
  .add(
    HttpApiGroup.make("Instances")
      .addError(ForbiddenError, { status: 403 })
      .add(
        HttpApiEndpoint.get("list", "/api/instances")
          .addSuccess(ListInstancesResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.post("create", "/api/instances")
          .setPayload(CreateInstanceRequest)
          .addSuccess(CreateInstanceResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.put(
          "update",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}`
          .setPayload(UpdateInstanceRequest)
          .addSuccess(UpdateInstanceResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.del(
          "remove",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}`
          .addSuccess(DeleteInstanceResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "health",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/health`
          .addSuccess(InstanceHealthResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "status",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/status`
          .addSuccess(BotStatus)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "balance",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/balance`
          .addSuccess(BalanceResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "profit",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/profit`
          .addSuccess(ProfitSummary)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "openPositions",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/positions/open`
          .setUrlParams(OpenPositionsQuery)
          .addSuccess(OpenPositionsResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "closedPositions",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/positions/closed`
          .setUrlParams(ClosedPositionsQuery)
          .addSuccess(ClosedPositionsResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "tagPerformance",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/tags/performance`
          .setUrlParams(TagPerformanceQuery)
          .addSuccess(TagPerformanceResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "pairs",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/pairs`
          .setUrlParams(AvailablePairsQuery)
          .addSuccess(AvailablePairsResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "candles",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/candles`
          .setUrlParams(CandlesQuery)
          .addSuccess(CandlesResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "plotConfig",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/plot-config`
          .setUrlParams(PlotConfigQuery)
          .addSuccess(PlotConfigResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "balanceRelative",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/balance/relative`
          .addSuccess(RelativeBalance)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "profitRelative",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/profit/relative`
          .addSuccess(RelativeProfit)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "openPositionsRelative",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/positions/open/relative`
          .setUrlParams(SearchQuery)
          .addSuccess(RelativeOpenPositionsResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "closedPositionsRelative",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/positions/closed/relative`
          .setUrlParams(ClosedPositionsQuery)
          .addSuccess(RelativeClosedPositionsResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "tagPerformanceRelative",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/tags/performance/relative`
          .setUrlParams(TagPerformanceQuery)
          .addSuccess(RelativeTagPerformanceResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "config",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/config`
          .addSuccess(BotConfigSummary)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "locks",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/locks`
          .setUrlParams(LocksQuery)
          .addSuccess(LocksResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "blacklist",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/blacklist`
          .setUrlParams(SearchQuery)
          .addSuccess(BlacklistResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "whitelist",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/whitelist`
          .setUrlParams(SearchQuery)
          .addSuccess(WhitelistResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("locksAll", "/api/instances/locks/all")
          .setUrlParams(LocksQuery)
          .addSuccess(FleetLocksResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("blacklistAll", "/api/instances/blacklist/all")
          .setUrlParams(SearchQuery)
          .addSuccess(FleetBlacklistResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("whitelistAll", "/api/instances/whitelist/all")
          .setUrlParams(SearchQuery)
          .addSuccess(FleetWhitelistResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "tradeCount",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/trade-count`
          .addSuccess(TradeCountResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "profitDaily",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/profit/daily`
          .setUrlParams(ProfitDailyQuery)
          .addSuccess(ProfitBucketsResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "profitHistory",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/profit/history`
          .setUrlParams(BalanceHistoryQuery)
          .addSuccess(ProfitHistoryResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("overview", "/api/instances/overview")
          .addSuccess(FleetOverviewResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("positionsAll", "/api/instances/positions/open-all")
          .setUrlParams(OpenPositionsQuery)
          .addSuccess(FleetOpenPositionsResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("closedAll", "/api/instances/positions/closed-all")
          .setUrlParams(ClosedPositionsQuery)
          .addSuccess(FleetClosedPositionsResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("profitDailyAll", "/api/instances/profit-daily/all")
          .setUrlParams(ProfitDailyQuery)
          .addSuccess(ProfitBucketsResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "balanceHistoryAll",
          "/api/instances/balance-history",
        )
          .setUrlParams(BalanceHistoryQuery)
          .addSuccess(FleetBalanceHistoryResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "balanceHistoryAllRelative",
          "/api/instances/balance-history/relative",
        )
          .setUrlParams(BalanceHistoryQuery)
          .addSuccess(RelativeFleetBalanceHistoryResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "profitHistoryAllRelative",
          "/api/instances/profit-history/relative",
        )
          .setUrlParams(BalanceHistoryQuery)
          .addSuccess(RelativeFleetProfitHistoryResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "profitHistoryAll",
          "/api/instances/profit-history/all",
        )
          .setUrlParams(BalanceHistoryQuery)
          .addSuccess(ProfitHistoryResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "tagPerformanceAll",
          "/api/instances/tags/performance-all",
        )
          .setUrlParams(TagPerformanceQuery)
          .addSuccess(TagPerformanceResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "tradeTape",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/tape`
          .setUrlParams(TapeQuery)
          .addSuccess(TapeResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("tradeTapeAll", "/api/instances/tape/all")
          .setUrlParams(TapeQuery)
          .addSuccess(TapeResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "pairWatch",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/pairs/watch`
          .setUrlParams(PairWatchQuery)
          .addSuccess(PairWatchResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("pairWatchAll", "/api/instances/pairs/watch-all")
          .setUrlParams(PairWatchQuery)
          .addSuccess(PairWatchResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "performanceStats",
          "/api/instances/performance-stats",
        )
          .setUrlParams(PerformanceStatsQuery)
          .addSuccess(PerformanceStatsResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("drawdown", "/api/instances/drawdown")
          .setUrlParams(DrawdownQuery)
          .addSuccess(DrawdownResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "cumulativeProfit",
          "/api/instances/cumulative-profit",
        )
          .setUrlParams(CumulativeProfitQuery)
          .addSuccess(CumulativeProfitResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("exposure", "/api/instances/exposure")
          .setUrlParams(ExposureQuery)
          .addSuccess(ExposureResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get("tradedPairs", "/api/instances/traded-pairs")
          .setUrlParams(TradedPairsQuery)
          .addSuccess(TradedPairsResponse)
          .addError(BackendError, { status: 502 }),
      ),
  );

/** Client handle type derived from the contract — no hand-written fetch types. */
const makeNfiClient = (baseUrl?: string) =>
  HttpApiClient.make(NfiApi, { baseUrl });

export type NfiApiClient = Effect.Effect.Success<
  ReturnType<typeof makeNfiClient>
>;

/** Decode helpers so shells fail loudly on contract drift. */
export const decodeHealth = Schema.decodeUnknownSync(HealthResponse);

export const decodeBotStatus = Schema.decodeUnknownSync(BotStatus);

export const decodeBalance = Schema.decodeUnknownSync(BalanceResponse);

export const decodeProfit = Schema.decodeUnknownSync(ProfitSummary);

export const decodeOpenTrades = Schema.decodeUnknownSync(OpenTradesResponse);

export const decodeBotConfig = Schema.decodeUnknownSync(BotConfigSummary);

export const decodeBackendConfig = Schema.decodeUnknownSync(
  BackendConfigResponse,
);

// ---------------------------------------------------------------------------
// Error formatting (shared by server-adjacent packages and the web shell)
// ---------------------------------------------------------------------------

/** `{ error, detail? }` body carried by this contract's failed responses. */
const ContractErrorBody = Schema.Struct({
  error: Schema.String,
  detail: Schema.optional(Schema.String),
});

type ContractErrorBody = typeof ContractErrorBody.Type;

/** Error-shaped objects whose `message` may itself hide a contract body. */
const MessageBody = Schema.Struct({ message: Schema.String });

const decodeContractErrorBody = Schema.decodeUnknownEither(ContractErrorBody);

const decodeMessageBody = Schema.decodeUnknownEither(MessageBody);

const decodeTextMessage = Schema.decodeUnknownEither(Schema.String);

/**
 * Pull a `{ error, ... }` contract body out of a string (or Error message):
 * `null` unless the string is JSON with a string `error` field.
 */
const asContractError = (message: string): ContractErrorBody | null => {
  const trimmed = message.trim();

  if (!trimmed.startsWith("{")) return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    const decoded = decodeContractErrorBody(parsed);

    return Either.isRight(decoded) ? decoded.right : null;
  } catch {
    // Not JSON — fall through.
  }

  return null;
};

const sentenceCase = (text: string): string =>
  text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text;

/** Render a decoded contract body (`Error[: detail]`). */
const formatContractBody = (body: ContractErrorBody): string => {
  const detail =
    body.detail !== undefined && body.detail.length > 0
      ? `: ${body.detail}`
      : "";

  return `${sentenceCase(body.error)}${detail}`;
};

/** Format a message: a nested contract body when present, else the text. */
const formatMessage = (message: string): string => {
  const body = asContractError(message);

  return body === null ? message : formatContractBody(body);
};

/**
 * Human-readable message for contract / transport failures: understands the
 * `BackendError` shape (`{ error, detail }`), JSON-encoded bodies inside
 * Error messages, and plain strings/objects. Returns null for nullish input.
 */
export function formatQueryError(cause: unknown): string | null {
  if (cause === null || cause === undefined) return null;

  if (cause instanceof Error) {
    return formatMessage(cause.message);
  }

  const body = decodeContractErrorBody(cause);

  if (Either.isRight(body)) return formatContractBody(body.right);

  const messageBody = decodeMessageBody(cause);

  if (Either.isRight(messageBody)) {
    return formatMessage(messageBody.right.message);
  }

  const text = decodeTextMessage(cause);

  if (Either.isRight(text)) return formatMessage(text.right);

  return String(cause);
}
