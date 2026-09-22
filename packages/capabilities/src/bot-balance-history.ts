// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect"
import { Effect } from "effect"
import { BalanceHistoryResponse } from "@nfi/api-contract"
import { DEFAULT_INSTANCE_ID, defineCapability, parseLimitParam } from "./definition.js"
import { asBackendError } from "./errors.js"

/**
 * `bot.balance-history` — sqlite balance snapshots (ABSOLUTE stake amounts).
 *
 * Never grant publicly: use `bot.balance-history.relative` for shareable pages.
 */
export const BotBalanceHistoryCapability = defineCapability({
  name: "bot.balance-history",
  optionsSchema: Schema.Struct({ limit: Schema.optional(Schema.String) }),
  resultSchema: BalanceHistoryResponse,
  description: "Recorded balance history in absolute stake amounts.",
  streamable: true,
  pollMs: 60_000,
  exposes: ["absolute-balance"],
  run: (options, ctx) =>
    ctx.snapshots
      .balanceHistory(DEFAULT_INSTANCE_ID, parseLimitParam(options.limit, 500, 500))
      .pipe(Effect.mapError((cause) => asBackendError("balance history", cause))),
})
