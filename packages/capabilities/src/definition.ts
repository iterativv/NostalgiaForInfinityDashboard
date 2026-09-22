// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect"
import type { HttpClient } from "@effect/platform"
import type { BackendError, Capability, ForbiddenError, InfoKind } from "@nfi/api-contract"
import type {
  InstanceRepoService,
  SnapshotRepoService,
  StoredInstance,
  UserRepoService,
  WorkspaceRepoService,
} from "@nfi/db"
import type { FreqtradeClientService } from "@nfi/freqtrade-client"

/**
 * Core capability model: ONE file per capability in this package.
 *
 * A capability is a server-side function — it receives a validated option
 * object and responds with a validated result. Auth limits which capabilities
 * are available to a specific user (the granted set served by
 * `Auth.capabilities`); every definition below is hard-coded (literal `name`,
 * explicit schemas) and the registry (`registry.ts`) is typed
 * `Record<Capability, ...>`, so capability definition and usage are type-safe
 * end to end: a typo'd id or mismatched options/result is a compile error.
 *
 * Each capability file exports exactly one `defineCapability({...})` value
 * owning: the option schema (what the client may pass), the result schema
 * (what the backend returns), the streaming cadence (`pollMs`, the ONLY
 * polling in the system — between backend and freqtrade), the information
 * kinds it can expose, and the `run` implementation against
 * `CapabilityContext`.
 */

/** Failure channel shared by every capability run. */
export type CapabilityError = BackendError | ForbiddenError

export interface CapabilityDef<Name extends string, Options, Result> {
  /** Hard-coded literal id (e.g. `"bot.balance"`). Never constructed dynamically. */
  readonly name: Name
  /** Options the client may pass. Decoded at every trust boundary. */
  readonly optionsSchema: Schema.Schema<Options, any>
  /** Result the backend returns. Always encoded through this schema. */
  readonly resultSchema: Schema.Schema<Result, any>
  /** Human description for registries / public-page listings. */
  readonly description: string
  /** Whether the live stream (`GET /api/stream`) pushes this capability. */
  readonly streamable: boolean
  /**
   * Backend <-> freqtrade refresh cadence in ms. The ONLY polling in the
   * system lives here (server-side poller); the frontend holds no interval —
   * it renders pushed snapshots from a TanStack Store.
   */
  readonly pollMs: number
  /**
   * Kinds of information this capability can expose (`InfoKind` in
   * `@nfi/api-contract`). Deliberately not a sensitivity verdict — what
   * counts as sensitive is the root user's call (served by
   * `System.sensitivity`): this capability is sensitive iff at least one
   * exposed kind is in the configured sensitive set.
   */
  readonly exposes: ReadonlyArray<InfoKind>
  /** Server implementation: options + injected services -> result. */
  readonly run: (
    options: Options,
    ctx: CapabilityContext,
  ) => Effect.Effect<Result, CapabilityError>
}

export const defineCapability = <const Name extends string, Options, Result>(
  def: CapabilityDef<Name, Options, Result>,
): CapabilityDef<Name, Options, Result> => def

/**
 * Who is calling a capability. Resolved by the server at every trust
 * boundary (REST dispatch + SSE stream subscribe):
 *
 * - `root` — the env-configured root user. Always granted every capability;
 *   nothing can disable or narrow it.
 * - `user` — a stored user; `granted` is re-read from sqlite per request so
 *   edits apply immediately.
 * - `anonymous` — not signed in; `granted` is the anonymous row's public
 *   grant (default seed: `NON_SENSITIVE_CAPABILITIES`).
 * - `system` — the backend itself (live poller); internal trust, no user.
 */
export type Principal =
  | {
      readonly kind: "user"
      readonly userId: string
      readonly username: string
      readonly role: "root" | "user"
      readonly granted: ReadonlyArray<Capability>
    }
  | {
      readonly kind: "anonymous"
      readonly granted: ReadonlyArray<Capability>
    }
  | { readonly kind: "system" }

