// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { BackendError, CreateInstanceRequest, CreateInstanceResponse } from "@nfi/api-contract"
import { DEFAULT_INSTANCE_ID, defineCapability } from "./definition.js"
import { asBackendError } from "./errors.js"

/** `instances.create` — store a new named freqtrade connection. */
export const InstancesCreateCapability = defineCapability({
  name: "instances.create",
  optionsSchema: CreateInstanceRequest,
  resultSchema: CreateInstanceResponse,
  description: "Store a new named freqtrade connection.",
  streamable: false,
  pollMs: 60_000,
  exposes: ["infra-location"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      if (options.name.trim() === DEFAULT_INSTANCE_ID) {
        return yield* Effect.fail(
          BackendError.make({ error: "instance name reserved", detail: `"${DEFAULT_INSTANCE_ID}" is the env instance` }),
        )
      }
      let parsed: URL
      try {
        parsed = new URL(options.baseUrl.trim())
      } catch {
        return yield* Effect.fail(BackendError.make({ error: "invalid baseUrl", detail: options.baseUrl }))
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return yield* Effect.fail(BackendError.make({ error: "invalid baseUrl", detail: "use http(s)://host:port" }))
      }
      const instance = yield* ctx.instances.createInstance({
        name: options.name,
        baseUrl: options.baseUrl,
        username: options.username,
        password: options.password,
      })
      return { instance }
    }).pipe(Effect.mapError((cause) => asBackendError("instance create", cause))),
})
