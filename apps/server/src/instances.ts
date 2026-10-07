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
      .handle("openPositions", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.open-positions", {
          id: path.id,
          search: urlParams.search,
          sort: urlParams.sort,
          dir: urlParams.dir,
          limit: urlParams.limit,
          filter: urlParams.filter,
        }),
      )
      .handle("closedPositions", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.closed-positions", {
          id: path.id,
          limit: urlParams.limit,
          offset: urlParams.offset,
          search: urlParams.search,
        }),
      )
      .handle("tagPerformance", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.tag-performance", {
          id: path.id,
          limit: urlParams.limit,
          groupBy: urlParams.groupBy,
          minTrades: urlParams.minTrades,
          sortBy: urlParams.sortBy,
          sortDir: urlParams.sortDir,
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
          before: urlParams.before,
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
      .handle("openPositionsRelative", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.open-positions.relative", {
          id: path.id,
          search: urlParams.search,
        }),
      )
      .handle("closedPositionsRelative", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.closed-positions.relative", {
          id: path.id,
          limit: urlParams.limit,
          offset: urlParams.offset,
          search: urlParams.search,
        }),
      )
      .handle("tagPerformanceRelative", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.tag-performance.relative", {
          id: path.id,
          limit: urlParams.limit,
          groupBy: urlParams.groupBy,
          minTrades: urlParams.minTrades,
          sortBy: urlParams.sortBy,
          sortDir: urlParams.sortDir,
        }),
      )
      .handle("config", ({ path }) =>
        runCapabilityForHttp("instances.config", { id: path.id }),
      )
      .handle("locks", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.locks", {
          id: path.id,
          includeExpired: urlParams.includeExpired,
        }),
      )
      .handle("blacklist", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.blacklist", {
          id: path.id,
          search: urlParams.search,
        }),
      )
      .handle("whitelist", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.whitelist", {
          id: path.id,
          search: urlParams.search,
        }),
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
      .handle("positionsAll", ({ urlParams }) =>
        runCapabilityForHttp("instances.positions-all", {
          search: urlParams.search,
          sort: urlParams.sort,
          dir: urlParams.dir,
          limit: urlParams.limit,
          filter: urlParams.filter,
        }),
      )
      .handle("closedAll", ({ urlParams }) =>
        runCapabilityForHttp("instances.closed-all", {
          limit: urlParams.limit,
          search: urlParams.search,
        }),
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
          bucket: urlParams.bucket,
          id: urlParams.id,
        }),
      )
      .handle("balanceHistoryAllRelative", ({ urlParams }) =>
        runCapabilityForHttp("instances.balance-history.relative", {
          limit: urlParams.limit,
        }),
      )
      .handle("profitHistoryAllRelative", ({ urlParams }) =>
        runCapabilityForHttp("instances.profit-history-all.relative", {
          limit: urlParams.limit,
        }),
      )
      .handle("profitHistoryAll", ({ urlParams }) =>
        runCapabilityForHttp("instances.profit-history-all", {
          limit: urlParams.limit,
        }),
      )
      .handle("tagPerformanceAll", ({ urlParams }) =>
        runCapabilityForHttp("instances.tag-performance-all", {
          limit: urlParams.limit,
          groupBy: urlParams.groupBy,
          minTrades: urlParams.minTrades,
          sortBy: urlParams.sortBy,
          sortDir: urlParams.sortDir,
        }),
      )
      .handle("locksAll", ({ urlParams }) =>
        runCapabilityForHttp("instances.locks-all", {
          includeExpired: urlParams.includeExpired,
        }),
      )
      .handle("tradeTape", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.trade-tape", {
          id: path.id,
          limit: urlParams.limit,
          opens: urlParams.opens,
          closes: urlParams.closes,
        }),
      )
      .handle("tradeTapeAll", ({ urlParams }) =>
        runCapabilityForHttp("instances.trade-tape-all", {
          limit: urlParams.limit,
          opens: urlParams.opens,
          closes: urlParams.closes,
        }),
      )
      .handle("pairWatch", ({ path, urlParams }) =>
        runCapabilityForHttp("instances.pair-watch", {
          id: path.id,
          pairs: urlParams.pairs,
          showOnlyOpen: urlParams.showOnlyOpen,
        }),
      )
      .handle("pairWatchAll", ({ urlParams }) =>
        runCapabilityForHttp("instances.pair-watch-all", {
          pairs: urlParams.pairs,
          showOnlyOpen: urlParams.showOnlyOpen,
        }),
      )
      .handle("performanceStats", ({ urlParams }) =>
        runCapabilityForHttp("instances.performance-stats", {
          id: urlParams.id,
        }),
      )
      .handle("drawdown", ({ urlParams }) =>
        runCapabilityForHttp("instances.drawdown", {
          id: urlParams.id,
          limit: urlParams.limit,
        }),
      )
      .handle("cumulativeProfit", ({ urlParams }) =>
        runCapabilityForHttp("instances.cumulative-profit", {
          id: urlParams.id,
          limit: urlParams.limit,
        }),
      )
      .handle("exposure", ({ urlParams }) =>
        runCapabilityForHttp("instances.exposure", { id: urlParams.id }),
      )
      .handle("tradedPairs", ({ urlParams }) =>
        runCapabilityForHttp("instances.traded-pairs", { id: urlParams.id }),
      )
      .handle("blacklistAll", ({ urlParams }) =>
        runCapabilityForHttp("instances.blacklist-all", {
          search: urlParams.search,
        }),
      )
      .handle("whitelistAll", ({ urlParams }) =>
        runCapabilityForHttp("instances.whitelist-all", {
          search: urlParams.search,
        }),
      ),
);
