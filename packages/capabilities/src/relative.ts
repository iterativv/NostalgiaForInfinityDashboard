// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type {
  BalanceResponse,
  ClosedPositionsResponse,
  FleetBalanceHistoryResponse,
  OpenPositionsResponse,
  OpenTradesResponse,
  ProfitPoint,
  ProfitSummary,
  RelativeBalance,
  RelativeBalanceHistoryResponse,
  RelativeClosedPositionsResponse,
  RelativeFleetBalanceHistoryResponse,
  RelativeFleetProfitHistoryResponse,
  RelativeOpenPositionsResponse,
  RelativeOrder,
  RelativeProfit,
  RelativeProfitHistoryResponse,
  RelativeTagPerformanceResponse,
  RelativeTradesResponse,
  TagGroupBy,
  TagPerformanceResponse,
  TradeOrder,
} from "@nfi/api-contract";
import type {
  BalanceHistoryResponse,
  ProfitHistoryResponse,
} from "@nfi/api-contract";
import { isJsonObject, type JsonValue } from "./definition.js";

/**
 * Absolute -> relative transforms (pure functions, no I/O).
 *
 * These mirror every balance/PnL capability for publicly shareable pages.
 * Since callers can pass ANY options (any instance id, limit, offset, ...),
 * the mirrors are safe by construction: they only ever emit percentages,
 * allocation weights and rebased indices, and they never emit absolute coin /
 * fiat amounts, stake sizes, order prices or order amounts. There is no way
 * to calculate, derive or track down the freqtrade absolute balance or
 * absolute PnL from a `.relative` response — regardless of the options used.
 *
 * - Weights are shares of a server-side total that is never exposed.
 * - Histories are rebased per returned window: the first visible point is
 *   exactly 100, so shifting `limit`/`offset` cannot reveal the baseline.
 * - Rebase is direction-preserving (`100 + (v - base) / scale * 100`) so a
 *   negative starting profit does not invert the curve; `scale >= 1` keeps
 *   the all-zero window well-defined (flat 100s).
 */

/** Exact JSON keys that must NEVER appear in a relative payload. */
export const RELATIVE_BANNED_KEYS: ReadonlyArray<string> = [
  "profitAbs",
  "closeProfitAbs",
  "profitFiat",
  "realizedProfit",
  "stakeAmount",
  "maxStakeAmount",
  "totalStake",
  "profitClosedCoin",
  "profitAllCoin",
  "profitClosedFiat",
  "profitAllFiat",
  "free",
  "used",
  "total",
  "amount",
  "price",
  "cost",
  "filled",
  "remaining",
  "openRate",
  "currentRate",
  "closeRate",
  "liquidationPrice",
  "fundingFees",
  "note",
];

/** Collect every object key in a JSON value (for leak tests). */
export const collectKeys = (value: JsonValue): string[] => {
  const keys: string[] = [];

  const visit = (node: JsonValue): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
    } else if (isJsonObject(node)) {
      for (const [key, entry] of Object.entries(node)) {
        keys.push(key);
        visit(entry);
      }
    }
  };

  visit(value);

  return keys;
};

const num = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isFinite(value) ? value : undefined;

const str = (value: string | undefined): string | undefined =>
  value !== undefined && value.length > 0 ? value : undefined;

/** Rebase a window of absolute values to an index starting at exactly 100. */
export const rebaseToIndex = (values: ReadonlyArray<number>): number[] => {
  if (values.length === 0) return [];
  const base = values[0] ?? 0;
  let peak = 1;

  for (const v of values) {
    const a = Math.abs(v - base);

    if (a > peak) peak = a;
  }

  return values.map((v) => 100 + ((v - base) / peak) * 100);
};

export const toRelativeBalance = (
  absolute: BalanceResponse,
): RelativeBalance => {
  const total =
    Number.isFinite(absolute.totalStake) && absolute.totalStake > 0
      ? absolute.totalStake
      : 0;

  return {
    stakeCurrency: absolute.stakeCurrency,
    currencies: absolute.currencies.map((c) => ({
      currency: c.currency,
      weight: total > 0 ? c.total / total : 0,
      freeWeight: total > 0 ? c.free / total : 0,
      usedWeight: total > 0 ? c.used / total : 0,
    })),
  };
};

export const toRelativeProfit = (absolute: ProfitSummary): RelativeProfit => ({
  profitClosedPercent: absolute.profitClosedPercent,
  profitAllPercent: absolute.profitAllPercent,
  tradeCount: absolute.tradeCount,
  closedTradeCount: absolute.closedTradeCount,
  stakeCurrency: absolute.stakeCurrency,
  fiatCurrency: absolute.fiatCurrency,
});

export const toRelativeTrades = (
  absolute: OpenTradesResponse,
): RelativeTradesResponse => ({
  trades: absolute.trades.map((t) => ({
    tradeId: t.tradeId,
    pair: t.pair,
    isOpen: t.isOpen,
    profitPct: num(t.profitPct),
    openDate: t.openDate,
    strategy: str(t.strategy),
    timeframe: str(t.timeframe),
  })),
});

export const toRelativeProfitHistory = (
  absolute: ProfitHistoryResponse,
): RelativeProfitHistoryResponse => {
  const closed = absolute.points.map((p) => p.profitClosedCoin);
  const all = absolute.points.map((p) => p.profitAllCoin);
  const closedIndex = rebaseToIndex(closed);
  const allIndex = rebaseToIndex(all);

  return {
    points: absolute.points.map((p, i) => ({
      recordedAt: p.recordedAt,
      profitClosedIndex: closedIndex[i] ?? 100,
      profitAllIndex: allIndex[i] ?? 100,
    })),
  };
};

