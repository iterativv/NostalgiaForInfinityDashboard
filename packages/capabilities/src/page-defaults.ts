// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Either, Effect, Schema } from "effect";
import {
  ANONYMOUS_USER_ID,
  PageDefaultsConfig,
  type GetPageDefaultsResponse,
} from "@nfi/api-contract";
import { asBackendError } from "./errors.js";
import type { CapabilityContext } from "./definition.js";

/**
 * Page-defaults storage (`app_settings` key `page-defaults.v1`).
 *
 * Shape: `{ globalDefaultPageId: string | null, perUser: Record<userId,
 * PageDefaultsConfig> }`. Page/tab ids are opaque UI strings (never
 * balances, stakes or locations), so the read capability stays
 * non-sensitive. Corrupt rows fall back to empty rather than failing the
 * landing page.
 */

export const PAGE_DEFAULTS_SETTING_KEY = "page-defaults.v1";

const StoredState = Schema.Struct({
  globalDefaultPageId: Schema.NullOr(Schema.String),
  perUser: Schema.Record({
    key: Schema.String,
    value: PageDefaultsConfig,
  }),
});

type StoredState = typeof StoredState.Type;

const emptyState = (): StoredState => ({
  globalDefaultPageId: null,
  perUser: {},
});



export const readPageDefaultsState = (
  ctx: Pick<CapabilityContext, "settings">,
): Effect.Effect<StoredState, ReturnType<typeof asBackendError>> =>
  Effect.gen(function* () {
    const raw = yield* ctx.settings
      .getSetting(PAGE_DEFAULTS_SETTING_KEY)
      .pipe(Effect.mapError((cause) => asBackendError("page-defaults read", cause)));

    if (raw === null) return emptyState();

    try {
      const parsed: unknown = JSON.parse(raw);
      const decoded = Schema.decodeUnknownEither(StoredState)(parsed);

      if (Either.isRight(decoded)) return decoded.right;
    } catch {
      // Corrupt row — fall through to empty.
    }

    return emptyState();
  });

export const writePageDefaultsState = (
  ctx: Pick<CapabilityContext, "settings">,
  state: StoredState,
): Effect.Effect<void, ReturnType<typeof asBackendError>> =>
  ctx.settings
    .saveSetting(PAGE_DEFAULTS_SETTING_KEY, JSON.stringify(state))
    .pipe(Effect.mapError((cause) => asBackendError("page-defaults save", cause)));

/** Caller identity for defaults resolution (user id, root, or anonymous). */
export const resolveDefaultsUserId = (
  ctx: Pick<CapabilityContext, "principal">,
  requested: string | undefined,
): string => {
  const trimmed = requested?.trim();

  if (trimmed !== undefined && trimmed.length > 0) return trimmed;

  const principal = ctx.principal;

  if (principal.kind === "user") return principal.userId;

  return ANONYMOUS_USER_ID;
};

export const scopedView = (
  state: StoredState,
  userId: string,
): GetPageDefaultsResponse => ({
  userId,
  globalDefaultPageId: state.globalDefaultPageId,
  defaults: state.perUser[userId] ?? null,
});
