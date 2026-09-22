// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Candle chart — OHLCV candlesticks with indicator overlays.
 *
 * Candles come from freqtrade `pair_candles` through our backend; rendering
 * is TradingView's `lightweight-charts` and indicator math is
 * `lightweight-charts-indicators` (PineScript-compatible SMA/EMA/Bollinger/
 * RSI/MACD). Strategy indicator metadata comes from `plot_config`.
 *
 * Capability split: candles need `instances.candles`; every indicator control
 * needs `instances.plot-config`. A user with only the former still gets the
 * chart — overlays stay locked with an explanation instead of failing.
 */

import { useEffect, useMemo } from "react";
import { NumberInput } from "@carbon/react";
import { Schema } from "effect";
import {
  BollingerBands,
  EMA,
  MACD,
  RSI,
  SMA,
} from "lightweight-charts-indicators";
import type { HistogramData, LineData, UTCTimestamp } from "lightweight-charts";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import {
  InstanceIdField,
  booleanWithDefault,
  numberWithDefault,
} from "./shared/config";
import { clampInt, fmtCompact } from "./shared/format";
import { queryState, useWidgetAccess } from "./shared/query";
import { InstanceSelect } from "./shared/InstanceSelect";
import { PairCombobox } from "./shared/PairCombobox";
import { SettingsSelect } from "./shared/SettingsSelect";
import { SettingsToggle } from "./shared/SettingsToggle";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";
import {
  CandleChart,
  orderedByTime,
  type TvOverlayLine,
  type TvSubplot,
} from "./shared/CandleChart";

export const CANDLE_MARKET_CAPABILITY: Capability = "instances.candles";
export const CANDLE_INDICATORS_CAPABILITY: Capability = "instances.plot-config";

export const CandleTimeframe = Schema.Literal(
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
);
export type CandleTimeframe = typeof CandleTimeframe.Type;

export const CandleSubplot = Schema.Literal("none", "rsi", "macd");
export type CandleSubplot = typeof CandleSubplot.Type;

export const CandleChartConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  pair: Schema.optionalWith(Schema.String.pipe(Schema.minLength(1)), {
    default: (): string => "BTC/USDT",
  }),
  // 5m is freqtrade's own default strategy timeframe: analyzed candles
  // virtually always exist for it, while coarser frames often come back
  // empty when the bot never analyzed them.
  timeframe: Schema.optionalWith(CandleTimeframe, {
    default: (): CandleTimeframe => "5m",
  }),
  limit: numberWithDefault(200),
  showSma20: booleanWithDefault(true),
  showSma50: booleanWithDefault(true),
  showEma12: booleanWithDefault(false),
  showBollinger: booleanWithDefault(false),
  showVwap: booleanWithDefault(true),
  showVolume: booleanWithDefault(true),
  subplot: Schema.optionalWith(CandleSubplot, {
    default: (): CandleSubplot => "rsi",
  }),
});
export type CandleChartConfig = typeof CandleChartConfigSchema.Type;

export const CANDLE_CHART_DEFAULTS: CandleChartConfig =
  Schema.decodeUnknownSync(CandleChartConfigSchema)({});

const TIMEFRAME_ITEMS = [
  { id: "1m", text: "1m" },
  { id: "5m", text: "5m" },
  { id: "15m", text: "15m" },
  { id: "30m", text: "30m" },
  { id: "1h", text: "1h" },
  { id: "4h", text: "4h" },
  { id: "1d", text: "1d" },
] as const;

const SUBPLOT_ITEMS: ReadonlyArray<{
  readonly id: CandleSubplot;
  readonly text: string;
}> = [
  { id: "none", text: "None" },
  { id: "rsi", text: "RSI (14)" },
  { id: "macd", text: "MACD (12, 26, 9)" },
];

/** Bar shape expected by `lightweight-charts-indicators` (time in seconds). */
interface TvBar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
}

const toLineData = (
  plots: ReadonlyArray<{ time: number; value: number }> | undefined,
): LineData[] => {
  const out: LineData[] = [];
  for (const p of plots ?? []) {
    if (Number.isFinite(p.value))
      out.push({ time: p.time as UTCTimestamp, value: p.value });
  }
  return out;
};

const lastPlotValue = (
  plots: ReadonlyArray<{ value: number }> | undefined,
): number | null => {
  const list = plots ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const v = list[i]?.value;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
};

/** Window VWAP: cumulative Σ(typical price × volume) ÷ Σ(volume). */
const computeVwap = (
  candles: ReadonlyArray<{
    time: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  }>,
): LineData[] => {
  const out: LineData[] = [];
  let pv = 0;
  let vol = 0;
  for (const c of candles) {
    const v = c.volume ?? 0;
    pv += ((c.high + c.low + c.close) / 3) * v;
    vol += v;
    if (vol > 0) out.push({ time: toSec(c.time), value: pv / vol });
  }
  return out;
};

