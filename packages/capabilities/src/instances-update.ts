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
      // Credential-repoint guard: an empty/omitted password keeps the stored
      // secret (see `InstanceRepo.updateInstance`), so repointing the base
      // URL or username without a fresh password would forward the REAL bot
      // credentials to an attacker-controlled host on the next login. Compare
      // against the STORED values (the edit form always sends baseUrl and
      // username, even unchanged) and require the password on any change.
      const current = yield* ctx.getStoredInstance(options.id)
      if (!current) return yield* Effect.fail(notFoundError("instance", options.id))
      const normalizeBaseUrl = (url: string): string => url.trim().replace(/\/$/, "")
      const nextBaseUrl =
        options.baseUrl !== undefined ? normalizeBaseUrl(options.baseUrl) : current.baseUrl
      const nextUsername = options.username !== undefined ? options.username : current.username
      const passwordProvided = options.password !== undefined && options.password.length > 0
      if ((nextBaseUrl !== current.baseUrl || nextUsername !== current.username) && !passwordProvided) {
        return yield* Effect.fail(
          BackendError.make({
            error: "password required",
            detail: "re-enter the freqtrade password when changing the base URL or username",
          }),
        )
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
