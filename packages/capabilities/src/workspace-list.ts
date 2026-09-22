// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { ListWorkspacesResponse } from "@nfi/api-contract"
import { defineCapability, NoOptions } from "./definition.js"
import { asBackendError } from "./errors.js"

/** `workspace.list` — durable workspace summaries (no layout payloads). */
export const WorkspaceListCapability = defineCapability({
  name: "workspace.list",
  optionsSchema: NoOptions,
  resultSchema: ListWorkspacesResponse,
  description: "List durable workspace summaries.",
  streamable: false,
  pollMs: 60_000,
  exposes: ["user-workspaces"],
  run: (_options, ctx) =>
    Effect.map(ctx.workspaces.listWorkspaces(), (workspaces) => ({ workspaces: [...workspaces] })).pipe(
      Effect.mapError((cause) => asBackendError("workspace list", cause)),
    ),
})
