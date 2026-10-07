// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import {
  TagPerformanceResponse,
  type TagGroupBy,
  type TagPerformanceRow,
} from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError } from "./errors.js";
import { fleetInstances } from "./fleet.js";
import { parseGroupBy } from "./instances-tag-performance.js";

const TagPerformanceAllOptions = Schema.Struct({
  /** Newest closed trades aggregated per instance. Default 200, capped 1000. */
  limit: Schema.optional(Schema.String),
  groupBy: Schema.optional(Schema.String),
  /** SQL HAVING: only dimensions with at least this many closed trades. */
  minTrades: Schema.optional(Schema.String),
  /** SQL ORDER BY: trades | wins | losses | winrate | profitAbs | profitPctAvg. */
  sortBy: Schema.optional(Schema.String),
  sortDir: Schema.optional(Schema.Literal("asc", "desc")),
});

/**
 * `instances.tag-performance-all` — closed-trade stats across EVERY
 * configured instance, computed as one SQL GROUP BY over the mirror
 * (full-history coverage, no per-instance tail windows to merge).
 *
 * enter/exit/pair dimensions merge across the fleet into one row per value;
 * `strategy` groups per (strategy, instance) — fleet strategy tables label
 * each row `strategy · bot`. Never grant publicly: percentages-only callers
 * should grant `instances.tag-performance.relative` instead (single
 * instance).
 */
export const InstancesTagPerformanceAllCapability = defineCapability({
  name: "instances.tag-performance-all",
  optionsSchema: TagPerformanceAllOptions,
  resultSchema: TagPerformanceResponse,
  description:
    "Per-tag closed-trade stats merged across all instances (absolute profit).",
  streamable: true,
  pollMs: 60_000,
  exposes: ["absolute-profit"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const groupBy: TagGroupBy = parseGroupBy(options.groupBy);
      const perInstance = groupBy === "strategy";
      const instances = yield* fleetInstances(ctx);

      const nameById = new Map(
        instances.map((instance) => [instance.id, instance.name] as const),
      );

      const { rows, totalMatching, totals, best, worst } =
        yield* ctx.trades.aggregate({
          instanceId: null,
          groupBy,
          search: null,
          minTrades:
            options.minTrades === undefined
              ? null
              : parseLimitParam(options.minTrades, 1, 1000),
          sortBy: options.sortBy ?? null,
          sortDir: options.sortDir ?? "desc",
          limit: parseLimitParam(options.limit, 200, 1000),
          perInstance,
          bestEdgeMinTrades: null,
        });

      const table: TagPerformanceRow[] = rows.map((row) => ({
        tag: row.tag,
        trades: row.trades,
        wins: row.wins,
        losses: row.losses,
        winrate: row.winrate,
        profitAbs: row.profitAbs,
        profitPctAvg: row.profitPctAvg,
        instanceId: row.instanceId ?? undefined,
        instanceName:
          row.instanceId === null ? undefined : nameById.get(row.instanceId),
      }));

      return {
        groupBy,
        rows: table,
        aggregatedTrades: table.reduce((sum, row) => sum + row.trades, 0),
        totalTrades: totalMatching,
        totals,
        best: best ?? undefined,
        worst: worst ?? undefined,
      };
    }).pipe(
      Effect.mapError((cause) =>
        asBackendError("fleet tag performance", cause),
      ),
    ),
});
