// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import {
  ALL_CAPABILITIES,
  ANONYMOUS_USER_ID,
  ListUsersResponse,
  ManagedUser,
  ROOT_USER_ID,
  type UserRole,
} from "@nfi/api-contract"
import { defineCapability, NoOptions } from "./definition.js"
import { asBackendError } from "./errors.js"
import type { StoredUser } from "@nfi/db"

/**
 * `users.list` — every principal the Manage users page shows: the virtual
 * root user (all capabilities, read-only), the anonymous grant row and the
 * stored users. Requires holding the capability itself (enforced at the
 * HTTP boundary); password hashes never leave storage.
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

export const UsersListCapability = defineCapability({
  name: "users.list",
  optionsSchema: NoOptions,
  resultSchema: ListUsersResponse,
  description: "List users (root, anonymous grant, stored users) for the manage page.",
  streamable: false,
  pollMs: 60_000,
  exposes: ["user-accounts"],
  run: (_options, ctx) =>
    Effect.gen(function* () {
      const rows = yield* ctx.users
        .listUsers()
        .pipe(Effect.mapError((cause) => asBackendError("users.list", cause)))
      const root: ManagedUser = {
        id: ROOT_USER_ID,
        username: ctx.rootUsername,
        role: "root",
        capabilities: [...ALL_CAPABILITIES],
        hasPassword: true,
        createdAt: undefined,
        updatedAt: undefined,
      }
      const anonymous = rows.find((row) => row.id === ANONYMOUS_USER_ID)
      // A setup-provisioned root is a real row, but the synthetic entry
      // above is its only representation (grants resolved, never read).
      const users = rows.filter(
        (row) => row.id !== ANONYMOUS_USER_ID && row.id !== ROOT_USER_ID,
      ).map(toManaged)
      return {
        users: [root, ...(anonymous ? [toManaged(anonymous)] : []), ...users],
      } satisfies ListUsersResponse
    }),
})
