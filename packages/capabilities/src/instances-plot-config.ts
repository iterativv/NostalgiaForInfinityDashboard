// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect"
import { Effect } from "effect"
import { PlotConfigResponse } from "@nfi/api-contract"
import { defineCapability } from "./definition.js"
import { asBackendError } from "./errors.js"

/** `instances.plot-config` — strategy indicator metadata (neutral). */
export const InstancesPlotConfigCapability = defineCapability({
  name: "instances.plot-config",
  optionsSchema: Schema.Struct({
    id: Schema.String.pipe(Schema.minLength(1)),
    strategy: Schema.optional(Schema.String),
  }),
  resultSchema: PlotConfigResponse,
  description: "Strategy indicator metadata for chart overlays.",
  streamable: false,
  pollMs: 60_000,
  exposes: ["market-data"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const service = yield* ctx.resolveInstance(options.id)
      const strategy = options.strategy?.trim()
      return yield* service.getPlotConfig(strategy !== undefined && strategy.length > 0 ? strategy : undefined)
    }).pipe(Effect.mapError((cause) => asBackendError("instance plot config", cause))),
})
