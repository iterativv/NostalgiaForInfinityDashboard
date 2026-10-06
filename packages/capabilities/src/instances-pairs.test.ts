// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { Effect, Either } from "effect";
import {
  FreqtradeError,
  type FreqtradeClientService,
} from "@nfi/freqtrade-client";
import type { CapabilityContext } from "./definition.js";
import { InstancesPairsCapability } from "./instances-pairs.js";

/**
 * `instances.pairs` falls back to the bot whitelist when freqtrade gates
 * `available_pairs` (503 "not in the correct state" on some setups).
 */

const gated = new FreqtradeError({
  operation: "available_pairs",
  reason: "freqtrade returned 503",
  status: 503,
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
    getAvailablePairs: () => Effect.fail(gated),
    getWhitelist: () => Effect.succeed({ pairs: [] }),
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

  // SAFETY: deliberate test double — `instances.pairs` reads only
  // `resolveInstance` from the context.
  return ctx as CapabilityContext;
}

const runPairs = (service: FreqtradeClientService) =>
  Effect.runPromise(
    InstancesPairsCapability.run(
      { id: "default", timeframe: "15m" },
      stubCtx(service),
    ).pipe(Effect.either),
  );

describe("instances.pairs whitelist fallback", () => {
  it("serves available_pairs when freqtrade allows it", async () => {
    const service = stubService({
      getAvailablePairs: () =>
        Effect.succeed({
          pairs: ["BTC/USDT", "ETH/USDT"],
          length: 2,
          stakeCurrency: "USDT",
        }),
    });

    const result = await runPairs(service);
    expect(Either.isRight(result)).toBe(true);

    if (Either.isRight(result))
      expect(result.right.pairs).toEqual(["BTC/USDT", "ETH/USDT"]);
  });

  it("falls back to the whitelist when available_pairs is gated", async () => {
    const service = stubService({
      getWhitelist: () =>
        Effect.succeed({ pairs: ["HYPE/USDT:USDT", "BTC/USDT:USDT"] }),
    });

    const result = await runPairs(service);
    expect(Either.isRight(result)).toBe(true);

    if (Either.isRight(result)) {
      expect(result.right.pairs).toEqual(["HYPE/USDT:USDT", "BTC/USDT:USDT"]);
      expect(result.right.length).toBe(2);
    }
  });

  it("reports the original failure when the whitelist is empty or down", async () => {
    const empty = await runPairs(stubService({}));
    expect(Either.isLeft(empty)).toBe(true);

    if (Either.isLeft(empty))
      expect(empty.left.error).toContain("instance pairs failed");

    const down = await runPairs(
      stubService({ getWhitelist: () => Effect.fail(gated) }),
    );

    expect(Either.isLeft(down)).toBe(true);
  });
});
