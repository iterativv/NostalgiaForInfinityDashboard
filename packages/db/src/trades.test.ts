// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { SqlClient } from "@effect/sql";
import { SqliteClient } from "@effect/sql-sqlite-node";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, TradesRepo, TradesRepoLive } from "./index.js";
import type { ClosedPosition, OpenPosition } from "@nfi/api-contract";

/**
 * TradesRepo against real SQLite (temp file) — the mirror behind every
 * SQL-level table filter. The suite pins the semantics the capabilities
 * rely on: upsert idempotence, search covering order ids via json_each,
 * true filtered totals, GROUP BY aggregation with HAVING, movers, tape and
 * the pair-watch join.
 */

const DB_PATH = join(tmpdir(), `nfi-desk-trades-test-${process.pid}.db`);

const SqlLive = SqliteClient.layer({ filename: DB_PATH });

const RepoLive = TradesRepoLive.pipe(Layer.provide(SqlLive));

const TestLive = Layer.mergeAll(RepoLive, SqlLive);

const runTest = <A, E>(
  effect: Effect.Effect<A, E, TradesRepo | SqlClient.SqlClient>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(TestLive)));

const repo = <A, E>(
  f: (trades: typeof TradesRepo.Service) => Effect.Effect<A, E, TradesRepo>,
) => Effect.flatMap(TradesRepo, f);

const closed = (
  overrides: Partial<ClosedPosition> & { tradeId: number },
): ClosedPosition => ({
  pair: "BTC/USDT",
  isOpen: false,
  amount: 1,
  stakeAmount: 100,
  openRate: 50_000,
  openDate: `2026-01-01T00:00:00Z`,
  closeDate: `2026-01-02T00:00:00Z`,
  closeProfitAbs: 5,
  closeProfitPct: 5,
  profitAbs: 5,
  profitPct: 5,
  ...overrides,
});

const open = (
  overrides: Partial<OpenPosition> & { tradeId: number },
): OpenPosition => ({
  pair: "ETH/USDT",
  isOpen: true,
  amount: 2,
  stakeAmount: 200,
  openRate: 3_000,
  openDate: "2026-02-01T00:00:00Z",
  currentRate: 3_100,
  profitAbs: 6,
  profitPct: 3,
  ...overrides,
});

const BTC_ORDERS = [
  { orderId: "ord-abc-1", side: "buy" },
  { orderId: "ord-abc-2", side: "sell" },
];

beforeAll(async () => {
  await Effect.runPromise(migrate.pipe(Effect.provide(SqlLive)));

  // Two instances: alpha with 3 closed + 1 open, beta with 1 closed.
  await runTest(
    repo((trades) =>
      Effect.all([
        trades.upsertClosed("alpha", [
          closed({ tradeId: 1, pair: "BTC/USDT", orders: BTC_ORDERS }),
          closed({
            tradeId: 2,
            pair: "ETH/USDT",
            closeProfitAbs: -3,
            closeProfitPct: -3,
            profitAbs: -3,
            profitPct: -3,
            strategy: "scalp",
          }),
          closed({
            tradeId: 3,
            pair: "SOL/USDT",
            closeProfitAbs: 10,
            closeProfitPct: 12,
            profitAbs: 10,
            profitPct: 12,
            strategy: "scalp",
            enterTag: "momentum",
          }),
        ]),
        trades.upsertOpen("alpha", [
          open({
            tradeId: 100,
            pair: "BTC/USDT",
            profitPct: 4,
            profitAbs: 8,
          }),
        ]),
        trades.upsertClosed("beta", [
          closed({ tradeId: 1, pair: "BTC/USDT", closeProfitAbs: -1 }),
        ]),
        // A trade that was open and then closed: the closed upsert overwrites
        // the open row in place (same PK) instead of duplicating it.
        trades.upsertOpen("alpha", [open({ tradeId: 55 })]),
        trades.upsertClosed("alpha", [
          closed({ tradeId: 55, closeProfitAbs: 1, closeProfitPct: 1 }),
        ]),
        trades.replaceWhitelist("alpha", ["BTC/USDT", "ETH/USDT", "SOL/USDT"]),
        trades.replaceBlacklist("alpha", [
          { pair: "DOGE/USDT", reason: "meme" },
          { pair: "PEPE/USDT", reason: "too volatile" },
        ]),
        trades.replaceLocks("alpha", [
          {
            id: 7,
            pair: "BNB/USDT",
            lockTime: "2026-01-01T00:00:00Z",
            lockEndTime: "2026-01-02T00:00:00Z",
            reason: "cooldown",
            active: true,
          },
          {
            id: 8,
            pair: "ADA/USDT",
            lockTime: "2025-01-01T00:00:00Z",
            lockEndTime: "2025-01-02T00:00:00Z",
            reason: "old",
            active: false,
          },
        ]),
      ]),
    ),
  );
});

