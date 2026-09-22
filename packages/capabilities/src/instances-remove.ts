// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { BackendError, DeleteInstanceResponse } from "@nfi/api-contract"
import { DEFAULT_INSTANCE_ID, defineCapability, IdOptions } from "./definition.js"
import { asBackendError, notFoundError } from "./errors.js"

/** `instances.remove` — delete a stored instance (default cannot be deleted). */
export const InstancesRemoveCapability = defineCapability({
  name: "instances.remove",
  optionsSchema: IdOptions,
  resultSchema: DeleteInstanceResponse,
  description: "Delete a stored freqtrade instance.",
  streamable: false,
  pollMs: 60_000,
  exposes: ["infra-location"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      if (options.id === DEFAULT_INSTANCE_ID) {
        return yield* Effect.fail(
          BackendError.make({ error: "default instance cannot be deleted", detail: options.id }),
        )
      }
      const existing = yield* ctx.getStoredInstance(options.id)
      if (!existing) return yield* Effect.fail(notFoundError("instance", options.id))
      yield* ctx.instances.deleteInstance(options.id)
      return { id: options.id }
    }).pipe(Effect.mapError((cause) => asBackendError("instance delete", cause))),
})
