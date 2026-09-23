// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { HttpServerRequest } from "@effect/platform"
import { Context, Effect, Layer } from "effect"
import {
  ALL_CAPABILITIES,
  ANONYMOUS_USER_ID,
  BackendError,
  ForbiddenError,
  LoginResponse,
  MIN_ROOT_PASSWORD_LENGTH,
  NON_SENSITIVE_CAPABILITIES,
  ROOT_USER_ID,
  UnauthorizedError,
  type Capability,
  type UserRole,
} from "@nfi/api-contract"
import { UserRepo, verifyPassword, type UserRepoService } from "@nfi/db"
import type { Principal } from "@nfi/capabilities"

/**
 * Session auth — the server-side identity plane.
 *
 * - Root user is provisioned ONE of two ways: env (`ROOT_USERNAME` /
 *   `ROOT_PASSWORD`, the classic virtual root) or first-run setup
 *   (`Auth.setupRoot`, which stores a fixed sqlite row with id `"root"`).
 *   Either way root always holds every capability and can never be
 *   disabled, narrowed or edited by the user-management endpoints. Env
 *   takes precedence whenever it is present.
 * - Users + the anonymous grant live in sqlite (`@nfi/db` users table).
 * - Sessions are in-memory tokens in an HttpOnly `SameSite=Lax` cookie
 *   (plus `Secure` when the login arrived over TLS); a server restart logs
 *   everyone out (no tokens persist at rest). Grants are re-read from
 *   sqlite on every request, so capability edits apply immediately.
 * - Logins are throttled per username (lockout after repeated failures —
 *   see the throttle block below).
 * - `principalFromRequest` never fails: an unknown/expired session or a
 *   missing cookie resolves to the anonymous principal. Authorization (what
 *   the principal may use) happens separately at each capability boundary.
 */

export const SESSION_COOKIE = "nfi_session"
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Sync env reader for the OPTIONAL root identity. Returns `null` when
 * `ROOT_USERNAME`/`ROOT_PASSWORD` are not both set — the deployment then
 * provisions root through `Auth.setupRoot` on first visit.
 */
export const readEnvRootCredentials = (): { rootUsername: string; rootPassword: string } | null => {
  const rootUsername = (process.env["ROOT_USERNAME"] ?? "").trim()
  const rootPassword = process.env["ROOT_PASSWORD"] ?? ""
  if (rootUsername.length === 0 || rootPassword.length === 0) return null
  return { rootUsername, rootPassword }
}

/**
 * One-time first-run setup token.
 *
 * The Docker defaults publish the port on every interface while root is
 * still unprovisioned, so whoever opens the setup screen first would become
 * root. The token closes that window: the server prints it to its log on
 * first boot (see the `SessionAuthLive` boot check) and `setupRoot` refuses
 * without it — even an exposed first boot cannot be claimed by a stranger.
 *
 * - `NFI_SETUP_TOKEN` pins a fixed token (automation, reproducible
 *   deployments); otherwise a random 128-bit hex token is generated once
 *   per process and stays valid until restart.
 * - Empty env means unset (compose passes `${VAR:-}` through as `""`).
 */
let generatedSetupToken: string | null = null

export const readSetupToken = (): string => {
  const fixed = (process.env["NFI_SETUP_TOKEN"] ?? "").trim()
  if (fixed.length > 0) return fixed
  if (generatedSetupToken === null) {
    generatedSetupToken = randomBytes(16).toString("hex")
  }
  return generatedSetupToken
}

/** Test hook: drop the cached generated token so the next read re-rolls. */
export const resetSetupTokenForTests = (): void => {
  generatedSetupToken = null
}

/**
 * Resolve the root identity for capability guards and the manage-users
 * listing: env credentials win, else the provisioned root row, else the
 * literal `root` is still reserved while root is unprovisioned.
 */
