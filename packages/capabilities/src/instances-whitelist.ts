// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect";
import { WhitelistResponse } from "@nfi/api-contract";
import { defineCapability, IdOptions } from "./definition.js";
import { asBackendError } from "./errors.js";

/** `instances.whitelist` — the pairs the strategy actually analyzes. */
export const InstancesWhitelistCapability = defineCapability({
  name: "instances.whitelist",
  optionsSchema: IdOptions,
  resultSchema: WhitelistResponse,
  description: "Whitelisted pairs the strategy analyzes.",
  streamable: true,
  pollMs: 60_000,
  exposes: ["market-data"],
  run: (options, ctx) =>
    Effect.flatMap(ctx.resolveInstance(options.id), (service) =>
      service.getWhitelist(),
    ).pipe(
      Effect.map((body) => ({ pairs: body.pairs, length: body.pairs.length })),
      Effect.mapError((cause) => asBackendError("instance whitelist", cause)),
    ),
});
