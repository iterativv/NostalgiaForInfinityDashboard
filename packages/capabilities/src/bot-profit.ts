// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { ProfitSummary } from "@nfi/api-contract"
import { defineCapability, NoOptions } from "./definition.js"
import { toBackendError } from "./errors.js"

/**
 * `bot.profit` — default-instance profit summary (ABSOLUTE coin/fiat amounts).
 *
 * Never grant publicly: use `bot.profit.relative` for shareable pages.
 */
export const BotProfitCapability = defineCapability({
  name: "bot.profit",
  optionsSchema: NoOptions,
  resultSchema: ProfitSummary,
  description: "Default-instance profit summary in absolute coin/fiat amounts.",
  streamable: true,
  pollMs: 15_000,
  exposes: ["absolute-profit"],
  run: (_options, ctx) =>
    ctx.defaultService.getProfit().pipe(Effect.mapError((cause) => toBackendError("profit", cause))),
})
