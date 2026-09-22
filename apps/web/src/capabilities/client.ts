// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect";
import type { NfiApiClient } from "@nfi/api-contract";
import type {
  CapabilityName,
  CapabilityOptions,
  CapabilityResult,
} from "@nfi/capabilities";
import { runApi } from "../api";

/**
 * Type-safe unary capability calls (request/response).
 *
 * `callCapability(name, options)` infers options/result per hard-coded id —
 * a typo'd id or mismatched options is a compile error. Each entry below
 * maps one capability to its contract REST endpoint (derived from the shared
 * `NfiApi`, so paths/methods/schemas cannot drift). Continuous updates for
 * streamable capabilities arrive via `useCapability` (`./live.ts`, SSE +
 * TanStack Store); this module is the seed + the transport for
 * non-streamable capabilities (mutations, static config).
 */

type Invoker<N extends CapabilityName> = (
  client: NfiApiClient,
  options: CapabilityOptions<N>,
) => Effect.Effect<CapabilityResult<N>, unknown>;

const INVOKERS: { [N in CapabilityName]: Invoker<N> } = {
  "system.health": (client) => client.System.health(),
  "system.backend-config": (client) => client.System.backendConfig(),
  "bot.status": (client) => client.Bot.status(),
  "bot.balance": (client) => client.Bot.balance(),
  "bot.profit": (client) => client.Bot.profit(),
  "bot.trades": (client) => client.Bot.trades(),
  "bot.config": (client) => client.Bot.config(),
  "bot.profit-history": (client) => client.Bot.profitHistory(),
  "bot.balance-history": (client) => client.Bot.balanceHistory(),
  "bot.balance.relative": (client) => client.Bot.balanceRelative(),
  "bot.profit.relative": (client) => client.Bot.profitRelative(),
  "bot.trades.relative": (client) => client.Bot.tradesRelative(),
  "bot.profit-history.relative": (client) => client.Bot.profitHistoryRelative(),
  "bot.balance-history.relative": (client) =>
    client.Bot.balanceHistoryRelative(),
  "workspace.list": (client) => client.Workspace.list(),
  "workspace.load": (client, options) =>
    client.Workspace.load({ path: { id: options.id } }),
  "workspace.save": (client, options) =>
    client.Workspace.save({
      path: { id: options.id },
      payload: { workspace: options.workspace },
    }),
  "workspace.create": (client, options) =>
    client.Workspace.create({
      payload: { name: options.name, workspace: options.workspace },
    }),
  "workspace.remove": (client, options) =>
    client.Workspace.remove({ path: { id: options.id } }),
  "instances.list": (client) => client.Instances.list(),
  "instances.create": (client, options) =>
    client.Instances.create({ payload: { ...options } }),
  "instances.update": (client, options) =>
    client.Instances.update({
      path: { id: options.id },
      payload: {
        name: options.name,
        baseUrl: options.baseUrl,
        username: options.username,
        password: options.password,
      },
    }),
  "instances.remove": (client, options) =>
    client.Instances.remove({ path: { id: options.id } }),
  "instances.health": (client, options) =>
    client.Instances.health({ path: { id: options.id } }),
  "instances.status": (client, options) =>
    client.Instances.status({ path: { id: options.id } }),
  "instances.balance": (client, options) =>
    client.Instances.balance({ path: { id: options.id } }),
  "instances.profit": (client, options) =>
    client.Instances.profit({ path: { id: options.id } }),
  "instances.open-positions": (client, options) =>
    client.Instances.openPositions({ path: { id: options.id } }),
  "instances.closed-positions": (client, options) =>
    client.Instances.closedPositions({
      path: { id: options.id },
      urlParams: { limit: options.limit, offset: options.offset },
    }),
  "instances.tag-performance": (client, options) =>
    client.Instances.tagPerformance({
      path: { id: options.id },
      urlParams: { limit: options.limit, groupBy: options.groupBy },
    }),
  "instances.pairs": (client, options) =>
    client.Instances.pairs({
      path: { id: options.id },
      urlParams: {
        timeframe: options.timeframe,
        stakeCurrency: options.stakeCurrency,
      },
    }),
  "instances.candles": (client, options) =>
    client.Instances.candles({
      path: { id: options.id },
      urlParams: {
        pair: options.pair,
        timeframe: options.timeframe,
        limit: options.limit,
      },
    }),
  "instances.plot-config": (client, options) =>
    client.Instances.plotConfig({
      path: { id: options.id },
      urlParams: { strategy: options.strategy },
    }),
  "instances.balance.relative": (client, options) =>
    client.Instances.balanceRelative({ path: { id: options.id } }),
  "instances.profit.relative": (client, options) =>
    client.Instances.profitRelative({ path: { id: options.id } }),
  "instances.open-positions.relative": (client, options) =>
    client.Instances.openPositionsRelative({ path: { id: options.id } }),
  "instances.closed-positions.relative": (client, options) =>
    client.Instances.closedPositionsRelative({
      path: { id: options.id },
      urlParams: { limit: options.limit, offset: options.offset },
    }),
  "instances.tag-performance.relative": (client, options) =>
    client.Instances.tagPerformanceRelative({
      path: { id: options.id },
      urlParams: { limit: options.limit, groupBy: options.groupBy },
    }),
  "instances.config": (client, options) =>
    client.Instances.config({ path: { id: options.id } }),
  "instances.locks": (client, options) =>
    client.Instances.locks({ path: { id: options.id } }),
  "instances.blacklist": (client, options) =>
    client.Instances.blacklist({ path: { id: options.id } }),
  "instances.whitelist": (client, options) =>
    client.Instances.whitelist({ path: { id: options.id } }),
  "instances.trade-count": (client, options) =>
    client.Instances.tradeCount({ path: { id: options.id } }),
  "instances.profit-daily": (client, options) =>
    client.Instances.profitDaily({
      path: { id: options.id },
      urlParams: { bucket: options.bucket, days: options.days },
    }),
  "instances.profit-history": (client, options) =>
    client.Instances.profitHistory({
      path: { id: options.id },
      urlParams: { limit: options.limit },
    }),
  "instances.overview": (client) => client.Instances.overview(),
  "instances.positions-all": (client) => client.Instances.positionsAll(),
  "instances.closed-all": (client, options) =>
    client.Instances.closedAll({ urlParams: { limit: options.limit } }),
  "instances.profit-daily-all": (client, options) =>
    client.Instances.profitDailyAll({
      urlParams: { bucket: options.bucket, days: options.days },
    }),
  "instances.balance-history": (client, options) =>
    client.Instances.balanceHistoryAll({ urlParams: { limit: options.limit } }),
  "instances.balance-history.relative": (client, options) =>
    client.Instances.balanceHistoryAllRelative({
      urlParams: { limit: options.limit },
    }),
  "users.list": (client) => client.Users.list(),
  "users.create": (client, options) =>
    client.Users.create({
      payload: {
        username: options.username,
        password: options.password,
        capabilities: [...options.capabilities],
      },
    }),
  "users.update": (client, options) =>
    client.Users.update({
      path: { id: options.id },
      payload: {
        password: options.password,
        capabilities:
          options.capabilities === undefined
            ? undefined
            : [...options.capabilities],
      },
    }),
  "users.remove": (client, options) =>
    client.Users.remove({ path: { id: options.id } }),
  "auth.capabilities": (client) => client.Auth.capabilities(),
};

export function callCapability<N extends CapabilityName>(
  name: N,
  options: CapabilityOptions<N>,
): Promise<CapabilityResult<N>> {
  const invoke = INVOKERS[name] as Invoker<N>;
  return runApi((client) => invoke(client, options));
}
