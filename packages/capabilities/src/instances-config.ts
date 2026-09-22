// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect";
import { BotConfigSummary } from "@nfi/api-contract";
import { defineCapability, IdOptions } from "./definition.js";
import { asBackendError } from "./errors.js";

/** `instances.config` — strategy/stake/run-mode summary for one instance. */
export const InstancesConfigCapability = defineCapability({
  name: "instances.config",
  optionsSchema: IdOptions,
  resultSchema: BotConfigSummary,
  description: "Strategy, stake and run-mode configuration for one instance.",
  streamable: false,
  pollMs: 60_000,
  exposes: ["strategy-config", "stake-amount"],
  run: (options, ctx) =>
    Effect.flatMap(ctx.resolveInstance(options.id), (service) =>
      service.getConfig(),
    ).pipe(
      Effect.mapError((cause) => asBackendError("instance config", cause)),
    ),
});
