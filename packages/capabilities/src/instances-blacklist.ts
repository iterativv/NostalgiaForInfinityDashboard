// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import { BlacklistResponse } from "@nfi/api-contract";
import { defineCapability } from "./definition.js";
import { asBackendError } from "./errors.js";
import { normalizeSearch } from "./search.js";

const BlacklistOptions = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  /** Free-text filter — a SQL LIKE over pair and reason. */
  search: Schema.optional(Schema.String),
});

/**
 * `instances.blacklist` — blacklisted pairs with reasons for one instance,
 * read from the mirror (SQL LIKE search, unfiltered SQL COUNT length).
 */
export const InstancesBlacklistCapability = defineCapability({
  name: "instances.blacklist",
  optionsSchema: BlacklistOptions,
  resultSchema: BlacklistResponse,
  description: "Blacklisted pairs with reasons.",
  streamable: true,
  pollMs: 60_000,
  exposes: ["market-data"],
  run: (options, ctx) =>
    ctx.trades.listBlacklist({
      instanceId: options.id,
      search: normalizeSearch(options.search),
    }).pipe(
    Effect.mapError((cause) => asBackendError("instance blacklist", cause)),
  ),
});
