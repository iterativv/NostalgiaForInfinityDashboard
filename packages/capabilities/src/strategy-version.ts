// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import {
  parseStrategyVersion,
  parseStrategyVersionFromLogs,
  type FreqtradeClientService,
} from "@nfi/freqtrade-client"

/**
 * Resolve the strategy implementation version (`v18.0.119`, …).
 *
 * Priority (first hit wins, all best-effort):
 * 1. `show_config.strategy_version` (already on the status read).
 * 2. The `/version` string itself — some builds render
 *    `"<freqtrade>, strategy_version: <strategy>"` there too.
 * 3. The `Bot heartbeat … strategy_version: …` log line from
 *    `GET /api/v1/logs` (heartbeat is the only source on older bots).
 *
 * Never fails: returns `undefined` when no source yields a version, so the
 * status read it enriches stays up.
 */
export const resolveStrategyVersion = (
  service: FreqtradeClientService,
  statusStrategyVersion: string | undefined,
  botVersion: string | null | undefined,
): Effect.Effect<string | undefined, never> =>
  Effect.gen(function* () {
    const fromConfig = statusStrategyVersion?.trim()

    if (fromConfig) return fromConfig

    const fromVersionString = parseStrategyVersion(
      botVersion ?? undefined,
    )

    if (fromVersionString) return fromVersionString

    const logs = yield* service
      .getLogs(200)
      .pipe(Effect.orElseSucceed(() => null))

    if (!logs) return undefined

    return parseStrategyVersionFromLogs(logs.logs)
  })
