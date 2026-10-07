// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import {
  ProfitBucketsResponse,
  type ProfitBucket,
  type ProfitBucketTotals,
  type ProfitBucketKind,
} from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError } from "./errors.js";

const ProfitDailyOptions = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  /** `daily` (default), `weekly` or `monthly` buckets. */
  bucket: Schema.optional(Schema.String),
  /** Timescale: number of buckets. Default 30, capped at 100. */
  days: Schema.optional(Schema.String),
});

const asBucket = (raw: string | undefined): ProfitBucketKind =>
  raw === "weekly" || raw === "monthly" ? raw : "daily";

/**
 * Window totals over a bucket series, computed server-side so widgets
 * never reduce the buckets client-side.
 */
export const bucketTotals = (
  buckets: ReadonlyArray<ProfitBucket>,
): ProfitBucketTotals => {
  let profitAbs = 0;
  let trades = 0;
  let best = Number.NEGATIVE_INFINITY;
  let worst = Number.POSITIVE_INFINITY;

  for (const bucket of buckets) {
    profitAbs += bucket.profitAbs;
    trades += bucket.trades;

    if (bucket.profitAbs > best) best = bucket.profitAbs;

    if (bucket.profitAbs < worst) worst = bucket.profitAbs;
  }

  return {
    profitAbs,
    trades,
    bestProfitAbs: Number.isFinite(best) ? best : 0,
    worstProfitAbs: Number.isFinite(worst) ? worst : 0,
  };
};

/**
 * `instances.profit-daily` — profit per day/week/month bucket for one
 * instance (freqtrade `GET /api/v1/{daily,weekly,monthly}`), plus
 * server-computed window totals.
 */
export const InstancesProfitDailyCapability = defineCapability({
  name: "instances.profit-daily",
  optionsSchema: ProfitDailyOptions,
  resultSchema: ProfitBucketsResponse,
  description:
    "Absolute/relative profit per day, week or month for one instance.",
  streamable: true,
  pollMs: 60_000,
  exposes: ["absolute-profit"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const bucket = asBucket(options.bucket);
      const timescale = parseLimitParam(options.days, 30, 100);
      const service = yield* ctx.resolveInstance(options.id);
      const { buckets } = yield* service.getProfitBuckets(bucket, timescale);

      return { bucket, buckets, totals: bucketTotals(buckets) };
    }).pipe(
      Effect.mapError((cause) =>
        asBackendError("instance profit-daily", cause),
      ),
    ),
});

export type ProfitDailyOptions = typeof ProfitDailyOptions.Type;
