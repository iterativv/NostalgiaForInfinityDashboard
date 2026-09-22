// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { RelativeBalance } from "@nfi/api-contract"
import { defineCapability, NoOptions } from "./definition.js"
import { toBackendError } from "./errors.js"
import { toRelativeBalance } from "./relative.js"

/**
 * `bot.balance.relative` — default-instance allocation as weights (0..1).
 *
 * Public-shareable mirror of `bot.balance`: carries NO absolute amounts, so
 * no option combination can reveal the underlying freqtrade balance.
 */
export const BotBalanceRelativeCapability = defineCapability({
  name: "bot.balance.relative",
  optionsSchema: NoOptions,
  resultSchema: RelativeBalance,
  description: "Default-instance allocation weights (relative, shareable).",
  streamable: true,
  pollMs: 15_000,
  exposes: ["relative-values"],
  run: (_options, ctx) =>
    Effect.map(ctx.defaultService.getBalance(), toRelativeBalance).pipe(
      Effect.mapError((cause) => toBackendError("balance.relative", cause)),
    ),
})
