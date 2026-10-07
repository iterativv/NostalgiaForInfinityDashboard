// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import {
  FleetWhitelistResponse,
  type FleetWhitelistInstance,
} from "@nfi/api-contract";
import { defineCapability } from "./definition.js";
import { asBackendError } from "./errors.js";
import { fleetInstances } from "./fleet.js";
import { normalizeSearch } from "./search.js";

const WhitelistAllOptions = Schema.Struct({
  /** Free-text filter — a SQL LIKE per instance's mirrored list. */
  search: Schema.optional(Schema.String),
});

/**
 * `instances.whitelist-all` — whitelisted pairs across every configured
 * instance, grouped per instance plus a sorted union for fleet views.
 * Each instance's list (search included) comes from one SQL query over the
 * mirror; the handler only assembles the per-instance groups and union.
 */
export const InstancesWhitelistAllCapability = defineCapability({
  name: "instances.whitelist-all",
  optionsSchema: WhitelistAllOptions,
  resultSchema: FleetWhitelistResponse,
  description: "Whitelisted pairs across all instances, grouped per instance.",
  streamable: true,
  pollMs: 60_000,
  exposes: ["market-data"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const instances = yield* fleetInstances(ctx);
      const search = normalizeSearch(options.search);

      const grouped = yield* Effect.forEach(
        instances,
        (instance) =>
          Effect.gen(function* () {
            const list = yield* ctx.trades.listWhitelist({
              instanceId: instance.id,
              search,
            });

            // A search matching the bot keeps its whole list.
            const botMatched =
              search !== null &&
              (instance.name.toLowerCase().includes(search.toLowerCase()) ||
                instance.id.toLowerCase().includes(search.toLowerCase()));

            const pairs =
              botMatched
                ? (yield* ctx.trades.listWhitelist({
                    instanceId: instance.id,
                    search: null,
                  })).pairs
                : list.pairs;

            return {
              instanceId: instance.id,
              instanceName: instance.name,
              pairs,
              length: list.length,
              matched: search === null || pairs.length > 0 || botMatched,
            };
          }).pipe(Effect.catchAll(() => Effect.succeed(null))),
        { concurrency: 4 },
      );

      const perInstanceRows: FleetWhitelistInstance[] = grouped
        .filter((row): row is NonNullable<typeof row> =>
          row !== null && (search === null || row.matched),
        )
        .map(({ matched: _matched, ...row }) => row);

      const union = [
        ...new Set(perInstanceRows.flatMap((row) => row.pairs)),
      ].sort((a, b) => a.localeCompare(b));

      return {
        instances: perInstanceRows,
        pairs: union,
        length: union.length,
      };
    }).pipe(
    Effect.mapError((cause) => asBackendError("fleet whitelist", cause)),
  ),
});
