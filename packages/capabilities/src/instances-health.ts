// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { InstanceHealthResponse } from "@nfi/api-contract"
import { defineCapability, IdOptions } from "./definition.js"
import { asBackendError } from "./errors.js"

/** `instances.health` — reachability, version and state for one instance. */
export const InstancesHealthCapability = defineCapability({
  name: "instances.health",
  optionsSchema: IdOptions,
  resultSchema: InstanceHealthResponse,
  description: "Reachability, version and state for one freqtrade instance.",
  streamable: true,
  pollMs: 15_000,
  exposes: ["bot-state"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const service = yield* ctx.resolveInstance(options.id)
      const ping = yield* service.ping().pipe(Effect.orElseSucceed(() => null))
      if (!ping) return { id: options.id, reachable: false as const }
      const version = yield* service.getVersion().pipe(Effect.orElseSucceed(() => ({ version: "unknown" })))
      const status = yield* service.getStatus().pipe(Effect.orElseSucceed(() => null))
      return {
        id: options.id,
        reachable: true as const,
        version: version.version,
        state: status?.state,
      }
    }).pipe(Effect.mapError((cause) => asBackendError("instance health", cause))),
})
