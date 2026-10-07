// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import { TapeResponse } from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError } from "./errors.js";
import { fleetInstances } from "./fleet.js";

const FleetTapeOptions = Schema.Struct({
  /** Max events (SQL LIMIT over the merged newest-opens/closes feed). */
  limit: Schema.optional(Schema.String),
  opens: Schema.optional(Schema.String),
  closes: Schema.optional(Schema.String),
});

/**
 * `instances.trade-tape-all` — the fleet trade tape: one SQL pass per
 * instance (kind filter, ordering, LIMIT), merged newest-first and tagged
 * with the owning instance for the color dots.
 */
export const InstancesTradeTapeAllCapability = defineCapability({
  name: "instances.trade-tape-all",
  optionsSchema: FleetTapeOptions,
  resultSchema: TapeResponse,
  description: "Fleet feed of position opens and closes, tagged per instance.",
  streamable: true,
  pollMs: 15_000,
  exposes: ["trade-details"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const instances = yield* fleetInstances(ctx);

      const nameById = new Map(
        instances.map((instance) => [instance.id, instance.name] as const),
      );

      const events = yield* ctx.trades.tape({
        instanceId: null,
        limit: parseLimitParam(options.limit, 30, 100),
        opens: options.opens !== "false",
        closes: options.closes !== "false",
      });

      return {
        events: events.map((event) => ({
          ...event,
          instanceName: nameById.get(event.instanceId ?? "") ?? undefined,
        })),
      };
    }).pipe(
    Effect.mapError((cause) => asBackendError("fleet trade tape", cause)),
  ),
});
