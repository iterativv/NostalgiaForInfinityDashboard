// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import {
  TagPerformanceResponse,
  type TagGroupBy,
  type TagPerformanceRow,
} from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError, toBackendError } from "./errors.js";
import { fleetInstances, perInstance } from "./fleet.js";

const TagPerformanceAllOptions = Schema.Struct({
  /** Newest closed trades aggregated per instance. Default 200, capped 1000. */
  limit: Schema.optional(Schema.String),
  groupBy: Schema.optional(Schema.String),
});

/**
 * `instances.tag-performance-all` — per-tag closed-trade stats across EVERY
 * configured instance (ABSOLUTE profit): each bot's newest trades are
 * aggregated locally (see the freqtrade client's tail window), then the
 * per-tag counters merge into one fleet-wide table.
 *
 * Per-instance failures degrade (their tags simply miss from the totals);
 * only a fleet where every instance failed errors. Never grant publicly:
 * percentages-only callers should grant `instances.tag-performance.relative`
 * instead (single instance).
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
      const limit = parseLimitParam(options.limit, 200, 1000);
      const groupBy: TagGroupBy = options.groupBy === "exit" ? "exit" : "enter";
      const instances = yield* fleetInstances(ctx);

      const outcomes = yield* perInstance(instances, (instance) =>
        instance.service.getTagPerformance(limit, groupBy),
      );

      const groups = new Map<
        string,
        {
          trades: number;
          wins: number;
          losses: number;
          profitAbs: number;
          profitPctSum: number;
        }
      >();

      let aggregated = 0;
      let totalTrades = 0;
      let totalKnown = false;
      let failures = 0;
      let firstError: string | null = null;

      for (const outcome of outcomes) {
        if (outcome.data === undefined) {
          failures += 1;
          firstError = firstError ?? outcome.error ?? "unreachable";
          continue;
        }

        for (const row of outcome.data.rows) {
          const entry = groups.get(row.tag) ?? {
            trades: 0,
            wins: 0,
            losses: 0,
            profitAbs: 0,
            profitPctSum: 0,
          };

          entry.trades += row.trades;
          entry.wins += row.wins;
          entry.losses += row.losses;
          entry.profitAbs += row.profitAbs;
          entry.profitPctSum += row.profitPctAvg * row.trades;
          groups.set(row.tag, entry);
          aggregated += row.trades;
        }

        if (outcome.data.totalTrades !== undefined) {
          totalTrades += outcome.data.totalTrades;
          totalKnown = true;
        }
      }

      if (aggregated === 0 && failures > 0 && failures === instances.length) {
        return yield* Effect.fail(
          toBackendError(
            "fleet tag performance",
            firstError ?? "all instances unreachable",
          ),
        );
      }

      const rows: TagPerformanceRow[] = [...groups.entries()].map(
        ([tag, g]) => ({
          tag,
          trades: g.trades,
          wins: g.wins,
          losses: g.losses,
          winrate: g.trades > 0 ? g.wins / g.trades : 0,
          profitAbs: g.profitAbs,
          profitPctAvg: g.trades > 0 ? g.profitPctSum / g.trades : 0,
        }),
      );

      return {
        groupBy,
        rows,
        aggregatedTrades: aggregated,
        totalTrades: totalKnown ? totalTrades : undefined,
      };
    }).pipe(
      Effect.mapError((cause) =>
        asBackendError("fleet tag performance", cause),
      ),
    ),
});
