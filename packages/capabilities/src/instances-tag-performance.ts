// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
import { Effect } from "effect";
import { TagPerformanceResponse, type TagGroupBy } from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError } from "./errors.js";

const TAG_PERF_OPTIONS = {
  id: Schema.String.pipe(Schema.minLength(1)),
  limit: Schema.optional(Schema.String),
  groupBy: Schema.optional(Schema.String),
  /** SQL HAVING: only dimensions with at least this many closed trades. */
  minTrades: Schema.optional(Schema.String),
  /** SQL ORDER BY: trades | wins | losses | winrate | profitAbs | profitPctAvg. */
  sortBy: Schema.optional(Schema.String),
  sortDir: Schema.optional(Schema.Literal("asc", "desc")),
};

export const parseGroupBy = (raw: string | undefined): TagGroupBy =>
  raw === "exit" || raw === "pair" || raw === "strategy" ? raw : "enter";

/** Best-edge gate default: a dimension needs >= 3 trades to be "the edge". */
export const DEFAULT_BEST_EDGE_MIN_TRADES = 3;

export const parseBestEdgeMinTrades = (
  raw: string | undefined,
  fallback: number = DEFAULT_BEST_EDGE_MIN_TRADES,
): number => parseLimitParam(raw, fallback, 1_000);

/**
 * `instances.tag-performance` — closed-trade stats per dimension (ABSOLUTE
 * profit), one SQL GROUP BY over the FULL mirror history: enter/exit tags,
 * pairs or strategies. `minTrades` becomes HAVING, `sortBy`/`sortDir` the
 * ORDER BY — the grouping never sees a window. `totals`/`best`/`worst` are
 * server-computed over the same WHERE, so footer sums survive the LIMIT.
 *
 * Never grant publicly: use `instances.tag-performance.relative` instead.
 */
export const InstancesTagPerformanceCapability = defineCapability({
  name: "instances.tag-performance",
  optionsSchema: Schema.Struct(TAG_PERF_OPTIONS),
  resultSchema: TagPerformanceResponse,
  description: "Per-tag closed-trade stats for one instance (absolute profit).",
  streamable: true,
  pollMs: 60_000,
  exposes: ["absolute-profit"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const groupBy = parseGroupBy(options.groupBy);

      const { rows, totalMatching, totals, best, worst } =
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
          bestEdgeMinTrades: null,
        });

      return {
        groupBy,
        rows: rows.map(({ instanceId: _unused, ...row }) => row),
        aggregatedTrades: rows.reduce((sum, row) => sum + row.trades, 0),
        totalTrades: totalMatching,
        totals,
        best: best ?? undefined,
        worst: worst ?? undefined,
      };
    }).pipe(
      Effect.mapError((cause) =>
        asBackendError("instance tag performance", cause),
      ),
    ),
});
