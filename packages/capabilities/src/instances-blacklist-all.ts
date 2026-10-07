// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import {
  FleetBlacklistResponse,
  type TaggedBlacklistedPair,
} from "@nfi/api-contract";
import { defineCapability } from "./definition.js";
import { asBackendError } from "./errors.js";
import { fleetInstances } from "./fleet.js";
import { normalizeSearch } from "./search.js";

const BlacklistAllOptions = Schema.Struct({
  /** Free-text filter — a SQL LIKE over pair and reason per instance. */
  search: Schema.optional(Schema.String),
});

/**
 * `instances.blacklist-all` — blacklisted pairs across every configured
 * instance, each tagged with its source instance. Per-instance SQL queries
 * (pair + reason LIKE); the handler assembles, tags, and keeps the
 * unfiltered total.
 */
export const InstancesBlacklistAllCapability = defineCapability({
  name: "instances.blacklist-all",
  optionsSchema: BlacklistAllOptions,
  resultSchema: FleetBlacklistResponse,
  description: "Blacklisted pairs across all instances, tagged per instance.",
  streamable: true,
  pollMs: 60_000,
  exposes: ["market-data"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const instances = yield* fleetInstances(ctx);
      const search = normalizeSearch(options.search);

      const groups = yield* Effect.forEach(
        instances,
        (instance) =>
          Effect.gen(function* () {
            const list = yield* ctx.trades.listBlacklist({
              instanceId: instance.id,
              search,
            });

            return {
              entries: list.pairs.map((entry) => ({
                ...entry,
                instanceId: instance.id,
                instanceName: instance.name,
              })),
              // Unfiltered per-instance total (repo returns the SQL COUNT).
              length: list.length,
            };
          }).pipe(Effect.catchAll(() => Effect.succeed(null))),
        { concurrency: 4 },
      );

      const ok = groups.filter(
        (group): group is NonNullable<typeof group> => group !== null,
      );

      const pairs: TaggedBlacklistedPair[] = ok.flatMap((group) => [
        ...group.entries,
      ]);

      return {
        pairs,
        length: ok.reduce((sum, group) => sum + group.length, 0),
      };
    }).pipe(
    Effect.mapError((cause) => asBackendError("fleet blacklist", cause)),
  ),
});
