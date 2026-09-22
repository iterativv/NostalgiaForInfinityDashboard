// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { HealthResponse } from "@nfi/api-contract"
import { defineCapability, NoOptions } from "./definition.js"

/**
 * `system.health` — backend liveness plus freqtrade reachability.
 *
 * One file = one capability: option schema, result schema, streaming cadence
 * and server implementation live here. Auth gates availability by this id;
 * widgets use the id (never endpoint strings) via `callCapability` /
 * `useCapability`, so usage is type-safe.
 */
export const SystemHealthCapability = defineCapability({
  name: "system.health",
  optionsSchema: NoOptions,
  resultSchema: HealthResponse,
  description: "Backend liveness and freqtrade reachability.",
  streamable: true,
  pollMs: 10_000,
  exposes: ["bot-state"],
  run: (_options, ctx) =>
    Effect.map(
      Effect.orElseSucceed(Effect.as(ctx.defaultService.ping(), "reachable" as const), () => "unreachable" as const),
      (freqtrade) => ({ status: "ok" as const, freqtrade, timestamp: new Date().toISOString() }),
    ),
})
