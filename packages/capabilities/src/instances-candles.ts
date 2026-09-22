// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect"
import { Effect } from "effect"
import { BackendError, CandlesResponse } from "@nfi/api-contract"
import { defineCapability, parseLimitParam } from "./definition.js"
import { asBackendError } from "./errors.js"

/** `instances.candles` — normalized OHLCV candles (public market data). */
export const InstancesCandlesCapability = defineCapability({
  name: "instances.candles",
  optionsSchema: Schema.Struct({
    id: Schema.String.pipe(Schema.minLength(1)),
    pair: Schema.String.pipe(Schema.minLength(1)),
    timeframe: Schema.optional(Schema.String),
    limit: Schema.optional(Schema.String),
  }),
  resultSchema: CandlesResponse,
  description: "Normalized OHLCV candles for one pair (public market data).",
  streamable: true,
  pollMs: 30_000,
  exposes: ["market-data"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const pair = options.pair.trim()
      if (pair.length === 0) {
        return yield* Effect.fail(BackendError.make({ error: "pair is required", detail: "pass a non-empty pair" }))
      }
      const service = yield* ctx.resolveInstance(options.id)
      return yield* service.getCandles(pair, options.timeframe?.trim() || "15m", parseLimitParam(options.limit, 200, 1000))
    }).pipe(Effect.mapError((cause) => asBackendError("instance candles", cause))),
})
