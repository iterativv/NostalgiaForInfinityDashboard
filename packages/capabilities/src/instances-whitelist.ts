// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import { WhitelistResponse } from "@nfi/api-contract";
import { defineCapability } from "./definition.js";
import { asBackendError } from "./errors.js";
import { applySearch } from "./search.js";

const WhitelistOptions = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  /** Free-text filter applied server-side over the full pair list. */
  search: Schema.optional(Schema.String),
});

/** `instances.whitelist` — the pairs the strategy actually analyzes. */
export const InstancesWhitelistCapability = defineCapability({
  name: "instances.whitelist",
  optionsSchema: WhitelistOptions,
  resultSchema: WhitelistResponse,
  description: "Whitelisted pairs the strategy analyzes.",
  streamable: true,
  pollMs: 60_000,
  exposes: ["market-data"],
  run: (options, ctx) =>
    Effect.flatMap(ctx.resolveInstance(options.id), (service) =>
      service.getWhitelist(),
    ).pipe(
      Effect.map((body) => ({
        pairs: applySearch(body.pairs, (pair) => [pair], options.search),
        length: body.pairs.length,
      })),
      Effect.mapError((cause) => asBackendError("instance whitelist", cause)),
    ),
});
