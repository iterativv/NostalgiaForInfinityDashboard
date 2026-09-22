// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect"
import { Effect } from "effect"
import { RelativeTagPerformanceResponse, type TagGroupBy } from "@nfi/api-contract"
import { defineCapability, parseLimitParam } from "./definition.js"
import { asBackendError } from "./errors.js"
import { toRelativeTagPerformance } from "./relative.js"

/**
 * `instances.tag-performance.relative` — per-tag winrate/avg% (shareable).
 *
 * Drops the absolute `profitAbs` column; winrate and average percent cannot
 * be converted back to money without a baseline that is never exposed.
 */
export const InstancesTagPerformanceRelativeCapability = defineCapability({
  name: "instances.tag-performance.relative",
  optionsSchema: Schema.Struct({
    id: Schema.String.pipe(Schema.minLength(1)),
    limit: Schema.optional(Schema.String),
    groupBy: Schema.optional(Schema.String),
  }),
  resultSchema: RelativeTagPerformanceResponse,
  description: "Per-tag winrate and average percent (relative, shareable).",
  streamable: true,
  pollMs: 60_000,
  exposes: ["relative-values"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const service = yield* ctx.resolveInstance(options.id)
      const groupBy: TagGroupBy = options.groupBy === "exit" ? "exit" : "enter"
      const absolute = yield* service.getTagPerformance(parseLimitParam(options.limit, 200, 1000), groupBy)
      return toRelativeTagPerformance(absolute)
    }).pipe(Effect.mapError((cause) => asBackendError("instance tag-performance.relative", cause))),
})
