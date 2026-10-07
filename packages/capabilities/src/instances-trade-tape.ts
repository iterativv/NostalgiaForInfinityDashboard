// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
import { Effect } from "effect";
import { TapeResponse } from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError } from "./errors.js";

const TapeOptions = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  /** Max events (SQL LIMIT over the merged newest-opens/closes feed). */
  limit: Schema.optional(Schema.String),
  opens: Schema.optional(Schema.String),
  closes: Schema.optional(Schema.String),
});

/**
 * `instances.trade-tape` — the newest opens and closes of one instance as
 * one feed: both halves are SQL-selected (kind filter, ORDER BY event date,
 * LIMIT), the handler only merges the two halves.
 */
export const InstancesTradeTapeCapability = defineCapability({
  name: "instances.trade-tape",
  optionsSchema: TapeOptions,
  resultSchema: TapeResponse,
  description: "Chronological feed of position opens and closes.",
  streamable: true,
  pollMs: 15_000,
  exposes: ["trade-details"],
  run: (options, ctx) =>
    Effect.map(
      ctx.trades.tape({
        instanceId: options.id,
        limit: parseLimitParam(options.limit, 30, 100),
        opens: options.opens !== "false",
        closes: options.closes !== "false",
      }),
      (events) => ({ events }),
    ).pipe(
    Effect.mapError((cause) => asBackendError("instance trade tape", cause)),
  ),
});