const toSec = (ms: number): UTCTimestamp =>
  Math.floor(ms / 1000) as UTCTimestamp;

export function CandleChartWidget({
  config,
  panelId,
}: WidgetProps<CandleChartConfig>) {
  const cfg = config;
  const limit = clampInt(cfg.limit, 200, 20, 1000);
  const market = useWidgetAccess([CANDLE_MARKET_CAPABILITY]);
  const indicatorsAccess = useWidgetAccess([CANDLE_INDICATORS_CAPABILITY]);
  const candlesQ = useCapability(
    "instances.candles",
    {
      id: cfg.instanceId,
      pair: cfg.pair,
      timeframe: cfg.timeframe,
      limit: String(limit),
    },
    { enabled: market.allowed },
  );
  const pairsQ = useCapability(
    "instances.pairs",
    { id: cfg.instanceId, timeframe: cfg.timeframe },
    { enabled: market.allowed },
  );
  const plotQ = useCapability(
    "instances.plot-config",
    { id: cfg.instanceId },
    { enabled: indicatorsAccess.allowed },
  );
  const state = queryState(candlesQ.error, candlesQ.isLoading);
  const marketError = market.allowed
    ? null
    : `Not authorized — needs ${market.missing.join(", ")}`;
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<CandleChartConfig>) =>
    applyWidgetSettings(panelId, "candle-chart", cfg, p);

  const candles = useMemo(() => candlesQ.data?.candles ?? [], [candlesQ.data]);

  // Pair self-heal: futures exchanges whitelist `BTC/USDT:USDT` while spot
  // lists `BTC/USDT`. When the configured pair is not on the whitelist,
  // adopt its settled variant (else the same base) once, so the BTC/USDT
  // default is usable out of the box on either market type.
  useEffect(() => {
    const whitelist = pairsQ.data?.pairs;
    if (!whitelist || whitelist.length === 0) return;
    if (whitelist.includes(cfg.pair)) return;
    const base = cfg.pair.split("/")[0] ?? cfg.pair;
    const settled = whitelist.find((p) => p === `${cfg.pair}:USDT`);
    const byBase = whitelist.find((p) => (p.split("/")[0] ?? "") === base);
    const next = settled ?? byBase;
    if (next) patch({ pair: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairsQ.data, cfg.pair]);

  // Bars drive the indicator math and VWAP: dedupe by bar-time seconds
  // (keep the newest) so a duplicated candle from freqtrade cannot produce
  // duplicate-time indicator points either.
  const bars = useMemo<TvBar[]>(
    () =>
      orderedByTime(
        candles.map((c) => ({
          time: Math.floor(c.time / 1000),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        })),
      ),
    [candles],
  );

  const overlays = useMemo<TvOverlayLine[]>(() => {
    if (!indicatorsAccess.allowed || bars.length === 0) return [];
    const list: TvOverlayLine[] = [];
    if (cfg.showSma20) {
      list.push({
        name: "SMA 20",
        color: "#ffab00",
        data: toLineData(SMA.calculate(bars, { len: 20 }).plots.plot0),
      });
    }
    if (cfg.showSma50) {
      list.push({
        name: "SMA 50",
        color: "#3ddbd9",
        data: toLineData(SMA.calculate(bars, { len: 50 }).plots.plot0),
      });
    }
    if (cfg.showEma12) {
      list.push({
        name: "EMA 12",
        color: "#ff7eb6",
        data: toLineData(EMA.calculate(bars, { length: 12 }).plots.plot0),
      });
    }
    if (cfg.showBollinger) {
      const bb = BollingerBands.calculate(bars, { length: 20, mult: 2 });
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
    if (cfg.showVwap) {
      const vwap = computeVwap(bars);
      if (vwap.length > 0) {
        list.push({ name: "VWAP", color: "#78a9ff", data: vwap, lineWidth: 2 });
      }
    }
    return list;
  }, [
    bars,
    cfg.showSma20,
    cfg.showSma50,
    cfg.showEma12,
    cfg.showBollinger,
    cfg.showVwap,
    indicatorsAccess.allowed,
  ]);

  const rsiPlots = useMemo(
    () =>
      indicatorsAccess.allowed && bars.length > 0 && cfg.subplot === "rsi"
        ? RSI.calculate(bars, { length: 14 }).plots.plot0
        : [],
    [bars, cfg.subplot, indicatorsAccess.allowed],
  );

  const macdPlots = useMemo(
    () =>
      indicatorsAccess.allowed && bars.length > 0 && cfg.subplot === "macd"
        ? MACD.calculate(bars, {
            fastLength: 12,
            slowLength: 26,
            signalLength: 9,
          }).plots
        : null,
    [bars, cfg.subplot, indicatorsAccess.allowed],
  );

  const subplot = useMemo<TvSubplot | null>(() => {
    if (!indicatorsAccess.allowed || cfg.subplot === "none") return null;
    if (cfg.subplot === "rsi") {
      return {
        lines: [
          { name: "RSI 14", color: "#3ddbd9", data: toLineData(rsiPlots) },
        ],
        levels: [
          { price: 70, title: "70" },
          { price: 50, title: "50" },
          { price: 30, title: "30" },
        ],
      };
    }
    if (!macdPlots) return null;
    const histogram: HistogramData[] = [];
    for (const p of macdPlots?.plot2 ?? []) {
      if (Number.isFinite(p.value)) {
        histogram.push({
          time: p.time as UTCTimestamp,
          value: p.value,
          color:
            p.value >= 0 ? "rgba(38, 166, 154, 0.6)" : "rgba(239, 83, 80, 0.6)",
        });
      }
    }
    return {
      lines: [
        { name: "MACD", color: "#ff7eb6", data: toLineData(macdPlots?.plot0) },
        {
          name: "Signal",
          color: "#ffab00",
          data: toLineData(macdPlots?.plot1),
        },
      ],
      histogram,
      levels: [{ price: 0, title: "0" }],
    };
  }, [cfg.subplot, indicatorsAccess.allowed, rsiPlots, macdPlots]);

  const lastRsi = cfg.subplot === "rsi" ? lastPlotValue(rsiPlots) : null;
  const availablePairs = pairsQ.data?.pairs ?? [];
  const strategyPlots = plotQ.data;
  const strategyHints = strategyPlots
    ? [
        ...strategyPlots.mainPlot,
        ...Object.entries(strategyPlots.subplots).flatMap(([name, inds]) =>
          inds.map((i) => `${name}:${i}`),
        ),
      ]
    : [];

  // Window stats for the toolbar quote strip (over deduped, sorted bars).
  const lastBar = bars[bars.length - 1];
  const prevBar = bars[bars.length - 2];
  const lastClose =
    lastBar && Number.isFinite(lastBar.close) ? lastBar.close : null;
  const windowChange =
    lastClose !== null &&
    prevBar !== undefined &&
    prevBar.close !== 0 &&
    Number.isFinite(prevBar.close)
      ? ((lastClose - prevBar.close) / Math.abs(prevBar.close)) * 100
      : 0;
  let windowHigh: number | null = null;
  let windowLow: number | null = null;
  let windowVolume = 0;
  for (const b of bars) {
    if (windowHigh === null || b.high > windowHigh) windowHigh = b.high;
    if (windowLow === null || b.low < windowLow) windowLow = b.low;
    windowVolume += b.volume ?? 0;
  }
  const chartPrecision = (() => {
    if (lastClose === null || lastClose <= 0) return 4;
    if (lastClose >= 100) return 2;
    if (lastClose >= 1) return 4;
    return 6;
  })();

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Candle chart settings"
        widgetType="candle-chart"
      >
        <InstanceSelect
          id={`candle-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
        />
        <PairCombobox
          id={`candle-pair-${panelId}`}
          label="Pair"
          value={cfg.pair}
          pairs={availablePairs}
          onChange={(pair) => patch({ pair })}
        />
        <SettingsSelect
          id={`candle-tf-${panelId}`}
          label="Timeframe"
          items={TIMEFRAME_ITEMS.map((i) => ({ ...i }))}
          value={cfg.timeframe}
          onChange={(id) => patch({ timeframe: id as CandleTimeframe })}
        />
        <NumberInput
          id={`candle-limit-${panelId}`}
          label="Candles"
          value={limit}
          min={20}
          max={1000}
          step={10}
          onChange={(_e, { value }) =>
            patch({ limit: clampInt(value, 200, 20, 1000) })
          }
          size="sm"
        />
        {indicatorsAccess.allowed ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "0 0.75rem",
              }}
            >
              <SettingsToggle
                id={`candle-sma20-${panelId}`}
                label="SMA 20"
                toggled={cfg.showSma20}
                onToggle={(v) => patch({ showSma20: v })}
              />
              <SettingsToggle
                id={`candle-sma50-${panelId}`}
                label="SMA 50"
                toggled={cfg.showSma50}
                onToggle={(v) => patch({ showSma50: v })}
              />
              <SettingsToggle
                id={`candle-ema-${panelId}`}
                label="EMA 12"
                toggled={cfg.showEma12}
                onToggle={(v) => patch({ showEma12: v })}
              />
              <SettingsToggle
                id={`candle-bb-${panelId}`}
                label="Bollinger"
                toggled={cfg.showBollinger}
                onToggle={(v) => patch({ showBollinger: v })}
              />
              <SettingsToggle
                id={`candle-vwap-${panelId}`}
                label="VWAP"
                toggled={cfg.showVwap}
                onToggle={(v) => patch({ showVwap: v })}
              />
              <SettingsToggle
                id={`candle-vol-${panelId}`}
                label="Volume"
                toggled={cfg.showVolume}
                onToggle={(v) => patch({ showVolume: v })}
              />
            </div>
            <SettingsSelect
              id={`candle-sub-${panelId}`}
              label="Subplot"
              items={SUBPLOT_ITEMS.map((i) => ({ ...i }))}
              value={cfg.subplot}
              onChange={(id) => patch({ subplot: id as CandleSubplot })}
            />
          </>
        ) : (
          <p
            style={{ fontSize: "0.8125rem", color: "var(--cds-support-error)" }}
          >
            Indicators locked — needs {indicatorsAccess.missing.join(", ")}.
          </p>
        )}
      </WidgetSettingsModal>
      <WidgetFrame
      title={`Candles · ${cfg.pair} · ${cfg.timeframe}`}
      isLoading={state.isLoading}
      error={marketError ?? state.error}
    >
      {candles.length >= 2 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.375rem",
            flex: "1 1 auto",
            minHeight: 240,
          }}
        >
          <div className="nfi-candle-toolbar">
            {availablePairs.length > 0 ? (
              <span title={`${candles.length} candles loaded`}>
                <PairCombobox
                  id={`candle-pair-${panelId}`}
                  value={cfg.pair}
                  pairs={availablePairs}
                  onChange={(pair) => patch({ pair })}
                />
              </span>
            ) : (
              <span
                className="nfi-candle-pair"
                title={`${candles.length} candles loaded`}
              >
                {cfg.pair}
              </span>
            )}
            <div className="nfi-tf-group" role="group" aria-label="Timeframe">
              {TIMEFRAME_ITEMS.map((tf) => (
                <button
                  key={tf.id}
                  type="button"
                  className={
                    cfg.timeframe === tf.id
                      ? "nfi-tf-btn nfi-tf-active"
                      : "nfi-tf-btn"
                  }
                  onClick={() => patch({ timeframe: tf.id as CandleTimeframe })}
                  aria-pressed={cfg.timeframe === tf.id}
                >
                  {tf.text}
                </button>
              ))}
            </div>
            <span className="nfi-candle-quote">
              <span
                className={
                  windowChange >= 0 ? "nfi-pnl-positive" : "nfi-pnl-negative"
                }
                style={{ fontWeight: 600 }}
              >
                {lastClose !== null ? lastClose.toFixed(chartPrecision) : "—"}
              </span>
              <span
                className={
                  windowChange >= 0 ? "nfi-pnl-positive" : "nfi-pnl-negative"
                }
              >
                {windowChange >= 0 ? "+" : ""}
                {windowChange.toFixed(2)}%
              </span>
              <span className="nfi-candle-range">
                H{" "}
                {windowHigh !== null ? windowHigh.toFixed(chartPrecision) : "—"}{" "}
                L {windowLow !== null ? windowLow.toFixed(chartPrecision) : "—"}
              </span>
              <span className="nfi-candle-range">
                ΣV {fmtCompact(windowVolume)}
              </span>
              {lastRsi !== null ? (
                <span
                  className={
                    lastRsi > 70
                      ? "nfi-pnl-negative"
                      : lastRsi < 30
                        ? "nfi-pnl-positive"
                        : undefined
                  }
                >
                  RSI {lastRsi.toFixed(1)}
                </span>
              ) : null}
            </span>
          </div>
          {strategyHints.length > 0 ? (
            <div
              className="nfi-candle-strategy"
              title={strategyHints.join(", ")}
            >
              strategy plots: {strategyHints.slice(0, 6).join(" · ")}
              {strategyHints.length > 6 ? "…" : ""}
            </div>
          ) : null}
          <CandleChart
            candles={candles}
            overlays={overlays}
            showVolume={cfg.showVolume}
            subplot={subplot}
          />
        </div>
      ) : (
        <EmptyState
          title="No candles"
          hint={`Freqtrade has no analyzed data for ${cfg.pair} · ${cfg.timeframe} — the pair may be off the bot's whitelist or the timeframe unanalyzed. Pick a listed pair and the strategy timeframe in the tab's ⋯ menu.`}
        />
      )}
    </WidgetFrame>
    </>
  );
}

export const CandleChartWidgetDef = defineWidget({
  type: "candle-chart",
  hasSettings: true,
  title: "Candle Chart",
  description:
    "OHLCV candlesticks with SMA/EMA/Bollinger overlays, volume and RSI/MACD.",
  configSchema: CandleChartConfigSchema,
  defaultConfig: CANDLE_CHART_DEFAULTS,
  component: CandleChartWidget,
  capabilities: [CANDLE_MARKET_CAPABILITY, CANDLE_INDICATORS_CAPABILITY],
  minWidth: 420,
  minHeight: 240,
});
