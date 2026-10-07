// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { Effect, Either } from "effect";
import {
  FreqtradeError,
  type FreqtradeClientService,
} from "@nfi/freqtrade-client";
import type { CandlesResponse } from "@nfi/api-contract";
import type { CapabilityContext } from "./definition.js";
import { InstancesCandlesCapability } from "./instances-candles.js";

/**
 * `instances.candles` falls back to public exchange klines when freqtrade
 * has no analyzed data for the requested timeframe — the fix for "the
 * timeframe switcher only ever works on the strategy timeframe".
 */

const candle = (time: number): CandlesResponse["candles"][number] => ({
  time,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
});

function stubService(
  overrides: Partial<FreqtradeClientService>,
): FreqtradeClientService {
  return {
    ping: () => Effect.succeed({ status: "pong" }),
    getVersion: () => Effect.succeed({ version: "test" }),
    getStatus: () => Effect.die("unused"),
    getBalance: () => Effect.die("unused"),
    getProfit: () => Effect.die("unused"),
    getOpenTrades: () => Effect.die("unused"),
    getOpenPositions: () => Effect.die("unused"),
    getClosedPositions: () => Effect.die("unused"),
    getTagPerformance: () => Effect.die("unused"),
    getConfig: () => Effect.die("unused"),
    getCandles: () => Effect.die("unused"),
    getMarketCandles: () => Effect.die("unused"),
    getAvailablePairs: () => Effect.die("unused"),
    getWhitelist: () => Effect.die("unused"),
    getPlotConfig: () => Effect.die("unused"),
    getLocks: () => Effect.die("unused"),
    getBlacklist: () => Effect.die("unused"),
    getTradeCount: () => Effect.die("unused"),
    getProfitBuckets: () => Effect.die("unused"),
    getLogs: () => Effect.die("unused"),
    ...overrides,
  };
}

function stubCtx(service: FreqtradeClientService): CapabilityContext {
  const ctx: Pick<CapabilityContext, "resolveInstance"> = {
    resolveInstance: () => Effect.succeed(service),
  };

  // SAFETY: deliberate test double — `instances.candles` reads only
  // `resolveInstance` from the context.
  return ctx as CapabilityContext;
}

const runCandles = (
  service: FreqtradeClientService,
  options: {
    readonly id: string;
    readonly pair: string;
    readonly timeframe: string;
    readonly limit: string;
    readonly before?: string;
  } = {
    id: "default",
    pair: "BTC/USDT:USDT",
    timeframe: "15m",
    limit: "200",
  },
) =>
  Effect.runPromise(
    InstancesCandlesCapability.run(options, stubCtx(service)).pipe(
      Effect.either,
    ),
  );

const analyzed: CandlesResponse = {
  pair: "BTC/USDT:USDT",
  timeframe: "15m",
  candles: [candle(1_000), candle(61_000), candle(121_000)],
  source: "analyzed",
};

const market: CandlesResponse = {
  pair: "BTC/USDT:USDT",
  timeframe: "15m",
  candles: [candle(1_000), candle(901_000), candle(1_801_000)],
  source: "exchange",
};

describe("instances.candles exchange fallback", () => {
  it("serves analyzed candles untouched when freqtrade has them", async () => {
    const result = await runCandles(
      stubService({
        getCandles: () => Effect.succeed(analyzed),
        getMarketCandles: () => Effect.die("must not be called"),
      }),
    );

    expect(Either.isRight(result)).toBe(true);

    if (Either.isRight(result)) {
      expect(result.right.source).toBe("analyzed");
      expect(result.right.candles).toHaveLength(3);
    }
  });

  it("falls back to exchange klines for unanalyzed timeframes", async () => {
    const result = await runCandles(
      stubService({
        getCandles: () =>
          Effect.succeed({
            pair: "BTC/USDT:USDT",
            timeframe: "15m",
            candles: [],
            source: "analyzed",
          }),
        getMarketCandles: () => Effect.succeed(market),
      }),
    );

    expect(Either.isRight(result)).toBe(true);

    if (Either.isRight(result)) {
      expect(result.right.source).toBe("exchange");
      expect(result.right.candles).toHaveLength(3);
    }
  });

  it("keeps the honest empty result when the fallback fails", async () => {
    const result = await runCandles(
      stubService({
        getCandles: () =>
          Effect.succeed({
            pair: "BTC/USDT:USDT",
            timeframe: "15m",
            candles: [],
            source: "analyzed",
          }),
        getMarketCandles: () =>
          Effect.fail(
            new FreqtradeError({
              operation: "market-candles",
              reason: "no public market-data fallback for exchange kraken",
            }),
          ),
      }),
    );

    expect(Either.isRight(result)).toBe(true);

    if (Either.isRight(result)) {
      expect(result.right.candles).toHaveLength(0);
      expect(result.right.source ?? "analyzed").toBe("analyzed");
    }
  });

  it("ignores an unusable fallback payload (single candle)", async () => {
    const result = await runCandles(
      stubService({
        getCandles: () =>
          Effect.succeed({
            pair: "BTC/USDT:USDT",
            timeframe: "15m",
            candles: [],
            source: "analyzed",
          }),
        getMarketCandles: () =>
          Effect.succeed({
            pair: "BTC/USDT:USDT",
            timeframe: "15m",
            candles: [candle(1_000)],
            source: "exchange",
          }),
      }),
    );

    expect(Either.isRight(result)).toBe(true);

    if (Either.isRight(result)) expect(result.right.candles).toHaveLength(0);
  });
});

describe("instances.candles history paging", () => {
  it("serves a backward market page when `before` is set (analyzed skipped)", async () => {
    const historyPage: CandlesResponse = {
      pair: "BTC/USDT:USDT",
      timeframe: "15m",
      candles: [candle(-119_000), candle(-59_000)],
      source: "exchange",
    };

    let seenBefore: number | undefined;

    const result = await runCandles(
      stubService({
        getCandles: () => Effect.die("analyzed must not be called for pages"),
        getMarketCandles: (_pair, _timeframe, _limit, beforeMs) => {
          seenBefore = beforeMs;

          return Effect.succeed(historyPage);
        },
      }),
      {
        id: "default",
        pair: "BTC/USDT:USDT",
        timeframe: "15m",
        limit: "500",
        before: "1700000000000",
      },
    );

    expect(Either.isRight(result)).toBe(true);
    expect(seenBefore).toBe(1_700_000_000_000);

    if (Either.isRight(result)) {
      expect(result.right.source).toBe("exchange");
      expect(result.right.candles).toHaveLength(2);
    }
  });

  it("fails the before-page when the exchange has no backward source", async () => {
    const result = await runCandles(
      stubService({
        getMarketCandles: () =>
          Effect.fail(
            new FreqtradeError({
              operation: "market-candles",
              reason: "no public market-data fallback for exchange kraken",
            }),
          ),
      }),
      {
        id: "default",
        pair: "BTC/USDT:USDT",
        timeframe: "15m",
        limit: "500",
        before: "1700000000000",
      },
    );

    expect(Either.isLeft(result)).toBe(true);
  });

  it("rejects a non-numeric before instant", async () => {
    const result = await runCandles(
      stubService({
        getMarketCandles: () => Effect.die("must not be called"),
      }),
      {
        id: "default",
        pair: "BTC/USDT:USDT",
        timeframe: "15m",
        limit: "500",
        before: "not-a-number",
      },
    );

    expect(Either.isLeft(result)).toBe(true);
  });
});
