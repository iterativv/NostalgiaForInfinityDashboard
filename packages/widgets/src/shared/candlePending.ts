// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/* eslint-disable react-hooks/purity -- the grace deadline is adopted and
   compared against the clock during render by contract (store-only hook,
   see the doc comment below); re-render skew only shifts the window. */
import { useLocalStore, useStore, useStoreEffect } from "@nfi/ui";

/**
 * Grace loader for candle refetches (timeframe/pair switches).
 *
 * Freqtrade `pair_candles` for a freshly requested timeframe can take a
 * while (exchange fetch + strategy analysis), and the live store may still
 * hold a cached EMPTY result for that key from an earlier visit — so
 * `candlesQ.isLoading` is already false while the fresh REST seed is in
 * flight, and widgets would flash the scary "no analyzed data" empty state
 * instead of a loader.
 *
 * This hook forces a loading window after every request-key change: while
 * there are still no candles and the grace deadline hasn't passed, callers
 * should keep their `WidgetFrame` in `isLoading` instead of rendering the
 * empty state. Once real candles arrive (`hasData`) the pending flag drops
 * immediately; after the grace expires the widget falls through to the
 * honest empty state (truly unanalyzed timeframe / off-whitelist pair).
 *
 * Store-only by contract (see `@nfi/ui` store boundary): no React state
 * hooks, render-time key adoption with equality-guarded writes, and a timer
 * effect that ticks once at the deadline so the empty state appears without
 * another prop change.
 */
export function useCandlePending(
  requestKey: string,
  hasData: boolean,
  isLoading: boolean,
  graceMs = 8000,
): boolean {
  const pendingStore = useLocalStore(() => ({
    key: requestKey,
    deadline: Date.now() + graceMs,
  }));

  if (pendingStore.state.key !== requestKey) {
    pendingStore.setState(() => ({
      key: requestKey,
      deadline: Date.now() + graceMs,
    }));
  }

  const deadline = useStore(pendingStore, (s) => s.deadline);
  const key = useStore(pendingStore, (s) => s.key);

  const tickStore = useLocalStore(0);
  useStore(tickStore, (s) => s);

  useStoreEffect(() => {
    if (hasData || isLoading) return;

    const wait = deadline - Date.now();

    if (wait <= 0) return;

    const timer = setTimeout(
      () => tickStore.setState((v) => v + 1),
      Math.min(wait + 50, graceMs + 1000),
    );

    return () => clearTimeout(timer);
  }, [deadline, key, hasData, isLoading]);

  if (hasData) return false;

  if (isLoading) return true;

  return Date.now() < deadline;
}
