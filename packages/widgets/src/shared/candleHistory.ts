// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Infinite scroll-back for candle charts.
 *
 * The live candle window (`instances.candles`, streamed) is bounded —
 * freqtrade's analyzed dataframe is a rolling window and the UI limit
 * ceiling caps the exchange fallback. This hook accumulates OLDER pages
 * as the user pans left: each `loadOlder(oldestLoadedMs)` fetches one
 * backward page of exchange klines strictly before that instant (the
 * `before` option of `instances.candles` — the exchange is the only
 * source that reaches years back), merges it into the accumulated set
 * and keeps going until the exchange runs dry.
 *
 * Pages are unary calls on purpose: a history page must never enter the
 * stream subscription key (every page would resubscribe the live feed).
 * Failures mark the history exhausted — without a public backward source
 * (non-binance exchanges) re-asking on every pan frame would be a loop.
 */

import type { Candle } from "@nfi/api-contract";
import { useLocalStore, useStore } from "@nfi/ui";
import { callCapability } from "../live/transport";
import { orderedByTime } from "./CandleChart";

/** One backward page: 500 klines is a snappy request on both hosts. */
export const CANDLE_HISTORY_PAGE = 500;

/** Ascending merge of accumulated pages and an incoming page. */
export const mergeOlderCandles = (
  accumulated: ReadonlyArray<Candle>,
  incoming: ReadonlyArray<Candle>,
): Candle[] =>
  // Accumulated first so the freshly fetched page wins the seam candle
  // (same "newest data wins" rule as the chart's own sanitizer).
  orderedByTime([...accumulated, ...incoming]);

export interface CandleHistory {
  /** Accumulated candles OLDER than the live window (time ascending). */
  readonly older: ReadonlyArray<Candle>;
  /** One backward page is in flight. */
  readonly loading: boolean;
  /** No more history: end reached or no backward source for the exchange. */
  readonly exhausted: boolean;
  /** Fetch one page strictly older than `oldestLoadedMs` (epoch millis). */
  loadOlder: (oldestLoadedMs: number) => void;
}

export function useCandleHistory(dataset: {
  readonly enabled: boolean;
  readonly instanceId: string;
  readonly pair: string;
  readonly timeframe: string;
}): CandleHistory {
  const key = `${dataset.instanceId}|${dataset.pair}|${dataset.timeframe}`;

  interface HistoryState {
    key: string;
    candles: ReadonlyArray<Candle>;
    loading: boolean;
    exhausted: boolean;
  }

  const store = useLocalStore<HistoryState>({
    key,
    candles: [],
    loading: false,
    exhausted: false,
  });

  // Dataset switch (instance, pair or timeframe): drop the accumulated
  // pages — they belong to a different chart.
  if (store.state.key !== key) {
    store.setState(() => ({
      key,
      candles: [],
      loading: false,
      exhausted: false,
    }));
  }

  const loadOlder = (oldestLoadedMs: number): void => {
    const state = store.state;

    if (!dataset.enabled || state.loading || state.exhausted) return;

    if (!Number.isFinite(oldestLoadedMs) || oldestLoadedMs <= 0) return;

    store.setState((s) => ({ ...s, loading: true }));

    void callCapability("instances.candles", {
      id: dataset.instanceId,
      pair: dataset.pair,
      timeframe: dataset.timeframe,
      limit: String(CANDLE_HISTORY_PAGE),
      before: String(Math.floor(oldestLoadedMs)),
    }).then(
      (result) => {
        store.setState((s) => {
          if (s.key !== key) return s;

          return {
            ...s,
            candles: mergeOlderCandles(s.candles, result.candles),
            loading: false,
            // An empty page means the exchange's history start is reached.
            exhausted: result.candles.length === 0,
          };
        });
      },
      () => {
        // No usable backward source (unsupported exchange, dead network):
        // stop asking rather than retry-looping while the user pans.
        store.setState((s) =>
          s.key === key ? { ...s, loading: false, exhausted: true } : s,
        );
      },
    );
  };

  return {
    older: useStore(store, (s) => s.candles),
    loading: useStore(store, (s) => s.loading),
    exhausted: useStore(store, (s) => s.exhausted),
    loadOlder,
  };
}
