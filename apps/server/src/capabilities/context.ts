// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { HttpServerRequest } from "@effect/platform";
import { HttpClient } from "@effect/platform";
import { Effect } from "effect";
import {
  BackendError,
  FreqtradeInstance,
  ForbiddenError,
} from "@nfi/api-contract";
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
} from "@nfi/capabilities";
import {
  InstanceRepo,
  SettingsRepo,
  SnapshotRepo,
  TradesRepo,
  UserRepo,
  WorkspaceRepo,
} from "@nfi/db";
import { FreqtradeClient, makeFreqtradeService } from "@nfi/freqtrade-client";
import {
  loadServerConfig,
  maskFreqtradeHost,
  readDefaultInstanceConfigured,
  readDefaultInstanceUrlConfigured,
} from "../config.js";
import {
  readEnvRootCredentials,
  resolveRootIdentity,
  SessionAuth,
} from "../auth/session.js";

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

const systemPrincipal: Principal = { kind: "system" };

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
  | TradesRepo
  | UserRepo
  | SettingsRepo
> =>
  Effect.gen(function* () {
    const defaultService = yield* FreqtradeClient;
    const http = yield* HttpClient.HttpClient;
    const workspaces = yield* WorkspaceRepo;
    const instances = yield* InstanceRepo;
    const snapshots = yield* SnapshotRepo;
    const trades = yield* TradesRepo;
    const users = yield* UserRepo;
    const settings = yield* SettingsRepo;

    const { freqtradeBaseUrl } = yield* loadServerConfig.pipe(
      Effect.mapError((cause) =>
        BackendError.make({
          error: "backend misconfigured",
          detail: String(cause),
        }),
      ),
    );

    // Root identity: env credentials win, else the first-run provisioned
    // row, else the literal `root` is reserved while root is unprovisioned.
    const envRoot = readEnvRootCredentials();

    const { rootUsername, rootProvisioned } = envRoot
      ? { rootUsername: envRoot.rootUsername, rootProvisioned: true }
      : yield* resolveRootIdentity(users);

    const resolveInstance = (id: string) =>
      Effect.gen(function* () {
        if (id === DEFAULT_INSTANCE_ID) return defaultInstanceService;

        const stored = yield* instances
          .getInstance(id)
          .pipe(
            Effect.mapError((cause) =>
              asBackendError("instance resolve", cause),
            ),
          );

        if (!stored) return yield* Effect.fail(notFoundError("instance", id));

        return yield* makeFreqtradeService(
          {
            baseUrl: stored.baseUrl,
            username: stored.username,
            password: stored.password,
          },
          http,
        );
      });

    const getStoredInstance = (id: string) =>
      instances
        .getInstance(id)
        .pipe(
          Effect.mapError((cause) => asBackendError("instance resolve", cause)),
        );

    // Effective `default` instance: the env credentials when configured
    // (explicit FREQTRADE_URL or a password), else the FIRST stored instance
    // — a deployment that connected its bot through the UI gets a live
    // terminal without env config instead of every default-id widget polling
    // a dead localhost URL. Best-effort: a storage failure keeps the env
    // service rather than failing every capability.
    const envDefaultConfigured =
      readDefaultInstanceConfigured() || readDefaultInstanceUrlConfigured();

    const storedRows = yield* instances
      .listInstances()
      .pipe(Effect.orElseSucceed((): ReadonlyArray<FreqtradeInstance> => []));

    const firstStored = storedRows[0];

    const fallbackInstance =
      envDefaultConfigured || !firstStored
        ? null
        : yield* getStoredInstance(firstStored.id).pipe(
            Effect.orElseSucceed(() => null),
          );

    const defaultInstanceService = fallbackInstance
      ? yield* makeFreqtradeService(
          {
            baseUrl: fallbackInstance.baseUrl,
            username: fallbackInstance.username,
            password: fallbackInstance.password,
          },
          http,
        )
      : defaultService;

    return {
      defaultService: defaultInstanceService,
      defaultFollowsStoredInstance: fallbackInstance !== null,
      defaultEnvConfigured: envDefaultConfigured,
      resolveInstance,
      workspaces,
      instances,
      snapshots,
      trades,
      users,
      settings,
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
    } satisfies CapabilityContext;
  });

/** Kept for the poller's snapshot reads (system principal, no HTTP caller). */
export const buildCapabilityContext: Effect.Effect<
  CapabilityContext,
  BackendError,
  | FreqtradeClient
  | HttpClient.HttpClient
  | WorkspaceRepo
  | InstanceRepo
  | SnapshotRepo
  | TradesRepo
  | UserRepo
  | SettingsRepo
> = makeCapabilityContext();

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
  | TradesRepo
  | UserRepo
  | SettingsRepo
> =>
  Effect.flatMap(makeCapabilityContext(principal), (ctx) =>
    runCapability(name, options, ctx),
  );

/**
 * The REST authorization choke point: resolve the caller from the session
 * cookie, enforce the capability grant, then run. Three exemptions:
 * - `auth.capabilities` — the bootstrap that tells callers their own grant
 *   and only ever reflects it.
 * - `system.page-defaults` — the landing-page read. Every visitor (including
 *   grants predating this capability) must resolve where to land; the
 *   response carries only opaque UI ids (page/panel) plus the global
 *   landing — no balances, stakes or locations — and user enumeration still
 *   requires `users.list`. The write twin (`system.page-defaults.update`)
 *   stays fully gated.
 * - `workspace.load` for `page-home` — the shared Home layout. Home is the
 *   deployment's landing dashboard: its layout (widget types + configs,
 *   never balances or credentials) must resolve for signed-out visitors or
 *   every incognito window falls back to the baked-in default while the
 *   admin's edited Home stays trapped in one browser's localStorage. Data
 *   inside each widget is still gated per-widget (anonymous sees forbidden
 *   states unless granted the widget's capability), and every other
 *   workspace id plus all writes (`save`/`create`/`remove`) stay fully
 *   gated.
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
  | TradesRepo
  | UserRepo
  | SettingsRepo
  | SessionAuth
> =>
  Effect.gen(function* () {
    const auth = yield* SessionAuth;

    const requestOption = yield* Effect.serviceOption(
      HttpServerRequest.HttpServerRequest,
    );

    const principal = yield* Effect.matchEffect(requestOption, {
      onSuccess: (request) => auth.principalFromRequest(request),
      onFailure: () => Effect.succeed<Principal>(systemPrincipal),
    });

    // Public Home layout: anyone (including anonymous) may read the shared
    // `page-home` document — see the choke-point doc above. The id is stable
    // (frontend `HOME_PAGE_ID`) so the check is a plain string compare.
    // SAFETY: `options` is the union of every capability's option type; the
    // members that carry an `id` all type it `string`, so widening to an
    // optional-`id` view only reads `workspace.load`'s field.
    const optionsId = (options as { readonly id?: string }).id;

    const isPublicHomeLoad = name === "workspace.load" && optionsId === "page-home";

    if (
      name !== "auth.capabilities" &&
      name !== "system.page-defaults" &&
      !isPublicHomeLoad &&
      !principalCanUse(principal, name)
    ) {
      return yield* Effect.fail(
        ForbiddenError.make({
          error: `not authorized for ${name}`,
          detail:
            principal.kind === "anonymous"
              ? "sign in, or ask an admin to add the capability to the anonymous grant"
              : "ask an admin to grant this capability to your user",
        }),
      );
    }

    return yield* runCapabilityEffect(name, options, principal);
  });
