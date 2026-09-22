// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect"
import { Effect } from "effect"
import { AvailablePairsResponse } from "@nfi/api-contract"
import { defineCapability } from "./definition.js"
import { asBackendError } from "./errors.js"

/** `instances.pairs` — available market pairs (public market data, neutral). */
export const InstancesPairsCapability = defineCapability({
  name: "instances.pairs",
  optionsSchema: Schema.Struct({
    id: Schema.String.pipe(Schema.minLength(1)),
    timeframe: Schema.optional(Schema.String),
    stakeCurrency: Schema.optional(Schema.String),
  }),
  resultSchema: AvailablePairsResponse,
  description: "Available market pairs for one instance (public market data).",
  streamable: true,
  pollMs: 60_000,
  exposes: ["market-data"],
  run: (options, ctx) =>
    Effect.flatMap(ctx.resolveInstance(options.id), (service) =>
      service.getAvailablePairs(options.timeframe, options.stakeCurrency).pipe(
        Effect.catchAll((pairsError) =>
          // freqtrade gates `available_pairs` on some setups (503 "Bot is
          // not in the correct state") while the bot itself runs fine. The
          // analyzed whitelist stays reachable and is the better pair
          // source anyway — every listed pair carries candle data.
          service.getWhitelist().pipe(
            Effect.flatMap((whitelist) =>
              whitelist.pairs.length > 0
                ? Effect.succeed({
                    pairs: whitelist.pairs,
                    length: whitelist.pairs.length,
                    stakeCurrency: options.stakeCurrency,
                  })
                : Effect.fail(pairsError),
            ),
            // Whitelist unreachable too: report the original failure.
            Effect.catchAll(() => Effect.fail(pairsError)),
          ),
        ),
      ),
    ).pipe(Effect.mapError((cause) => asBackendError("instance pairs", cause))),
})
