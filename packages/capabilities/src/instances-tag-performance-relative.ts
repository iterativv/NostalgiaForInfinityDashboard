// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
import { Effect } from "effect";
import { RelativeTagPerformanceResponse } from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError } from "./errors.js";
import {
  parseBestEdgeMinTrades,
  parseGroupBy,
} from "./instances-tag-performance.js";
import { toRelativeTagPerformance } from "./relative.js";

/**
 * `instances.tag-performance.relative` — per-dimension winrate/avg%
 * (shareable), one SQL GROUP BY over the FULL mirror history.
 *
 * Drops the absolute `profitAbs` column; winrate and average percent cannot
 * be converted back to money without a baseline that is never exposed.
 * `totals` (percentages-only) and `bestEdge` are computed in SQL over the
 * full matching set, so footer sums survive the row LIMIT.
 */
export const InstancesTagPerformanceRelativeCapability = defineCapability({
  name: "instances.tag-performance.relative",
  optionsSchema: Schema.Struct({
    id: Schema.String.pipe(Schema.minLength(1)),
    limit: Schema.optional(Schema.String),
    groupBy: Schema.optional(Schema.String),
    minTrades: Schema.optional(Schema.String),
    sortBy: Schema.optional(Schema.String),
    sortDir: Schema.optional(Schema.Literal("asc", "desc")),
    /** Best-edge gate: dimensions need >= this many trades (default 3). */
    bestEdgeMinTrades: Schema.optional(Schema.String),
  }),
  resultSchema: RelativeTagPerformanceResponse,
  description: "Per-tag winrate and average percent (relative, shareable).",
  streamable: true,
  pollMs: 60_000,
  exposes: ["relative-values"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const groupBy = parseGroupBy(options.groupBy);

      const { rows, totalMatching, totals, bestEdge } =
        yield* ctx.trades.aggregate({
          instanceId: options.id,
          groupBy,
          search: null,
          minTrades:
            options.minTrades === undefined
              ? null
              : parseLimitParam(options.minTrades, 1, 1000),
          sortBy: options.sortBy ?? null,
          sortDir: options.sortDir ?? "desc",
          limit: parseLimitParam(options.limit, 200, 1000),
          perInstance: false,
          bestEdgeMinTrades: parseBestEdgeMinTrades(options.bestEdgeMinTrades),
        });

      const stats = {
        trades: totals.trades,
        wins: totals.wins,
        losses: totals.losses,
        winrate: totals.winrate,
        profitPctAvg: totals.profitPctAvg,
      };

      // The best-edge row joins the footer stats only when a dimension
      // cleared the min-trades gate.
      const withEdge =
        bestEdge === null
          ? { stats }
          : { stats: { ...stats, bestEdge: bestEdge } };

      return toRelativeTagPerformance({
        groupBy,
        rows: rows.map(({ instanceId: _unused, ...row }) => row),
        aggregatedTrades: rows.reduce((sum, row) => sum + row.trades, 0),
        totalTrades: totalMatching,
        ...withEdge,
      });
    }).pipe(
      Effect.mapError((cause) =>
        asBackendError("instance tag-performance.relative", cause),
      ),
    ),
});
