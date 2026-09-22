// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect"
import { Effect } from "effect"
import { ClosedPositionsResponse } from "@nfi/api-contract"
import { defineCapability, parseLimitParam } from "./definition.js"
import { asBackendError } from "./errors.js"

/**
 * `instances.closed-positions` — closed positions window (ABSOLUTE amounts).
 *
 * Never grant publicly: use `instances.closed-positions.relative` instead.
 */
export const InstancesClosedPositionsCapability = defineCapability({
  name: "instances.closed-positions",
  optionsSchema: Schema.Struct({
    id: Schema.String.pipe(Schema.minLength(1)),
    limit: Schema.optional(Schema.String),
    offset: Schema.optional(Schema.String),
  }),
  resultSchema: ClosedPositionsResponse,
  description: "Closed positions window for one instance (absolute amounts).",
  streamable: true,
  pollMs: 30_000,
  exposes: ["trade-details"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const service = yield* ctx.resolveInstance(options.id)
      return yield* service.getClosedPositions(
        parseLimitParam(options.limit, 50, 500),
        parseLimitParam(options.offset, 0, 100_000),
      )
    }).pipe(Effect.mapError((cause) => asBackendError("instance closed positions", cause))),
})
