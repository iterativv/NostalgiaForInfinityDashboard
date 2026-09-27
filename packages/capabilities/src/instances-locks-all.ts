// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect";
import {
  FleetLocksResponse,
  type TaggedPairLock,
} from "@nfi/api-contract";
import { defineCapability, NoOptions } from "./definition.js";
import { toBackendError } from "./errors.js";
import { fleetInstances, perInstance } from "./fleet.js";

/**
 * `instances.locks-all` — pair locks across every configured instance,
 * each tagged with its source instance. Per-instance failures degrade;
 * only a total fleet failure fails the capability.
 */
export const InstancesLocksAllCapability = defineCapability({
  name: "instances.locks-all",
  optionsSchema: NoOptions,
  resultSchema: FleetLocksResponse,
  description: "Pair locks across all instances, tagged per instance.",
  streamable: true,
  pollMs: 30_000,
  exposes: ["bot-state"],
  run: (_options, ctx) =>
    Effect.gen(function* () {
      const instances = yield* fleetInstances(ctx);

      const outcomes = yield* perInstance(instances, (instance) =>
        instance.service.getLocks(),
      );

      const locks: TaggedPairLock[] = [];
      let failures = 0;
      let firstError: string | null = null;

      for (const outcome of outcomes) {
        if (outcome.data !== undefined) {
          for (const lock of outcome.data.locks) {
            locks.push({
              ...lock,
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
        locks.length === 0 &&
        failures > 0 &&
        failures === instances.length
      ) {
        return yield* Effect.fail(
          toBackendError(
            "fleet locks",
            firstError ?? "all instances unreachable",
          ),
        );
      }

      return { locks };
    }).pipe(Effect.mapError((cause) => toBackendError("fleet locks", cause))),
});