afterAll(async () => {
  await rm(DB_PATH, { force: true });
});

describe("TradesRepo upserts", () => {
  it("upserts idempotently (no duplicate rows)", async () => {
    // Same trade id upserted again: no duplicate row.
    await runTest(
      repo((trades) =>
        Effect.gen(function* () {
          yield* trades.upsertClosed("alpha", [
            closed({ tradeId: 1, pair: "BTC/USDT", orders: BTC_ORDERS }),
          ]);

          return yield* trades.countClosed("alpha");
        }),
      ),
    ).then((n) => expect(n).toBe(4));
  });
});

describe("TradesRepo listClosed", () => {
  it("paginates newest-first and reports the true filtered total", async () => {
    const page = await runTest(
      repo((trades) =>
        trades.listClosed({
          instanceId: null,
          search: null,
          limit: 3,
          offset: 0,
        }),
      ),
    );

    expect(page.total).toBe(5); // alpha 3 + trade 55 + beta 1
    // Newest close date first; ties break on trade id descending.
    expect(page.positions.map((p) => p.tradeId)).toEqual([55, 3, 2]);
    expect(page.positions[0]?.instanceId).toBe("alpha");
  });

  it("searches across pair, strategy, tag, exit reason, trade id and order ids", async () => {
    const byOrder = await runTest(
      repo((trades) =>
        trades.listClosed({
          instanceId: null,
          search: "ord-abc-2",
          limit: 10,
          offset: 0,
        }),
      ),
    );

    expect(byOrder.positions.map((p) => p.tradeId)).toEqual([1]);

    const byTradeId = await runTest(
      repo((trades) =>
        trades.listClosed({
          instanceId: null,
          search: "3",
          limit: 10,
          offset: 0,
        }),
      ),
    );

    expect(byTradeId.positions.some((p) => p.tradeId === 3)).toBe(true);

    const byTag = await runTest(
      repo((trades) =>
        trades.listClosed({
          instanceId: "alpha",
          search: "momentum",
          limit: 10,
          offset: 0,
        }),
      ),
    );

    expect(byTag.positions.map((p) => p.tradeId)).toEqual([3]);
    // Filtered total, not the unfiltered 4.
    expect(byTag.total).toBe(1);
  });
});

describe("TradesRepo listOpen", () => {
  it("filters, sorts and partitions by sign in SQL", async () => {
    const movers = await runTest(
      repo((trades) =>
        trades.listOpen({
          instanceId: null,
          search: null,
          sort: "profitPct",
          dir: "desc",
          filter: "gain",
          limit: 1,
        }),
      ),
    );

    expect(movers.positions).toHaveLength(1);
    expect(movers.positions[0]?.tradeId).toBe(100);
    expect(movers.positions[0]?.currentRate).toBe(3_100);
  });
});

