// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect";
import {
  GetPageDefaultsRequest,
  GetPageDefaultsResponse,
} from "@nfi/api-contract";
import { defineCapability } from "./definition.js";
import {
  readPageDefaultsState,
  resolveDefaultsUserId,
  scopedView,
} from "./page-defaults.js";

/**
 * `system.page-defaults` — read the landing-page defaults for one identity.
 *
 * Options `{ userId? }` resolve to the caller (signed-in user id, else
 * `anonymous`) when omitted. The result carries the global landing page
 * plus that identity's override (null = follow the global). Page/tab ids
 * are opaque UI strings, so this stays non-sensitive (`session-identity`)
 * and ships in the anonymous seed — every visitor's landing page resolves
 * without extra grants.
 */
export const SystemPageDefaultsCapability = defineCapability({
  name: "system.page-defaults",
  optionsSchema: GetPageDefaultsRequest,
  resultSchema: GetPageDefaultsResponse,
  description:
    "Read the landing page + visible pages + default tabs for one user or the anonymous role.",
  streamable: false,
  pollMs: 60_000,
  exposes: ["session-identity"],
  run: (options, ctx) =>
    Effect.map(readPageDefaultsState(ctx), (state) =>
      scopedView(state, resolveDefaultsUserId(ctx, options.userId)),
    ),
});
