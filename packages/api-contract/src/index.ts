// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  HttpApi,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "@effect/platform";
import { Effect, Schema } from "effect";

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
  exchange: Schema.optional(Schema.String),
  stakeCurrency: Schema.optional(Schema.String),
  dryRun: Schema.optional(Schema.Boolean),
  tradingMode: Schema.optional(Schema.String),
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
});
export type ClosedPositionsQuery = typeof ClosedPositionsQuery.Type;

/** Snapshot-history window size, shared by the fleet balance-history reads. */
export const BalanceHistoryQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
});
export type BalanceHistoryQuery = typeof BalanceHistoryQuery.Type;

// --- NFI tag performance (aggregated closed-trade stats per tag) -------------

export const TagGroupBy = Schema.Literal("enter", "exit");
export type TagGroupBy = typeof TagGroupBy.Type;

export const TagPerformanceRow = Schema.Struct({
  /** Trimmed tag value (`enter_tag` for `enter`, `exit_reason` for `exit`). */
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
});
export type TagPerformanceRow = typeof TagPerformanceRow.Type;

export const TagPerformanceResponse = Schema.Struct({
  groupBy: TagGroupBy,
  rows: Schema.Array(TagPerformanceRow),
  /** Closed trades actually aggregated (after the limit window). */
  aggregatedTrades: Schema.Number,
  totalTrades: Schema.optional(Schema.Number),
});
export type TagPerformanceResponse = typeof TagPerformanceResponse.Type;

export const TagPerformanceQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  groupBy: Schema.optional(Schema.String),
});
export type TagPerformanceQuery = typeof TagPerformanceQuery.Type;

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
});
export type CandlesResponse = typeof CandlesResponse.Type;

export const CandlesQuery = Schema.Struct({
  /** e.g. `BTC/USDT` (URL-encoded by the client). */
  pair: Schema.String.pipe(Schema.minLength(1)),
  /** Freqtrade timeframe, e.g. `5m`, `1h`, `1d`. Defaults to `15m`. */
  timeframe: Schema.optional(Schema.String),
  /** Last N candles. Defaults to 200, capped server-side. */
  limit: Schema.optional(Schema.String),
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
});
export type LocksResponse = typeof LocksResponse.Type;

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

