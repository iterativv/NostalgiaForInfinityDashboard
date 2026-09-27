// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import { RelativeOpenPositionsResponse } from "@nfi/api-contract";
import { defineCapability, IdOptions } from "./definition.js";
import { asBackendError } from "./errors.js";
import { applySearch } from "./search.js";
import { toRelativeOpenPositions } from "./relative.js";

const OpenPositionsRelativeOptions = Schema.Struct({
  ...IdOptions.fields,
  /** Free-text filter applied server-side (non-sensitive fields only). */
  search: Schema.optional(Schema.String),
});

/**
 * `instances.open-positions.relative` — per-instance positions (shareable).
 *
 * Allocation weights are computed against a server-side total that is never
 * exposed; stake amounts, prices and absolute profits are stripped. The
 * optional `search` filters the same non-sensitive fields the absolute
 * capability filters (pair, strategy, enter/exit tags) — before the
 * relative transform, so no amount-bearing row influences the weights.
 */
export const InstancesOpenPositionsRelativeCapability = defineCapability({
  name: "instances.open-positions.relative",
  optionsSchema: OpenPositionsRelativeOptions,
  resultSchema: RelativeOpenPositionsResponse,
  description:
    "Per-instance open positions, percentages/weights only (shareable).",
  streamable: true,
  pollMs: 10_000,
  exposes: ["relative-values"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const service = yield* ctx.resolveInstance(options.id);
      const positions = yield* service.getOpenPositions();
      const balance = yield* service.getBalance();

      const filtered = {
        positions: applySearch(
          positions.positions,
          (p) => [p.pair, p.strategy, p.enterTag, p.exitReason],
          options.search,
        ),
      };

      return toRelativeOpenPositions(filtered, balance.totalStake);
    }).pipe(
      Effect.mapError((cause) =>
        asBackendError("instance open-positions.relative", cause),
      ),
    ),
});
