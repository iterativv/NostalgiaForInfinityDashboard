// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import { DeleteWorkspaceResponse, WorkspaceId } from "@nfi/api-contract";
import { defineCapability, IdOptions } from "./definition.js";
import { asBackendError } from "./errors.js";

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
    Effect.map(ctx.workspaces.deleteWorkspace(options.id), () => ({
      // Brand the echoed id through the response's own id schema (options
      // already enforce the same minLength(1) contract).
      id: Schema.decodeSync(WorkspaceId)(options.id),
    })).pipe(
      Effect.mapError((cause) => asBackendError("workspace delete", cause)),
    ),
});
