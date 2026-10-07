// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { Effect, Either } from "effect";
import type { CapabilityContext } from "./definition.js";
import type { DrawdownArgs, DrawdownResult } from "@nfi/db";
import { InstancesPerformanceStatsCapability } from "./instances-performance-stats.js";
import { InstancesDrawdownCapability } from "./instances-drawdown.js";
import { InstancesCumulativeProfitCapability } from "./instances-cumulative-profit.js";
import { InstancesExposureCapability } from "./instances-exposure.js";
import { InstancesTradedPairsCapability } from "./instances-traded-pairs.js";
import { makeTradesStub } from "./tradesStub.js";

/**
 * The server-computed metric capabilities must forward the instance scope
 * to the SQL layer verbatim (absent id = fleet = `null`) and derive the
 * display ratios from the SQL aggregates — the repo tests pin the SQL
 * semantics; here we pin the contract.
 */

/** Mutable partial context double — see the SAFETY notes inside ctxWith. */
interface TradesSnapshotsDouble {
  trades: CapabilityContext["trades"];
  snapshots?: CapabilityContext["snapshots"];
}

const ctxWith = (
  overrides: Parameters<typeof makeTradesStub>[0],
  snapshots?: (args: DrawdownArgs) => DrawdownResult,
): CapabilityContext => {
  // The capability under test only touches `trades` (stubbed) and
  // `snapshots.drawdown` (stubbed on demand), so the unimplemented
  // context members are never reached.
  const ctx: TradesSnapshotsDouble = {
    trades: makeTradesStub(overrides).trades,
  };

  if (snapshots !== undefined) {
    const drawdown: CapabilityContext["snapshots"]["drawdown"] = (args) =>
      Effect.succeed(snapshots(args));

    // SAFETY: drawdown-only view of the snapshot repo for the same reason.
    ctx.snapshots = { drawdown } as CapabilityContext["snapshots"];
  }

  // SAFETY: the partial double above satisfies every member the tested
  // capabilities read; the rest of the context is never dereferenced.
  return ctx as CapabilityContext;
};

const run = async <R>(effect: Effect.Effect<R, unknown>) => {
  const outcome = await Effect.runPromise(Effect.either(effect));

  return Either.isRight(outcome) ? outcome.right : undefined;
};

describe("instances.performance-stats", () => {
  it("derives the headline block from the SQL aggregate", async () => {
    // grossWin 70, grossLoss 15 -> net 55, PF 4.67, expectancy 55/42.
    const result = await run(
      InstancesPerformanceStatsCapability.run(
        { id: "default" },
        ctxWith({
          onPerformanceStats: (args) => {
            expect(args).toEqual({ instanceId: "default" });
          },
        }),
      ),
    );

    expect(result).toMatchObject({
      trades: 42,
      wins: 30,
      losses: 12,
      net: 55,
      winrate: (30 / 42) * 100,
      profitFactor: 70 / 15,
      expectancy: 55 / 42,
      avgWin: 70 / 30,
      avgLoss: 15 / 12,
      best: 9,
      worst: -3,
    });
  });

  it("forwards an absent id as the fleet scope (null)", async () => {
    await run(
      InstancesPerformanceStatsCapability.run(
        {},
        ctxWith({
          onPerformanceStats: (args) => {
            expect(args).toEqual({ instanceId: null });
          },
        }),
      ),
    );
  });

  it("reports profitFactor 0 for a lossless book (JSON-safe ∞)", async () => {
    const result = await run(
      InstancesPerformanceStatsCapability.run(
        { id: "default" },
        ctxWith({
          onPerformanceStats: () => ({
            trades: 3,
            wins: 3,
            losses: 0,
            grossWin: 9,
            grossLoss: 0,
            best: 9,
            worst: 1,
          }),
        }),
      ),
    );

    expect(result).toMatchObject({ profitFactor: 0, grossLoss: 0, wins: 3 });
  });
});

describe("instances.drawdown", () => {
  it("forwards the instance scope and curve limit to the SQL layer", async () => {
    const result = await run(
      InstancesDrawdownCapability.run(
        { id: "default", limit: "120" },
        ctxWith({}, (args) => {
          expect(args).toEqual({ instanceId: "default", limit: 120 });

          return {
            points: [{ recordedAt: "2026-10-07T00:00:00Z", drawdown: -3.2 }],
            maxDrawdown: -21.4,
            currentDrawdown: -3.2,
            peakValue: 812.6,
          };
        }),
      ),
    );

    expect(result).toMatchObject({ maxDrawdown: -21.4, peakValue: 812.6 });
  });

  it("defaults the fleet scope (null) and limit 500", async () => {
    await run(
      InstancesDrawdownCapability.run(
        {},
        ctxWith({}, (args) => {
          expect(args).toEqual({ instanceId: null, limit: 500 });

          return {
            points: [],
            maxDrawdown: 0,
            currentDrawdown: 0,
            peakValue: 0,
          };
        }),
      ),
    );
  });
});

describe("instances.cumulative-profit", () => {
  it("maps the SQL rows into one unnamed series for a single instance", async () => {
    const result = await run(
      InstancesCumulativeProfitCapability.run(
        { id: "default", limit: "50" },
        ctxWith({
          onCumulativeProfit: (args) => {
            expect(args).toEqual({ instanceId: "default", limit: 50 });
          },
        }),
      ),
    );

    expect(result?.series).toHaveLength(1);
    expect(result?.series[0]?.instanceId).toBeUndefined();
    expect(result?.series[0]?.points).toEqual([
      { at: "2026-10-05T00:00:00Z", profit: 5, cumulative: 5 },
      { at: "2026-10-06T00:00:00Z", profit: -2, cumulative: 3 },
    ]);
    expect(result?.series[0]).toMatchObject({ totalProfit: 3, trades: 2 });
  });
});

describe("instances.traded-pairs", () => {
  it("passes the SQL rows through with the row count", async () => {
    const result = await run(
      InstancesTradedPairsCapability.run(
        { id: "default" },
        ctxWith({
          onTradedPairs: (args) => {
            expect(args).toEqual({ instanceId: "default" });
          },
        }),
      ),
    );

    expect(result?.length).toBe(1);
    expect(result?.pairs[0]).toMatchObject({
      pair: "BTC/USDT",
      trades: 5,
      openTrades: 1,
      closedTrades: 4,
    });
  });

  it("forwards an absent id as the fleet scope (null)", async () => {
    await run(
      InstancesTradedPairsCapability.run(
        {},
        ctxWith({
          onTradedPairs: (args) => {
            expect(args).toEqual({ instanceId: null });
          },
        }),
      ),
    );
  });
});

describe("instances.exposure", () => {
  it("passes the SQL open summary through verbatim", async () => {
    const result = await run(
      InstancesExposureCapability.run(
        { id: "beta" },
        ctxWith({
          onOpenSummary: (args) => {
            expect(args).toEqual({ instanceId: "beta" });
          },
        }),
      ),
    );

    expect(result?.summary).toMatchObject({
      positions: 2,
      deployed: 300,
      unrealized: 6,
      maxLeverage: 2,
      longs: 1,
      shorts: 1,
      largestStake: 200,
      pairs: 2,
    });
    expect(result?.rows).toHaveLength(2);
    expect(result?.rows[0]).toMatchObject({ pair: "BTC/USDT", share: 2 / 3 });
  });

  it("forwards an absent id as the fleet scope (null)", async () => {
    await run(
      InstancesExposureCapability.run(
        {},
        ctxWith({
          onOpenSummary: (args) => {
            expect(args).toEqual({ instanceId: null });
          },
        }),
      ),
    );
  });
});
