// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { LoadWorkspaceResponse } from "@nfi/api-contract"
import { defineCapability, IdOptions } from "./definition.js"
import { asBackendError, notFoundError } from "./errors.js"

/** `workspace.load` — load one durable workspace document by id. */
export const WorkspaceLoadCapability = defineCapability({
  name: "workspace.load",
  optionsSchema: IdOptions,
  resultSchema: LoadWorkspaceResponse,
  description: "Load one durable workspace document by id.",
  streamable: false,
  pollMs: 60_000,
  exposes: ["user-workspaces"],
  run: (options, ctx) =>
    Effect.flatMap(ctx.workspaces.loadWorkspace(options.id), (workspace) =>
      workspace === null ? Effect.fail(notFoundError("workspace", options.id)) : Effect.succeed({ workspace }),
    ).pipe(Effect.mapError((cause) => asBackendError("workspace load", cause))),
})
