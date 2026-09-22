// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { ALL_CAPABILITIES, CapabilitiesResponse } from "@nfi/api-contract"
import { defineCapability, NoOptions } from "./definition.js"

/**
 * `auth.capabilities` — the caller's granted capability set (public bootstrap).
 *
 * This is the ONLY capability exempt from the grant check: the shell fetches
 * it first to learn what else it may use. The result reflects the resolved
 * principal — root (everything), a signed-in user (their stored grant) or
 * anonymous (the public grant) — and never includes anything the caller
 * cannot already observe.
 */
export const AuthCapabilitiesCapability = defineCapability({
  name: "auth.capabilities",
  optionsSchema: NoOptions,
  resultSchema: CapabilitiesResponse,
  description: "Caller's granted capability set (public bootstrap endpoint).",
  streamable: false,
  pollMs: 60_000,
  exposes: ["session-identity"],
  run: (_options, ctx) => {
    const principal = ctx.principal
    if (principal.kind === "system") {
      // Internal caller (poller/self-test): mirror the unrestricted truth.
      return Effect.succeed({
        capabilities: [...ALL_CAPABILITIES],
        userId: undefined,
        authenticated: false,
        username: undefined,
        role: undefined,
        rootProvisioned: ctx.rootProvisioned,
      } satisfies CapabilitiesResponse)
    }
    if (principal.kind === "anonymous") {
      return Effect.succeed({
        capabilities: [...principal.granted],
        userId: undefined,
        authenticated: false,
        username: undefined,
        role: "anonymous",
        rootProvisioned: ctx.rootProvisioned,
      } satisfies CapabilitiesResponse)
    }
    return Effect.succeed({
      capabilities: [...principal.granted],
      userId: principal.userId,
      authenticated: true,
      username: principal.username,
      role: principal.role,
      rootProvisioned: ctx.rootProvisioned,
    } satisfies CapabilitiesResponse)
  },
})
