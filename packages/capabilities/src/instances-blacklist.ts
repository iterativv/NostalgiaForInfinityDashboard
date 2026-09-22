// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect";
import { BlacklistResponse } from "@nfi/api-contract";
import { defineCapability, IdOptions } from "./definition.js";
import { asBackendError } from "./errors.js";

/** `instances.blacklist` — blacklisted pairs with reasons for one instance. */
export const InstancesBlacklistCapability = defineCapability({
  name: "instances.blacklist",
  optionsSchema: IdOptions,
  resultSchema: BlacklistResponse,
  description: "Blacklisted pairs with reasons.",
  streamable: true,
  pollMs: 60_000,
  exposes: ["market-data"],
  run: (options, ctx) =>
    Effect.flatMap(ctx.resolveInstance(options.id), (service) =>
      service.getBlacklist(),
    ).pipe(
      Effect.mapError((cause) => asBackendError("instance blacklist", cause)),
    ),
});
