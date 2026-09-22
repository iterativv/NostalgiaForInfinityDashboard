// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import {
  ProfitBucketsResponse,
  type ProfitBucketKind,
} from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError, toBackendError } from "./errors.js";
import { fleetInstances, perInstance } from "./fleet.js";

const ProfitDailyAllOptions = Schema.Struct({
  /** `daily` (default), `weekly` or `monthly` buckets. */
  bucket: Schema.optional(Schema.String),
  /** Timescale: number of buckets. Default 30, capped at 100. */
  days: Schema.optional(Schema.String),
});

const asBucket = (raw: string | undefined): ProfitBucketKind =>
  raw === "weekly" || raw === "monthly" ? raw : "daily";

/**
 * `instances.profit-daily-all` — fleet profit buckets: every instance's
 * daily/weekly/monthly profit merged by bucket date. Absolute profit and
 * fiat sum across instances (homogeneous-currency fleets); the relative
 * figure is an absolute-profit-weighted average of per-instance returns.
 * Instances missing a bucket date simply contribute nothing to it.
 */
export const InstancesProfitDailyAllCapability = defineCapability({
  name: "instances.profit-daily-all",
  optionsSchema: ProfitDailyAllOptions,
  resultSchema: ProfitBucketsResponse,
  description: "Profit per day/week/month bucket, merged across all instances.",
  streamable: true,
  pollMs: 60_000,
  exposes: ["absolute-profit"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const bucket = asBucket(options.bucket);
      const timescale = parseLimitParam(options.days, 30, 100);
      const instances = yield* fleetInstances(ctx);
      const outcomes = yield* perInstance(instances, (instance) =>
        instance.service.getProfitBuckets(bucket, timescale),
      );
      const merged = new Map<
        string,
        {
          abs: number;
          fiat: number;
          trades: number;
          relWeighted: number;
          weight: number;
        }
      >();
      let failures = 0;
      let firstError: string | null = null;
      for (const outcome of outcomes) {
        if (outcome.data === undefined) {
          failures += 1;
          firstError = firstError ?? outcome.error ?? "unreachable";
          continue;
        }
        for (const entry of outcome.data.buckets) {
          if (entry.date.length === 0) continue;
          const acc = merged.get(entry.date) ?? {
            abs: 0,
            fiat: 0,
            trades: 0,
            relWeighted: 0,
            weight: 0,
          };
          acc.abs += entry.profitAbs;
          acc.fiat += entry.profitFiat;
          acc.trades += entry.trades;
          // Weight each instance's relative return by its absolute profit so
          // big books dominate; zero-profit days fall back to equal weight.
          const weight =
            Math.abs(entry.profitAbs) > 0 ? Math.abs(entry.profitAbs) : 1;
          acc.relWeighted += entry.profitRel * weight;
          acc.weight += weight;
          merged.set(entry.date, acc);
        }
      }
      if (merged.size === 0 && failures > 0 && failures === instances.length) {
        return yield* Effect.fail(
          toBackendError(
            "fleet profit-daily",
            firstError ?? "all instances unreachable",
          ),
        );
      }
      const buckets = [...merged.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, acc]) => ({
          date,
          profitAbs: acc.abs,
          profitRel: acc.weight > 0 ? acc.relWeighted / acc.weight : 0,
          profitFiat: acc.fiat,
          trades: acc.trades,
        }));
      return { bucket, buckets };
    }).pipe(
      Effect.mapError((cause) => asBackendError("fleet profit-daily", cause)),
    ),
});

export type ProfitDailyAllOptions = typeof ProfitDailyAllOptions.Type;
