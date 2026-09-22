// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect"
import { Effect } from "effect"
import { BackendError, SaveWorkspaceResponse, Workspace } from "@nfi/api-contract"
import { defineCapability } from "./definition.js"
import { asBackendError } from "./errors.js"

/** `workspace.save` — persist a workspace document (path id must match). */
export const WorkspaceSaveCapability = defineCapability({
  name: "workspace.save",
  optionsSchema: Schema.Struct({ id: Schema.String.pipe(Schema.minLength(1)), workspace: Workspace }),
  resultSchema: SaveWorkspaceResponse,
  description: "Persist a workspace document (path id must match body id).",
  streamable: false,
  pollMs: 60_000,
  exposes: ["user-workspaces"],
  run: (options, ctx) =>
    options.workspace.id !== options.id
      ? Effect.fail(
          BackendError.make({
            error: "workspace id mismatch",
            detail: `path ${options.id} !== body ${options.workspace.id}`,
          }),
        )
      : Effect.map(ctx.workspaces.saveWorkspace(options.workspace), (workspace) => ({ workspace })).pipe(
          Effect.mapError((cause) => asBackendError("workspace save", cause)),
        ),
})
