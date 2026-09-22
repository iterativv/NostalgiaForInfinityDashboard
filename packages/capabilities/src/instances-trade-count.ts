// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect";
import { TradeCountResponse } from "@nfi/api-contract";
import { defineCapability, IdOptions } from "./definition.js";
import { asBackendError } from "./errors.js";

/** `instances.trade-count` — open trades vs. max open trades for one instance. */
export const InstancesTradeCountCapability = defineCapability({
  name: "instances.trade-count",
  optionsSchema: IdOptions,
  resultSchema: TradeCountResponse,
  description: "Open trade count vs. max open trades.",
  streamable: true,
  pollMs: 15_000,
  exposes: ["bot-state"],
  run: (options, ctx) =>
    Effect.flatMap(ctx.resolveInstance(options.id), (service) =>
      service.getTradeCount(),
    ).pipe(
      Effect.mapError((cause) => asBackendError("instance trade count", cause)),
    ),
});