export const ProfitBucketsResponse = Schema.Struct({
  bucket: ProfitBucketKind,
  buckets: Schema.Array(ProfitBucket),
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
export type FleetBalanceHistoryResponse = typeof FleetBalanceHistoryResponse.Type;

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

export const RelativeOpenPositionsResponse = Schema.Struct({
  positions: Schema.Array(RelativeOpenPosition),
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

export const RelativeClosedPositionsResponse = Schema.Struct({
  positions: Schema.Array(RelativeClosedPosition),
  tradesCount: Schema.optional(Schema.Number),
  totalTrades: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
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
});
export type RelativeTagPerformanceRow = typeof RelativeTagPerformanceRow.Type;

export const RelativeTagPerformanceResponse = Schema.Struct({
  groupBy: TagGroupBy,
  rows: Schema.Array(RelativeTagPerformanceRow),
  aggregatedTrades: Schema.Number,
  totalTrades: Schema.optional(Schema.Number),
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

export type LayoutNode =
  SplitLayoutNode | TabsLayoutNode | PanelLayoutNode | GridLayoutNode;

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

export const LayoutNode: Schema.Schema<LayoutNode, any> = Schema.suspend(() =>
  Schema.Union(
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
   * Pages-bar icon key (resolved by the web `PAGE_ICONS` map); absent pages
   * render without an icon. Only custom pages use it — preset pages derive
   * their icon from code.
   */
  icon: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
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
        id: `${node.id}-first` as LayoutNodeId,
        col: 1,
        row: 1,
        colSpan: 1,
        rowSpan: 1,
        child: first,
      },
      {
        type: "item",
        id: `${node.id}-second` as LayoutNodeId,
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
 * Decode persisted documents with an explicit schema-version gate FIRST, so
 * a future `schemaVersion: 2` fails with a migration error (the place where
 * migrations will hook in) rather than a generic literal mismatch. Legacy
 * split trees are migrated to grids on the way through.
 */
export const decodePersistedWorkspace = (value: unknown): Workspace => {
  if (typeof value === "object" && value !== null) {
    const version = (value as Record<string, unknown>)["schemaVersion"];
    if (version !== CURRENT_WORKSPACE_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported workspace schema version: ${String(version)} (expected ${CURRENT_WORKSPACE_SCHEMA_VERSION})`,
      );
    }
  }
  return migrateWorkspace(decodeWorkspace(value));
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
  "instances.trade-count",
  "instances.profit-daily",
  "instances.profit-history",
  "instances.overview",
  "instances.positions-all",
  "instances.closed-all",
  "instances.profit-daily-all",
  "instances.balance-history",
  "instances.balance-history.relative",
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
  "instances.trade-count",
  "instances.profit-daily",
  "instances.profit-history",
  "instances.overview",
  "instances.positions-all",
  "instances.closed-all",
  "instances.profit-daily-all",
  "instances.balance-history",
  "instances.balance-history.relative",
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
  "instances.trade-count",
  "instances.balance-history.relative",
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
export type SensitivitySettingsResponse = typeof SensitivitySettingsResponse.Type;

export const UpdateSensitivityRequest = Schema.Struct({
  /** New set of sensitive kinds (empty = nothing is sensitive). */
  sensitiveKinds: Schema.Array(InfoKind),
});
export type UpdateSensitivityRequest = typeof UpdateSensitivityRequest.Type;

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
  | "System"
  | "Bot"
  | "Workspace"
  | "Instances"
  | "Users"
  | "Auth";
export type ApiEndpointName = string;

/**
 * Backend endpoint -> required capability (one function per id).
 * `capabilitiesForEndpoint` is the single reader so widgets never hardcode
 * endpoint strings.
 */
export const ENDPOINT_CAPABILITIES: Readonly<
  Record<string, ReadonlyArray<Capability>>
> = {
  "System.health": ["system.health"],
  "System.backendConfig": ["system.backend-config"],
  // Not capabilities: readable by everyone, root-guarded in the handler.
  "System.sensitivity": [],
  "System.sensitivityUpdate": [],
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
  "Instances.tradeCount": ["instances.trade-count"],
  "Instances.profitDaily": ["instances.profit-daily"],
  "Instances.profitHistory": ["instances.profit-history"],
  "Instances.overview": ["instances.overview"],
  "Instances.positionsAll": ["instances.positions-all"],
  "Instances.closedAll": ["instances.closed-all"],
  "Instances.profitDailyAll": ["instances.profit-daily-all"],
  "Instances.balanceHistoryAll": ["instances.balance-history"],
  "Instances.balanceHistoryAllRelative": ["instances.balance-history.relative"],
  "Users.list": ["users.list"],
  "Users.create": ["users.create"],
  "Users.update": ["users.update"],
  "Users.remove": ["users.remove"],
  "Auth.capabilities": [],
  "Auth.login": [],
  "Auth.setupRoot": [],
  "Auth.logout": [],
};

export function capabilitiesForEndpoint(
  group: string,
  endpoint: string,
): ReadonlyArray<Capability> {
  return ENDPOINT_CAPABILITIES[`${group}.${endpoint}`] ?? [];
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
 */
export const SetupRootRequest = Schema.Struct({
  username: Schema.String.pipe(Schema.minLength(1)),
  password: Schema.String.pipe(Schema.minLength(1)),
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
          .addSuccess(LocksResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "blacklist",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/blacklist`
          .addSuccess(BlacklistResponse)
          .addError(BackendError, { status: 502 }),
      )
      .add(
        HttpApiEndpoint.get(
          "whitelist",
        )`/api/instances/${HttpApiSchema.param("id", Schema.String)}/whitelist`
          .addSuccess(WhitelistResponse)
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

/** Pull a `{ error, ... }` contract body out of a string (or Error message). */
const asContractError = (value: unknown): Record<string, unknown> | null => {
  if (typeof value !== "string" || value.length === 0) return null
  const trimmed = value.trim()
  if (!trimmed.startsWith("{")) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)["error"] === "string"
    ) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Not JSON — fall through.
  }
  return null
}

const sentenceCase = (text: string): string =>
  text.length > 0 ? text.charAt(0).toUpperCase() + text.slice(1) : text

/**
 * Human-readable message for contract / transport failures: understands the
 * `BackendError` shape (`{ error, detail }`), JSON-encoded bodies inside
 * Error messages, and plain strings/objects. Returns null for nullish input.
 */
export function formatQueryError(error: unknown): string | null {
  if (error == null) return null
  if (error instanceof Error) {
    const fromMessage = asContractError(error.message)
    if (fromMessage) return formatQueryError(fromMessage)
    return error.message
  }
  if (typeof error === "string") {
    const fromJson = asContractError(error)
    if (fromJson) return formatQueryError(fromJson)
    return error
  }
  if (typeof error === "object") {
    const record = error as Record<string, unknown>
    // `BackendError` shape from this contract (`{ error, detail }`).
    if (typeof record["error"] === "string") {
      const detail =
        typeof record["detail"] === "string" && record["detail"].length > 0
          ? `: ${record["detail"]}`
          : ""
      return `${sentenceCase(record["error"])}${detail}`
    }
    if (typeof record["message"] === "string") {
      const fromMessage = asContractError(record["message"])
      if (fromMessage) return formatQueryError(fromMessage)
      return record["message"]
    }
  }
  return String(error)
}
