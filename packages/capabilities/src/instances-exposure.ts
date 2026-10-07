// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import { ExposureResponse } from "@nfi/api-contract";
import { defineCapability } from "./definition.js";
import { asBackendError } from "./errors.js";

const ExposureOptions = Schema.Struct({
  /** Absent = fleet: every instance's open positions. */
  id: Schema.optional(Schema.String),
});

/**
 * `instances.exposure` — the open-book metrics the risk monitor and the
 * exposure widget used to fold client-side over fetched position lists:
 * deployed stake, unrealized PnL, max leverage, long/short split, largest
 * position, and the per-pair allocation with SQL-computed shares. The
 * mirror scan covers every open position; the frontend renders the
 * aggregate row and the pair rows verbatim.
 *
 * The exposure RATIO (deployed / wallet capital) stays a display-time
 * division in the widget between this SQL total and the live balance read
 * — both operands are server-computed.
 *
 * Never grant publicly: stake amounts and absolute PnL.
 */
export const InstancesExposureCapability = defineCapability({
  name: "instances.exposure",
  optionsSchema: ExposureOptions,
  resultSchema: ExposureResponse,
  description:
    "Open-book exposure: deployed stake, leverage, long/short split, per-pair allocation.",
  streamable: true,
  pollMs: 10_000,
  exposes: ["trade-details", "stake-amount", "absolute-profit"],
  run: (options, ctx) =>
    ctx.trades
      .openSummary({ instanceId: options.id ?? null })
      .pipe(
        Effect.mapError((cause) => asBackendError("instance exposure", cause)),
      ),
});
