// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect";
import {
  FleetOpenPositionsResponse,
  type TaggedOpenPosition,
} from "@nfi/api-contract";
import { defineCapability, NoOptions } from "./definition.js";
import { toBackendError } from "./errors.js";
import { fleetInstances, perInstance } from "./fleet.js";

/**
 * `instances.positions-all` — open positions across every configured
 * instance, each tagged with its source instance. Reachable instances
 * contribute their positions; unreachable ones are skipped (per-instance
 * failures degrade, only a total fleet failure fails the capability).
 */
export const InstancesPositionsAllCapability = defineCapability({
  name: "instances.positions-all",
  optionsSchema: NoOptions,
  resultSchema: FleetOpenPositionsResponse,
  description: "Open positions across all instances, tagged per instance.",
  streamable: true,
  pollMs: 10_000,
  exposes: ["trade-details"],
  run: (_options, ctx) =>
    Effect.gen(function* () {
      const instances = yield* fleetInstances(ctx);
      const outcomes = yield* perInstance(instances, (instance) =>
        instance.service.getOpenPositions(),
      );
      const positions: TaggedOpenPosition[] = [];
      let failures = 0;
      let firstError: string | null = null;
      for (const outcome of outcomes) {
        if (outcome.data !== undefined) {
          for (const position of outcome.data.positions) {
            positions.push({
              ...position,
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
        positions.length === 0 &&
        failures > 0 &&
        failures === instances.length
      ) {
        return yield* Effect.fail(
          toBackendError(
            "fleet positions",
            firstError ?? "all instances unreachable",
          ),
        );
      }
      // Most-recently-opened first for tape-style views.
      positions.sort((a, b) => b.openDate.localeCompare(a.openDate));
      return { positions };
    }).pipe(
      Effect.mapError((cause) => toBackendError("fleet positions", cause)),
    ),
});
