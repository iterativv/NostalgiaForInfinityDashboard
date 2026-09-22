// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { HttpServerRequest } from "@effect/platform"
import { HttpClient } from "@effect/platform"
import { Effect } from "effect"
import { BackendError, FreqtradeInstance, ForbiddenError } from "@nfi/api-contract"
import {
  asBackendError,
  DEFAULT_INSTANCE_ID,
  notFoundError,
  runCapability,
  principalCanUse,
  type CapabilityContext,
  type CapabilityError,
  type CapabilityName,
  type CapabilityOptions,
  type CapabilityResult,
  type Principal,
} from "@nfi/capabilities"
import { InstanceRepo, SnapshotRepo, UserRepo, WorkspaceRepo } from "@nfi/db"
import { FreqtradeClient, makeFreqtradeService } from "@nfi/freqtrade-client"
import {
  loadServerConfig,
  maskFreqtradeHost,
  readDefaultInstanceConfigured,
  readDefaultInstanceUrlConfigured,
} from "../config.js"
import { readEnvRootCredentials, resolveRootIdentity, SessionAuth } from "../auth/session.js"

/**
 * Server capability wiring (one hub + one poller for ALL capabilities).
 *
 * `makeCapabilityContext` assembles the per-caller `CapabilityContext`
 * (`@nfi/capabilities`) from ambient layers; `runCapabilityEffect` runs any
 * hard-coded capability id with fully inferred options/result. REST handlers
 * (`routes.ts`, `instances.ts`, `workspaces.ts`, `auth.ts`) go through
 * `runCapabilityForHttp` — the authorization choke point which resolves the
 * caller (root | user | anonymous) and rejects ungranted capability ids.
 * The live poller uses `runCapabilityEffect` directly with the internal
 * system principal (backend <-> freqtrade traffic, no user involved).
 */

const systemPrincipal: Principal = { kind: "system" }

export const makeCapabilityContext = (
  principal: Principal = systemPrincipal,
): Effect.Effect<
  CapabilityContext,
  BackendError,
  | FreqtradeClient
  | HttpClient.HttpClient
  | WorkspaceRepo
  | InstanceRepo
  | SnapshotRepo
  | UserRepo
> =>
  Effect.gen(function* () {
    const defaultService = yield* FreqtradeClient
    const http = yield* HttpClient.HttpClient
    const workspaces = yield* WorkspaceRepo
    const instances = yield* InstanceRepo
    const snapshots = yield* SnapshotRepo
    const users = yield* UserRepo
    const { freqtradeBaseUrl } = yield* loadServerConfig.pipe(
      Effect.mapError((cause) => BackendError.make({ error: "backend misconfigured", detail: String(cause) })),
    )
    // Root identity: env credentials win, else the first-run provisioned
    // row, else the literal `root` is reserved while root is unprovisioned.
    const envRoot = readEnvRootCredentials()
    const { rootUsername, rootProvisioned } = envRoot
      ? { rootUsername: envRoot.rootUsername, rootProvisioned: true }
      : yield* resolveRootIdentity(users)

    const resolveInstance = (id: string) =>
      Effect.gen(function* () {
        if (id === DEFAULT_INSTANCE_ID) return defaultInstanceService
        const stored = yield* instances
          .getInstance(id)
          .pipe(Effect.mapError((cause) => asBackendError("instance resolve", cause)))
        if (!stored) return yield* Effect.fail(notFoundError("instance", id))
        return yield* makeFreqtradeService(
          { baseUrl: stored.baseUrl, username: stored.username, password: stored.password },
          http,
        )
      })

    const getStoredInstance = (id: string) =>
      instances
        .getInstance(id)
        .pipe(Effect.mapError((cause) => asBackendError("instance resolve", cause)))

    // Effective `default` instance: the env credentials when configured
    // (explicit FREQTRADE_URL or a password), else the FIRST stored instance
    // — a deployment that connected its bot through the UI gets a live
    // terminal without env config instead of every default-id widget polling
    // a dead localhost URL. Best-effort: a storage failure keeps the env
    // service rather than failing every capability.
    const envDefaultConfigured =
      readDefaultInstanceConfigured() || readDefaultInstanceUrlConfigured()
    const storedRows = yield* instances.listInstances().pipe(
      Effect.orElseSucceed(() => [] as ReadonlyArray<FreqtradeInstance>),
    )
    const firstStored = storedRows[0]
    const fallbackInstance =
      envDefaultConfigured || !firstStored
        ? null
        : (yield* getStoredInstance(firstStored.id).pipe(
            Effect.orElseSucceed(() => null),
          ))
    const defaultInstanceService = fallbackInstance
      ? yield* makeFreqtradeService(
          {
            baseUrl: fallbackInstance.baseUrl,
            username: fallbackInstance.username,
            password: fallbackInstance.password,
          },
          http,
        )
      : defaultService

    return {
      defaultService: defaultInstanceService,
      defaultFollowsStoredInstance: fallbackInstance !== null,
      defaultEnvConfigured: envDefaultConfigured,
      resolveInstance,
      workspaces,
      instances,
      snapshots,
      users,
      principal,
      rootUsername,
      rootProvisioned,
      http,
      getStoredInstance,
      backendConfig: {
        freqtradeHost: maskFreqtradeHost(
          fallbackInstance?.baseUrl ?? freqtradeBaseUrl,
        ),
        // A real freqtrade target exists: the env default is configured, or
        // at least one instance was added through the UI. (The built-in
        // FREQTRADE_URL fallback URL does NOT count — that is the empty
        // slot a fresh install ships with.)
        freqtradeConfigured: envDefaultConfigured || storedRows.length > 0,
        defaultInstanceConfigured: readDefaultInstanceConfigured(),
      },
      defaultInstanceBaseUrl: fallbackInstance?.baseUrl ?? freqtradeBaseUrl,
    } satisfies CapabilityContext
  })

