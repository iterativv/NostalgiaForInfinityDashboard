// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import { ProfitHistoryResponse, type ProfitPoint } from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError, toBackendError } from "./errors.js";
import { fleetInstances, perInstance } from "./fleet.js";

const ProfitHistoryAllOptions = Schema.Struct({
  /** Snapshot window per instance. Default 500, capped at 500. */
  limit: Schema.optional(Schema.String),
});

/**
 * `instances.profit-history-all` — the FLEET's combined profit history
 * (ABSOLUTE coin amounts): per-instance snapshot series summed per minute
 * bucket into one total-profit curve.
 *
 * The live poller records one profit snapshot per instance inside the same
 * tick, so bucketing on the minute keeps the bots' rows aligned (a snapshot
 * straddling a minute boundary simply lands in the adjacent bucket — one
 * extra curve point, never a gap). Instances with no recorded history
 * contribute nothing; only a fleet where every instance failed errors.
 * Never grant publicly: use `instances.profit-history-all.relative` for
 * shareable pages.
 */
export const InstancesProfitHistoryAllCapability = defineCapability({
  name: "instances.profit-history-all",
  optionsSchema: ProfitHistoryAllOptions,
  resultSchema: ProfitHistoryResponse,
  description: "Fleet-total profit history summed across instances.",
  streamable: true,
  pollMs: 60_000,
  exposes: ["absolute-profit"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const limit = parseLimitParam(options.limit, 500, 500);
      const instances = yield* fleetInstances(ctx);

      const outcomes = yield* perInstance(instances, (instance) =>
        ctx.snapshots.profitHistory(instance.id, limit),
      );

      const buckets = new Map<
        string,
        { profitClosedCoin: number; profitAllCoin: number; tradeCount: number }
      >();

      const currencies = new Set<string>();
      let failures = 0;
      let firstError: string | null = null;

      for (const outcome of outcomes) {
        if (outcome.data === undefined) {
          failures += 1;
          firstError = firstError ?? outcome.error ?? "unreachable";
          continue;
        }

        for (const point of outcome.data.points) {
          if (point.stakeCurrency !== undefined)
            currencies.add(point.stakeCurrency);

          // ISO-8601 sorts chronologically as strings, so the minute
          // prefix is both the merge key and the sort key.
          const minute = point.recordedAt.slice(0, 16);

          const bucket = buckets.get(minute) ?? {
            profitClosedCoin: 0,
            profitAllCoin: 0,
            tradeCount: 0,
          };

          bucket.profitClosedCoin += point.profitClosedCoin;
          bucket.profitAllCoin += point.profitAllCoin;
          bucket.tradeCount += point.tradeCount;
          buckets.set(minute, bucket);
        }
      }

      if (buckets.size === 0 && failures > 0 && failures === instances.length) {
        return yield* Effect.fail(
          toBackendError(
            "fleet profit history",
            firstError ?? "all instances unavailable",
          ),
        );
      }

      // Mixed-currency fleets cannot label one coin; the curve stays valid,
      // the label drops (both consuming widgets never read the currency).
      const stakeCurrency =
        currencies.size === 1 ? ([...currencies][0] ?? "") : "";

      const points: ProfitPoint[] = [...buckets.keys()]
        .sort()
        .map((minute) => ({
          recordedAt: `${minute}:00.000Z`,
          profitClosedCoin: buckets.get(minute)!.profitClosedCoin,
          profitAllCoin: buckets.get(minute)!.profitAllCoin,
          tradeCount: buckets.get(minute)!.tradeCount,
          stakeCurrency,
        }));

      return { points };
    }).pipe(
      Effect.mapError((cause) => asBackendError("fleet profit history", cause)),
    ),
});
