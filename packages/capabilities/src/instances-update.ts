// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect"
import { Effect } from "effect"
import { BackendError, UpdateInstanceResponse } from "@nfi/api-contract"
import { DEFAULT_INSTANCE_ID, defineCapability } from "./definition.js"
import { asBackendError, notFoundError } from "./errors.js"

/** `instances.update` — rename/repoint a stored instance (default is read-only). */
export const InstancesUpdateCapability = defineCapability({
  name: "instances.update",
  optionsSchema: Schema.Struct({
    id: Schema.String.pipe(Schema.minLength(1)),
    name: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
    baseUrl: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
    username: Schema.optional(Schema.String),
    password: Schema.optional(Schema.String),
  }),
  resultSchema: UpdateInstanceResponse,
  description: "Rename or repoint a stored freqtrade instance.",
  streamable: false,
  pollMs: 60_000,
  exposes: ["infra-location"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      if (options.id === DEFAULT_INSTANCE_ID) {
        return yield* Effect.fail(
          BackendError.make({ error: "default instance is read-only", detail: "configure it via FREQTRADE_* env" }),
        )
      }
      if (options.baseUrl !== undefined) {
        try {
          const parsed = new URL(options.baseUrl.trim())
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return yield* Effect.fail(BackendError.make({ error: "invalid baseUrl", detail: options.baseUrl }))
          }
        } catch {
          return yield* Effect.fail(BackendError.make({ error: "invalid baseUrl", detail: options.baseUrl ?? "" }))
        }
      }
      const instance = yield* ctx.instances.updateInstance(options.id, {
        name: options.name,
        baseUrl: options.baseUrl,
        username: options.username,
        password: options.password,
      })
      if (!instance) return yield* Effect.fail(notFoundError("instance", options.id))
      return { instance }
    }).pipe(Effect.mapError((cause) => asBackendError("instance update", cause))),
})
