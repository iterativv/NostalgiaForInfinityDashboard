// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type {
  AggregateArgs,
  AggregateResult,
  ClosedListResult,
  ClosedPercentStats,
  ClosedPercentStatsArgs,
  CumulativeProfitArgs,
  CumulativeProfitResult,
  ListClosedArgs,
  ListOpenArgs,
  MirrorClosedPosition,
  MirrorOpenPosition,
  OpenListResult,
  OpenSummaryArgs,
  OpenSummaryResult,
  PairListArgs,
  PairWatchArgs,
  PairWatchResultRow,
  PerformanceStats,
  PerformanceStatsArgs,
  TapeArgs,
  TradedPairRow,
  TradedPairsArgs,
} from "@nfi/db";
import type { BlacklistedPair, PairLock, TapeEvent } from "@nfi/api-contract";
import { Effect } from "effect";

/**
 * Shared test double for the trades mirror: every method is a no-op success
 * unless the test passed a callback or override for it. Callbacks record the
 * forwarded arguments (capabilities must pass filter state through verbatim)
 * and can return canned rows.
 */

export interface RecordedClosed extends ListClosedArgs {}

export interface RecordedOpen extends ListOpenArgs {}

export interface TradesStubOverrides {
  onClosed?: (args: ListClosedArgs) => Partial<ClosedListResult> | void;
  onOpen?: (args: ListOpenArgs) => Partial<OpenListResult> | void;
  onAggregate?: (args: AggregateArgs) => Partial<AggregateResult> | void;
  onTape?: (args: TapeArgs) => ReadonlyArray<TapeEvent> | void;
  onPairWatch?: (
    args: PairWatchArgs,
  ) => ReadonlyArray<PairWatchResultRow> | void;
  onPerformanceStats?: (args: PerformanceStatsArgs) => PerformanceStats | void;
  onCumulativeProfit?: (
    args: CumulativeProfitArgs,
  ) => CumulativeProfitResult | void;
  onOpenSummary?: (args: OpenSummaryArgs) => OpenSummaryResult | void;
  onClosedPercentStats?: (
    args: ClosedPercentStatsArgs,
  ) => ClosedPercentStats | void;
  onTradedPairs?: (
    args: TradedPairsArgs,
  ) => ReadonlyArray<TradedPairRow> | void;
}

