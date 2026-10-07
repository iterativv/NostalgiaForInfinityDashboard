// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import { TradedPairsResponse } from "@nfi/api-contract";
import { defineCapability } from "./definition.js";
import { asBackendError } from "./errors.js";

const TradedPairsOptions = Schema.Struct({
  /** Absent = fleet: every instance's rows in one SQL GROUP BY. */
  id: Schema.optional(Schema.String),
});

/**
 * `instances.traded-pairs` — every pair that actually has trades in the
 * mirror (open or closed), one SQL GROUP BY over the FULL history, most
 * recently active first. Unlike `instances.pairs` (the whitelist — what
 * the bot MAY trade), this is what it DID trade: pair pickers offering
 * history review list exactly these rows, never whitelisted-but-never-
 * traded names.
 *
 * Sensitive by default: which pairs a book actually traded is trading
 * activity, not public market data.
 */
export const InstancesTradedPairsCapability = defineCapability({
  name: "instances.traded-pairs",
  optionsSchema: TradedPairsOptions,
  resultSchema: TradedPairsResponse,
  description:
    "Every pair with open or closed trades in the mirror, newest activity first.",
  streamable: true,
  pollMs: 60_000,
  exposes: ["trade-details"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const rows = yield* ctx.trades.tradedPairs({
        instanceId: options.id ?? null,
      });

      return { pairs: [...rows], length: rows.length };
    }).pipe(
    Effect.mapError((cause) => asBackendError("instance traded pairs", cause)),
  ),
});
