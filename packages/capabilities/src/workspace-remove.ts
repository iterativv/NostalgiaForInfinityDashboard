// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { DeleteWorkspaceResponse } from "@nfi/api-contract"
import { defineCapability, IdOptions } from "./definition.js"
import { asBackendError } from "./errors.js"

/** `workspace.remove` — delete a workspace and its panels by id. */
export const WorkspaceRemoveCapability = defineCapability({
  name: "workspace.remove",
  optionsSchema: IdOptions,
  resultSchema: DeleteWorkspaceResponse,
  description: "Delete a workspace and its panels by id.",
  streamable: false,
  pollMs: 60_000,
  exposes: ["user-workspaces"],
  run: (options, ctx) =>
    Effect.map(ctx.workspaces.deleteWorkspace(options.id), (id) => ({
      id: id as DeleteWorkspaceResponse["id"],
    })).pipe(Effect.mapError((cause) => asBackendError("workspace delete", cause))),
})
