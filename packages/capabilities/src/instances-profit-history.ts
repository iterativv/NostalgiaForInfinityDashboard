// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect"
import { ProfitHistoryResponse } from "@nfi/api-contract"
import { defineCapability, IdOptions, parseLimitParam } from "./definition.js"
import { asBackendError } from "./errors.js"

/**
 * `instances.profit-history` — sqlite profit snapshots for ONE instance.
 *
 * The live poller records profit snapshots for every configured instance
 * (throttled to the snapshot interval), so each bot has its own recorded
 * equity curve — this capability reads one instance's window. Absolute coin
 * amounts; never grant publicly.
 */
export const InstancesProfitHistoryCapability = defineCapability({
  name: "instances.profit-history",
  optionsSchema: Schema.Struct({
    ...IdOptions.fields,
    limit: Schema.optional(Schema.String),
  }),
  resultSchema: ProfitHistoryResponse,
  description: "Recorded profit history for one instance (absolute coin amounts).",
  streamable: true,
  pollMs: 60_000,
  exposes: ["absolute-profit"],
  run: (options, ctx) =>
    ctx.snapshots
      .profitHistory(options.id, parseLimitParam(options.limit, 500, 500))
      .pipe(Effect.mapError((cause) => asBackendError("profit history", cause))),
})
