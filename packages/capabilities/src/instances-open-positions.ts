// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect"
import { OpenPositionsResponse } from "@nfi/api-contract"
import { defineCapability } from "./definition.js"
import { asBackendError } from "./errors.js"
import { applySearch } from "./search.js"

const OpenPositionsOptions = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  /** Free-text filter applied server-side, before any slicing. */
  search: Schema.optional(Schema.String),
})

/**
 * `instances.open-positions` — open positions for one instance (ABSOLUTE).
 *
 * Never grant publicly: use `instances.open-positions.relative` instead.
 */
export const InstancesOpenPositionsCapability = defineCapability({
  name: "instances.open-positions",
  optionsSchema: OpenPositionsOptions,
  resultSchema: OpenPositionsResponse,
  description: "Open positions with sub-orders for one instance (absolute amounts).",
  streamable: true,
  pollMs: 10_000,
  exposes: ["trade-details"],
  run: (options, ctx) =>
    Effect.flatMap(ctx.resolveInstance(options.id), (service) => service.getOpenPositions()).pipe(
      Effect.map((body) => ({
        positions: applySearch(
          body.positions,
          (p) => [p.pair, p.strategy, p.enterTag, p.exitReason],
          options.search,
        ),
      })),
      Effect.mapError((cause) => asBackendError("instance open positions", cause)),
    ),
})
