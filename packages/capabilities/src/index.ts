// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * @nfi/capabilities
 *
 * One file = one capability. Each module in this package owns a single
 * server-side function (option schema, result schema, streaming cadence,
 * exposed information kinds, implementation). `registry.ts` is the single
 * hard-coded map (`Record<Capability, ...>`), so definition and usage are
 * type-safe: `runCapability` (server), `callCapability` / `useCapability`
 * (web) infer options/results per id — typos and mismatches are compile
 * errors.
 *
 * Sensitivity: capabilities declare the kinds of information they expose;
 * the ROOT user configures which kinds are sensitive (`sensitivity.ts`,
 * served by `System.sensitivity`). A capability is sensitive iff it
 * exposes at least one sensitive kind.
 */

export * from "./definition.js";
export * from "./errors.js";
export * from "./fleet.js";
export * from "./relative.js";
export * from "./registry.js";
export * from "./sensitivity.js";
export { SystemHealthCapability } from "./system-health.js";
export { SystemBackendConfigCapability } from "./system-backend-config.js";
export { BotStatusCapability } from "./bot-status.js";
export { BotBalanceCapability } from "./bot-balance.js";
export { BotProfitCapability } from "./bot-profit.js";
export { BotTradesCapability } from "./bot-trades.js";
export { BotConfigCapability } from "./bot-config.js";
export { BotProfitHistoryCapability } from "./bot-profit-history.js";
export { BotBalanceHistoryCapability } from "./bot-balance-history.js";
export { BotBalanceRelativeCapability } from "./bot-balance-relative.js";
export { BotProfitRelativeCapability } from "./bot-profit-relative.js";
export { BotTradesRelativeCapability } from "./bot-trades-relative.js";
export { BotProfitHistoryRelativeCapability } from "./bot-profit-history-relative.js";
export { BotBalanceHistoryRelativeCapability } from "./bot-balance-history-relative.js";
export { WorkspaceListCapability } from "./workspace-list.js";
export { WorkspaceLoadCapability } from "./workspace-load.js";
export { WorkspaceSaveCapability } from "./workspace-save.js";
export { WorkspaceCreateCapability } from "./workspace-create.js";
export { WorkspaceRemoveCapability } from "./workspace-remove.js";
export { InstancesListCapability } from "./instances-list.js";
export { InstancesCreateCapability } from "./instances-create.js";
export { InstancesUpdateCapability } from "./instances-update.js";
export { InstancesRemoveCapability } from "./instances-remove.js";
export { InstancesHealthCapability } from "./instances-health.js";
export { InstancesStatusCapability } from "./instances-status.js";
export { InstancesBalanceCapability } from "./instances-balance.js";
export { InstancesProfitCapability } from "./instances-profit.js";
export { InstancesOpenPositionsCapability } from "./instances-open-positions.js";
export { InstancesClosedPositionsCapability } from "./instances-closed-positions.js";
export { InstancesTagPerformanceCapability } from "./instances-tag-performance.js";
export { InstancesPairsCapability } from "./instances-pairs.js";
export { InstancesCandlesCapability } from "./instances-candles.js";
export { InstancesPlotConfigCapability } from "./instances-plot-config.js";
export { InstancesBalanceRelativeCapability } from "./instances-balance-relative.js";
export { InstancesBalanceHistoryAllCapability } from "./instances-balance-history-all.js";
export { InstancesBalanceHistoryAllRelativeCapability } from "./instances-balance-history-all-relative.js";
export { InstancesProfitRelativeCapability } from "./instances-profit-relative.js";
export { InstancesOpenPositionsRelativeCapability } from "./instances-open-positions-relative.js";
export { InstancesClosedPositionsRelativeCapability } from "./instances-closed-positions-relative.js";
export { InstancesTagPerformanceRelativeCapability } from "./instances-tag-performance-relative.js";
export { InstancesBlacklistCapability } from "./instances-blacklist.js";
export { InstancesClosedAllCapability } from "./instances-closed-all.js";
export { InstancesConfigCapability } from "./instances-config.js";
export { InstancesLocksCapability } from "./instances-locks.js";
export { InstancesOverviewCapability } from "./instances-overview.js";
export { InstancesPositionsAllCapability } from "./instances-positions-all.js";
export { InstancesProfitDailyAllCapability } from "./instances-profit-daily-all.js";
export { InstancesProfitDailyCapability } from "./instances-profit-daily.js";
export { InstancesProfitHistoryCapability } from "./instances-profit-history.js";
export { InstancesTradeCountCapability } from "./instances-trade-count.js";
export { InstancesWhitelistCapability } from "./instances-whitelist.js";
export { UsersListCapability } from "./users-list.js";
export { UsersCreateCapability } from "./users-create.js";
export { UsersUpdateCapability } from "./users-update.js";
export { UsersRemoveCapability } from "./users-remove.js";
export { AuthCapabilitiesCapability } from "./auth-capabilities.js";
