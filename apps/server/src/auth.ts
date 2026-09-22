// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { HttpApiBuilder, HttpServerResponse } from "@effect/platform"
import { Effect, Schema } from "effect"
import {
  BackendError,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  NfiApi,
  SetupRootRequest,
} from "@nfi/api-contract"
import { runCapabilityForHttp } from "./capabilities/context.js"
import { clearedSessionCookie, requestIsSecure, SessionAuth, sessionTokenFromRequest } from "./auth/session.js"

/**
 * Auth / capabilities.
 *
 * - `Auth.capabilities` is the bootstrap capability: it reports the caller's
 *   own granted set (root = everything, user = stored grant, anonymous =
 *   public grant) and is the only capability exempt from the grant check.
 * - `Auth.login` / `Auth.logout` are the credential exchange. They are the
 *   documented exception to one-capability-per-endpoint: their job is the
 *   session cookie itself, which capabilities cannot touch. Login failures
 *   are `UnauthorizedError` (401); everything capability-shaped stays behind
 *   `runCapabilityForHttp` (403 on missing grants).
 * - `Auth.setupRoot` is the first-run root provisioning exchange: while the
 *   deployment has no root (no env credentials, no stored row) it creates
 *   the always-privileged account and signs the caller in as root. Once root
 *   exists it refuses with `ForbiddenError` (403) — this is the only path
 *   that can ever create root, so the window is exactly "before first use".
 *
 * Login/logout/setup use `handleRaw` because only raw handlers can attach
 * `Set-Cookie` headers; the payload is decoded through the contract schema
 * at the boundary exactly like the framework would.
 */

const encodeFailure = (operation: string) => (cause: unknown) =>
  BackendError.make({
    error: `${operation} failed`,
    detail: cause instanceof Error ? cause.message : String(cause),
  })

const decodePayload = (schema: typeof LoginRequest | typeof SetupRootRequest) => (body: unknown) =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(body),
    catch: (cause) =>
      BackendError.make({ error: "invalid login payload", detail: String(cause) }),
  })

/** Decode the payload, exchange it for a session, attach the cookie. */
const respondWithSession = <E>(
  session: Effect.Effect<
    { response: LoginResponse; setCookie: string },
    E,
    SessionAuth
  >,
) =>
  Effect.gen(function* () {
    const login = yield* session
    const response = yield* HttpServerResponse.schemaJson(LoginResponse)(
      login.response,
    ).pipe(Effect.mapError(encodeFailure("login response encode")))
    return HttpServerResponse.setHeader("set-cookie", login.setCookie)(response)
  })

export const AuthGroupLive = HttpApiBuilder.group(NfiApi, "Auth", (handlers) =>
  handlers
    .handle("capabilities", () => runCapabilityForHttp("auth.capabilities", {}))
    .handleRaw("login", ({ request }) =>
      Effect.gen(function* () {
        const body = yield* request.json.pipe(Effect.mapError(encodeFailure("login body read")))
        const payload = yield* decodePayload(LoginRequest)(body)
        const auth = yield* SessionAuth
        return yield* respondWithSession(
          auth.login(payload.username, payload.password, requestIsSecure(request)),
        )
      }),
    )
    .handleRaw("setupRoot", ({ request }) =>
      Effect.gen(function* () {
        const body = yield* request.json.pipe(Effect.mapError(encodeFailure("setup body read")))
        const payload = yield* decodePayload(SetupRootRequest)(body)
        const auth = yield* SessionAuth
        return yield* respondWithSession(
          auth.setupRoot(payload.username, payload.password, requestIsSecure(request)),
        )
      }),
    )
    .handleRaw("logout", ({ request }) =>
      Effect.gen(function* () {
        const auth = yield* SessionAuth
        yield* auth.logout(sessionTokenFromRequest(request))
        const response = yield* HttpServerResponse.schemaJson(LogoutResponse)({ ok: true }).pipe(
          Effect.mapError(encodeFailure("logout response encode")),
        )
        return HttpServerResponse.setHeader("set-cookie", clearedSessionCookie())(response)
      }),
    ),
)
