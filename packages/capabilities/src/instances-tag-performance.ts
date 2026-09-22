// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect"
import { Effect } from "effect"
import { TagPerformanceResponse, type TagGroupBy } from "@nfi/api-contract"
import { defineCapability, parseLimitParam } from "./definition.js"
import { asBackendError } from "./errors.js"

/**
 * `instances.tag-performance` — per-tag closed-trade stats (ABSOLUTE profit).
 *
 * Never grant publicly: use `instances.tag-performance.relative` instead.
 */
export const InstancesTagPerformanceCapability = defineCapability({
  name: "instances.tag-performance",
  optionsSchema: Schema.Struct({
    id: Schema.String.pipe(Schema.minLength(1)),
    limit: Schema.optional(Schema.String),
    groupBy: Schema.optional(Schema.String),
  }),
  resultSchema: TagPerformanceResponse,
  description: "Per-tag closed-trade stats for one instance (absolute profit).",
  streamable: true,
  pollMs: 60_000,
  exposes: ["absolute-profit"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const service = yield* ctx.resolveInstance(options.id)
      const groupBy: TagGroupBy = options.groupBy === "exit" ? "exit" : "enter"
      return yield* service.getTagPerformance(parseLimitParam(options.limit, 200, 1000), groupBy)
    }).pipe(Effect.mapError((cause) => asBackendError("instance tag performance", cause))),
})
