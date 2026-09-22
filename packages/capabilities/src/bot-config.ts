// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { BotConfigSummary } from "@nfi/api-contract"
import { defineCapability, NoOptions } from "./definition.js"
import { toBackendError } from "./errors.js"

/** `bot.config` — default-instance strategy/exchange configuration summary. */
export const BotConfigCapability = defineCapability({
  name: "bot.config",
  optionsSchema: NoOptions,
  resultSchema: BotConfigSummary,
  description: "Default-instance strategy and exchange configuration summary.",
  streamable: false,
  pollMs: 60_000,
  exposes: ["strategy-config", "stake-amount"],
  run: (_options, ctx) =>
    ctx.defaultService.getConfig().pipe(Effect.mapError((cause) => toBackendError("config", cause))),
})
