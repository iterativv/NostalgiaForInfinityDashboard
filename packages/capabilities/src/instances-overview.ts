// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect";
import {
  FleetOverviewResponse,
  type FleetInstanceSummary,
} from "@nfi/api-contract";
import { defineCapability, NoOptions } from "./definition.js";
import { asBackendError } from "./errors.js";
import { fleetInstances, optional, perInstance } from "./fleet.js";

/**
 * `instances.overview` — one-stop fleet snapshot across every configured
 * instance (default env + stored rows). Per instance: reachability, version,
 * bot state, strategy, open-trade capacity, profit summary and wallet total.
 *
 * Sub-fetches degrade gracefully: a stopped bot still reports its balance, a
 * misconfigured one becomes an `error` row while the rest of the fleet
 * resolves. Aggregating per-instance endpoints server-side keeps the wire at
 * one capability and lets every widget show "All instances" without opening
 * N subscriptions.
 */
export const InstancesOverviewCapability = defineCapability({
  name: "instances.overview",
  optionsSchema: NoOptions,
  resultSchema: FleetOverviewResponse,
  description:
    "Health, status, profit and balance of every configured instance.",
  streamable: true,
  pollMs: 15_000,
  exposes: ["absolute-balance", "absolute-profit"],
  run: (_options, ctx) =>
    Effect.gen(function* () {
      const instances = yield* fleetInstances(ctx);
      const outcomes = yield* perInstance(instances, (instance) =>
        Effect.gen(function* () {
          const [ping, version, status, profit, balance, count, open] =
            yield* Effect.all([
              optional(instance.service.ping()),
              optional(instance.service.getVersion()),
              optional(instance.service.getStatus()),
              optional(instance.service.getProfit()),
              optional(instance.service.getBalance()),
              optional(instance.service.getTradeCount()),
              optional(instance.service.getOpenTrades()),
            ]);
          const reachable =
            ping !== undefined || version !== undefined || status !== undefined;
          if (
            !reachable &&
            profit === undefined &&
            balance === undefined &&
            count === undefined
          ) {
            return yield* Effect.fail(
              asBackendError(
                "instance overview",
                `${instance.name} is unreachable`,
              ),
            );
          }
          const openProfitCoin = (open?.trades ?? []).reduce(
            (sum, trade) => sum + (trade.profitAbs ?? 0),
            0,
          );
          return {
            reachable,
            version: version?.version,
            state: status?.state,
            strategy: status?.strategy,
            dryRun: status?.dryRun,
            openCount: count?.current,
            maxOpenTrades: count?.max,
            profitClosedCoin: profit?.profitClosedCoin,
            profitAllCoin: profit?.profitAllCoin,
            profitClosedPercent: profit?.profitClosedPercent,
            profitAllPercent: profit?.profitAllPercent,
            closedTradeCount: profit?.closedTradeCount,
            tradeCount: profit?.tradeCount,
            openProfitCoin:
              open !== undefined ? openProfitCoin : undefined,
            wins: profit?.winningTrades,
            losses: profit?.losingTrades,
            totalStake: balance?.totalStake,
            stakeCurrency: balance?.stakeCurrency ?? profit?.stakeCurrency,
          };
        }),
      );
      const rows: FleetInstanceSummary[] = outcomes.map((outcome) => ({
        id: outcome.instance.id,
        name: outcome.instance.name,
        ...(outcome.data !== undefined
          ? outcome.data
          : { reachable: false, error: outcome.error ?? "unreachable" }),
      }));
      const healthy = rows.filter((row) => row.error === undefined);
      const stakeCurrencies = new Set(
        healthy.map((row) => row.stakeCurrency).filter((c): c is string => !!c),
      );
      return {
        instances: rows,
        totals: {
          instanceCount: rows.length,
          reachableCount: rows.filter((row) => row.reachable).length,
          openCount: rows.reduce((sum, row) => sum + (row.openCount ?? 0), 0),
          profitClosedCoin: rows.reduce(
            (sum, row) => sum + (row.profitClosedCoin ?? 0),
            0,
          ),
          profitAllCoin: rows.reduce(
            (sum, row) => sum + (row.profitAllCoin ?? 0),
            0,
          ),
          openProfitCoin: rows.reduce(
            (sum, row) => sum + (row.openProfitCoin ?? 0),
            0,
          ),
          wins: rows.reduce((sum, row) => sum + (row.wins ?? 0), 0),
          losses: rows.reduce((sum, row) => sum + (row.losses ?? 0), 0),
          totalStake: rows.reduce((sum, row) => sum + (row.totalStake ?? 0), 0),
          stakeCurrency:
            stakeCurrencies.size === 1 ? [...stakeCurrencies][0] : undefined,
        },
      };
    }).pipe(
      Effect.mapError((cause) => asBackendError("fleet overview", cause)),
    ),
});
