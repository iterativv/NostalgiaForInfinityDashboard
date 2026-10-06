// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Position-window auto-fit — keep the followed position's entry in view.
 *
 * A position chart's job is "entry → now" context, but the default window
 * (200 × 5m ≈ 17h) cannot hold a days-old position: the entry marker and
 * the PnL shading simply fall out of the loaded data. This helper picks
 * the timeframe/limit pair whose window still covers the entry — the
 * finest timeframe that fits inside the 1000-candle ceiling wins, so the
 * chart keeps as much resolution as the span allows.
 */

import { timeframeSeconds } from "./tradeOverlay";

/** Candle request ceiling shared by the widgets and the capability. */
export const MAX_CANDLE_LIMIT = 1000;

/** Context bars around the entry so its marker is not glued to the edge. */
export const FIT_PAD_CANDLES = 40;

/** Candle timeframes, finest → coarsest. */
const TIMEFRAME_ORDER = [
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
] as const;

/** The timeframe literal shared by every candle widget config schema. */
export type FittedTimeframe = (typeof TIMEFRAME_ORDER)[number];

export interface FittedWindow {
  readonly timeframe: FittedTimeframe;
  readonly limit: number;
}

/** How the fit may change the timeframe. */
export type FitMode = "prefer-current" | "coarser-only";

/**
 * Window covering `entrySec` → now for the current timeframe (bumping the
 * limit), or the finest timeframe whose ≤1000-candle window covers it.
 * Null when the current window already reaches back past the entry —
 * nothing to change.
 *
 * `coarser-only` skips the raise-limit-at-current-timeframe branch and
 * every timeframe at or below the current granularity: for the data
 * shortfall case, where the loaded (analyzed) history starts AFTER the
 * entry and no limit can reach it — only a coarser timeframe, served by
 * the exchange fallback, covers the span.
 */
export function fitWindowToEntry(
  entrySec: number,
  timeframe: string,
  limit: number,
  options?: {
    readonly nowSec?: number;
    readonly mode?: FitMode;
  },
): FittedWindow | null {
  const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
  const mode = options?.mode ?? "prefer-current";
  // Only the widget timeframes are fittable; anything else leaves the
  // window alone.
  const current = TIMEFRAME_ORDER.find((tf) => tf === timeframe);

  if (current === undefined || !Number.isFinite(entrySec)) return null;

  const tfSec = timeframeSeconds(current);

  if (tfSec === null) return null;

  const spanSec = nowSec - entrySec;

  if (spanSec <= 0) return null;

  // Current timeframe, raised limit, whenever the 1000-candle ceiling
  // allows it — keeps the user's resolution choice untouched.
  const neededHere = Math.ceil(spanSec / tfSec) + FIT_PAD_CANDLES;

  if (mode === "prefer-current") {
    if (neededHere <= limit) return null;

    if (neededHere <= MAX_CANDLE_LIMIT) {
      return {
        timeframe: current,
        limit: Math.min(MAX_CANDLE_LIMIT, Math.max(limit, neededHere)),
      };
    }
  }

  // Zoom out to the finest timeframe that fits (skipping the current one
  // entirely in `coarser-only` mode). A span beyond even 1d × 1000
  // (≈2.7 years) pins to 1d/1000.
  const currentSec = tfSec;

  for (const candidate of TIMEFRAME_ORDER) {
    const candidateSec = timeframeSeconds(candidate);

    if (candidateSec === null) continue;

    if (mode === "coarser-only" && candidateSec <= currentSec) continue;

    const needed = Math.ceil(spanSec / candidateSec) + FIT_PAD_CANDLES;

    if (needed <= MAX_CANDLE_LIMIT) {
      return { timeframe: candidate, limit: needed };
    }
  }

  return { timeframe: "1d", limit: MAX_CANDLE_LIMIT };
}
