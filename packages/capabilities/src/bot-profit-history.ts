// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect"
import { Effect } from "effect"
import { ProfitHistoryResponse } from "@nfi/api-contract"
import { DEFAULT_INSTANCE_ID, defineCapability, parseLimitParam } from "./definition.js"
import { asBackendError } from "./errors.js"

/**
 * `bot.profit-history` — sqlite profit snapshots (ABSOLUTE coin amounts).
 *
 * Never grant publicly: use `bot.profit-history.relative` for shareable pages.
 */
export const BotProfitHistoryCapability = defineCapability({
  name: "bot.profit-history",
  optionsSchema: Schema.Struct({ limit: Schema.optional(Schema.String) }),
  resultSchema: ProfitHistoryResponse,
  description: "Recorded profit history in absolute coin amounts.",
  streamable: true,
  pollMs: 60_000,
  exposes: ["absolute-profit"],
  run: (options, ctx) =>
    ctx.snapshots
      .profitHistory(DEFAULT_INSTANCE_ID, parseLimitParam(options.limit, 500, 500))
      .pipe(Effect.mapError((cause) => asBackendError("profit history", cause))),
})
