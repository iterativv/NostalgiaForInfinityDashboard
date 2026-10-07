// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
import { Effect } from "effect";
import { PairWatchResponse } from "@nfi/api-contract";
import { defineCapability } from "./definition.js";
import { asBackendError } from "./errors.js";

const PairWatchOptions = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  /** Comma-separated pair list — the SQL `pair IN (...)` filter. */
  pairs: Schema.optional(Schema.String),
  /** SQL-level: only pairs currently held open come back. */
  showOnlyOpen: Schema.optional(Schema.String),
});

/**
 * `instances.pair-watch` — tracked pairs joined with their live open
 * position and most recent close, one SQL join over the mirror. The pair
 * list and the open-only filter are database clauses, so a pair's last
 * close is found in the FULL history (a window would mislabel traded pairs
 * as untracked).
 */
export const InstancesPairWatchCapability = defineCapability({
  name: "instances.pair-watch",
  optionsSchema: PairWatchOptions,
  resultSchema: PairWatchResponse,
  description: "Tracked pairs with live open state and last closed result.",
  streamable: true,
  pollMs: 15_000,
  exposes: ["trade-details"],
  run: (options, ctx) =>
    Effect.map(
      ctx.trades.pairWatch({
        instanceId: options.id,
        pairs: (options.pairs ?? "").split(","),
        showOnlyOpen: options.showOnlyOpen === "true",
      }),
      (rows) => ({
        rows: rows.map((row) => ({
          pair: row.pair,
          open: row.open ?? undefined,
          lastPct: row.lastPct ?? undefined,
          lastProfit: row.lastProfit ?? undefined,
          lastCloseDate: row.lastCloseDate ?? undefined,
        })),
      }),
    ).pipe(
    Effect.mapError((cause) => asBackendError("instance pair watch", cause)),
  ),
});
