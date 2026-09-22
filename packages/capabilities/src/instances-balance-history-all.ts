// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import { FleetBalanceHistoryResponse } from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError, toBackendError } from "./errors.js";
import { fleetInstances, optional, perInstance } from "./fleet.js";

const BalanceHistoryAllOptions = Schema.Struct({
  /** Snapshot window per instance. Default 500, capped at 500. */
  limit: Schema.optional(Schema.String),
});

/**
 * `instances.balance-history` — wallet history for EVERY configured instance
 * from the server's own balance snapshots (ABSOLUTE stake amounts), plus each
 * bot's starting capital (freqtrade `/balance`) for dashed reference lines.
 *
 * Per-instance failures degrade to `error` rows; the snapshot store keeps
 * recording even while freqtrade is unreachable. Never grant publicly: use
 * `instances.balance-history.relative` for shareable pages.
 */
export const InstancesBalanceHistoryAllCapability = defineCapability({
  name: "instances.balance-history",
  optionsSchema: BalanceHistoryAllOptions,
  resultSchema: FleetBalanceHistoryResponse,
  description:
    "Per-instance wallet history with starting capital, across all instances.",
  streamable: true,
  pollMs: 60_000,
  exposes: ["absolute-balance"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const limit = parseLimitParam(options.limit, 500, 500);
      const instances = yield* fleetInstances(ctx);
      const outcomes = yield* perInstance(instances, (instance) =>
        Effect.gen(function* () {
          // Snapshots come from sqlite (default-scoped rows for `default`);
          // the live balance only tops up starting capital / currency.
          const [history, balance] = yield* Effect.all([
            ctx.snapshots.balanceHistory(instance.id, limit),
            optional(instance.service.getBalance()),
          ]);
          return {
            instanceId: instance.id,
            instanceName: instance.name,
            points: history.points,
            startingCapital: balance?.startingCapital,
            stakeCurrency:
              balance?.stakeCurrency ?? history.points.at(-1)?.stakeCurrency,
          };
        }),
      );
      const rows = outcomes.map((outcome) =>
        outcome.data !== undefined
          ? outcome.data
          : {
              instanceId: outcome.instance.id,
              instanceName: outcome.instance.name,
              points: [],
              error: outcome.error ?? "unreachable",
            },
      );
      if (
        rows.every((row) => row.points.length === 0) &&
        outcomes.every((outcome) => outcome.error !== undefined)
      ) {
        return yield* Effect.fail(
          toBackendError(
            "fleet balance history",
            outcomes[0]?.error ?? "all instances unavailable",
          ),
        );
      }
      const currencies = new Set(
        outcomes.flatMap((outcome) =>
          outcome.data?.stakeCurrency ? [outcome.data.stakeCurrency] : [],
        ),
      );
      return {
        instances: rows,
        stakeCurrency: currencies.size === 1 ? [...currencies][0] : undefined,
      };
    }).pipe(
      Effect.mapError((cause) => asBackendError("fleet balance history", cause)),
    ),
});

export type BalanceHistoryAllOptions = typeof BalanceHistoryAllOptions.Type;