export const resolveRootIdentity = (
  users: UserRepoService,
): Effect.Effect<{ rootUsername: string; rootProvisioned: boolean }> =>
  Effect.map(
    Effect.catchAll(users.getUser(ROOT_USER_ID), () => Effect.succeed(null)),
    (row): { rootUsername: string; rootProvisioned: boolean } => {
      const envRoot = readEnvRootCredentials()
      if (envRoot) return { rootUsername: envRoot.rootUsername, rootProvisioned: true }
      if (row && row.role === "root") return { rootUsername: row.username, rootProvisioned: true }
      return { rootUsername: "root", rootProvisioned: false }
    },
  )

// ---------------------------------------------------------------------------
// Cookie helpers (no dependency — the only cookie in the system)
// ---------------------------------------------------------------------------

const parseCookies = (header: string | undefined): Map<string, string> => {
  const out = new Map<string, string>()
  if (!header) return out
  for (const part of header.split(";")) {
    const eq = part.indexOf("=")
    if (eq <= 0) continue
    const name = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (!name) continue
    // Malformed percent-encoding must degrade to the raw value, never throw:
    // this runs on every request (`principalFromRequest` never fails).
    try {
      out.set(name, decodeURIComponent(value))
    } catch {
      out.set(name, value)
    }
  }
  return out
}

export const sessionTokenFromRequest = (request: HttpServerRequest.HttpServerRequest): string | undefined =>
  parseCookies(request.headers.cookie).get(SESSION_COOKIE)

/**
 * Whether the browser reached us over TLS — directly or behind a reverse
 * proxy that forwards `X-Forwarded-Proto`. Only used to decide the cookie's
 * `Secure` attribute; a spoofed header can at most make the SENDER's own
 * session cookie Secure-restricted.
 */
export const requestIsSecure = (request: HttpServerRequest.HttpServerRequest): boolean => {
  const forwarded = request.headers["x-forwarded-proto"]
  if (typeof forwarded === "string" && forwarded.split(",")[0]?.trim() === "https") {
    return true
  }
  return request.url.startsWith("https://")
}

