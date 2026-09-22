// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { RelativeProfit } from "@nfi/api-contract"
import { defineCapability, IdOptions } from "./definition.js"
import { asBackendError } from "./errors.js"
import { toRelativeProfit } from "./relative.js"

/**
 * `instances.profit.relative` — per-instance profit percentages (shareable).
 */
export const InstancesProfitRelativeCapability = defineCapability({
  name: "instances.profit.relative",
  optionsSchema: IdOptions,
  resultSchema: RelativeProfit,
  description: "Per-instance profit percentages (relative, shareable).",
  streamable: true,
  pollMs: 15_000,
  exposes: ["relative-values"],
  run: (options, ctx) =>
    Effect.flatMap(ctx.resolveInstance(options.id), (service) =>
      Effect.map(service.getProfit(), toRelativeProfit),
    ).pipe(Effect.mapError((cause) => asBackendError("instance profit.relative", cause))),
})
