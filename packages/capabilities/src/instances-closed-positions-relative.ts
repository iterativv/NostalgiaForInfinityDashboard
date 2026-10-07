// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
import { Effect } from "effect";
import { RelativeClosedPositionsResponse } from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError } from "./errors.js";
import { normalizeSearch } from "./search.js";
import { toRelativeClosedPositions } from "./relative.js";

const ClosedRelativeOptions = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  limit: Schema.optional(Schema.String),
  offset: Schema.optional(Schema.String),
  /** Free-text filter — SQL WHERE restricted to non-sensitive fields. */
  search: Schema.optional(Schema.String),
});

/**
 * `instances.closed-positions.relative` — closed window without absolutes.
 *
 * Public-shareable mirror of `instances.closed-positions`: queried from the
 * trades mirror in SQL (search, order, limit, offset — full-history
 * coverage), and any window yields only percentages, so history cannot be
 * monetized. The search predicate is restricted to non-sensitive fields
 * (pair, strategy, enter/exit tags — never amounts or trade ids).
 *
 * `stats` carries the footer metrics (win rate, mean/best/worst percent)
 * computed in SQL over EVERY matching closed trade — the loaded page may
 * be a window, the footer never is.
 */
export const InstancesClosedPositionsRelativeCapability = defineCapability({
  name: "instances.closed-positions.relative",
  optionsSchema: ClosedRelativeOptions,
  resultSchema: RelativeClosedPositionsResponse,
  description: "Closed positions window, percentages only (shareable).",
  streamable: true,
  pollMs: 30_000,
  exposes: ["relative-values"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const limit = parseLimitParam(options.limit, 50, 5_000);
      const offset = parseLimitParam(options.offset, 0, 100_000);
      const search = normalizeSearch(options.search);

      const { positions, total } = yield* ctx.trades.listClosed({
        instanceId: options.id,
        search,
        searchNonSensitiveOnly: true,
        limit,
        offset,
      });

      const stats = yield* ctx.trades.closedPercentStats({
        instanceId: options.id,
        search,
        searchNonSensitiveOnly: true,
      });

      return {
        ...toRelativeClosedPositions({
          positions,
          tradesCount: positions.length,
          totalTrades: total,
        }),
        stats: {
          withPnl: stats.withPnl,
          wins: stats.wins,
          winRatePct: stats.winRatePct,
          avgProfitPct: stats.avgProfitPct,
          bestPct: stats.bestPct,
          worstPct: stats.worstPct,
        },
      };
    }).pipe(
      Effect.mapError((cause) =>
        asBackendError("instance closed-positions.relative", cause),
      ),
    ),
});
