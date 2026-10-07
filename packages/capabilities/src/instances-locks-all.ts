// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import {
  FleetLocksResponse,
  type TaggedPairLock,
} from "@nfi/api-contract";
import { defineCapability } from "./definition.js";
import { asBackendError } from "./errors.js";
import { fleetInstances } from "./fleet.js";

const FleetLocksOptions = Schema.Struct({
  /** SQL WHERE: expired locks stay in the mirror but out of the response
   * unless asked for (the widget's show-expired toggle). */
  includeExpired: Schema.optional(Schema.String),
});

/** One instance's locks tagged with their source instance (fleet views). */
interface LockGroup {
  rows: TaggedPairLock[];
  countOnRecord: number;
}

/**
 * `instances.locks-all` — pair locks across every configured instance,
 * each tagged with its source instance, read from the mirror with the
 * expiry filter as a SQL clause per instance (assembly-only handler).
 */
export const InstancesLocksAllCapability = defineCapability({
  name: "instances.locks-all",
  optionsSchema: FleetLocksOptions,
  resultSchema: FleetLocksResponse,
  description: "Pair locks across all instances, tagged per instance.",
  streamable: true,
  pollMs: 30_000,
  exposes: ["bot-state"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const instances = yield* fleetInstances(ctx);

      const perInstanceLocks = yield* Effect.forEach(
        instances,
        (instance) =>
          ctx.trades
            .listLocks({
              instanceId: instance.id,
              includeExpired: options.includeExpired === "true",
            })
            .pipe(
              Effect.map(({ locks, countOnRecord }): LockGroup => ({
                countOnRecord,
                rows: locks.map((lock) => ({
                  ...lock,
                  instanceId: instance.id,
                  instanceName: instance.name,
                })),
              })),
              Effect.catchAll(() => Effect.succeed({ rows: [], countOnRecord: 0 })),
            ),
        { concurrency: 4 },
      );

      const groups = perInstanceLocks.filter(
        (g): g is { rows: TaggedPairLock[]; countOnRecord: number } => g !== null,
      );

      return {
        locks: groups.flatMap((group) => group.rows),
        countOnRecord: groups.reduce((sum, group) => sum + group.countOnRecord, 0),
      };
    }).pipe(
    Effect.mapError((cause) => asBackendError("fleet locks", cause)),
  ),
});