/** Kept for the poller's snapshot reads (system principal, no HTTP caller). */
export const buildCapabilityContext: Effect.Effect<
  CapabilityContext,
  BackendError,
  FreqtradeClient | HttpClient.HttpClient | WorkspaceRepo | InstanceRepo | SnapshotRepo | UserRepo
> = makeCapabilityContext()

/** Type-safe dispatch of any hard-coded capability (no authorization). */
export const runCapabilityEffect = <N extends CapabilityName>(
  name: N,
  options: CapabilityOptions<N>,
  principal: Principal = systemPrincipal,
): Effect.Effect<
  CapabilityResult<N>,
  CapabilityError,
  | FreqtradeClient
  | HttpClient.HttpClient
  | WorkspaceRepo
  | InstanceRepo
  | SnapshotRepo
  | UserRepo
> =>
  Effect.flatMap(makeCapabilityContext(principal), (ctx) => runCapability(name, options, ctx))

/**
 * The REST authorization choke point: resolve the caller from the session
 * cookie, enforce the capability grant, then run. `auth.capabilities` is the
 * single exemption — it is the bootstrap that tells callers their own grant
 * and only ever reflects it.
 *
 * The request is read with `serviceOption` (not as a required service):
 * inside an HTTP handler the fiber context always carries
 * `HttpServerRequest`, while the poller (no request) sees `None` and falls
 * back to the internal system principal — this keeps the handler layers
 * free of request-scoped requirements.
 */
export const runCapabilityForHttp = <N extends CapabilityName>(
  name: N,
  options: CapabilityOptions<N>,
): Effect.Effect<
  CapabilityResult<N>,
  CapabilityError,
  | FreqtradeClient
  | HttpClient.HttpClient
  | WorkspaceRepo
  | InstanceRepo
  | SnapshotRepo
  | UserRepo
  | SessionAuth
> =>
  Effect.gen(function* () {
    const auth = yield* SessionAuth
    const requestOption = yield* Effect.serviceOption(HttpServerRequest.HttpServerRequest)
    const principal = yield* Effect.matchEffect(requestOption, {
      onSuccess: (request) => auth.principalFromRequest(request),
      onFailure: () => Effect.succeed<Principal>(systemPrincipal),
    })
    if (name !== "auth.capabilities" && !principalCanUse(principal, name)) {
      return yield* Effect.fail(
        ForbiddenError.make({
          error: `not authorized for ${name}`,
          detail:
            principal.kind === "anonymous"
              ? "sign in, or ask an admin to add the capability to the anonymous grant"
              : "ask an admin to grant this capability to your user",
        }),
      )
    }
    return yield* runCapabilityEffect(name, options, principal)
  })
