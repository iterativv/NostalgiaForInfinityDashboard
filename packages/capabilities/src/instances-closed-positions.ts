// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
import { Effect } from "effect";
import { ClosedPositionsResponse } from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError } from "./errors.js";
import { normalizeSearch } from "./search.js";

const ClosedPositionsOptions = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  limit: Schema.optional(Schema.String),
  offset: Schema.optional(Schema.String),
  /** Free-text filter — a SQL WHERE over the mirror, so it always covers
   * the FULL history and `totalTrades` is the filtered total. */
  search: Schema.optional(Schema.String),
});

/**
 * `instances.closed-positions` — closed positions window (ABSOLUTE amounts),
 * queried from the trades mirror in SQL: search, ordering, limit and offset
 * are all database clauses, so matches beyond any window still surface and
 * the reported total is exact.
 *
 * Never grant publicly: use `instances.closed-positions.relative` instead.
 */
export const InstancesClosedPositionsCapability = defineCapability({
  name: "instances.closed-positions",
  optionsSchema: ClosedPositionsOptions,
  resultSchema: ClosedPositionsResponse,
  description: "Closed positions window for one instance (absolute amounts).",
  streamable: true,
  pollMs: 30_000,
  exposes: ["trade-details"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const limit = parseLimitParam(options.limit, 50, 5_000);
      const offset = parseLimitParam(options.offset, 0, 100_000);

      const { positions, total } = yield* ctx.trades.listClosed({
        instanceId: options.id,
        search: normalizeSearch(options.search),
        limit,
        offset,
      });

      return {
        positions,
        tradesCount: positions.length,
        totalTrades: total,
        offset,
      };
    }).pipe(
    Effect.mapError((cause) => asBackendError("instance closed positions", cause)),
  ),
});
