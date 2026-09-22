// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { ProfitSummary } from "@nfi/api-contract"
import { defineCapability, IdOptions } from "./definition.js"
import { asBackendError } from "./errors.js"

/**
 * `instances.profit` — profit summary for one instance (ABSOLUTE amounts).
 *
 * Never grant publicly: use `instances.profit.relative` for shareable pages.
 */
export const InstancesProfitCapability = defineCapability({
  name: "instances.profit",
  optionsSchema: IdOptions,
  resultSchema: ProfitSummary,
  description: "Profit summary for one instance in absolute coin/fiat amounts.",
  streamable: true,
  pollMs: 15_000,
  exposes: ["absolute-profit"],
  run: (options, ctx) =>
    Effect.flatMap(ctx.resolveInstance(options.id), (service) => service.getProfit()).pipe(
      Effect.mapError((cause) => asBackendError("instance profit", cause)),
    ),
})
