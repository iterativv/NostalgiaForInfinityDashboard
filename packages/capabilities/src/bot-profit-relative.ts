// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { RelativeProfit } from "@nfi/api-contract"
import { defineCapability, NoOptions } from "./definition.js"
import { toBackendError } from "./errors.js"
import { toRelativeProfit } from "./relative.js"

/**
 * `bot.profit.relative` — default-instance profit as percentages + counts.
 *
 * Public-shareable mirror of `bot.profit`: no coin/fiat absolutes.
 */
export const BotProfitRelativeCapability = defineCapability({
  name: "bot.profit.relative",
  optionsSchema: NoOptions,
  resultSchema: RelativeProfit,
  description: "Default-instance profit percentages (relative, shareable).",
  streamable: true,
  pollMs: 15_000,
  exposes: ["relative-values"],
  run: (_options, ctx) =>
    Effect.map(ctx.defaultService.getProfit(), toRelativeProfit).pipe(
      Effect.mapError((cause) => toBackendError("profit.relative", cause)),
    ),
})
