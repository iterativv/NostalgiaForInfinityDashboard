// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { SqlClient } from "@effect/sql";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProfitSummary } from "@nfi/api-contract";
import { migrate, SnapshotRepo, SnapshotRepoLive } from "./index.js";

/**
 * SnapshotRepo.drawdown against real SQLite (temp file): the underwater
 * curve and its scalars are SQL window functions over the FULL snapshot
 * history — the property under test is that a small `limit` (curve tail)
 * never truncates max drawdown or the peak, which the old client-side
 * scan over a fetched window could not guarantee.
 */

const DB_PATH = join(tmpdir(), `nfi-desk-snapshots-test-${process.pid}.db`);

const SqlLive = SqliteClient.layer({ filename: DB_PATH });

const RepoLive = SnapshotRepoLive.pipe(Layer.provide(SqlLive));

const TestLive = Layer.mergeAll(RepoLive, SqlLive);

const runTest = <A, E>(
  effect: Effect.Effect<A, E, SnapshotRepo | SqlClient.SqlClient>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(TestLive)));

const drawdown = (instanceId: string | null, limit: number) =>
  Effect.flatMap(SnapshotRepo, (snapshots) =>
    snapshots.drawdown({ instanceId, limit }),
  );

const point = (profitAllCoin: number): ProfitSummary => ({
  profitClosedCoin: profitAllCoin,
  profitClosedPercent: 0,
  profitClosedFiat: 0,
  profitAllCoin,
  profitAllPercent: 0,
  profitAllFiat: 0,
  tradeCount: 0,
  closedTradeCount: 0,
  winningTrades: 0,
  losingTrades: 0,
  stakeCurrency: "USDT",
  fiatCurrency: "USD",
});

beforeAll(async () => {
  await Effect.runPromise(migrate.pipe(Effect.provide(SqlLive)));

  await runTest(
    Effect.flatMap(SnapshotRepo, (snapshots) =>
      Effect.gen(function* () {
        // dd1: deep early drawdown, then a recovery to a new peak. Running
        // peaks: 100, 100, 150, 150, 140 -> drawdowns 0, -50, 0, 0, -6.67.
        yield* snapshots.recordProfit("dd1", point(100));
        yield* snapshots.recordProfit("dd1", point(50));
        yield* snapshots.recordProfit("dd1", point(150));
        yield* snapshots.recordProfit("dd1", point(150));
        yield* snapshots.recordProfit("dd1", point(140));

        // dd2 shares one minute with dd1's last point (fleet merge sums them).
        yield* snapshots.recordProfit("dd2", point(10));
      }),
    ),
  );

  // Fleet scenario with EXPLICIT minutes (recordProfit stamps wall-clock
  // time, which a fast test cannot spread across minutes): two instances
  // whose per-minute sums form 110, 60, 170, 140.
  await runTest(
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      Effect.all(
        [
          ["fleetA", "2026-05-01T12:00:00.000Z", 100],
          ["fleetB", "2026-05-01T12:00:10.000Z", 10],
          ["fleetA", "2026-05-01T12:01:00.000Z", 50],
          ["fleetA", "2026-05-01T12:02:00.000Z", 150],
          ["fleetB", "2026-05-01T12:02:30.000Z", 20],
          ["fleetA", "2026-05-01T12:03:00.000Z", 140],
        ].map(
          ([instanceId, at, equity]) =>
            sql`INSERT INTO profit_snapshots (
            recorded_at, profit_closed_coin, profit_closed_percent, profit_closed_fiat,
            profit_all_coin, profit_all_percent, profit_all_fiat,
            trade_count, closed_trade_count, stake_currency, fiat_currency, instance_id
          ) VALUES (
            ${at}, 0, 0, 0, ${equity}, 0, 0, 0, 0, 'USDT', 'USD', ${instanceId}
          )`,
        ),
        { discard: true },
      ),
    ),
  );
});

afterAll(async () => {
  await rm(DB_PATH, { force: true });
});

describe("SnapshotRepo drawdown", () => {
  it("computes the curve, max drawdown and peak over the FULL history in SQL", async () => {
    const result = await runTest(drawdown("dd1", 1));

    // The curve tail is limited to the newest point…
    expect(result.points).toHaveLength(1);
    expect(result.points[0]?.drawdown).toBeCloseTo(
      -((150 - 140) / 150) * 100,
      5,
    );
    // …but the scalars cover the whole recorded history: the -50% hole
    // sits far outside the 1-point window.
    expect(result.maxDrawdown).toBeCloseTo(-50, 5);
    expect(result.currentDrawdown).toBeCloseTo(-((150 - 140) / 150) * 100, 5);
    expect(result.peakValue).toBe(150);
  });

  it("returns every point when the limit covers the history", async () => {
    const { points } = await runTest(drawdown("dd1", 100));

    expect(points.map((p) => p.drawdown)).toEqual([
      0,
      -50,
      0,
      0,
      -((150 - 140) / 150) * 100,
    ]);
  });

  it("merges every instance per minute for the fleet curve", async () => {
    const result = await runTest(drawdown(null, 100));

    // Per-minute fleet equity: 110 (A+B), 50 (A), 170 (A+B), 140 (A) from
    // the explicit scenario, then the beforeAll rows' minute (dd1 590 +
    // dd2 10). Running peaks 110, 110, 170, 170, 600 -> deepest hole at
    // the second minute.
    expect(result.points).toHaveLength(5);
    expect(result.maxDrawdown).toBeCloseTo(-((110 - 50) / 110) * 100, 5);
    expect(result.points.map((p) => p.drawdown)).toEqual([
      0,
      -((110 - 50) / 110) * 100,
      0,
      -((170 - 140) / 170) * 100,
      0,
    ]);
    expect(result.peakValue).toBe(100 + 50 + 150 + 150 + 140 + 10);
  });

  it("reports zeroed scalars for an instance without history", async () => {
    const result = await runTest(drawdown("nobody", 50));

    expect(result.points).toHaveLength(0);
    expect(result.maxDrawdown).toBe(0);
    expect(result.currentDrawdown).toBe(0);
    expect(result.peakValue).toBe(0);
  });
});
