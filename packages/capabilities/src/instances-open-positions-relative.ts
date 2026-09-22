// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { RelativeOpenPositionsResponse } from "@nfi/api-contract"
import { defineCapability, IdOptions } from "./definition.js"
import { asBackendError } from "./errors.js"
import { toRelativeOpenPositions } from "./relative.js"

/**
 * `instances.open-positions.relative` — per-instance positions (shareable).
 *
 * Allocation weights are computed against a server-side total that is never
 * exposed; stake amounts, prices and absolute profits are stripped.
 */
export const InstancesOpenPositionsRelativeCapability = defineCapability({
  name: "instances.open-positions.relative",
  optionsSchema: IdOptions,
  resultSchema: RelativeOpenPositionsResponse,
  description: "Per-instance open positions, percentages/weights only (shareable).",
  streamable: true,
  pollMs: 10_000,
  exposes: ["relative-values"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const service = yield* ctx.resolveInstance(options.id)
      const positions = yield* service.getOpenPositions()
      const balance = yield* service.getBalance()
      return toRelativeOpenPositions(positions, balance.totalStake)
    }).pipe(Effect.mapError((cause) => asBackendError("instance open-positions.relative", cause))),
})
