// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { HttpApiBuilder } from "@effect/platform"
import { NfiApi } from "@nfi/api-contract"
import { runCapabilityForHttp } from "./capabilities/context.js"

/**
 * User management (HTTP boundary).
 *
 * One-line delegations to the `users.*` capabilities; authorization (the
 * caller must hold the capability, grants may not exceed the caller's own,
 * root/anonymous rows are protected) is enforced at the choke point and
 * inside each capability.
 */

export const UsersGroupLive = HttpApiBuilder.group(NfiApi, "Users", (handlers) =>
  handlers
    .handle("list", () => runCapabilityForHttp("users.list", {}))
    .handle("create", ({ payload }) =>
      runCapabilityForHttp("users.create", {
        username: payload.username,
        password: payload.password,
        capabilities: [...payload.capabilities],
      }),
    )
    .handle("update", ({ path, payload }) =>
      runCapabilityForHttp("users.update", {
        id: path.id,
        password: payload.password,
        capabilities: payload.capabilities === undefined ? undefined : [...payload.capabilities],
      }),
    )
    .handle("remove", ({ path }) => runCapabilityForHttp("users.remove", { id: path.id })),
)
