// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import { DrawdownResponse } from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError } from "./errors.js";

const DrawdownOptions = Schema.Struct({
  /** Absent = fleet: per-minute snapshot sums across every instance. */
  id: Schema.optional(Schema.String),
  /** Newest N curve points (the scalars always cover the full history). */
  limit: Schema.optional(Schema.String),
});

/**
 * `instances.drawdown` — underwater curve + max/current drawdown + the
 * all-time peak, computed in SQL over the FULL profit-snapshot history
 * (running peak = window MAX). The old widget scanned a fetched window
 * client-side, so its "max drawdown" only measured the visible slice;
 * here a small `limit` trims the chart, never the metrics.
 *
 * Never grant publicly: the peak is an absolute profit figure.
 */
export const InstancesDrawdownCapability = defineCapability({
  name: "instances.drawdown",
  optionsSchema: DrawdownOptions,
  resultSchema: DrawdownResponse,
  description:
    "Underwater curve and max drawdown over the full recorded profit history.",
  streamable: true,
  pollMs: 60_000,
  exposes: ["absolute-profit"],
  run: (options, ctx) =>
    ctx.snapshots
      .drawdown({
        instanceId: options.id ?? null,
        limit: parseLimitParam(options.limit, 500, 5_000),
      })
      .pipe(
        Effect.mapError((cause) => asBackendError("instance drawdown", cause)),
      ),
});
