// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import {
  FleetClosedPositionsResponse,
  type TaggedClosedPosition,
} from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { toBackendError } from "./errors.js";
import { fleetInstances, perInstance } from "./fleet.js";

const ClosedAllOptions = Schema.Struct({
  /** Recent closed positions per instance. Default 50, capped at 500. */
  limit: Schema.optional(Schema.String),
});

/**
 * `instances.closed-all` — recent closed positions across every configured
 * instance, each tagged with its source instance and merged into one
 * close-date-descending list (per-instance failures degrade).
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
      const limit = parseLimitParam(options.limit, 50, 500);
      const instances = yield* fleetInstances(ctx);
      const outcomes = yield* perInstance(instances, (instance) =>
        instance.service.getClosedPositions(limit, 0),
      );
      const positions: TaggedClosedPosition[] = [];
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
            "fleet closed positions",
            firstError ?? "all instances unreachable",
          ),
        );
      }
      positions.sort((a, b) =>
        (b.closeDate ?? b.openDate).localeCompare(a.closeDate ?? a.openDate),
      );
      return {
        positions: positions.slice(0, limit * Math.max(1, instances.length)),
        tradesCount: positions.length,
      };
    }).pipe(
      Effect.mapError((cause) =>
        toBackendError("fleet closed positions", cause),
      ),
    ),
});

export type ClosedAllOptions = typeof ClosedAllOptions.Type;
