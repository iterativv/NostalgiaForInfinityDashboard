// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { BotStatus } from "@nfi/api-contract"
import { defineCapability, IdOptions } from "./definition.js"
import { asBackendError } from "./errors.js"
import { resolveStrategyVersion } from "./strategy-version.js"

/** `instances.status` — bot state/strategy/exchange/version summary for one instance. */
export const InstancesStatusCapability = defineCapability({
  name: "instances.status",
  optionsSchema: IdOptions,
  resultSchema: BotStatus,
  description:
    "Bot state, strategy, exchange and version summary for one instance.",
  streamable: true,
  pollMs: 10_000,
  exposes: ["bot-state"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const service = yield* ctx.resolveInstance(options.id);
      const status = yield* service.getStatus();

      // Version is informational: an unreadable `/version` (old bot,
      // transient failure) must never fail the status read.
      const version = yield* service
        .getVersion()
        .pipe(Effect.orElseSucceed(() => null));

      const strategyVersion = yield* resolveStrategyVersion(
        service,
        status.strategyVersion,
        version?.version,
      );

      return {
        ...status,
        version: version?.version,
        strategyVersion,
      };
    }).pipe(
      Effect.mapError((cause) => asBackendError("instance status", cause)),
    ),
})
