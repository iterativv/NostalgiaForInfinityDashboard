// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect"
import { Effect } from "effect"
import { RelativeBalanceHistoryResponse } from "@nfi/api-contract"
import { DEFAULT_INSTANCE_ID, defineCapability, parseLimitParam } from "./definition.js"
import { asBackendError } from "./errors.js"
import { toRelativeBalanceHistory } from "./relative.js"

/**
 * `bot.balance-history.relative` — balance history rebased to an index.
 *
 * Public-shareable mirror of `bot.balance-history`: first visible point is
 * exactly 100, so no `limit` can reveal the absolute baseline.
 */
export const BotBalanceHistoryRelativeCapability = defineCapability({
  name: "bot.balance-history.relative",
  optionsSchema: Schema.Struct({ limit: Schema.optional(Schema.String) }),
  resultSchema: RelativeBalanceHistoryResponse,
  description: "Balance history rebased to an index starting at 100 (shareable).",
  streamable: true,
  pollMs: 60_000,
  exposes: ["relative-values"],
  run: (options, ctx) =>
    Effect.map(
      ctx.snapshots.balanceHistory(DEFAULT_INSTANCE_ID, parseLimitParam(options.limit, 500, 500)),
      toRelativeBalanceHistory,
    ).pipe(Effect.mapError((cause) => asBackendError("balance-history.relative", cause))),
})
