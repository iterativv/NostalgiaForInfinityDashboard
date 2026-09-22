// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect"
import { RelativeFleetBalanceHistoryResponse } from "@nfi/api-contract"
import { defineCapability, parseLimitParam } from "./definition.js"
import { asBackendError } from "./errors.js"
import { fleetInstances, perInstance } from "./fleet.js"
import { toRelativeFleetBalanceHistory } from "./relative.js"

/**
 * `instances.balance-history.relative` — every instance's wallet history
 * rebased per instance to an index starting at 100.
 *
 * Public-shareable mirror of `instances.balance-history`: each bot's window
 * is rebased on its own first visible point, so no `limit` can reveal the
 * absolute baseline (or the relative wallet sizes) of any instance.
 */
export const InstancesBalanceHistoryAllRelativeCapability = defineCapability({
  name: "instances.balance-history.relative",
  optionsSchema: Schema.Struct({ limit: Schema.optional(Schema.String) }),
  resultSchema: RelativeFleetBalanceHistoryResponse,
  description:
    "Per-instance wallet history rebased to an index starting at 100 (shareable).",
  streamable: true,
  pollMs: 60_000,
  exposes: ["relative-values"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const limit = parseLimitParam(options.limit, 500, 500)
      const instances = yield* fleetInstances(ctx)
      const outcomes = yield* perInstance(instances, (instance) =>
        ctx.snapshots.balanceHistory(instance.id, limit),
      )
      return toRelativeFleetBalanceHistory({
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
      })
    }).pipe(
      Effect.mapError((cause) =>
        asBackendError("balance-history.relative", cause),
      ),
    ),
})
