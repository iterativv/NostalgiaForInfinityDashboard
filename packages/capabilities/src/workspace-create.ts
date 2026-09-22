// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { CreateWorkspaceRequest, CreateWorkspaceResponse } from "@nfi/api-contract"
import { defineCapability } from "./definition.js"
import { asBackendError } from "./errors.js"

/** `workspace.create` — create a workspace (from a document or blank). */
export const WorkspaceCreateCapability = defineCapability({
  name: "workspace.create",
  optionsSchema: CreateWorkspaceRequest,
  resultSchema: CreateWorkspaceResponse,
  description: "Create a workspace from a document or blank.",
  streamable: false,
  pollMs: 60_000,
  exposes: ["user-workspaces"],
  run: (options, ctx) =>
    Effect.map(
      ctx.workspaces.createWorkspace({ name: options.name, workspace: options.workspace }),
      (workspace) => ({ workspace }),
    ).pipe(Effect.mapError((cause) => asBackendError("workspace create", cause))),
})
