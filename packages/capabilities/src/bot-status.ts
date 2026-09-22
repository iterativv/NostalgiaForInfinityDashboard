// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { BotStatus } from "@nfi/api-contract"
import { defineCapability, NoOptions } from "./definition.js"
import { toBackendError } from "./errors.js"

/** `bot.status` — default-instance bot state/strategy/exchange summary. */
export const BotStatusCapability = defineCapability({
  name: "bot.status",
  optionsSchema: NoOptions,
  resultSchema: BotStatus,
  description: "Default-instance bot state, strategy and exchange summary.",
  streamable: true,
  pollMs: 10_000,
  exposes: ["bot-state"],
  run: (_options, ctx) =>
    ctx.defaultService.getStatus().pipe(Effect.mapError((cause) => toBackendError("status", cause))),
})
