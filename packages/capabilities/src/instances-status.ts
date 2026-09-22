// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { BotStatus } from "@nfi/api-contract"
import { defineCapability, IdOptions } from "./definition.js"
import { asBackendError } from "./errors.js"

/** `instances.status` — bot state/strategy/exchange summary for one instance. */
export const InstancesStatusCapability = defineCapability({
  name: "instances.status",
  optionsSchema: IdOptions,
  resultSchema: BotStatus,
  description: "Bot state, strategy and exchange summary for one instance.",
  streamable: true,
  pollMs: 10_000,
  exposes: ["bot-state"],
  run: (options, ctx) =>
    Effect.flatMap(ctx.resolveInstance(options.id), (service) => service.getStatus()).pipe(
      Effect.mapError((cause) => asBackendError("instance status", cause)),
    ),
})
