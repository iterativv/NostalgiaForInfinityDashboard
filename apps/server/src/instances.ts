// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { HttpApiBuilder } from "@effect/platform";
import { NfiApi } from "@nfi/api-contract";
import { runCapabilityForHttp } from "./capabilities/context.js";

/**
 * Freqtrade instance management (multi-bot support) + per-instance reads.
 *
 * Every handler delegates to its capability (`@nfi/capabilities`, one file
 * per capability). Passwords never leave this process: list/create/update
 * responses carry `hasPassword`, never the secret.
 */

export const InstancesGroupLive = HttpApiBuilder.group(
  NfiApi,
  "Instances",
  (handlers) =>
    handlers
      .handle("list", () => runCapabilityForHttp("instances.list", {}))
      .handle("create", ({ payload }) =>
        runCapabilityForHttp("instances.create", { ...payload }),
      )
      .handle("update", ({ path, payload }) =>
        runCapabilityForHttp("instances.update", { id: path.id, ...payload }),
      )
      .handle("remove", ({ path }) =>
        runCapabilityForHttp("instances.remove", { id: path.id }),
      )
      .handle("health", ({ path }) =>
        runCapabilityForHttp("instances.health", { id: path.id }),
      )
      .handle("status", ({ path }) =>
        runCapabilityForHttp("instances.status", { id: path.id }),
      )
      .handle("balance", ({ path }) =>
        runCapabilityForHttp("instances.balance", { id: path.id }),
      )
      .handle("profit", ({ path }) =>
        runCapabilityForHttp("instances.profit", { id: path.id }),
      )
      .handle("openPositions", ({ path }) =>
        runCapabilityForHttp("instances.open-positions", { id: path.id }),
      )
      .handle("closedPositions", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.closed-positions", {
          id: path.id,
          limit: urlParams.limit,
          offset: urlParams.offset,
        }),
      )
      .handle("tagPerformance", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.tag-performance", {
          id: path.id,
          limit: urlParams.limit,
          groupBy: urlParams.groupBy,
        }),
      )
      .handle("pairs", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.pairs", {
          id: path.id,
          timeframe: urlParams.timeframe,
          stakeCurrency: urlParams.stakeCurrency,
        }),
      )
      .handle("candles", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.candles", {
          id: path.id,
          pair: urlParams.pair,
          timeframe: urlParams.timeframe,
          limit: urlParams.limit,
        }),
      )
      .handle("plotConfig", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.plot-config", {
          id: path.id,
          strategy: urlParams.strategy,
        }),
      )
      .handle("balanceRelative", ({ path }) =>
        runCapabilityForHttp("instances.balance.relative", { id: path.id }),
      )
      .handle("profitRelative", ({ path }) =>
        runCapabilityForHttp("instances.profit.relative", { id: path.id }),
      )
      .handle("openPositionsRelative", ({ path }) =>
        runCapabilityForHttp("instances.open-positions.relative", {
          id: path.id,
        }),
      )
      .handle("closedPositionsRelative", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.closed-positions.relative", {
          id: path.id,
          limit: urlParams.limit,
          offset: urlParams.offset,
        }),
      )
      .handle("tagPerformanceRelative", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.tag-performance.relative", {
          id: path.id,
          limit: urlParams.limit,
          groupBy: urlParams.groupBy,
        }),
      )
      .handle("config", ({ path }) =>
        runCapabilityForHttp("instances.config", { id: path.id }),
      )
      .handle("locks", ({ path }) =>
        runCapabilityForHttp("instances.locks", { id: path.id }),
      )
      .handle("blacklist", ({ path }) =>
        runCapabilityForHttp("instances.blacklist", { id: path.id }),
      )
      .handle("whitelist", ({ path }) =>
        runCapabilityForHttp("instances.whitelist", { id: path.id }),
      )
      .handle("tradeCount", ({ path }) =>
        runCapabilityForHttp("instances.trade-count", { id: path.id }),
      )
      .handle("profitDaily", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.profit-daily", {
          id: path.id,
          bucket: urlParams.bucket,
          days: urlParams.days,
        }),
      )
      .handle("profitHistory", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.profit-history", {
          id: path.id,
          limit: urlParams.limit,
        }),
      )
      .handle("overview", () => runCapabilityForHttp("instances.overview", {}))
      .handle("positionsAll", () =>
        runCapabilityForHttp("instances.positions-all", {}),
      )
      .handle("closedAll", ({ urlParams }) =>
        runCapabilityForHttp("instances.closed-all", { limit: urlParams.limit }),
      )
      .handle("profitDailyAll", ({ urlParams }) =>
        runCapabilityForHttp("instances.profit-daily-all", {
          bucket: urlParams.bucket,
          days: urlParams.days,
        }),
      )
      .handle("balanceHistoryAll", ({ urlParams }) =>
        runCapabilityForHttp("instances.balance-history", {
          limit: urlParams.limit,
        }),
      )
      .handle("balanceHistoryAllRelative", ({ urlParams }) =>
        runCapabilityForHttp("instances.balance-history.relative", {
          limit: urlParams.limit,
        }),
      ),
);