export const toRelativeBalanceHistory = (
  absolute: BalanceHistoryResponse,
): RelativeBalanceHistoryResponse => {
  const index = rebaseToIndex(absolute.points.map((p) => p.totalStake));

  return {
    points: absolute.points.map((p, i) => ({
      recordedAt: p.recordedAt,
      balanceIndex: index[i] ?? 100,
    })),
  };
};

/**
 * Fleet variant: every instance is rebased on its OWN first visible point,
 * so a `limit` cannot reveal any instance's absolute baseline — including
 * relative differences between bots' wallet sizes.
 */
export const toRelativeFleetBalanceHistory = (
  absolute: FleetBalanceHistoryResponse,
): RelativeFleetBalanceHistoryResponse => ({
  instances: absolute.instances.map((row) => {
    const index = rebaseToIndex(row.points.map((p) => p.totalStake));

    return {
      instanceId: row.instanceId,
      instanceName: row.instanceName,
      points: row.points.map((p, i) => ({
        recordedAt: p.recordedAt,
        balanceIndex: index[i] ?? 100,
      })),
      error: str(row.error),
    };
  }),
});

/** Fleet profit history input (no absolute fleet DTO — assembled per run). */
interface FleetProfitHistoryInput {
  readonly instances: ReadonlyArray<{
    readonly instanceId: string;
    readonly instanceName: string;
    readonly points: ReadonlyArray<ProfitPoint>;
    readonly error?: string;
  }>;
}

/**
 * Fleet profit variant: each instance's closed/all profit is rebased on its
 * OWN first visible point, so curves compare shape without leaking any
 * bot's absolute profit — nor the profit ratio between bots.
 */
export const toRelativeFleetProfitHistory = (
  absolute: FleetProfitHistoryInput,
): RelativeFleetProfitHistoryResponse => ({
  instances: absolute.instances.map((row) => {
    const closedIndex = rebaseToIndex(
      row.points.map((p) => p.profitClosedCoin),
    );

    const allIndex = rebaseToIndex(row.points.map((p) => p.profitAllCoin));

    return {
      instanceId: row.instanceId,
      instanceName: row.instanceName,
      points: row.points.map((p, i) => ({
        recordedAt: p.recordedAt,
        profitClosedIndex: closedIndex[i] ?? 100,
        profitAllIndex: allIndex[i] ?? 100,
      })),
      error: str(row.error),
    };
  }),
});

const toRelativeOrderFacets = (o: TradeOrder): RelativeOrder => ({
  side: o.side,
  status: str(o.status),
  isEntry: o.isEntry,
  tag: str(o.tag),
});

export const toRelativeOpenPositions = (
  absolute: OpenPositionsResponse,
  totalStake: number,
): RelativeOpenPositionsResponse => ({
  positions: absolute.positions.map((p) => ({
    tradeId: p.tradeId,
    pair: p.pair,
    isOpen: p.isOpen,
    isShort: p.isShort,
    profitPct: num(p.profitPct),
    allocationWeight: totalStake > 0 ? p.stakeAmount / totalStake : 0,
    openDate: p.openDate,
    strategy: str(p.strategy),
    timeframe: str(p.timeframe),
    enterTag: str(p.enterTag),
    leverage: num(p.leverage),
    orders: p.orders?.map(toRelativeOrderFacets),
  })),
});

export const toRelativeClosedPositions = (
  absolute: ClosedPositionsResponse,
): RelativeClosedPositionsResponse => ({
  positions: absolute.positions.map((p) => ({
    tradeId: p.tradeId,
    pair: p.pair,
    isOpen: p.isOpen,
    isShort: p.isShort,
    profitPct: num(p.profitPct),
    closeProfitPct: num(p.closeProfitPct),
    openDate: p.openDate,
    closeDate: str(p.closeDate),
    tradeDurationSeconds: num(p.tradeDurationSeconds),
    strategy: str(p.strategy),
    timeframe: str(p.timeframe),
    enterTag: str(p.enterTag),
    exitReason: str(p.exitReason),
    leverage: num(p.leverage),
    orders: p.orders?.map(toRelativeOrderFacets),
  })),
  tradesCount: num(absolute.tradesCount),
  totalTrades: num(absolute.totalTrades),
  offset: num(absolute.offset),
});

/** Mutable local shape; assignable to the readonly response type. */
interface MutableTagPerformanceBase {
  groupBy: TagGroupBy;
  rows: RelativeTagPerformanceResponse["rows"];
  aggregatedTrades: number;
  totalTrades?: number;
  stats?: NonNullable<RelativeTagPerformanceResponse["stats"]>;
}

export const toRelativeTagPerformance = (
  absolute: Omit<TagPerformanceResponse, "totals" | "best" | "worst"> & {
    /** Percentages-only stats (pre-stripped by the caller). */
    readonly stats?: {
      readonly trades: number;
      readonly wins: number;
      readonly losses: number;
      readonly winrate: number;
      readonly profitPctAvg: number;
      readonly bestEdge?: { readonly tag: string; readonly value: number };
    };
  },
): RelativeTagPerformanceResponse => {
  const base: MutableTagPerformanceBase = {
    groupBy: absolute.groupBy,
    rows: absolute.rows.map((r) => ({
      tag: r.tag,
      trades: r.trades,
      wins: r.wins,
      losses: r.losses,
      winrate: r.winrate,
      profitPctAvg: r.profitPctAvg,
      instanceId: r.instanceId,
      instanceName: r.instanceName,
    })),
    aggregatedTrades: absolute.aggregatedTrades,
    totalTrades: num(absolute.totalTrades),
  };

  // Stats pass through as the percentages-only subset; the absolute
  // `profitAbs` sum and the absolute `best`/`worst` extremes never enter
  // the relative payload.
  if (absolute.stats !== undefined) base.stats = absolute.stats;

  return base;
};
