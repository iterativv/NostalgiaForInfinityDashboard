// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { ListInstancesResponse } from "@nfi/api-contract"
import { DEFAULT_INSTANCE_ID, defineCapability, NoOptions } from "./definition.js"
import { asBackendError } from "./errors.js"

/**
 * `instances.list` — all known freqtrade instances (default + stored).
 *
 * Passwords never leave the backend: entries carry `hasPassword` only.
 * Entries do carry `baseUrl`, which locates the operator's infrastructure
 * — the `infra-location` information kind.
 */
export const InstancesListCapability = defineCapability({
  name: "instances.list",
  optionsSchema: NoOptions,
  resultSchema: ListInstancesResponse,
  description: "List known freqtrade instances (default env + stored).",
  streamable: true,
  pollMs: 15_000,
  exposes: ["infra-location"],
  run: (_options, ctx) =>
    Effect.gen(function* () {
      const stored = yield* ctx.instances.listInstances()
      const now = new Date().toISOString()
      return {
        instances: [
          // The env `default` row only exists when the env default is
          // actually configured (FREQTRADE_URL / FREQTRADE_PASSWORD set) —
          // the built-in fallback URL is an empty slot, not an instance.
          // When `default` follows a stored instance it IS that row —
          // listing both would show the same bot twice.
          ...(ctx.defaultEnvConfigured && !ctx.defaultFollowsStoredInstance
            ? [
                {
                  id: DEFAULT_INSTANCE_ID,
                  name: "default",
                  baseUrl: ctx.defaultInstanceBaseUrl,
                  username: "env",
                  hasPassword: false,
                  createdAt: now,
                  updatedAt: now,
                },
              ]
            : []),
          ...stored,
        ],
      }
    }).pipe(Effect.mapError((cause) => asBackendError("instance list", cause))),
})
