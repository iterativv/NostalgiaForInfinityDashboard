// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import { OpenPositionsResponse } from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError } from "./errors.js";
import { normalizeSearch } from "./search.js";

const OpenPositionsOptions = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  /** Free-text filter — a SQL WHERE over the mirror (full coverage). */
  search: Schema.optional(Schema.String),
  /** SQL ORDER BY key; absent keeps open-date order (newest first). */
  sort: Schema.optional(Schema.Literal("profitPct")),
  dir: Schema.optional(Schema.Literal("asc", "desc")),
  /** SQL LIMIT after sort/filter (absent = every open position). */
  limit: Schema.optional(Schema.String),
  /** Sign partition on the live profit percent (SQL WHERE). */
  filter: Schema.optional(Schema.Literal("gain", "loss")),
});

/**
 * `instances.open-positions` — open positions for one instance (ABSOLUTE),
 * read from the trades mirror: search, sign filter, ordering and limit are
 * SQL clauses, so consumers like market movers get exactly their window
 * from the database.
 *
 * Never grant publicly: use `instances.open-positions.relative` instead.
 */
export const InstancesOpenPositionsCapability = defineCapability({
  name: "instances.open-positions",
  optionsSchema: OpenPositionsOptions,
  resultSchema: OpenPositionsResponse,
  description: "Open positions with sub-orders for one instance (absolute amounts).",
  streamable: true,
  pollMs: 10_000,
  exposes: ["trade-details"],
  run: (options, ctx) =>
    Effect.map(
      ctx.trades.listOpen({
        instanceId: options.id,
        search: normalizeSearch(options.search),
        sort: options.sort ?? null,
        dir: options.dir ?? "desc",
        filter: options.filter ?? null,
        limit: options.limit === undefined
          ? 10_000
          : parseLimitParam(options.limit, 20, 10_000),
      }),
      ({ positions }) => ({ positions }),
    ).pipe(
    Effect.mapError((cause) => asBackendError("instance open positions", cause)),
  ),
});
