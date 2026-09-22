// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect"
import {
  Capability,
  CreateUserResponse,
  ForbiddenError,
  ManagedUser,
  type UserRole,
} from "@nfi/api-contract"
import type { StoredUser } from "@nfi/db"
import { defineCapability } from "./definition.js"
import { asBackendError } from "./errors.js"

/**
 * `users.create` — create a user with a password and granted capabilities.
 *
 * Guard (no privilege escalation): the requested grant must be a subset of
 * the CALLER's grant. Root holds everything, so only root (or a user who
 * already holds the requested ids) can grant them — a manager can never
 * mint an account more powerful than themselves. The root username is
 * reserved and rejected here.
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

const escalationError = (ids: ReadonlyArray<Capability>) =>
  ForbiddenError.make({
    error: "cannot grant capabilities you do not hold",
    detail: ids.join(", "),
  })

export const UsersCreateCapability = defineCapability({
  name: "users.create",
  optionsSchema: Schema.Struct({
    username: Schema.String.pipe(Schema.minLength(1)),
    password: Schema.String.pipe(Schema.minLength(1)),
    capabilities: Schema.Array(Capability),
  }),
  resultSchema: CreateUserResponse,
  description: "Create a user with a password and a granted capability subset.",
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
      const grant = options.capabilities
      const limited = principal.kind === "user" && principal.role !== "root"
      const missing = limited ? grant.filter((id) => !principal.granted.includes(id)) : []
      if (missing.length > 0) return yield* Effect.fail(escalationError(missing))
      if (options.username.trim().toLowerCase() === ctx.rootUsername.trim().toLowerCase()) {
        return yield* Effect.fail(
          ForbiddenError.make({ error: "username is reserved by the root user" }),
        )
      }
      const row = yield* ctx.users
        .createUser({
          username: options.username.trim(),
          password: options.password,
          capabilities: grant,
        })
        .pipe(Effect.mapError((cause) => asBackendError("users.create", cause)))
      return { user: toManaged(row) } satisfies CreateUserResponse
    }),
})
