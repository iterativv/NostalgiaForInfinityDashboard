// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { BotStatus } from "@nfi/api-contract"
import { defineCapability, NoOptions } from "./definition.js"
import { toBackendError } from "./errors.js"
import { resolveStrategyVersion } from "./strategy-version.js"

/** `bot.status` — default-instance bot state/strategy/exchange/version summary. */
export const BotStatusCapability = defineCapability({
  name: "bot.status",
  optionsSchema: NoOptions,
  resultSchema: BotStatus,
  description:
    "Default-instance bot state, strategy, exchange and version summary.",
  streamable: true,
  pollMs: 10_000,
  exposes: ["bot-state"],
  run: (_options, ctx) =>
    Effect.gen(function* () {
      const status = yield* ctx.defaultService.getStatus();

      // Version is informational: an unreadable `/version` must never fail
      // the status read.
      const version = yield* ctx.defaultService
        .getVersion()
        .pipe(Effect.orElseSucceed(() => null));

      const strategyVersion = yield* resolveStrategyVersion(
        ctx.defaultService,
        status.strategyVersion,
        version?.version,
      );

      return {
        ...status,
        version: version?.version,
        strategyVersion,
      };
    }).pipe(Effect.mapError((cause) => toBackendError("status", cause))),
})
