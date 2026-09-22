// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { RelativeTradesResponse } from "@nfi/api-contract"
import { defineCapability, NoOptions } from "./definition.js"
import { toBackendError } from "./errors.js"
import { toRelativeTrades } from "./relative.js"

/**
 * `bot.trades.relative` — default-instance open trades without absolutes.
 *
 * Public-shareable mirror of `bot.trades`: pairs + profit percentages only.
 */
export const BotTradesRelativeCapability = defineCapability({
  name: "bot.trades.relative",
  optionsSchema: NoOptions,
  resultSchema: RelativeTradesResponse,
  description: "Default-instance open trades, profit percentages only (shareable).",
  streamable: true,
  pollMs: 10_000,
  exposes: ["relative-values"],
  run: (_options, ctx) =>
    Effect.map(ctx.defaultService.getOpenTrades(), toRelativeTrades).pipe(
      Effect.mapError((cause) => toBackendError("trades.relative", cause)),
    ),
})