/**
 * The single authorization predicate shared by both server choke points
 * (REST dispatch + SSE stream subscribe): `system` and `root` are
 * unrestricted by definition; everyone else is limited to their grant.
 */
export const principalCanUse = (principal: Principal, name: Capability): boolean =>
  principal.kind === "system"
    ? true
    : principal.kind === "user" && principal.role === "root"
      ? true
      : principal.granted.includes(name)

/**
 * Services a capability implementation may use. Built per request by the
 * server (`apps/server/src/capabilities/context.ts`); capability files never
 * import server layers directly, so this package stays runnable anywhere.
 */
export interface CapabilityContext {
  /**
   * The service behind the implicit `default` instance id: the env
   * credentials when configured, else the first stored instance (so a
   * deployment that connected its bot through the UI gets a live terminal
   * without env config).
   */
  readonly defaultService: FreqtradeClientService
  /**
   * True when `defaultService` follows a stored instance because the env
   * default is unconfigured — the fleet then lists only the stored rows
   * (listing `default` too would duplicate the same bot).
   */
  readonly defaultFollowsStoredInstance: boolean
  /**
   * True when the env default is explicitly configured (`FREQTRADE_URL` set
   * or `FREQTRADE_PASSWORD` set). When false, `default` is an EMPTY SLOT:
   * it follows the first stored instance — or nothing exists at all, and a
   * fresh install has zero instances (no fleet row, no phantom `default`).
   */
  readonly defaultEnvConfigured: boolean
  /**
   * Resolve any instance id: `"default"` -> the effective default service
   * (see `defaultService`), otherwise the SQLite-backed service (own JWT
   * cache). Fails with `BackendError` (`instance not found`) for unknown ids.
   */
  readonly resolveInstance: (id: string) => Effect.Effect<FreqtradeClientService, BackendError>
  readonly workspaces: WorkspaceRepoService
  readonly instances: InstanceRepoService
  readonly snapshots: SnapshotRepoService
  /** User + anonymous-grant storage (users.* capabilities). */
  readonly users: UserRepoService
  /** Who is calling. `system` for the poller; real principal per HTTP request. */
  readonly principal: Principal
  /**
   * Username of the root user (reserved, cannot be created): env-configured,
   * else the username chosen at first-run setup, else the literal `root`
   * while root is still unprovisioned.
   */
  readonly rootUsername: string
  /** Whether an always-privileged root account exists (env or stored). */
  readonly rootProvisioned: boolean
  /** Raw HTTP client for per-instance freqtrade services. */
  readonly http: HttpClient.HttpClient
  /** Stored instance row (with password) for internal use. Never serialized. */
  readonly getStoredInstance: (id: string) => Effect.Effect<StoredInstance | null, BackendError>
  /** Masked backend config (safe for browsers) for `system.backend-config`. */
  readonly backendConfig: {
    readonly freqtradeHost: string
    readonly freqtradeConfigured: boolean
    /** True when `FREQTRADE_PASSWORD` is set (real default-instance creds). */
    readonly defaultInstanceConfigured: boolean
  }
  /**
   * Base URL the implicit `default` instance entry presents: the effective
   * default's URL (env or the stored instance it follows).
   */
  readonly defaultInstanceBaseUrl: string
}

/** Reserved id of the implicit env-backed instance (read-only, never stored). */
export const DEFAULT_INSTANCE_ID = "default"

/** Empty options `{}` shared by capabilities that take no options. */
export const NoOptions = Schema.Struct({})
export type NoOptions = typeof NoOptions.Type

/** `{ id }` options shared by single-resource capabilities. */
export const IdOptions = Schema.Struct({ id: Schema.String.pipe(Schema.minLength(1)) })
export type IdOptions = typeof IdOptions.Type

/**
 * Clamp a wire `limit`/`offset` string option the same way on every
 * capability: unparseable or negative values fall back, values above `max`
 * are capped — callers cannot force unbounded freqtrade reads.
 */
export const parseLimitParam = (raw: string | undefined, fallback: number, max: number): number => {
  if (raw === undefined) return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(n, max)
}
