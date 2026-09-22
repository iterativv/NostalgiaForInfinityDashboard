// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect"
import { ANONYMOUS_USER_ID, DeleteUserResponse, ForbiddenError, ROOT_USER_ID } from "@nfi/api-contract"
import { defineCapability } from "./definition.js"
import { asBackendError, notFoundError } from "./errors.js"

/**
 * `users.remove` — delete a stored user. Their sessions die lazily on the
 * next request (session resolve no longer finds the user -> anonymous).
 * `root` (virtual, env-configured) and `anonymous` (the public grant row)
 * cannot be deleted. A limited (non-root) caller may only delete users
 * whose grant is a subset of their own — the same no-escalation rule as
 * `users.update`, so a manager cannot touch more-privileged accounts.
 */
export const UsersRemoveCapability = defineCapability({
  name: "users.remove",
  optionsSchema: Schema.Struct({ id: Schema.String.pipe(Schema.minLength(1)) }),
  resultSchema: DeleteUserResponse,
  description: "Delete a user (root and the anonymous grant row are protected).",
  streamable: false,
  pollMs: 60_000,
  exposes: ["user-accounts"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const principal = ctx.principal
      if (principal.kind === "anonymous") {
        return yield* Effect.fail(
          ForbiddenError.make({ error: "sign in required to manage users" }),
        )
      }
      if (options.id === ROOT_USER_ID || options.id === ANONYMOUS_USER_ID) {
        return yield* Effect.fail(
          ForbiddenError.make({
            error: `${options.id} cannot be deleted`,
            detail: "root is env-configured; anonymous holds the public grant",
          }),
        )
      }
      if (principal.kind === "user" && principal.role !== "root") {
        const target = yield* ctx.users
          .getUser(options.id)
          .pipe(Effect.mapError((cause) => asBackendError("users.remove", cause)))
        if (!target) return yield* Effect.fail(notFoundError("user", options.id))
        const held = target.capabilities.filter((id) => !principal.granted.includes(id))
        if (held.length > 0) {
          return yield* Effect.fail(
            ForbiddenError.make({
              error: "cannot manage a user holding capabilities you do not hold",
              detail: held.join(", "),
            }),
          )
        }
      }
      const deleted = yield* ctx.users
        .deleteUser(options.id)
        .pipe(Effect.mapError((cause) => asBackendError("users.remove", cause)))
      if (!deleted) return yield* Effect.fail(notFoundError("user", options.id))
      return { id: options.id } satisfies DeleteUserResponse
    }),
})
