// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import {
  FleetClosedPositionsResponse,
  type TaggedClosedPosition,
} from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError } from "./errors.js";
import { fleetInstances } from "./fleet.js";
import { normalizeSearch } from "./search.js";

const ClosedAllOptions = Schema.Struct({
  /** Recent closed positions across the fleet. Default 50 per instance,
   * capped at 5000. */
  limit: Schema.optional(Schema.String),
  /** Free-text filter — a SQL WHERE over the mirror (full-history coverage,
   * instance names included). */
  search: Schema.optional(Schema.String),
});

/**
 * `instances.closed-all` — closed positions across every configured
 * instance, each tagged with its source instance and merged into one
 * close-date-descending list. One SQL query over the mirror: search and
 * limit cover the FULL fleet history, and `totalTrades` is the exact
 * filtered total (drives load-more).
 */
export const InstancesClosedAllCapability = defineCapability({
  name: "instances.closed-all",
  optionsSchema: ClosedAllOptions,
  resultSchema: FleetClosedPositionsResponse,
  description:
    "Recent closed positions across all instances, tagged per instance.",
  streamable: true,
  pollMs: 30_000,
  exposes: ["trade-details"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const instances = yield* fleetInstances(ctx);

      const nameById = new Map(
        instances.map((instance) => [instance.id, instance.name] as const),
      );

      const search = normalizeSearch(options.search);

      // Fleet search matches instance names too: resolve which instance ids
      // the needle names, and the SQL WHERE includes their rows.
      const matchInstanceIds =
        search === null
          ? undefined
          : [...nameById.entries()].flatMap(([id, name]) =>
              name.toLowerCase().includes(search.toLowerCase()) ? [id] : [],
            );

      const { positions, total } = yield* ctx.trades.listClosed({
        instanceId: null,
        search,
        matchInstanceIds,
        limit: parseLimitParam(options.limit, 50, 5_000) *
          Math.max(1, instances.length),
        offset: 0,
      });

      const tagged: TaggedClosedPosition[] = positions.map((position) => ({
        ...position,
        instanceName: nameById.get(position.instanceId) ?? position.instanceId,
      }));

      return {
        positions: tagged,
        tradesCount: tagged.length,
        totalTrades: total,
      };
    }).pipe(
    Effect.mapError((cause) => asBackendError("fleet closed positions", cause)),
  ),
});

export type ClosedAllOptions = typeof ClosedAllOptions.Type;
