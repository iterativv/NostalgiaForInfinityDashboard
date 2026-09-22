// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { BalanceResponse } from "@nfi/api-contract"
import { defineCapability, NoOptions } from "./definition.js"
import { toBackendError } from "./errors.js"

/**
 * `bot.balance` — default-instance wallet balances (ABSOLUTE coin amounts).
 *
 * Never grant publicly: use `bot.balance.relative` for shareable pages.
 */
export const BotBalanceCapability = defineCapability({
  name: "bot.balance",
  optionsSchema: NoOptions,
  resultSchema: BalanceResponse,
  description: "Default-instance wallet balances in absolute coin amounts.",
  streamable: true,
  pollMs: 15_000,
  exposes: ["absolute-balance"],
  run: (_options, ctx) =>
    ctx.defaultService.getBalance().pipe(Effect.mapError((cause) => toBackendError("balance", cause))),
})
