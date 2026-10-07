// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import { RelativeOpenPositionsResponse } from "@nfi/api-contract";
import { defineCapability, IdOptions } from "./definition.js";
import { asBackendError } from "./errors.js";
import { normalizeSearch } from "./search.js";
import { toRelativeOpenPositions } from "./relative.js";

const OpenPositionsRelativeOptions = Schema.Struct({
  ...IdOptions.fields,
  /** Free-text filter — SQL WHERE restricted to non-sensitive fields. */
  search: Schema.optional(Schema.String),
});

/**
 * `instances.open-positions.relative` — per-instance positions (shareable).
 *
 * Allocation weights are computed against a server-side total that is never
 * exposed; stake amounts, prices and absolute profits are stripped. The
 * optional `search` is a SQL WHERE over the mirror restricted to
 * non-sensitive fields (pair, strategy, enter/exit tags) — before the
 * relative transform, so no amount-bearing row influences the weights.
 *
 * `stats` carries the footer metrics (deployed share, mean percent, largest
 * share) computed server-side: the sums come from the SQL open summary, the
 * denominator stays the never-exposed wallet total.
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
      const balance = yield* service.getBalance();

      const filtered = yield* ctx.trades.listOpen({
        instanceId: options.id,
        search: normalizeSearch(options.search),
        searchNonSensitiveOnly: true,
        sort: null,
        dir: "desc",
        filter: null,
        limit: 10_000,
      });

      const { summary } = yield* ctx.trades.openSummary({
        instanceId: options.id,
      });

      const total = balance.totalStake;

      return {
        ...toRelativeOpenPositions({ positions: filtered.positions }, total),
        stats: {
          deployedWeight: total > 0 ? summary.deployed / total : 0,
          avgProfitPct: summary.avgProfitPct,
          largestWeight: total > 0 ? summary.largestStake / total : 0,
        },
      };
    }).pipe(
      Effect.mapError((cause) =>
        asBackendError("instance open-positions.relative", cause),
      ),
    ),
});
