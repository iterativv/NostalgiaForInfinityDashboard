// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import { RelativeFleetProfitHistoryResponse } from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError } from "./errors.js";
import { fleetInstances, perInstance } from "./fleet.js";
import { toRelativeFleetProfitHistory } from "./relative.js";

/**
 * `instances.profit-history-all.relative` — every instance's recorded
 * profit history rebased per instance to an index starting at 100.
 *
 * Public-shareable fleet performance comparison (freqtrade-UI style, one
 * index curve per bot): each instance's window is rebased on its own first
 * visible point, so no `limit` can reveal any bot's absolute profit — nor
 * the profit ratio between bots. The per-instance curves this feeds are
 * the canonical "non-mergeable" fleet view: performance indices cannot be
 * summed, so the UI distinguishes bots by their per-instance colors.
 */
export const InstancesProfitHistoryAllRelativeCapability = defineCapability({
  name: "instances.profit-history-all.relative",
  optionsSchema: Schema.Struct({ limit: Schema.optional(Schema.String) }),
  resultSchema: RelativeFleetProfitHistoryResponse,
  description:
    "Per-instance profit history rebased to an index starting at 100 (shareable).",
  streamable: true,
  pollMs: 60_000,
  exposes: ["relative-values"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const limit = parseLimitParam(options.limit, 500, 500);
      const instances = yield* fleetInstances(ctx);

      const outcomes = yield* perInstance(instances, (instance) =>
        ctx.snapshots.profitHistory(instance.id, limit),
      );

      return toRelativeFleetProfitHistory({
        instances: outcomes.map((outcome) =>
          outcome.data !== undefined
            ? {
                instanceId: outcome.instance.id,
                instanceName: outcome.instance.name,
                points: outcome.data.points,
              }
            : {
                instanceId: outcome.instance.id,
                instanceName: outcome.instance.name,
                points: [],
                error: outcome.error ?? "unreachable",
              },
        ),
      });
    }).pipe(
      Effect.mapError((cause) =>
        asBackendError("profit-history-all.relative", cause),
      ),
    ),
});