describe("TradesRepo aggregate", () => {
  it("groups the full history per dimension with wins/losses", async () => {
    const byStrategy = await runTest(
      repo((trades) =>
        trades.aggregate({
          instanceId: "alpha",
          groupBy: "strategy",
          search: null,
          minTrades: null,
          sortBy: "profitAbs",
          sortDir: "desc",
          limit: 10,
          perInstance: false,
          bestEdgeMinTrades: null,
        }),
      ),
    );

    // scalp: trades 2 + 3 -> profit 7; empty strategy: trades 1 + 55 -> 5 + 2.
    expect(byStrategy.rows.map((r) => r.tag)).toEqual(["scalp", ""]);
    expect(byStrategy.rows[0]?.trades).toBe(2);
    expect(byStrategy.rows[0]?.profitAbs).toBe(7);
    expect(byStrategy.rows[0]?.wins).toBe(1);
    expect(byStrategy.rows[0]?.losses).toBe(1);
    expect(byStrategy.totalMatching).toBe(4);
  });

  it("applies HAVING (minTrades) and groups per instance for fleet strategy rows", async () => {
    const perInstance = await runTest(
      repo((trades) =>
        trades.aggregate({
          instanceId: null,
          groupBy: "strategy",
          search: null,
          minTrades: 2,
          sortBy: "trades",
          sortDir: "desc",
          limit: 10,
          perInstance: true,
          bestEdgeMinTrades: null,
        }),
      ),
    );

    // (strategy, instance) groups with 2+ trades: alpha's scalp pair and
    // alpha's untagged pair; beta's single trade is filtered by HAVING.
    expect(perInstance.rows.map((r) => [r.instanceId, r.tag])).toEqual([
      ["alpha", ""],
      ["alpha", "scalp"],
    ]);
  });
});

describe("TradesRepo tape", () => {
  it("merges newest opens and closes into one feed with SQL-side selection", async () => {
    const feed = await runTest(
      repo((trades) =>
        trades.tape({
          instanceId: "alpha",
          limit: 3,
          opens: true,
          closes: true,
        }),
      ),
    );

    expect(feed).toHaveLength(3);
    // Newest event overall first (the open trade from 2026-02).
    expect(feed[0]?.kind).toBe("open");
    expect(feed[0]?.tradeId).toBe(100);

    const closesOnly = await runTest(
      repo((trades) =>
        trades.tape({
          instanceId: "alpha",
          limit: 2,
          opens: false,
          closes: true,
        }),
      ),
    );

    expect(closesOnly.every((e) => e.kind === "close")).toBe(true);
  });
});

describe("TradesRepo pairWatch", () => {
  it("joins live open state with the pair's most recent close", async () => {
    const rows = await runTest(
      repo((trades) =>
        trades.pairWatch({
          instanceId: null,
          pairs: ["btc/usdt", "SOL/USDT", "XRP/USDT"],
          showOnlyOpen: false,
        }),
      ),
    );

    expect(rows.map((r) => r.pair)).toEqual([
      "BTC/USDT",
      "SOL/USDT",
      "XRP/USDT",
    ]);

    const btc = rows[0]!;
    expect(btc.open).not.toBeNull();
    expect(btc.open?.instanceId).toBe("alpha");
    // Last close across instances: beta's -1 (2026-01-02, same date as
    // alpha trade 1 — the join keeps one deterministic row per pair).
    expect(btc.lastPct).not.toBeNull();

    const sol = rows[1]!;
    expect(sol.open).toBeNull();
    expect(sol.lastPct).toBe(12);

    expect(rows[2]?.open).toBeNull();
    expect(rows[2]?.lastPct).toBeNull();
  });

  it("showOnlyOpen keeps only pairs held open right now", async () => {
    const rows = await runTest(
      repo((trades) =>
        trades.pairWatch({
          instanceId: null,
          pairs: ["BTC/USDT", "SOL/USDT"],
          showOnlyOpen: true,
        }),
      ),
    );

    expect(rows.map((r) => r.pair)).toEqual(["BTC/USDT"]);
  });
});

