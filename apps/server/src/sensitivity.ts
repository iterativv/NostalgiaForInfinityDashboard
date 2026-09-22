// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { HttpServerRequest } from "@effect/platform";
import { Effect, Schema } from "effect";
import {
  BackendError,
  DEFAULT_SENSITIVE_INFO_KINDS,
  ForbiddenError,
  InfoKind,
  type SensitivitySettingsResponse,
  type UpdateSensitivityRequest,
} from "@nfi/api-contract";
import { SettingsRepo } from "@nfi/db";
import type { Principal } from "@nfi/capabilities";
import { SessionAuth } from "./auth/session.js";

/**
 * Root-configurable sensitivity criteria (`System.sensitivity` endpoints).
 *
 * Capabilities declare the kinds of information they expose; WHICH kinds
 * count as sensitive is the root user's call (subjective by design). The
 * chosen set lives in `app_settings` (`sensitive-info-kinds`) and every
 * client bootstraps it next to the capability grant — widget marks and
 * capability tags follow it live.
 *
 * Both endpoints are deliberately NOT capabilities: the criteria are
 * meta-info like the auth bootstrap. Reading them is public (every UI
 * needs them, anonymous included); writing them is restricted to the root
 * principal right here — sensitivity posture is the operator's decision
 * and is not delegable via grants.
 */

const SETTING_KEY = "sensitive-info-kinds";

const asBackendError =
  (operation: string) =>
  (cause: unknown): BackendError =>
    BackendError.make({
      error: `${operation} failed`,
      detail: cause instanceof Error ? cause.message : String(cause),
    });

/** Corrupt/absent rows fall back to the built-in defaults. */
const decodeKinds = (raw: string | null): ReadonlyArray<InfoKind> => {
  if (raw === null) return [...DEFAULT_SENSITIVE_INFO_KINDS];
  try {
    return Schema.decodeUnknownSync(Schema.Array(InfoKind))(JSON.parse(raw));
  } catch {
    return [...DEFAULT_SENSITIVE_INFO_KINDS];
  }
};

const readResponse = Effect.gen(function* () {
  const repo = yield* SettingsRepo;
  const raw = yield* repo.getSetting(SETTING_KEY);
  return {
    sensitiveKinds: decodeKinds(raw),
    defaults: [...DEFAULT_SENSITIVE_INFO_KINDS],
  } satisfies SensitivitySettingsResponse;
}).pipe(Effect.mapError(asBackendError("sensitivity settings read")));

const isRoot = (principal: Principal): boolean =>
  principal.kind === "user" && principal.role === "root";

export const getSensitivity = (): Effect.Effect<
  SensitivitySettingsResponse,
  BackendError,
  SettingsRepo
> => readResponse;

export const updateSensitivity = (
  payload: UpdateSensitivityRequest,
): Effect.Effect<
  SensitivitySettingsResponse,
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
          detail: "only the root user may change the sensitivity criteria",
        }),
      );
    }
    // Dedupe while preserving order; an empty set is legitimate (root says
    // nothing is sensitive — labels only, grants still gate access).
    const kinds = [...new Set(payload.sensitiveKinds)];
    const repo = yield* SettingsRepo;
    yield* repo
      .saveSetting(SETTING_KEY, JSON.stringify(kinds))
      .pipe(Effect.mapError(asBackendError("sensitivity settings save")));
    return {
      sensitiveKinds: kinds,
      defaults: [...DEFAULT_SENSITIVE_INFO_KINDS],
    };
  });
