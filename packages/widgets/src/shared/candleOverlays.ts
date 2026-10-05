// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Candle indicator math shared by the position-candle widgets.
 *
 * The sensitive `candle-chart` and public `candle-chart-public` widgets
 * each inline this math; the position-candle twins share it from here so
 * the three chart variants cannot drift (same SMA/EMA/Bollinger/RSI/MACD
 * parameters, same window-VWAP definition). Pure functions over plain
 * bars — no chart imports, unit-testable without a canvas.
 */

import {
  BollingerBands,
  EMA,
  MACD,
  RSI,
  SMA,
} from "lightweight-charts-indicators";
import type { HistogramData, LineData } from "lightweight-charts";
import { utcSeconds, type TvOverlayLine, type TvSubplot } from "./CandleChart";
import type { CandlePalette } from "./colorBlind";

/** Bar shape expected by `lightweight-charts-indicators` (time in seconds). */
export interface IndicatorBar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
}

export interface OverlayFlags {
  readonly showSma20: boolean;
  readonly showSma50: boolean;
  readonly showEma12: boolean;
  readonly showBollinger: boolean;
  readonly showVwap: boolean;
}

const toLineData = (
  plots: ReadonlyArray<{ time: number; value: number }> | undefined,
): LineData[] => {
  const out: LineData[] = [];

  // Indicator libraries preserve the input bar time unit (seconds here).
  for (const p of plots ?? []) {
    if (Number.isFinite(p.value))
      out.push({ time: utcSeconds(p.time), value: p.value });
  }

  return out;
};

export const lastPlotValue = (
  plots: ReadonlyArray<{ value: number }> | undefined,
): number | null => {
  const list = plots ?? [];

  for (let i = list.length - 1; i >= 0; i--) {
    const v = list[i]?.value;

    if (v !== undefined && Number.isFinite(v)) return v;
  }

  return null;
};

/** Window VWAP: cumulative Σ(typical price × volume) ÷ Σ(volume). */
export const computeVwap = (
  candles: ReadonlyArray<IndicatorBar>,
): LineData[] => {
  const out: LineData[] = [];
  let pv = 0;
  let vol = 0;

  for (const c of candles) {
    const v = c.volume ?? 0;
    pv += ((c.high + c.low + c.close) / 3) * v;
    vol += v;

    if (vol > 0) out.push({ time: utcSeconds(c.time), value: pv / vol });
  }

  return out;
};

/** Price-pane overlays (SMA/EMA/Bollinger/VWAP) for the given flags. */
export function buildIndicatorOverlays(
  bars: ReadonlyArray<IndicatorBar>,
  flags: OverlayFlags,
): TvOverlayLine[] {
  if (bars.length === 0) return [];
  const list: TvOverlayLine[] = [];
  // The indicator library takes a mutable bar array — copy once here so
  // callers can keep passing readonly derived stores.
  const input = [...bars];

  if (flags.showSma20) {
    list.push({
      name: "SMA 20",
      color: "#ffab00",
      data: toLineData(SMA.calculate(input, { len: 20 }).plots.plot0),
    });
  }

  if (flags.showSma50) {
    list.push({
      name: "SMA 50",
      color: "#3ddbd9",
      data: toLineData(SMA.calculate(input, { len: 50 }).plots.plot0),
    });
  }

  if (flags.showEma12) {
    list.push({
      name: "EMA 12",
      color: "#ff7eb6",
      data: toLineData(EMA.calculate(input, { length: 12 }).plots.plot0),
    });
  }

  if (flags.showBollinger) {
    const bb = BollingerBands.calculate(input, { length: 20, mult: 2 });

    list.push({
      name: "BB upper",
      color: "#8a3ffc",
      data: toLineData(bb.plots.plot0),
      dashed: true,
    });
    list.push({
      name: "BB basis",
      color: "#8a3ffc",
      data: toLineData(bb.plots.plot1),
      dashed: true,
    });
    list.push({
      name: "BB lower",
      color: "#8a3ffc",
      data: toLineData(bb.plots.plot2),
      dashed: true,
    });
  }

  if (flags.showVwap) {
    const vwap = computeVwap(bars);

    if (vwap.length > 0) {
      list.push({
        name: "VWAP",
        color: "#78a9ff",
        data: vwap,
        lineWidth: 2,
      });
    }
  }

  return list;
}

export type CandleSubplotKind = "none" | "rsi" | "macd";

/** RSI/MACD subplot (null when disabled) — MACD histogram follows `palette`. */
export function buildIndicatorSubplot(
  bars: ReadonlyArray<IndicatorBar>,
  subplot: CandleSubplotKind,
  palette: CandlePalette,
): TvSubplot | null {
  if (subplot === "none" || bars.length === 0) return null;
  const input = [...bars];

  if (subplot === "rsi") {
    return {
      lines: [
        {
          name: "RSI 14",
          color: "#3ddbd9",
          data: toLineData(RSI.calculate(input, { length: 14 }).plots.plot0),
        },
      ],
      levels: [
        { price: 70, title: "70" },
        { price: 50, title: "50" },
        { price: 30, title: "30" },
      ],
    };
  }

  const macd = MACD.calculate(input, {
    fastLength: 12,
    slowLength: 26,
    signalLength: 9,
  }).plots;

  const histogram: HistogramData[] = [];

  for (const p of macd.plot2 ?? []) {
    if (Number.isFinite(p.value)) {
      histogram.push({
        time: utcSeconds(p.time),
        value: p.value,
        color: p.value >= 0 ? palette.histUp : palette.histDown,
      });
    }
  }

  return {
    lines: [
      { name: "MACD", color: "#ff7eb6", data: toLineData(macd.plot0) },
      { name: "Signal", color: "#ffab00", data: toLineData(macd.plot1) },
    ],
    histogram,
    levels: [{ price: 0, title: "0" }],
  };
}
