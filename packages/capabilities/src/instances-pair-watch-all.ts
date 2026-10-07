// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import { PairWatchResponse, type PairWatchRow } from "@nfi/api-contract";
import { defineCapability } from "./definition.js";
import { asBackendError } from "./errors.js";
import { fleetInstances } from "./fleet.js";

const FleetPairWatchOptions = Schema.Struct({
  /** Comma-separated pair list — the SQL `pair IN (...)` filter. */
  pairs: Schema.optional(Schema.String),
  /** SQL-level: only pairs currently held open come back. */
  showOnlyOpen: Schema.optional(Schema.String),
});

/**
 * `instances.pair-watch-all` — fleet tracked pairs: the open rows and the
 * per-pair last close both span every instance (one SQL join), open
 * positions carry their owning instance for attribution.
 */
export const InstancesPairWatchAllCapability = defineCapability({
  name: "instances.pair-watch-all",
  optionsSchema: FleetPairWatchOptions,
  resultSchema: PairWatchResponse,
  description:
    "Tracked pairs across all instances with live and last-closed state.",
  streamable: true,
  pollMs: 15_000,
  exposes: ["trade-details"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const instances = yield* fleetInstances(ctx);

      const nameById = new Map(
        instances.map((instance) => [instance.id, instance.name] as const),
      );

      const rows = yield* ctx.trades.pairWatch({
        instanceId: null,
        pairs: (options.pairs ?? "").split(","),
        showOnlyOpen: options.showOnlyOpen === "true",
      });

      const table: PairWatchRow[] = rows.map((row) => ({
        pair: row.pair,
        open: row.open ?? undefined,
        lastPct: row.lastPct ?? undefined,
        lastProfit: row.lastProfit ?? undefined,
        lastCloseDate: row.lastCloseDate ?? undefined,
        instanceId: row.open?.instanceId,
        instanceName: row.open
          ? (nameById.get(row.open.instanceId) ?? row.open.instanceId)
          : undefined,
      }));

      return { rows: table };
    }).pipe(
    Effect.mapError((cause) => asBackendError("fleet pair watch", cause)),
  ),
});
