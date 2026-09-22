// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { HttpApiBuilder } from "@effect/platform"
import { NfiApi } from "@nfi/api-contract"
import { runCapabilityForHttp } from "./capabilities/context.js"

/**
 * WorkspaceService (HTTP boundary).
 *
 * Every handler delegates to its capability (`@nfi/capabilities`): the
 * frontend sends validated option objects, the capability revalidates at the
 * trust boundary and maps failures to the shared `BackendError` shape.
 */

export const WorkspaceGroupLive = HttpApiBuilder.group(NfiApi, "Workspace", (handlers) =>
  handlers
    .handle("list", () => runCapabilityForHttp("workspace.list", {}))
    .handle("load", ({ path }) => runCapabilityForHttp("workspace.load", { id: path.id }))
    .handle("save", ({ path, payload }) =>
      runCapabilityForHttp("workspace.save", { id: path.id, workspace: payload.workspace }),
    )
    .handle("create", ({ payload }) =>
      runCapabilityForHttp("workspace.create", { name: payload.name, workspace: payload.workspace }),
    )
    .handle("remove", ({ path }) => runCapabilityForHttp("workspace.remove", { id: path.id })),
)
