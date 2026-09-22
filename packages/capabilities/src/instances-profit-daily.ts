// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import {
  ProfitBucketsResponse,
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
 * `instances.profit-daily` — profit per day/week/month bucket for one
 * instance (freqtrade `GET /api/v1/{daily,weekly,monthly}`).
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
      return yield* service.getProfitBuckets(bucket, timescale);
    }).pipe(
      Effect.mapError((cause) =>
        asBackendError("instance profit-daily", cause),
      ),
    ),
});

export type ProfitDailyOptions = typeof ProfitDailyOptions.Type;
