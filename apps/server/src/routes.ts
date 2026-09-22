// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { HttpApiBuilder } from "@effect/platform"
import { NfiApi } from "@nfi/api-contract"
import { runCapabilityForHttp } from "./capabilities/context.js"
import { getSensitivity, updateSensitivity } from "./sensitivity.js"

/**
 * Backend API — the ONLY process that talks to freqtrade.
 *
 * Every handler here is a one-line delegation to a hard-coded capability
 * (`@nfi/capabilities`, one file per capability): option/result schemas,
 * streaming cadence and the server implementation live there, so this file
 * owns no endpoint logic. Auth gates availability by capability id
 * (`ENDPOINT_CAPABILITIES` in `@nfi/api-contract`).
 *
 * The sensitivity endpoints are the documented exception (meta-info, not a
 * capability): everyone reads the criteria, only root may write them
 * (guard in `sensitivity.ts`).
 */

export const SystemGroupLive = HttpApiBuilder.group(NfiApi, "System", (handlers) =>
  handlers
    .handle("health", () => runCapabilityForHttp("system.health", {}))
    .handle("backendConfig", () => runCapabilityForHttp("system.backend-config", {}))
    .handle("sensitivity", () => getSensitivity())
    .handle("sensitivityUpdate", ({ payload }) => updateSensitivity(payload)),
)

export const BotGroupLive = HttpApiBuilder.group(NfiApi, "Bot", (handlers) =>
  handlers
    .handle("status", () => runCapabilityForHttp("bot.status", {}))
    .handle("balance", () => runCapabilityForHttp("bot.balance", {}))
    .handle("profit", () => runCapabilityForHttp("bot.profit", {}))
    .handle("trades", () => runCapabilityForHttp("bot.trades", {}))
    .handle("config", () => runCapabilityForHttp("bot.config", {}))
    .handle("profitHistory", () => runCapabilityForHttp("bot.profit-history", {}))
    .handle("balanceHistory", () => runCapabilityForHttp("bot.balance-history", {}))
    .handle("balanceRelative", () => runCapabilityForHttp("bot.balance.relative", {}))
    .handle("profitRelative", () => runCapabilityForHttp("bot.profit.relative", {}))
    .handle("tradesRelative", () => runCapabilityForHttp("bot.trades.relative", {}))
    .handle("profitHistoryRelative", () => runCapabilityForHttp("bot.profit-history.relative", {}))
    .handle("balanceHistoryRelative", () => runCapabilityForHttp("bot.balance-history.relative", {})),
)
