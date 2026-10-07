// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import {
  CumulativeProfitResponse,
  type CumulativeProfitSeries,
} from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError } from "./errors.js";
import { fleetInstances } from "./fleet.js";

const CumulativeProfitOptions = Schema.Struct({
  /** Absent = fleet: one cumulative series per instance. */
  id: Schema.optional(Schema.String),
  /** Newest N points kept per series (running sums stay full-history). */
  limit: Schema.optional(Schema.String),
});

/**
 * `instances.cumulative-profit` — running closed-profit totals computed as
 * SQL window sums over the FULL mirror history (ordered by close time);
 * only the newest `limit` points per series leave the database. The old
 * widget accumulated a fetched window client-side, so both the curve and
 * its headline started wherever the window began.
 *
 * Never grant publicly: absolute profit amounts.
 */
/** Locally-mutable `CumulativeProfitSeries` (fleet tags added when present). */
type MutableSeriesEntry = {
  points: CumulativeProfitSeries["points"];
  totalProfit: number;
  trades: number;
  instanceId?: string;
  instanceName?: string;
};

export const InstancesCumulativeProfitCapability = defineCapability({
  name: "instances.cumulative-profit",
  optionsSchema: CumulativeProfitOptions,
  resultSchema: CumulativeProfitResponse,
  description:
    "Cumulative closed profit over the full history, per instance or fleet.",
  streamable: true,
  pollMs: 30_000,
  exposes: ["absolute-profit"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const limit = parseLimitParam(options.limit, 200, 5_000);
      const instanceId = options.id ?? null;

      const { rows, totals } = yield* ctx.trades.cumulativeProfit({
        instanceId,
        limit,
      });

      // Fleet rows carry their owning instance; name them for the legend
      // (mirror rows only hold ids — names live in the instances repo).
      const instances = instanceId === null ? yield* fleetInstances(ctx) : [];

      const nameById = new Map(
        instances.map((instance) => [instance.id, instance.name] as const),
      );

      const totalsById = new Map(totals.map((t) => [t.instanceId, t]));

      const byInstance = new Map<string, typeof rows>();

      for (const row of rows) {
        const list = byInstance.get(row.instanceId);

        if (list === undefined) {
          byInstance.set(row.instanceId, [row]);
        } else {
          list.push(row);
        }
      }

      const series: CumulativeProfitSeries[] = [...byInstance.entries()].map(
        ([id, points]) => {
          const total = totalsById.get(id);
          const named = nameById.get(id);

          // Fleet rows are tagged with their owner (id always, name when
          // the instance still exists); single-instance reads stay untagged.
          // Mutable series entry (the response type is readonly); the
          // fleet tags are added only when present, below.
          const entry: MutableSeriesEntry = {
            points: points.map((p) => ({
              at: p.at,
              profit: p.profit,
              cumulative: p.cumulative,
            })),
            totalProfit: total?.totalProfit ?? 0,
            trades: total?.trades ?? 0,
          };

          if (instanceId === null) entry.instanceId = id;

          if (named !== undefined) entry.instanceName = named;

          return entry;
        },
      );

      return { series };
    }).pipe(
      Effect.mapError((cause) =>
        asBackendError("instance cumulative profit", cause),
      ),
    ),
});
