// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import {
  FleetBlacklistResponse,
  type TaggedBlacklistedPair,
} from "@nfi/api-contract";
import { defineCapability } from "./definition.js";
import { toBackendError } from "./errors.js";
import { fleetInstances, perInstance } from "./fleet.js";
import { applySearch } from "./search.js";

const BlacklistAllOptions = Schema.Struct({
  /** Free-text filter applied server-side over the full entry list. */
  search: Schema.optional(Schema.String),
});

/**
 * `instances.blacklist-all` — blacklisted pairs across every configured
 * instance, each tagged with its source instance.
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

      const outcomes = yield* perInstance(instances, (instance) =>
        instance.service.getBlacklist(),
      );

      const pairs: TaggedBlacklistedPair[] = [];
      let failures = 0;
      let firstError: string | null = null;

      for (const outcome of outcomes) {
        if (outcome.data !== undefined) {
          for (const entry of outcome.data.pairs) {
            pairs.push({
              ...entry,
              instanceId: outcome.instance.id,
              instanceName: outcome.instance.name,
            });
          }
        } else {
          failures += 1;
          firstError = firstError ?? outcome.error ?? "unreachable";
        }
      }

      if (
        pairs.length === 0 &&
        failures > 0 &&
        failures === instances.length
      ) {
        return yield* Effect.fail(
          toBackendError(
            "fleet blacklist",
            firstError ?? "all instances unreachable",
          ),
        );
      }

      const filtered = applySearch(
        pairs,
        (entry) => [entry.pair, entry.reason, entry.instanceName],
        options.search,
      );

      return { pairs: filtered, length: pairs.length };
    }).pipe(
      Effect.mapError((cause) => toBackendError("fleet blacklist", cause)),
    ),
});
