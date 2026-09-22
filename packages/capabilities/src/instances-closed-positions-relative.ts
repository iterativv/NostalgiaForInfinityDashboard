// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect"
import { Effect } from "effect"
import { RelativeClosedPositionsResponse } from "@nfi/api-contract"
import { defineCapability, parseLimitParam } from "./definition.js"
import { asBackendError } from "./errors.js"
import { toRelativeClosedPositions } from "./relative.js"

/**
 * `instances.closed-positions.relative` — closed window without absolutes.
 *
 * Public-shareable mirror of `instances.closed-positions`: any `limit` /
 * `offset` still yields only percentages, so history cannot be monetized.
 */
export const InstancesClosedPositionsRelativeCapability = defineCapability({
  name: "instances.closed-positions.relative",
  optionsSchema: Schema.Struct({
    id: Schema.String.pipe(Schema.minLength(1)),
    limit: Schema.optional(Schema.String),
    offset: Schema.optional(Schema.String),
  }),
  resultSchema: RelativeClosedPositionsResponse,
  description: "Closed positions window, percentages only (shareable).",
  streamable: true,
  pollMs: 30_000,
  exposes: ["relative-values"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const service = yield* ctx.resolveInstance(options.id)
      const positions = yield* service.getClosedPositions(
        parseLimitParam(options.limit, 50, 500),
        parseLimitParam(options.offset, 0, 100_000),
      )
      return toRelativeClosedPositions(positions)
    }).pipe(Effect.mapError((cause) => asBackendError("instance closed-positions.relative", cause))),
})
