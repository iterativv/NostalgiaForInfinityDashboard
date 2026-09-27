// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Either, Effect, Schema } from "effect";
import {
  ForbiddenError,
  PageDefaultsConfig,
  UpdatePageDefaultsRequest,
  UpdatePageDefaultsResponse,
} from "@nfi/api-contract";
import { defineCapability } from "./definition.js";
import {
  readPageDefaultsState,
  resolveDefaultsUserId,
  scopedView,
  writePageDefaultsState,
} from "./page-defaults.js";

/**
 * `system.page-defaults.update` — set the global landing page and per-user
 * (or `anonymous`-role) page defaults.
 *
 * - `globalDefaultPageId` patches the deployment-wide landing page
 *   (undefined = no change, null = back to Home).
 * - `userId` + `defaults` replace one identity's override (null clears it
 *   back to global-following); `userId` alone with no `defaults` key leaves
 *   the per-user entry untouched so callers can patch the global only.
 *
 * Page/tab ids are validated as non-empty strings; unknown ids are kept
 * (pages may be created after the defaults). Holding this capability is the
 * only gate — defaults steer landing/visibility, never grants, so no
 * escalation subset applies. Anonymous callers are refused outright.
 */
export const SystemPageDefaultsUpdateCapability = defineCapability({
  name: "system.page-defaults.update",
  optionsSchema: UpdatePageDefaultsRequest,
  resultSchema: UpdatePageDefaultsResponse,
  description:
    "Set the default landing page and per-user (or anonymous) default pages + tabs.",
  streamable: false,
  pollMs: 60_000,
  exposes: ["user-accounts"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      if (ctx.principal.kind === "anonymous") {
        return yield* Effect.fail(
          ForbiddenError.make({ error: "sign in required to set page defaults" }),
        );
      }

      const cleanId = (value: string | null): string | null => {
        if (value === null) return null;
        const trimmed = value.trim();

        return trimmed.length > 0 ? trimmed : null;
      };

      if (
        options.globalDefaultPageId !== undefined &&
        options.globalDefaultPageId !== null &&
        options.globalDefaultPageId.trim().length === 0
      ) {
        return yield* Effect.fail(
          ForbiddenError.make({
            error: "global default page must be a page id or null",
          }),
        );
      }

      const state = yield* readPageDefaultsState(ctx);
      let next = state;

      if (options.globalDefaultPageId !== undefined) {
        next = {
          ...next,
          globalDefaultPageId: cleanId(options.globalDefaultPageId),
        };
      }

      let viewUserId = resolveDefaultsUserId(ctx, undefined);

      if (options.userId !== undefined) {
        const userId = options.userId.trim();

        if (userId.length === 0) {
          return yield* Effect.fail(
            ForbiddenError.make({ error: "user id must not be empty" }),
          );
        }

        viewUserId = userId;

        if (options.defaults !== undefined) {
          if (options.defaults === null) {
            const perUser = { ...next.perUser };
            delete perUser[userId];
            next = { ...next, perUser };
          } else {
            const decoded = Schema.decodeUnknownEither(PageDefaultsConfig)(
              options.defaults,
            );

            if (Either.isLeft(decoded)) {
              return yield* Effect.fail(
                ForbiddenError.make({
                  error: "invalid page defaults",
                  detail: String(decoded.left),
                }),
              );
            }

            const config = decoded.right;
            const visible = config.visiblePageIds?.map((id) => id.trim()).filter((id) => id.length > 0) ?? null;

            next = {
              ...next,
              perUser: {
                ...next.perUser,
                [userId]: {
                  defaultPageId: cleanId(config.defaultPageId),
                  visiblePageIds: visible,
                  defaultPanels: Object.fromEntries(
                    Object.entries(config.defaultPanels)
                      .map(([page, tab]): readonly [string, string] => [
                        page.trim(),
                        tab.trim(),
                      ])
                      .filter(
                        ([page, tab]): boolean =>
                          page !== undefined &&
                          tab !== undefined &&
                          page.length > 0 &&
                          tab.length > 0,
                      ),
                  ),
                },
              },
            };
          }
        }
      }

      yield* writePageDefaultsState(ctx, next);

      return scopedView(next, viewUserId);
    }),
});