export const makeTradesStub = (overrides: TradesStubOverrides = {}) => {
  const closedRow: MirrorClosedPosition = {
    tradeId: 101,
    pair: "BTC/USDT",
    isOpen: false,
    amount: 1,
    stakeAmount: 100,
    openRate: 50_000,
    openDate: "2026-10-05T00:00:00Z",
    instanceId: "default",
  };

  const openRow: MirrorOpenPosition = {
    tradeId: 100,
    pair: "BTC/USDT",
    isOpen: true,
    amount: 1,
    stakeAmount: 100,
    openRate: 50_000,
    openDate: "2026-10-05T00:00:00Z",
    instanceId: "default",
  };

  const defaultTapeEvents: TapeEvent[] = [
    {
      kind: "close",
      tradeId: 101,
      pair: "BTC/USDT",
      at: "2026-10-05T02:00:00Z",
      profitAbs: 5,
      instanceId: "default",
    },
  ];

  const defaultPairWatchRows: PairWatchResultRow[] = [
    {
      pair: "BTC/USDT",
      open: openRow,
      lastPct: 5,
      lastProfit: 5,
      lastCloseDate: "2026-10-05T02:00:00Z",
    },
  ];

  const defaultBlacklist: BlacklistedPair[] = [{ pair: "DOGE/USDT" }];

  const defaultLocks: PairLock[] = [
    {
      id: 1,
      pair: "BNB/USDT",
      lockTime: "2026-01-01T00:00:00Z",
      lockEndTime: "2026-01-02T00:00:00Z",
      reason: "cooldown",
      active: true,
    },
  ];

  const trades = {
    upsertClosed: () => Effect.void,
    upsertOpen: () => Effect.void,
    replaceWhitelist: () => Effect.void,
    replaceBlacklist: () => Effect.void,
    replaceLocks: () => Effect.void,
    deleteInstanceData: () => Effect.void,
    getSyncState: () => Effect.succeed(null),
    setSyncState: () => Effect.void,
    countClosed: () => Effect.succeed(0),
    clearClosed: () => Effect.void,

    listClosed: (args: ListClosedArgs) =>
      Effect.succeed({
        positions: [closedRow],
        total: 7,
        ...overrides.onClosed?.(args),
      }),
    listOpen: (args: ListOpenArgs) =>
      Effect.succeed({
        positions: [openRow],
        total: 1,
        ...overrides.onOpen?.(args),
      }),
    aggregate: (args: AggregateArgs) =>
      Effect.succeed({
        rows: [
          {
            tag: "alpha",
            instanceId: null,
            trades: 4,
            wins: 3,
            losses: 1,
            winrate: 0.75,
            profitAbs: 12,
            profitPctAvg: 3.5,
          },
        ],
        totalMatching: 42,
        totals: {
          trades: 42,
          wins: 30,
          losses: 12,
          winrate: 30 / 42,
          profitAbs: 55,
          profitPctAvg: 2.1,
        },
        best: { tag: "alpha", value: 12 },
        worst: { tag: "beta", value: -4 },
        bestEdge: { tag: "alpha", value: 3.5 },
        ...overrides.onAggregate?.(args),
      }),
    performanceStats: (args: PerformanceStatsArgs) =>
      Effect.succeed(
        overrides.onPerformanceStats?.(args) ?? {
          trades: 42,
          wins: 30,
          losses: 12,
          grossWin: 70,
          grossLoss: 15,
          best: 9,
          worst: -3,
        },
      ),
    cumulativeProfit: (args: CumulativeProfitArgs) =>
      Effect.succeed(
        overrides.onCumulativeProfit?.(args) ?? {
          rows: [
            {
              instanceId: args.instanceId ?? "default",
              at: "2026-10-05T00:00:00Z",
              profit: 5,
              cumulative: 5,
            },
            {
              instanceId: args.instanceId ?? "default",
              at: "2026-10-06T00:00:00Z",
              profit: -2,
              cumulative: 3,
            },
          ],
          totals: [
            {
              instanceId: args.instanceId ?? "default",
              trades: 2,
              totalProfit: 3,
            },
          ],
        },
      ),
    openSummary: (args: OpenSummaryArgs) =>
      Effect.succeed(
        overrides.onOpenSummary?.(args) ?? {
          summary: {
            positions: 2,
            deployed: 300,
            unrealized: 6,
            maxLeverage: 2,
            longs: 1,
            shorts: 1,
            largestStake: 200,
            pairs: 2,
            avgProfitPct: 1.5,
          },
          rows: [
            {
              pair: "BTC/USDT",
              positions: 1,
              stake: 200,
              unrealized: 5,
              share: 2 / 3,
            },
            {
              pair: "ETH/USDT",
              positions: 1,
              stake: 100,
              unrealized: 1,
              share: 1 / 3,
            },
          ],
        },
      ),
    tradedPairs: (args: TradedPairsArgs) =>
      Effect.succeed(
        overrides.onTradedPairs?.(args) ?? [
          {
            pair: "BTC/USDT",
            trades: 5,
            openTrades: 1,
            closedTrades: 4,
            lastAt: "2026-10-05T02:00:00Z",
          },
        ],
      ),
    closedPercentStats: (args: ClosedPercentStatsArgs) =>
      Effect.succeed(
        overrides.onClosedPercentStats?.(args) ?? {
          withPnl: 42,
          wins: 30,
          winRatePct: (30 / 42) * 100,
          avgProfitPct: 2.1,
          bestPct: 9,
          worstPct: -3,
        },
      ),
    tape: (args: TapeArgs) =>
      Effect.succeed(overrides.onTape?.(args) ?? defaultTapeEvents),
    pairWatch: (args: PairWatchArgs) =>
      Effect.succeed(overrides.onPairWatch?.(args) ?? defaultPairWatchRows),
    listWhitelist: (_args: PairListArgs) =>
      Effect.succeed({ pairs: ["BTC/USDT"], length: 1 }),
    listBlacklist: (_args: PairListArgs) =>
      Effect.succeed({
        pairs: defaultBlacklist,
        length: 1,
      }),
    listLocks: (_args: { instanceId: string; includeExpired: boolean }) =>
      Effect.succeed({
        locks: defaultLocks,
        countOnRecord: 1,
      }),
  };

  return { trades };
};