describe("TradesRepo pair lists and locks", () => {
  it("searches whitelists with unfiltered lengths", async () => {
    const result = await runTest(
      repo((trades) =>
        trades.listWhitelist({ instanceId: "alpha", search: "eth" }),
      ),
    );

    expect(result.pairs).toEqual(["ETH/USDT"]);
    expect(result.length).toBe(3);
  });

  it("searches blacklists across pair and reason", async () => {
    const result = await runTest(
      repo((trades) =>
        trades.listBlacklist({ instanceId: "alpha", search: "volatile" }),
      ),
    );

    expect(result.pairs.map((p) => p.pair)).toEqual(["PEPE/USDT"]);
    expect(result.length).toBe(2);
  });

  it("hides expired locks unless asked for", async () => {
    const active = await runTest(
      repo((trades) =>
        trades.listLocks({ instanceId: "alpha", includeExpired: false }),
      ),
    );

    expect(active.locks.map((l) => l.id)).toEqual([7]);
    // Unfiltered SQL count rides along for the header stat.
    expect(active.countOnRecord).toBe(2);

    const all = await runTest(
      repo((trades) =>
        trades.listLocks({ instanceId: "alpha", includeExpired: true }),
      ),
    );

    expect(all.locks).toHaveLength(2);
  });
});

