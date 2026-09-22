// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { BackendConfigResponse } from "@nfi/api-contract"
import { defineCapability, NoOptions } from "./definition.js"

/**
 * `system.backend-config` — masked backend config (host only, never secrets).
 *
 * Static per boot, so it is not streamable: the frontend fetches it once via
 * `callCapability`. One file = one capability.
 */
export const SystemBackendConfigCapability = defineCapability({
  name: "system.backend-config",
  optionsSchema: NoOptions,
  resultSchema: BackendConfigResponse,
  description: "Masked backend config (freqtrade host only, never credentials).",
  streamable: false,
  pollMs: 60_000,
  exposes: ["infra-location"],
  run: (_options, ctx) => Effect.succeed({ ...ctx.backendConfig }),
})
