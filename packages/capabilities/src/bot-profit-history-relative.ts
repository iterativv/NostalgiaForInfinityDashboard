// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect"
import { Effect } from "effect"
import { RelativeProfitHistoryResponse } from "@nfi/api-contract"
import { DEFAULT_INSTANCE_ID, defineCapability, parseLimitParam } from "./definition.js"
import { asBackendError } from "./errors.js"
import { toRelativeProfitHistory } from "./relative.js"

/**
 * `bot.profit-history.relative` — profit history rebased to an index.
 *
 * Public-shareable mirror of `bot.profit-history`: the first point of the
 * returned window is exactly 100, so no `limit` can reveal the baseline.
 */
export const BotProfitHistoryRelativeCapability = defineCapability({
  name: "bot.profit-history.relative",
  optionsSchema: Schema.Struct({ limit: Schema.optional(Schema.String) }),
  resultSchema: RelativeProfitHistoryResponse,
  description: "Profit history rebased to an index starting at 100 (shareable).",
  streamable: true,
  pollMs: 60_000,
  exposes: ["relative-values"],
  run: (options, ctx) =>
    Effect.map(
      ctx.snapshots.profitHistory(DEFAULT_INSTANCE_ID, parseLimitParam(options.limit, 500, 500)),
      toRelativeProfitHistory,
    ).pipe(Effect.mapError((cause) => asBackendError("profit-history.relative", cause))),
})
