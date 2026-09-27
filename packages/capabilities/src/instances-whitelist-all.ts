// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import {
  FleetWhitelistResponse,
  type FleetWhitelistInstance,
} from "@nfi/api-contract";
import { defineCapability } from "./definition.js";
import { toBackendError } from "./errors.js";
import { fleetInstances, perInstance } from "./fleet.js";
import { applySearch, matchesSearch, normalizeSearch } from "./search.js";

const WhitelistAllOptions = Schema.Struct({
  /** Free-text filter applied server-side over the full pair lists. */
  search: Schema.optional(Schema.String),
});

/**
 * `instances.whitelist-all` — whitelisted pairs across every configured
 * instance, grouped per instance plus a sorted union for fleet views.
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

      const outcomes = yield* perInstance(instances, (instance) =>
        instance.service.getWhitelist(),
      );

      const needle = normalizeSearch(options.search);
      const perInstanceRows: FleetWhitelistInstance[] = [];
      let failures = 0;
      let firstError: string | null = null;

      for (const outcome of outcomes) {
        if (outcome.data !== undefined) {
          const allPairs = [...outcome.data.pairs];

          // A search matching the bot keeps its whole list; otherwise the
          // list is filtered to matching pairs (bots with neither drop out).
          const pairs =
            needle !== null &&
            matchesSearch(
              [outcome.instance.id, outcome.instance.name],
              needle,
            )
              ? allPairs
              : applySearch(allPairs, (pair) => [pair], options.search);

          if (needle === null || pairs.length > 0) {
            perInstanceRows.push({
              instanceId: outcome.instance.id,
              instanceName: outcome.instance.name,
              pairs,
              length: allPairs.length,
            });
          }
        } else {
          failures += 1;
          firstError = firstError ?? outcome.error ?? "unreachable";
        }
      }

      if (
        perInstanceRows.length === 0 &&
        failures > 0 &&
        failures === instances.length
      ) {
        return yield* Effect.fail(
          toBackendError(
            "fleet whitelist",
            firstError ?? "all instances unreachable",
          ),
        );
      }

      const union = [
        ...new Set(perInstanceRows.flatMap((row) => row.pairs)),
      ].sort((a, b) => a.localeCompare(b));

      return {
        instances: perInstanceRows,
        pairs: union,
        length: union.length,
      };
    }).pipe(
      Effect.mapError((cause) => toBackendError("fleet whitelist", cause)),
    ),
});
