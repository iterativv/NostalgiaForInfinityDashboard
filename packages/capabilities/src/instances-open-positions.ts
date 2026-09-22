// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { OpenPositionsResponse } from "@nfi/api-contract"
import { defineCapability, IdOptions } from "./definition.js"
import { asBackendError } from "./errors.js"

/**
 * `instances.open-positions` — open positions for one instance (ABSOLUTE).
 *
 * Never grant publicly: use `instances.open-positions.relative` instead.
 */
export const InstancesOpenPositionsCapability = defineCapability({
  name: "instances.open-positions",
  optionsSchema: IdOptions,
  resultSchema: OpenPositionsResponse,
  description: "Open positions with sub-orders for one instance (absolute amounts).",
  streamable: true,
  pollMs: 10_000,
  exposes: ["trade-details"],
  run: (options, ctx) =>
    Effect.flatMap(ctx.resolveInstance(options.id), (service) => service.getOpenPositions()).pipe(
      Effect.mapError((cause) => asBackendError("instance open positions", cause)),
    ),
})
