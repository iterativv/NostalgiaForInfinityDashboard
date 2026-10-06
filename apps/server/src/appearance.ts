// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { HttpServerRequest } from "@effect/platform";
import { Either, Effect, Schema } from "effect";
import {
  AppearanceDefaults,
  BackendError,
  ForbiddenError,
  type AppearanceDefaultsResponse,
  type UpdateAppearanceDefaultsRequest,
} from "@nfi/api-contract";
import { SettingsRepo } from "@nfi/db";
import type { Principal } from "@nfi/capabilities";
import { SessionAuth } from "./auth/session.js";

/**
 * Root-owned appearance defaults (`System.appearance` endpoints).
 *
 * The "Appearance & layout" tab otherwise lives in per-browser localStorage,
 * so a fresh visitor renders hardcoded defaults while root sees their own
 * choices. Root snapshots their current appearance here once
 * (`appearance-defaults.v1` in `app_settings`); browsers without stored
 * values seed from it on boot and match root by default, while anyone who
 * changed a setting keeps their own override.
 *
 * Both endpoints are deliberately NOT capabilities (same posture as
 * sensitivity): UI-only values, public to read, root-only to write — the
 * operator's presentation decision, not delegable via grants.
 */

const SETTING_KEY = "appearance-defaults.v1";

const asBackendError =
  (operation: string) =>
  (cause: unknown): BackendError =>
    BackendError.make({
      error: `${operation} failed`,
      detail: cause instanceof Error ? cause.message : String(cause),
    });

/** Absent/corrupt rows fall back to "never saved" (browsers use hardcoded defaults). */
const decodeDefaults = (
  raw: string | null,
): AppearanceDefaultsResponse["defaults"] => {
  if (raw === null) return null;

  try {
    const decoded = Schema.decodeUnknownEither(AppearanceDefaults)(
      JSON.parse(raw),
    );

    return Either.isRight(decoded) ? decoded.right : null;
  } catch {
    return null;
  }
};

const readResponse = Effect.gen(function* () {
  const repo = yield* SettingsRepo;
  const raw = yield* repo.getSetting(SETTING_KEY);

  return { defaults: decodeDefaults(raw) };
}).pipe(Effect.mapError(asBackendError("appearance defaults read")));

const isRoot = (principal: Principal): boolean =>
  principal.kind === "user" && principal.role === "root";

export const getAppearance = (): Effect.Effect<
  AppearanceDefaultsResponse,
  BackendError,
  SettingsRepo
> => readResponse;

export const updateAppearance = (
  payload: UpdateAppearanceDefaultsRequest,
): Effect.Effect<
  AppearanceDefaultsResponse,
  BackendError | ForbiddenError,
  SettingsRepo | SessionAuth | HttpServerRequest.HttpServerRequest
> =>
  Effect.gen(function* () {
    const auth = yield* SessionAuth;

    const requestOption = yield* Effect.serviceOption(
      HttpServerRequest.HttpServerRequest,
    );

    const principal = yield* Effect.matchEffect(requestOption, {
      onSuccess: (request) => auth.principalFromRequest(request),
      onFailure: () =>
        Effect.succeed<Principal>({ kind: "anonymous", granted: [] }),
    });

    if (!isRoot(principal)) {
      return yield* Effect.fail(
        ForbiddenError.make({
          error: "not authorized",
          detail: "only the root user may change the shared appearance defaults",
        }),
      );
    }

    // Canonicalize through the contract schema so only known keys persist.
    const canonical = Schema.decodeUnknownSync(AppearanceDefaults)(
      payload.defaults,
    );

    const repo = yield* SettingsRepo;
    yield* repo
      .saveSetting(SETTING_KEY, JSON.stringify(canonical))
      .pipe(Effect.mapError(asBackendError("appearance defaults save")));

    return { defaults: canonical };
  });
