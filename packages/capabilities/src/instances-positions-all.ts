// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import {
  FleetOpenPositionsResponse,
  type TaggedOpenPosition,
} from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError } from "./errors.js";
import { fleetInstances } from "./fleet.js";
import { normalizeSearch } from "./search.js";

const PositionsAllOptions = Schema.Struct({
  /** Free-text filter — a SQL WHERE over the mirror (instance names
   * included via fleet name matching). */
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
 * `instances.positions-all` — open positions across every configured
 * instance, each tagged with its source instance, queried from the trades
 * mirror in one SQL statement (search, sign filter, ordering and limit are
 * database clauses; instance names match through the fleet name filter).
 */
export const InstancesPositionsAllCapability = defineCapability({
  name: "instances.positions-all",
  optionsSchema: PositionsAllOptions,
  resultSchema: FleetOpenPositionsResponse,
  description: "Open positions across all instances, tagged per instance.",
  streamable: true,
  pollMs: 10_000,
  exposes: ["trade-details"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const instances = yield* fleetInstances(ctx);

      const nameById = new Map(
        instances.map((instance) => [instance.id, instance.name] as const),
      );

      const search = normalizeSearch(options.search);

      const matchInstanceIds =
        search === null
          ? undefined
          : [...nameById.entries()].flatMap(([id, name]) =>
              name.toLowerCase().includes(search.toLowerCase()) ? [id] : [],
            );

      const { positions } = yield* ctx.trades.listOpen({
        instanceId: null,
        search,
        matchInstanceIds,
        sort: options.sort ?? null,
        dir: options.dir ?? "desc",
        filter: options.filter ?? null,
        limit: options.limit === undefined
          ? 10_000
          : parseLimitParam(options.limit, 20, 10_000),
      });

      const tagged: TaggedOpenPosition[] = positions.map((position) => ({
        ...position,
        instanceName: nameById.get(position.instanceId) ?? position.instanceId,
      }));

      // Most-recently-opened first for tape-style views.
      tagged.sort((a, b) => b.openDate.localeCompare(a.openDate));

      return { positions: tagged };
    }).pipe(
    Effect.mapError((cause) => asBackendError("fleet positions", cause)),
  ),
});
