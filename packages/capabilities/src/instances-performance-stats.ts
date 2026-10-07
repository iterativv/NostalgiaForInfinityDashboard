// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import { PerformanceStatsResponse } from "@nfi/api-contract";
import { defineCapability } from "./definition.js";
import { asBackendError } from "./errors.js";

const PerformanceStatsOptions = Schema.Struct({
  /** Absent = fleet: every instance's closed trades in one aggregate. */
  id: Schema.optional(Schema.String),
});

/**
 * `instances.performance-stats` — the headline closed-trade block (winrate,
 * profit factor, expectancy, averages, best/worst) as ONE SQL aggregate
 * over the FULL mirror history. Previously the widget folded a fetched
 * window client-side, so every metric silently stopped at the window edge;
 * here the database aggregates every closed trade and the frontend renders
 * the row verbatim.
 *
 * `profitFactor` reports 0 when there are no losses (JSON cannot carry
 * Infinity) — consumers show ∞ when `grossLoss === 0 && wins > 0`.
 *
 * Never grant publicly: absolute profit amounts.
 */
export const InstancesPerformanceStatsCapability = defineCapability({
  name: "instances.performance-stats",
  optionsSchema: PerformanceStatsOptions,
  resultSchema: PerformanceStatsResponse,
  description:
    "Winrate, profit factor, expectancy and averages over the full closed history.",
  streamable: true,
  pollMs: 30_000,
  exposes: ["absolute-profit"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const s = yield* ctx.trades.performanceStats({
        instanceId: options.id ?? null,
      });

      const net = s.grossWin - s.grossLoss;

      return {
        trades: s.trades,
        wins: s.wins,
        losses: s.losses,
        grossWin: s.grossWin,
        grossLoss: s.grossLoss,
        net,
        winrate: s.trades > 0 ? (s.wins / s.trades) * 100 : 0,
        profitFactor: s.grossLoss > 0 ? s.grossWin / s.grossLoss : 0,
        expectancy: s.trades > 0 ? net / s.trades : 0,
        avgWin: s.wins > 0 ? s.grossWin / s.wins : 0,
        avgLoss: s.losses > 0 ? s.grossLoss / s.losses : 0,
        best: s.best,
        worst: s.worst,
      };
    }).pipe(
      Effect.mapError((cause) =>
        asBackendError("instance performance stats", cause),
      ),
    ),
});