describe("TradesRepo sync state + cleanup", () => {
  it("persists sync state and drops everything on instance removal", async () => {
    await runTest(
      repo((trades) =>
        Effect.gen(function* () {
          yield* trades.setSyncState("alpha", {
            backfillDone: true,
            lastTailAt: "2026-03-01T00:00:00Z",
            lastTotal: 4,
          });

          return yield* trades.getSyncState("alpha");
        }),
      ),
    ).then((state) => {
      expect(state?.backfillDone).toBe(true);
      expect(state?.lastTotal).toBe(4);
    });

    await runTest(repo((trades) => trades.deleteInstanceData("alpha")));

    await runTest(
      repo((trades) =>
        Effect.all([
          trades.countClosed("alpha"),
          trades.getSyncState("alpha"),
          trades.listWhitelist({ instanceId: "alpha", search: null }),
          trades.listLocks({ instanceId: "alpha", includeExpired: true }),
        ]),
      ),
    ).then(([count, state, whitelist, locks]) => {
      expect(count).toBe(0);
      expect(state).toBeNull();
      expect(whitelist.pairs).toHaveLength(0);
      expect(locks.locks).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Server-side metric reads (full-history SQL aggregates)
//
// The gamma/delta instances below are seeded inside the tests (not in
// beforeAll) so the shared-database assertions above — which pin alpha/beta
// row counts — stay intact whichever order vitest runs them in.
// ---------------------------------------------------------------------------

const seedMetricsInstances = repo((trades) =>
  Effect.gen(function* () {
    yield* trades.upsertClosed("gamma", [
      closed({
        tradeId: 1,
        pair: "BTC/USDT",
        closeDate: "2026-01-01T00:00:00Z",
        closeProfitAbs: 5,
        closeProfitPct: 5,
      }),
      closed({
        tradeId: 2,
        pair: "ETH/USDT",
        closeDate: "2026-01-02T00:00:00Z",
        closeProfitAbs: -3,
        closeProfitPct: -3,
      }),
      closed({
        tradeId: 3,
        pair: "SOL/USDT",
        closeDate: "2026-01-03T00:00:00Z",
        closeProfitAbs: 10,
        closeProfitPct: 12,
      }),
      closed({
        tradeId: 4,
        pair: "BTC/USDT",
        closeDate: "2026-01-04T00:00:00Z",
        closeProfitAbs: 1,
        closeProfitPct: 1,
      }),
    ]);
    yield* trades.upsertClosed("delta", [
      closed({
        tradeId: 1,
        pair: "XRP/USDT",
        closeDate: "2026-01-05T00:00:00Z",
        closeProfitAbs: -1,
        closeProfitPct: -2,
      }),
    ]);
    yield* trades.upsertOpen("gamma", [
      open({
        tradeId: 10,
        pair: "BTC/USDT",
        stakeAmount: 100,
        profitAbs: 5,
        profitPct: 2,
      }),
      open({
        tradeId: 11,
        pair: "ETH/USDT",
        stakeAmount: 300,
        profitAbs: -2,
        profitPct: -1,
      }),
      open({
        tradeId: 12,
        pair: "SOL/USDT",
        stakeAmount: 100,
        profitAbs: 0,
        profitPct: 0,
        isShort: true,
        leverage: 3,
      }),
    ]);
    yield* trades.upsertOpen("delta", [
      open({
        tradeId: 20,
        pair: "BTC/USDT",
        stakeAmount: 200,
        profitAbs: 8,
        profitPct: 4,
      }),
    ]);
  }),
);

describe("TradesRepo performanceStats", () => {
  it("computes headline metrics over the FULL closed history in SQL", async () => {
    // gamma: 5, -3, 10, 1 -> wins 3, losses 1, gross win 16, gross loss 3.
    await runTest(seedMetricsInstances);

    await runTest(
      repo((trades) => trades.performanceStats({ instanceId: "gamma" })),
    ).then((stats) => {
      expect(stats.trades).toBe(4);
      expect(stats.wins).toBe(3);
      expect(stats.losses).toBe(1);
      expect(stats.grossWin).toBe(16);
      expect(stats.grossLoss).toBe(3);
      expect(stats.best).toBe(10);
      expect(stats.worst).toBe(-3);
    });

    // Fleet (null): adds beta's -1 and delta's -1 -> gross loss 5.
    await runTest(
      repo((trades) => trades.performanceStats({ instanceId: null })),
    ).then((stats) => {
      expect(stats.trades).toBe(6);
      expect(stats.losses).toBe(3);
      expect(stats.grossLoss).toBe(5);
    });
  });
});

describe("TradesRepo cumulativeProfit", () => {
  it("runs the cumulative sum in SQL over the full history, newest tail only", async () => {
    await runTest(seedMetricsInstances);

    await runTest(
      repo((trades) =>
        trades.cumulativeProfit({ instanceId: "gamma", limit: 2 }),
      ),
    ).then(({ rows, totals }) => {
      // Newest 2 of gamma's 4 trades; running sums cover the FULL history,
      // so the first tail point already includes the older trades.
      expect(
        rows.map((r) => [r.at.slice(0, 10), r.profit, r.cumulative]),
      ).toEqual([
        ["2026-01-03", 10, 12],
        ["2026-01-04", 1, 13],
      ]);
      expect(totals).toEqual([
        { instanceId: "gamma", trades: 4, totalProfit: 13 },
      ]);
    });

    // Fleet: one series per instance, partitioned running sums (beta's
    // leftover -1 close rides along as its own series).
    await runTest(
      repo((trades) =>
        trades.cumulativeProfit({ instanceId: null, limit: 10 }),
      ),
    ).then(({ rows, totals }) => {
      const byInstance = new Map<string, number[]>();

      for (const row of rows) {
        byInstance.set(row.instanceId, [
          ...(byInstance.get(row.instanceId) ?? []),
          row.cumulative,
        ]);
      }

      expect(byInstance.get("gamma")).toEqual([5, 2, 12, 13]);
      expect(byInstance.get("delta")).toEqual([-1]);
      expect(totals).toEqual([
        { instanceId: "beta", trades: 1, totalProfit: -1 },
        { instanceId: "delta", trades: 1, totalProfit: -1 },
        { instanceId: "gamma", trades: 4, totalProfit: 13 },
      ]);
    });
  });
});

describe("TradesRepo openSummary", () => {
  it("aggregates the open book and per-pair allocation in SQL", async () => {
    await runTest(seedMetricsInstances);

    await runTest(
      repo((trades) => trades.openSummary({ instanceId: "gamma" })),
    ).then(({ summary, rows }) => {
      expect(summary).toEqual({
        positions: 3,
        deployed: 500,
        unrealized: 3,
        maxLeverage: 3,
        longs: 2,
        shorts: 1,
        largestStake: 300,
        pairs: 3,
        avgProfitPct: (2 - 1 + 0) / 3,
      });
      expect(rows).toEqual([
        {
          pair: "ETH/USDT",
          positions: 1,
          stake: 300,
          unrealized: -2,
          share: 0.6,
        },
        {
          pair: "BTC/USDT",
          positions: 1,
          stake: 100,
          unrealized: 5,
          share: 0.2,
        },
        {
          pair: "SOL/USDT",
          positions: 1,
          stake: 100,
          unrealized: 0,
          share: 0.2,
        },
      ]);
    });

    // Fleet: BTC rows from both instances merge into one pair allocation.
    await runTest(
      repo((trades) => trades.openSummary({ instanceId: null })),
    ).then(({ summary, rows }) => {
      expect(summary.positions).toBe(4);
      expect(summary.deployed).toBe(700);
      expect(summary.unrealized).toBe(11);
      expect(summary.largestStake).toBe(300);
      expect(rows[0]).toEqual({
        pair: "BTC/USDT",
        positions: 2,
        stake: 300,
        unrealized: 13,
        share: 300 / 700,
      });
    });
  });
});

describe("TradesRepo tradedPairs", () => {
  it("groups the full mirror per pair, newest activity first", async () => {
    await runTest(seedMetricsInstances);

    await runTest(
      repo((trades) => trades.tradedPairs({ instanceId: "gamma" })),
    ).then((rows) => {
      // gamma traded BTC (2 closed + 1 open), ETH (1 closed), SOL (1 closed
      // + 1 open) — the whitelist/universe never enters the picture.
      // Every open row shares the 2026-02-01 open date, so the lastAt tie
      // orders pairs alphabetically.
      expect(rows).toEqual([
        {
          pair: "BTC/USDT",
          trades: 3,
          openTrades: 1,
          closedTrades: 2,
          lastAt: "2026-02-01T00:00:00Z",
        },
        {
          pair: "ETH/USDT",
          trades: 2,
          openTrades: 1,
          closedTrades: 1,
          lastAt: "2026-02-01T00:00:00Z",
        },
        {
          pair: "SOL/USDT",
          trades: 2,
          openTrades: 1,
          closedTrades: 1,
          lastAt: "2026-02-01T00:00:00Z",
        },
      ]);
    });

    // Fleet: pairs merge across instances (delta adds an XRP close and a
    // second BTC open; beta's leftover closed BTC trade rides along too).
    await runTest(
      repo((trades) => trades.tradedPairs({ instanceId: null })),
    ).then((rows) => {
      const byPair = new Map(rows.map((row) => [row.pair, row]));

      expect(byPair.get("BTC/USDT")).toEqual({
        pair: "BTC/USDT",
        trades: 5,
        openTrades: 2,
        closedTrades: 3,
        lastAt: "2026-02-01T00:00:00Z",
      });
      expect(byPair.get("XRP/USDT")?.closedTrades).toBe(1);
      // A pair only whitelisted (never traded) never appears.
      expect(byPair.has("DOGE/USDT")).toBe(false);
    });
  });
});

describe("TradesRepo aggregate totals", () => {
  it("returns full-set totals and extremes that survive the row LIMIT", async () => {
    await runTest(seedMetricsInstances);

    const limited = await runTest(
      repo((trades) =>
        trades.aggregate({
          instanceId: "gamma",
          groupBy: "pair",
          search: null,
          minTrades: null,
          sortBy: "profitAbs",
          sortDir: "desc",
          limit: 1,
          perInstance: false,
          bestEdgeMinTrades: 1,
        }),
      ),
    );

    // Only the top pair row is returned…
    expect(limited.rows).toHaveLength(1);
    expect(limited.rows[0]?.tag).toBe("SOL/USDT");
    // …but the totals cover every matching closed trade (gamma's four).
    expect(limited.totals).toEqual({
      trades: 4,
      wins: 3,
      losses: 1,
      winrate: 0.75,
      profitAbs: 13,
      profitPctAvg: (5 - 3 + 12 + 1) / 4,
    });
    expect(limited.best).toEqual({ tag: "SOL/USDT", value: 10 });
    expect(limited.worst).toEqual({ tag: "ETH/USDT", value: -3 });
    // Best edge ranks by avg % behind its own min-trades gate.
    expect(limited.bestEdge).toEqual({ tag: "SOL/USDT", value: 12 });

    // With the gate raised above every pair's count, no edge qualifies.
    const gated = await runTest(
      repo((trades) =>
        trades.aggregate({
          instanceId: "gamma",
          groupBy: "pair",
          search: null,
          minTrades: null,
          sortBy: "profitAbs",
          sortDir: "desc",
          limit: 1,
          perInstance: false,
          bestEdgeMinTrades: 3,
        }),
      ),
    );

    expect(gated.bestEdge).toBeNull();
  });
});
