// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import { WhitelistResponse } from "@nfi/api-contract";
import { defineCapability } from "./definition.js";
import { asBackendError } from "./errors.js";
import { normalizeSearch } from "./search.js";

const WhitelistOptions = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  /** Free-text filter — a SQL LIKE over the mirrored pair list. */
  search: Schema.optional(Schema.String),
});

/**
 * `instances.whitelist` — the pairs the strategy actually analyzes, read
 * from the mirror: the search is a SQL LIKE and `length` is the unfiltered
 * SQL COUNT (same semantics as before, full coverage by construction).
 */
export const InstancesWhitelistCapability = defineCapability({
  name: "instances.whitelist",
  optionsSchema: WhitelistOptions,
  resultSchema: WhitelistResponse,
  description: "Whitelisted pairs the strategy analyzes.",
  streamable: true,
  pollMs: 60_000,
  exposes: ["market-data"],
  run: (options, ctx) =>
    ctx.trades.listWhitelist({
      instanceId: options.id,
      search: normalizeSearch(options.search),
    }).pipe(
    Effect.mapError((cause) => asBackendError("instance whitelist", cause)),
  ),
});
