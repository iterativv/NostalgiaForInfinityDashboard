// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useCapability } from "../live/live";

/**
 * Bot's strategy timeframe (e.g. `"5m"`) for one instance — the timeframe
 * whose live `pair_candles` the bot actually holds. Candle widgets use it
 * to explain empty unanalyzed timeframes ("your bot analyzes 5m") and offer
 * a one-click switch back, instead of stranding the user on a dead chart.
 *
 * Opportunistic read on purpose: `instances.config` is NOT declared in the
 * candle widgets' capability lists (it carries `strategy-config`, sensitive
 * by default, and absent from the anonymous grant). Without the grant the
 * query stays unauthorized and this returns `undefined` — callers fall back
 * to their generic empty-state copy. Never gates rendering by itself.
 */
export function useStrategyTimeframe(
  instanceId: string | undefined,
): string | undefined {
  const { data } = useCapability(
    "instances.config",
    { id: instanceId ?? "" },
    { enabled: !!instanceId && instanceId !== "all" },
  );

  const timeframe = data?.timeframe?.trim();

  return timeframe && timeframe.length > 0 ? timeframe : undefined;
}