/** `Set-Cookie` value that establishes a session. */
export const sessionCookie = (token: string, secure = false): string =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure ? "; Secure" : ""}`

/** `Set-Cookie` value that clears the session. */
export const clearedSessionCookie = (): string =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

interface SessionEntry {
  userId: string
  expiresAt: number
}

export interface SessionAuthLogin {
  readonly response: LoginResponse
  /** `Set-Cookie` header value for the HTTP layer to attach. */
  readonly setCookie: string
}

// ---------------------------------------------------------------------------
// Login throttle (in-memory, per username)
//
// 5 failures within 15 minutes lock the username for 15 minutes. This is a
// brute-force brake, not a hardened AAA feature: sessions are in-memory
// already, so a restart clears it, and the map is keyed by username only
// (behind a reverse proxy the socket address is the proxy's, so per-IP
// keying would throttle ALL users together). The accepted tradeoff: an
// attacker who knows a username can keep it locked out; legit users wait
// out the window. Scrypt + the dummy-hash timing equalizer slow every
// attempt regardless.
// ---------------------------------------------------------------------------

const LOGIN_MAX_FAILURES = 5
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000

interface SessionAuthService {
  /** Env-configured root username, or the reserved fallback (`root`). */
  readonly rootUsername: string
  /** Verify credentials, mint a session, and produce the login payload. */
  readonly login: (
    username: string,
    password: string,
    secure?: boolean,
  ) => Effect.Effect<SessionAuthLogin, UnauthorizedError | BackendError>
  /**
   * First-run root provisioning: create the always-privileged root account
   * and mint its session. Refuses once root exists (env or stored). Requires
   * the one-time setup token (`readSetupToken`, printed to the server log on
   * first boot) and a password of at least `MIN_ROOT_PASSWORD_LENGTH`
   * characters.
   */
  readonly setupRoot: (
    username: string,
    password: string,
    setupToken?: string,
    secure?: boolean,
  ) => Effect.Effect<SessionAuthLogin, ForbiddenError | BackendError>
  /** Drop the session behind `token` (missing token = no-op). */
  readonly logout: (token: string | undefined) => Effect.Effect<void>
  /** Resolve the caller: root | stored user | anonymous. Never fails. */
  readonly principalFromRequest: (
    request: HttpServerRequest.HttpServerRequest,
  ) => Effect.Effect<Principal>
}

export class SessionAuth extends Context.Tag("nfi/SessionAuth")<SessionAuth, SessionAuthService>() {}

/** Constant-time string compare via sha256 (equalizes lengths). */
const constantTimeEquals = (a: string, b: string): boolean => {
  const ha = createHash("sha256").update(a).digest()
  const hb = createHash("sha256").update(b).digest()
  return timingSafeEqual(ha, hb)
}

/**
 * Fixed dummy hash so a login for a NONEXISTENT user still pays the scrypt
 * cost — otherwise response timing would enumerate valid usernames.
 */
const DUMMY_HASH =
  "scrypt:AAAAAAAAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

const anonymousPrincipal = (grant: ReadonlyArray<Capability>): Principal => ({
  kind: "anonymous",
  granted: grant,
})

// ---------------------------------------------------------------------------
// Stream bridge (singleton, mirrors `liveHub`'s pattern)
//
// The SSE route is a plain `HttpLayerRouter.add` handler; service
// requirements on such routes surface as `Request.From<...>` phantom types
// that only HttpLayerRouter middleware layers can satisfy. Instead of
// fighting that, the SessionAuth layer installs a resolver closure (with
// `users` already captured) at build time — requests only arrive after the
// layer graph is built, so the bridge is always installed before first use.
// ---------------------------------------------------------------------------

type PrincipalResolver = (request: HttpServerRequest.HttpServerRequest) => Effect.Effect<Principal>

let principalResolver: PrincipalResolver | null = null

const anonymousFallback: Principal = anonymousPrincipal([...NON_SENSITIVE_CAPABILITIES])

/** Resolve the caller for a non-HttpApi route (SSE stream). Never fails. */
export const resolvePrincipalForRequest = (
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<Principal> =>
  principalResolver !== null ? principalResolver(request) : Effect.succeed(anonymousFallback)

export const SessionAuthLive: Layer.Layer<SessionAuth, never, UserRepo> = Layer.effect(
  SessionAuth,
  Effect.gen(function* () {
    const users = yield* UserRepo
    const envRoot = readEnvRootCredentials()
    const sessions = new Map<string, SessionEntry>()

    const loginFailures = new Map<string, number[]>()
    const loginLockedUntil = new Map<string, number>()

    const lockoutRemainingMs = (username: string): number => {
      const until = loginLockedUntil.get(username) ?? 0
      if (until <= 0) return 0
      const remaining = until - Date.now()
      if (remaining <= 0) {
        loginLockedUntil.delete(username)
        loginFailures.delete(username)
        return 0
      }
      return remaining
    }

    const recordLoginFailure = (username: string): void => {
      const now = Date.now()
      const cutoff = now - LOGIN_FAILURE_WINDOW_MS
      const recent = (loginFailures.get(username) ?? []).filter((t) => t > cutoff)
      recent.push(now)
      loginFailures.set(username, recent)
      if (recent.length >= LOGIN_MAX_FAILURES) {
        loginLockedUntil.set(username, now + LOGIN_LOCKOUT_MS)
        loginFailures.delete(username)
      }
    }

    const sweep = (now: number) => {
      for (const [token, entry] of sessions) {
        if (entry.expiresAt <= now) sessions.delete(token)
      }
    }

    const mint = (userId: string): string => {
      const token = randomBytes(32).toString("base64url")
      const now = Date.now()
      sweep(now)
      sessions.set(token, { userId, expiresAt: now + SESSION_TTL_MS })
      return token
    }

    const anonymousFromDb: Effect.Effect<Principal> = Effect.catchAll(
      Effect.map(users.getUser(ANONYMOUS_USER_ID), (row) =>
        anonymousPrincipal(row ? row.capabilities : [...NON_SENSITIVE_CAPABILITIES]),
      ),
      () => Effect.succeed(anonymousPrincipal([...NON_SENSITIVE_CAPABILITIES])),
    )

    const resolveToken = (token: string | undefined): Effect.Effect<Principal> => {
      if (token === undefined || token.length === 0) return anonymousFromDb
      const entry = sessions.get(token)
      if (!entry || entry.expiresAt <= Date.now()) {
        if (entry) sessions.delete(token)
        return anonymousFromDb
      }
      // Sliding expiry: activity keeps the session alive.
      entry.expiresAt = Date.now() + SESSION_TTL_MS
      if (entry.userId === ROOT_USER_ID) {
        // Env root is virtual; a setup-provisioned root falls through to the
        // stored row below (env takes precedence whenever it is present).
        if (envRoot) {
          return Effect.succeed<Principal>({
            kind: "user",
            userId: ROOT_USER_ID,
            username: envRoot.rootUsername,
            role: "root",
            granted: [...ALL_CAPABILITIES],
          })
        }
      }
      return Effect.catchAll(
        Effect.map(users.getUser(entry.userId), (row): Principal | null =>
          // Deleted user: the session dies lazily -> anonymous. A stored root
          // row resolves like the virtual one: every capability, no storage.
          row && row.role !== "anonymous"
            ? {
                kind: "user",
                userId: row.id,
                username: row.username,
                role: row.role === "root" ? "root" : "user",
                granted: row.role === "root" ? [...ALL_CAPABILITIES] : row.capabilities,
              }
            : null,
        ),
        () => Effect.succeed<Principal | null>(null),
      ).pipe(
        Effect.flatMap((principal) => (principal ? Effect.succeed(principal) : anonymousFromDb)),
      )
    }

    const grantFor = (
      userId: string,
      name: string,
      role: UserRole,
      granted: ReadonlyArray<Capability>,
      secure = false,
    ): SessionAuthLogin => {
      const token = mint(userId)
      return {
        response: { userId, username: name, role, capabilities: [...granted] },
        setCookie: sessionCookie(token, secure),
      }
    }

    const login = (username: string, password: string, secure = false) =>
      Effect.gen(function* () {
        const throttleKey = username.trim().toLowerCase()
        const lockoutMs = lockoutRemainingMs(throttleKey)
        if (lockoutMs > 0) {
          return yield* Effect.fail(
            UnauthorizedError.make({
              error: "too many failed attempts",
              detail: `try again in ${Math.ceil(lockoutMs / 1000)}s`,
            }),
          )
        }
        if (envRoot && username === envRoot.rootUsername) {
          if (!constantTimeEquals(password, envRoot.rootPassword)) {
            recordLoginFailure(throttleKey)
            return yield* Effect.fail(
              UnauthorizedError.make({ error: "invalid username or password" }),
            )
          }
          loginFailures.delete(throttleKey)
          return grantFor(ROOT_USER_ID, envRoot.rootUsername, "root", [...ALL_CAPABILITIES], secure)
        }
        const row: { id: string; username: string; role: "root" | "user"; capabilities: ReadonlyArray<Capability>; passwordHash: string } | null =
          yield* Effect.map(
            users.getUserByUsername(username),
            (found) =>
              found && (found.role === "user" || found.role === "root")
                ? {
                    id: found.id,
                    username: found.username,
                    role: found.role,
                    capabilities: found.capabilities,
                    passwordHash: found.passwordHash,
                  }
                : null,
          ).pipe(
            Effect.mapError((cause): BackendError =>
              BackendError.make({
                error: "login lookup failed",
                detail: cause instanceof Error ? cause.message : String(cause),
              }),
            ),
          )
        const ok = yield* Effect.promise(() =>
          verifyPassword(row ? row.passwordHash : DUMMY_HASH, password),
        )
        if (!row || !ok) {
          recordLoginFailure(throttleKey)
          return yield* Effect.fail(
            UnauthorizedError.make({ error: "invalid username or password" }),
          )
        }
        loginFailures.delete(throttleKey)
        return row.role === "root"
          ? grantFor(ROOT_USER_ID, row.username, "root", [...ALL_CAPABILITIES], secure)
          : grantFor(row.id, row.username, "user", row.capabilities, secure)
      })

    const setupRoot = (username: string, password: string, setupToken?: string, secure = false) =>
      Effect.gen(function* () {
        const name = username.trim()
        if (envRoot) {
          return yield* Effect.fail(
            ForbiddenError.make({
              error: "root is already configured",
              detail: "ROOT_USERNAME and ROOT_PASSWORD are set — remove them to use first-run setup",
            }),
          )
        }
        if (name.length === 0 || password.length === 0) {
          return yield* Effect.fail(
            ForbiddenError.make({ error: "username and password are required" }),
          )
        }
        if (password.length < MIN_ROOT_PASSWORD_LENGTH) {
          return yield* Effect.fail(
            ForbiddenError.make({
              error: "password too short",
              detail: `use at least ${MIN_ROOT_PASSWORD_LENGTH} characters for the root password`,
            }),
          )
        }
        if (name.toLowerCase() === ANONYMOUS_USER_ID) {
          return yield* Effect.fail(
            ForbiddenError.make({ error: "username is reserved" }),
          )
        }
        const existing = yield* Effect.catchAll(
          users.getUser(ROOT_USER_ID),
          () => Effect.succeed(null),
        )
        if (existing) {
          return yield* Effect.fail(
            ForbiddenError.make({
              error: "root already exists",
              detail: "this deployment has already been set up",
            }),
          )
        }
        if (!constantTimeEquals((setupToken ?? "").trim(), readSetupToken())) {
          return yield* Effect.fail(
            ForbiddenError.make({
              error: "invalid setup token",
              detail: "find the one-time token in the server log (docker compose logs -f nfi-desk)",
            }),
          )
        }
        const row = yield* Effect.mapError(
          users.createRootUser({ username: name, password }),
          (cause): BackendError =>
            // A racing setup call hits the id/username UNIQUE constraints.
            /unique/i.test(cause instanceof Error ? cause.message : String(cause))
              ? BackendError.make({ error: "root already exists", detail: "this deployment has already been set up" })
              : BackendError.make({ error: "root setup failed", detail: String(cause) }),
        )
        return grantFor(ROOT_USER_ID, row.username, "root", [...ALL_CAPABILITIES], secure)
      })

    // First-boot setup token: while root is still unprovisioned (no env
    // credentials, no stored row) whoever opens the setup screen first would
    // become root. Print the one-time token `setupRoot` requires so an
    // exposed first boot (e.g. Docker publishing every interface) cannot be
    // claimed by a stranger. Detached on purpose — a storage failure only
    // skips the log line, never the boot.
    yield* Effect.forkDaemon(
      Effect.ignore(
        Effect.gen(function* () {
          if (envRoot) return
          const existing = yield* Effect.catchAll(
            users.getUser(ROOT_USER_ID),
            () => Effect.succeed(null),
          )
          if (existing) return
          yield* Effect.log("First-run setup is open — create the root account on the /setup screen")
          yield* Effect.log(`One-time setup token (required on the setup screen): ${readSetupToken()}`)
        }),
      ),
    )

    // Install the R/E-free stream bridge BEFORE the service value: services
    // are captured in the closure, so the SSE route can resolve principals
    // without declaring layer requirements (see the bridge comment above).
    principalResolver = (request) => resolveToken(sessionTokenFromRequest(request))

    return {
      // Best-effort identity hint (env or the reserved fallback); guards that
      // need the live value resolve it per request via `resolveRootIdentity`.
      rootUsername: envRoot?.rootUsername ?? "root",
      login,
      setupRoot,
      logout: (token) =>
        Effect.sync(() => {
          if (token !== undefined) sessions.delete(token)
        }),
      principalFromRequest: (request) => resolveToken(sessionTokenFromRequest(request)),
    } satisfies SessionAuthService
  }),
)
