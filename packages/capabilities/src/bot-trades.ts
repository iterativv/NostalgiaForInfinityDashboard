// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { OpenTradesResponse } from "@nfi/api-contract"
import { defineCapability, NoOptions } from "./definition.js"
import { toBackendError } from "./errors.js"

/**
 * `bot.trades` — default-instance open trades (ABSOLUTE stake/profit amounts).
 *
 * Never grant publicly: use `bot.trades.relative` for shareable pages.
 */
export const BotTradesCapability = defineCapability({
  name: "bot.trades",
  optionsSchema: NoOptions,
  resultSchema: OpenTradesResponse,
  description: "Default-instance open trades with absolute stake/profit amounts.",
  streamable: true,
  pollMs: 10_000,
  exposes: ["trade-details"],
  run: (_options, ctx) =>
    ctx.defaultService.getOpenTrades().pipe(Effect.mapError((cause) => toBackendError("trades", cause))),
})
