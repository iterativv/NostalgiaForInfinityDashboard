// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect"
import {
  ANONYMOUS_USER_ID,
  Capability,
  ForbiddenError,
  ROOT_USER_ID,
  UpdateUserResponse,
  ManagedUser,
  type UserRole,
} from "@nfi/api-contract"
import type { StoredUser } from "@nfi/db"
import { defineCapability } from "./definition.js"
import { asBackendError, notFoundError } from "./errors.js"

/**
 * `users.update` — change a user's granted capabilities and/or password.
 *
 * Guards:
 * - `root` is immutable: it always holds every capability and no endpoint
 *   may narrow, rename or re-password it.
 * - `anonymous` may only have its capability grant edited (it has no
 *   password and can never log in).
 * - no privilege escalation: a new grant must be a subset of the caller's
 *   own grant (root trivially passes), AND a limited (non-root) caller may
 *   only touch targets whose CURRENT grant they fully hold — otherwise a
 *   bare password reset would hand them an account more powerful than
 *   their own.
 */

const toManaged = (row: StoredUser): ManagedUser => ({
  id: row.id,
  username: row.username,
  role: row.role as UserRole,
  capabilities: [...row.capabilities],
  hasPassword: row.hasPassword,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const UsersUpdateCapability = defineCapability({
  name: "users.update",
  optionsSchema: Schema.Struct({
    id: Schema.String.pipe(Schema.minLength(1)),
    /** Omitted/empty = keep the stored password. Ignored for `anonymous`. */
    password: Schema.optional(Schema.String),
    capabilities: Schema.optional(Schema.Array(Capability)),
  }),
  resultSchema: UpdateUserResponse,
  description: "Update a user's capabilities and/or password (root is immutable).",
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
      if (options.id === ROOT_USER_ID) {
        return yield* Effect.fail(
          ForbiddenError.make({
            error: "the root user cannot be modified",
            detail: "root always holds every capability and is configured via env",
          }),
        )
      }
      const limited = principal.kind === "user" && principal.role !== "root"
      if (limited) {
        // A limited manager may only manage accounts no more privileged
        // than themselves: the target's CURRENT grant must be a subset of
        // the caller's too, or a password reset alone would leak the extra
        // capabilities through the compromised account.
        const target = yield* ctx.users
          .getUser(options.id)
          .pipe(Effect.mapError((cause) => asBackendError("users.update", cause)))
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
      if (options.capabilities !== undefined) {
        const grant = options.capabilities
        const missing = limited ? grant.filter((id) => !principal.granted.includes(id)) : []
        if (missing.length > 0) {
          return yield* Effect.fail(
            ForbiddenError.make({
              error: "cannot grant capabilities you do not hold",
              detail: missing.join(", "),
            }),
          )
        }
      }
      const isAnonymous = options.id === ANONYMOUS_USER_ID
      const row = yield* ctx.users
        .updateUser(options.id, {
          capabilities: options.capabilities,
          // The anonymous row never gets a password.
          password:
            isAnonymous || options.password === undefined || options.password.length === 0
              ? undefined
              : options.password,
        })
        .pipe(Effect.mapError((cause) => asBackendError("users.update", cause)))
      if (!row) return yield* Effect.fail(notFoundError("user", options.id))
      return { user: toManaged(row) } satisfies UpdateUserResponse
    }),
})
