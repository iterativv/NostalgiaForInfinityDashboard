// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
import { Effect } from "effect";
import { LocksResponse } from "@nfi/api-contract";
import { defineCapability, IdOptions } from "./definition.js";
import { asBackendError } from "./errors.js";

const LocksOptions = Schema.Struct({
  ...IdOptions.fields,
  /** SQL WHERE: expired locks stay in the mirror but out of the response
   * unless asked for (the widget's show-expired toggle). */
  includeExpired: Schema.optional(Schema.String),
});

/**
 * `instances.locks` — pairs currently locked from trading on one instance,
 * read from the mirror with the expiry filter as a SQL clause.
 */
export const InstancesLocksCapability = defineCapability({
  name: "instances.locks",
  optionsSchema: LocksOptions,
  resultSchema: LocksResponse,
  description: "Active pair locks (pairs temporarily blocked from trading).",
  streamable: true,
  pollMs: 30_000,
  exposes: ["bot-state"],
  run: (options, ctx) =>
    Effect.map(
      ctx.trades.listLocks({
        instanceId: options.id,
        includeExpired: options.includeExpired === "true",
      }),
      ({ locks, countOnRecord }) => ({ locks, countOnRecord }),
    ).pipe(
    Effect.mapError((cause) => asBackendError("instance locks", cause)),
  ),
});
