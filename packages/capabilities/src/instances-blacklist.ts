// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import { BlacklistResponse } from "@nfi/api-contract";
import { defineCapability } from "./definition.js";
import { asBackendError } from "./errors.js";
import { applySearch } from "./search.js";

const BlacklistOptions = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  /** Free-text filter applied server-side over the full entry list. */
  search: Schema.optional(Schema.String),
});

/** `instances.blacklist` — blacklisted pairs with reasons for one instance. */
export const InstancesBlacklistCapability = defineCapability({
  name: "instances.blacklist",
  optionsSchema: BlacklistOptions,
  resultSchema: BlacklistResponse,
  description: "Blacklisted pairs with reasons.",
  streamable: true,
  pollMs: 60_000,
  exposes: ["market-data"],
  run: (options, ctx) =>
    Effect.flatMap(ctx.resolveInstance(options.id), (service) =>
      service.getBlacklist(),
    ).pipe(
      Effect.map((body) => ({
        pairs: applySearch(
          body.pairs,
          (entry) => [entry.pair, entry.reason],
          options.search,
        ),
        length: body.length,
      })),
      Effect.mapError((cause) => asBackendError("instance blacklist", cause)),
    ),
});
