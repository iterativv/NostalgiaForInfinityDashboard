// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Public candle chart — OHLCV candlesticks with indicator overlays and
 * position-history markers, and nothing else.
 *
 * The "non-sensitive" twin of `candle-chart`: it renders the same
 * market-data chart (candles, SMA/EMA/Bollinger/VWAP, volume, RSI/MACD —
 * all computed client-side from OHLCV) plus entry/exit markers built from
 * position *dates* and *percentages* only (no amounts, prices, or order
 * detail), so it stays shareable on public pages. Capabilities are
 * `instances.candles` + `instances.pairs` (`market-data`) and
 * `instances.open-positions.relative` +
 * `instances.closed-positions.relative` (`relative-values`) — all four in
 * the anonymous seed grant.
 *
 * Deliberate omissions vs `candle-chart`: no avg-entry line / PnL shading
 * (those need absolute `openRate`/`stakeAmount` via `trade-details`
 * capabilities) and no strategy plot hints (those need
 * `instances.plot-config`).
 */

import { Button, NumberInput } from "@carbon/react";
import { Schema } from "effect";
import {
  BollingerBands,
  EMA,
  MACD,
  RSI,
  SMA,
} from "lightweight-charts-indicators";
import type { HistogramData, LineData } from "lightweight-charts";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import {
  EmptyState,
  shallow,
  useDerived,
  useStoreEffect,
  WidgetFrame,
} from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { useCandlePending } from "./shared/candlePending";
import { useStrategyTimeframe } from "./shared/strategyTimeframe";
import {
  InstanceIdField,
  booleanWithDefault,
  numberWithDefault,
} from "./shared/config";
import { clampInt, fmtCompact } from "./shared/format";
import { queryState, useWidgetAccess } from "./shared/query";
import { useNarrowMode } from "./shared/size";
import { InstanceSelect } from "./shared/InstanceSelect";
import { PairCombobox } from "./shared/PairCombobox";
import { SettingsSelect } from "./shared/SettingsSelect";
import { candlePalette, useColorBlindSafe } from "./shared/colorBlind";
import { SettingsToggle } from "./shared/SettingsToggle";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";
import {
  CandleChart,
  orderedByTime,
  utcSeconds,
  type TvOverlayLine,
  type TvSubplot,
  type TvTradeMarker,
} from "./shared/CandleChart";
import {
  buildPositionHistoryMarkers,
  parsePositionTime,
  positionDirection,
  positionExitText,
  timeframeSeconds,
  type PositionMarkerEvent,
} from "./shared/tradeOverlay";

/** OHLCV candles (public market data). */
export const PUBLIC_CANDLE_MARKET_CAPABILITY: Capability = "instances.candles";

/** Pair whitelist for the pair switcher (public market data). */
export const PUBLIC_CANDLE_PAIRS_CAPABILITY: Capability = "instances.pairs";

/** Open positions, percentages/weights only (shareable). */
export const PUBLIC_CANDLE_OPEN_CAPABILITY: Capability =
  "instances.open-positions.relative";

/** Closed positions window, percentages only (shareable). */
export const PUBLIC_CANDLE_CLOSED_CAPABILITY: Capability =
  "instances.closed-positions.relative";

export const PUBLIC_CANDLE_CAPABILITIES: ReadonlyArray<Capability> = [
  PUBLIC_CANDLE_MARKET_CAPABILITY,
  PUBLIC_CANDLE_PAIRS_CAPABILITY,
  PUBLIC_CANDLE_OPEN_CAPABILITY,
  PUBLIC_CANDLE_CLOSED_CAPABILITY,
];

export const PublicCandleTimeframe = Schema.Literal(
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
);

export type PublicCandleTimeframe = typeof PublicCandleTimeframe.Type;

export const PublicCandleSubplot = Schema.Literal("none", "rsi", "macd");

export type PublicCandleSubplot = typeof PublicCandleSubplot.Type;

export const PublicCandleChartConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  pair: Schema.optionalWith(Schema.String.pipe(Schema.minLength(1)), {
    default: (): string => "BTC/USDT",
  }),
  timeframe: Schema.optionalWith(PublicCandleTimeframe, {
    default: (): PublicCandleTimeframe => "5m",
  }),
  limit: numberWithDefault(200),
  showSma20: booleanWithDefault(true),
  showSma50: booleanWithDefault(true),
  showEma12: booleanWithDefault(false),
  showBollinger: booleanWithDefault(false),
  showVwap: booleanWithDefault(true),
  showVolume: booleanWithDefault(true),
  /** Position-history markers (entries/exits, percentages only). */
  showPositions: booleanWithDefault(true),
  subplot: Schema.optionalWith(PublicCandleSubplot, {
    default: (): PublicCandleSubplot => "rsi",
  }),
});

export type PublicCandleChartConfig =
  typeof PublicCandleChartConfigSchema.Type;

export const PUBLIC_CANDLE_CHART_DEFAULTS: PublicCandleChartConfig =
  Schema.decodeUnknownSync(PublicCandleChartConfigSchema)({});

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
  readonly id: PublicCandleSubplot;
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

  // Indicator libraries preserve the input bar time unit (seconds here).
  for (const p of plots ?? []) {
    if (Number.isFinite(p.value))
      out.push({ time: utcSeconds(p.time), value: p.value });
  }

  return out;
};

const lastPlotValue = (
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

    if (vol > 0) out.push({ time: utcSeconds(c.time), value: pv / vol });
  }

  return out;
};

export function PublicCandleChartWidget({
  config,
  panelId,
}: WidgetProps<PublicCandleChartConfig>) {
  const cfg = config;
  const limit = clampInt(cfg.limit, 200, 20, 1000);

  // Market data gates the chart itself; position history is a separate
  // gate, so a grant without the relative ids still renders candles —
  // just without markers (same pattern as the sensitive twin).
  const marketAccess = useWidgetAccess([
    PUBLIC_CANDLE_MARKET_CAPABILITY,
    PUBLIC_CANDLE_PAIRS_CAPABILITY,
  ]);

  const positionsAccess = useWidgetAccess([
    PUBLIC_CANDLE_OPEN_CAPABILITY,
    PUBLIC_CANDLE_CLOSED_CAPABILITY,
  ]);

  const candlesQ = useCapability(
    "instances.candles",
    {
      id: cfg.instanceId,
      pair: cfg.pair,
      timeframe: cfg.timeframe,
      limit: String(limit),
    },
    { enabled: marketAccess.allowed },
  );

  const pairsQ = useCapability(
    "instances.pairs",
    { id: cfg.instanceId, timeframe: cfg.timeframe },
    { enabled: marketAccess.allowed },
  );

  // Position-history sources (gated: without these the chart renders
  // without markers). Closed window matches the sensitive twin (200).
  const openRelQ = useCapability(
    "instances.open-positions.relative",
    { id: cfg.instanceId },
    { enabled: positionsAccess.allowed },
  );

  const closedRelQ = useCapability(
    "instances.closed-positions.relative",
    { id: cfg.instanceId, limit: "200" },
    { enabled: positionsAccess.allowed },
  );

  const showSettings = useWidgetSettingsOpen(panelId);

  const patch = (p: Partial<PublicCandleChartConfig>) =>
    applyWidgetSettings(panelId, "candle-chart-public", cfg, p);

  const candles = useDerived(candlesQ.data, (data) => data?.candles ?? []);

  // Same timeframe-switch grace as the sensitive twin (see CandleChartWidget).
  const candlesPending = useCandlePending(
    `${cfg.instanceId}|${cfg.pair}|${cfg.timeframe}|${limit}`,
    candles.length >= 2,
    candlesQ.isLoading,
  );

  const state = queryState(
    candlesQ.error,
    candlesQ.isLoading || candlesPending,
  );

  const accessError = marketAccess.allowed
    ? null
    : `Not authorized — needs ${marketAccess.missing.join(", ")}`;

  // Opportunistic: anonymous grants lack `instances.config`, so public
  // pages usually fall back to the generic copy below.
  const strategyTf = useStrategyTimeframe(cfg.instanceId);

  const strategyFallback =
    strategyTf !== undefined &&
    strategyTf !== cfg.timeframe &&
    TIMEFRAME_ITEMS.some((t) => t.id === strategyTf)
      ? strategyTf
      : undefined;

  // Pair self-heal: futures exchanges whitelist `BTC/USDT:USDT` while spot
  // lists `BTC/USDT`. When the configured pair is not on the whitelist,
  // adopt its settled variant (else the same base) once, so the BTC/USDT
  // default is usable out of the box on either market type.
  useStoreEffect(() => {
    const whitelist = pairsQ.data?.pairs;

    if (!whitelist || whitelist.length === 0) return;

    if (whitelist.includes(cfg.pair)) return;
    const base = cfg.pair.split("/")[0] ?? cfg.pair;
    const settled = whitelist.find((p) => p === `${cfg.pair}:USDT`);
    const byBase = whitelist.find((p) => (p.split("/")[0] ?? "") === base);
    const next = settled ?? byBase;

    if (next) patch({ pair: next });
  }, [pairsQ.data, cfg.pair]);

  // Bars drive the indicator math and VWAP: dedupe by bar-time seconds
  // (keep the newest) so a duplicated candle from freqtrade cannot produce
  // duplicate-time indicator points either.
  const bars = useDerived(candles, (src): TvBar[] =>
    orderedByTime(
      src.map((c) => ({
        time: Math.floor(c.time / 1000),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
    ),
  );

  // Position history for THIS pair — one entry per open position, one
  // entry + one exit per closed position, from dates and percentages only
  // (the `.relative` payloads carry no amounts, prices, or order detail).
  const positionMarkers = useDerived(
    [
      openRelQ.data,
      closedRelQ.data,
      cfg.pair,
      bars,
      cfg.timeframe,
      cfg.showPositions,
      positionsAccess.allowed,
    ] as const,
    ([openData, closedData, pair, bars, timeframe, show, allowed]): TvTradeMarker[] => {
      if (!allowed || !show || bars.length === 0) return [];

      const tfSec = timeframeSeconds(timeframe);

      if (tfSec === null) return [];

      const secs = bars.map((b) => b.time);
      const events: PositionMarkerEvent[] = [];

      for (const p of openData?.positions ?? []) {
        if (p.pair !== pair) continue;
        const at = parsePositionTime(p.openDate);

        if (at === null) continue;
        events.push({
          timeMs: at,
          kind: "entry",
          text: positionDirection(p.isShort),
        });
      }

      for (const p of closedData?.positions ?? []) {
        if (p.pair !== pair) continue;
        const dir = positionDirection(p.isShort);
        const opened = parsePositionTime(p.openDate);

        if (opened !== null) events.push({ timeMs: opened, kind: "entry", text: dir });

        const closedAt =
          p.closeDate !== undefined ? parsePositionTime(p.closeDate) : null;

        if (closedAt !== null) {
          events.push({
            timeMs: closedAt,
            kind: "exit",
            text: positionExitText(p.isShort, p.closeProfitPct, p.profitPct),
          });
        }
      }

      if (events.length === 0) return [];

      return buildPositionHistoryMarkers(events, secs, tfSec).map((m) => ({
        time: utcSeconds(m.time),
        kind: m.kind,
        text: m.text,
      }));
    },
    { inputs: shallow },
  );

  // MACD histogram sentiment colors follow the color-blind safe setting
  // (declared before the subplot derivation that closes over it).
  const palette = candlePalette(useColorBlindSafe());

  const overlays = useDerived(
    [
      bars,
      cfg.showSma20,
      cfg.showSma50,
      cfg.showEma12,
      cfg.showBollinger,
      cfg.showVwap,
    ] as const,
    ([
      bars,
      showSma20,
      showSma50,
      showEma12,
      showBollinger,
      showVwap,
    ]): TvOverlayLine[] => {
      if (bars.length === 0) return [];
      const list: TvOverlayLine[] = [];

      if (showSma20) {
        list.push({
          name: "SMA 20",
          color: "#ffab00",
          data: toLineData(SMA.calculate(bars, { len: 20 }).plots.plot0),
        });
      }

      if (showSma50) {
        list.push({
          name: "SMA 50",
          color: "#3ddbd9",
          data: toLineData(SMA.calculate(bars, { len: 50 }).plots.plot0),
        });
      }

      if (showEma12) {
        list.push({
          name: "EMA 12",
          color: "#ff7eb6",
          data: toLineData(EMA.calculate(bars, { length: 12 }).plots.plot0),
        });
      }

      if (showBollinger) {
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

      if (showVwap) {
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
    },
    { inputs: shallow },
  );

  const rsiPlots = useDerived(
    [bars, cfg.subplot] as const,
    ([bars, subplot]) =>
      bars.length > 0 && subplot === "rsi"
        ? RSI.calculate(bars, { length: 14 }).plots.plot0
        : [],
    { inputs: shallow },
  );

  const macdPlots = useDerived(
    [bars, cfg.subplot] as const,
    ([bars, subplot]) =>
      bars.length > 0 && subplot === "macd"
        ? MACD.calculate(bars, {
            fastLength: 12,
            slowLength: 26,
            signalLength: 9,
          }).plots
        : null,
    { inputs: shallow },
  );

  const subplot = useDerived(
    [cfg.subplot, rsiPlots, macdPlots, palette] as const,
    ([subplot, rsiPlots, macdPlots, pal]): TvSubplot | null => {
      if (subplot === "none") return null;

      if (subplot === "rsi") {
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
            time: utcSeconds(p.time),
            value: p.value,
            color: p.value >= 0 ? pal.histUp : pal.histDown,
          });
        }
      }

      return {
        lines: [
          {
            name: "MACD",
            color: "#ff7eb6",
            data: toLineData(macdPlots?.plot0),
          },
          {
            name: "Signal",
            color: "#ffab00",
            data: toLineData(macdPlots?.plot1),
          },
        ],
        histogram,
        levels: [{ price: 0, title: "0" }],
      };
    },
    { inputs: shallow },
  );

  const lastRsi = cfg.subplot === "rsi" ? lastPlotValue(rsiPlots) : null;
  const narrow = useNarrowMode(420);
  const availablePairs = pairsQ.data?.pairs ?? [];

  // Window stats for the toolbar quote strip (over deduped, sorted
  // bars) — derived single pass so resize re-renders don't rescan up to
  // 1000 bars per frame.
  const windowStats = useDerived(bars, (src) => {
    const lastBar = src[src.length - 1];
    const prevBar = src[src.length - 2];

    const lastClose =
      lastBar && Number.isFinite(lastBar.close) ? lastBar.close : null;

    let windowHigh: number | null = null;
    let windowLow: number | null = null;
    let windowVolume = 0;

    for (const b of src) {
      if (windowHigh === null || b.high > windowHigh) windowHigh = b.high;

      if (windowLow === null || b.low < windowLow) windowLow = b.low;
      windowVolume += b.volume ?? 0;
    }

    return {
      lastClose,
      windowChange:
        lastClose !== null &&
        prevBar !== undefined &&
        prevBar.close !== 0 &&
        Number.isFinite(prevBar.close)
          ? ((lastClose - prevBar.close) / Math.abs(prevBar.close)) * 100
          : 0,
      windowHigh,
      windowLow,
      windowVolume,
      chartPrecision:
        lastClose === null || lastClose <= 0
          ? 4
          : lastClose >= 100
            ? 2
            : lastClose >= 1
              ? 4
              : 6,
    };
  });

  const {
    lastClose,
    windowChange,
    windowHigh,
    windowLow,
    windowVolume,
    chartPrecision,
  } = windowStats;

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Public candle chart settings"
        widgetType="candle-chart-public"
      >
        <InstanceSelect
          id={`pub-candle-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
        />
        <PairCombobox
          id={`pub-candle-pair-${panelId}`}
          label="Pair"
          value={cfg.pair}
          pairs={availablePairs}
          onChange={(pair) => patch({ pair })}
        />
        <SettingsSelect
          id={`pub-candle-tf-${panelId}`}
          label="Timeframe"
          items={TIMEFRAME_ITEMS.map((i) => ({ ...i }))}
          value={cfg.timeframe}
          onChange={(id) =>
            patch({
              timeframe: Schema.decodeUnknownSync(PublicCandleTimeframe)(id),
            })
          }
        />
        <NumberInput
          id={`pub-candle-limit-${panelId}`}
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
        <div className="nfi-settings-toggles">
          <SettingsToggle
            id={`pub-candle-sma20-${panelId}`}
            label="SMA 20"
            toggled={cfg.showSma20}
            onToggle={(v) => patch({ showSma20: v })}
          />
          <SettingsToggle
            id={`pub-candle-sma50-${panelId}`}
            label="SMA 50"
            toggled={cfg.showSma50}
            onToggle={(v) => patch({ showSma50: v })}
          />
          <SettingsToggle
            id={`pub-candle-ema-${panelId}`}
            label="EMA 12"
            toggled={cfg.showEma12}
            onToggle={(v) => patch({ showEma12: v })}
          />
          <SettingsToggle
            id={`pub-candle-bb-${panelId}`}
            label="Bollinger"
            toggled={cfg.showBollinger}
            onToggle={(v) => patch({ showBollinger: v })}
          />
          <SettingsToggle
            id={`pub-candle-vwap-${panelId}`}
            label="VWAP"
            toggled={cfg.showVwap}
            onToggle={(v) => patch({ showVwap: v })}
          />
          <SettingsToggle
            id={`pub-candle-vol-${panelId}`}
            label="Volume"
            toggled={cfg.showVolume}
            onToggle={(v) => patch({ showVolume: v })}
          />
          <SettingsToggle
            id={`pub-candle-pos-${panelId}`}
            label="Position history"
            toggled={cfg.showPositions}
            onToggle={(v) => patch({ showPositions: v })}
          />
        </div>
        <SettingsSelect
          id={`pub-candle-sub-${panelId}`}
          label="Subplot"
          items={SUBPLOT_ITEMS.map((i) => ({ ...i }))}
          value={cfg.subplot}
          onChange={(id) =>
            patch({
              subplot: Schema.decodeUnknownSync(PublicCandleSubplot)(id),
            })
          }
        />
      </WidgetSettingsModal>
      <WidgetFrame
        title={`Candles · ${cfg.pair} · ${cfg.timeframe}`}
        isLoading={state.isLoading}
        error={accessError ?? state.error}
      >
        {candles.length >= 2 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.375rem",
              flex: "1 1 auto",
              minHeight: 0,
              minWidth: 0,
              width: "100%",
              maxWidth: "100%",
              overflow: "hidden",
            }}
          >
            <div className="nfi-candle-toolbar">
              {availablePairs.length > 0 ? (
                <span title={`${candles.length} candles loaded`}>
                  <PairCombobox
                    id={`pub-candle-pair-${panelId}`}
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
                    onClick={() => patch({ timeframe: tf.id })}
                    aria-pressed={cfg.timeframe === tf.id}
                    title={
                      tf.id === strategyTf
                        ? "Strategy timeframe — always has live candles"
                        : `Show ${tf.id} candles`
                    }
                  >
                    {tf.text}
                    {tf.id === strategyTf ? " ●" : ""}
                  </button>
                ))}
              </div>
              <div
                className="nfi-tf-group"
                role="group"
                aria-label="Indicators"
                title="Toggle indicator overlays"
              >
                {(
                  [
                    {
                      id: "sma20",
                      text: "SMA20",
                      active: cfg.showSma20,
                      onToggle: () => patch({ showSma20: !cfg.showSma20 }),
                    },
                    {
                      id: "sma50",
                      text: "SMA50",
                      active: cfg.showSma50,
                      onToggle: () => patch({ showSma50: !cfg.showSma50 }),
                    },
                    {
                      id: "ema12",
                      text: "EMA12",
                      active: cfg.showEma12,
                      onToggle: () => patch({ showEma12: !cfg.showEma12 }),
                    },
                    {
                      id: "bb",
                      text: "BB",
                      active: cfg.showBollinger,
                      onToggle: () =>
                        patch({ showBollinger: !cfg.showBollinger }),
                    },
                    {
                      id: "vwap",
                      text: "VWAP",
                      active: cfg.showVwap,
                      onToggle: () => patch({ showVwap: !cfg.showVwap }),
                    },
                    {
                      id: "vol",
                      text: "VOL",
                      active: cfg.showVolume,
                      onToggle: () => patch({ showVolume: !cfg.showVolume }),
                    },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={
                      t.active ? "nfi-tf-btn nfi-tf-active" : "nfi-tf-btn"
                    }
                    onClick={t.onToggle}
                    aria-pressed={t.active}
                    title={`Toggle ${t.text}`}
                  >
                    {t.text}
                  </button>
                ))}
              </div>
              <div
                className="nfi-tf-group"
                role="group"
                aria-label="Subplot"
                title="Toggle RSI/MACD subplot"
              >
                <button
                  type="button"
                  className={
                    cfg.subplot === "rsi"
                      ? "nfi-tf-btn nfi-tf-active"
                      : "nfi-tf-btn"
                  }
                  onClick={() =>
                    patch({ subplot: cfg.subplot === "rsi" ? "none" : "rsi" })
                  }
                  aria-pressed={cfg.subplot === "rsi"}
                  title="Toggle RSI subplot"
                >
                  RSI
                </button>
                <button
                  type="button"
                  className={
                    cfg.subplot === "macd"
                      ? "nfi-tf-btn nfi-tf-active"
                      : "nfi-tf-btn"
                  }
                  onClick={() =>
                    patch({
                      subplot: cfg.subplot === "macd" ? "none" : "macd",
                    })
                  }
                  aria-pressed={cfg.subplot === "macd"}
                  title="Toggle MACD subplot"
                >
                  MACD
                </button>
              </div>
              {positionsAccess.allowed ? (
                <div
                  className="nfi-tf-group"
                  role="group"
                  aria-label="Position history"
                  title="Toggle position-history markers (entries/exits, percentages only)"
                >
                  <button
                    type="button"
                    className={
                      cfg.showPositions
                        ? "nfi-tf-btn nfi-tf-active"
                        : "nfi-tf-btn"
                    }
                    onClick={() => patch({ showPositions: !cfg.showPositions })}
                    aria-pressed={cfg.showPositions}
                    title="Toggle position-history markers"
                  >
                    Positions
                  </button>
                </div>
              ) : null}
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
                {narrow ? null : (
                  <>
                    <span className="nfi-candle-range">
                      H{" "}
                      {windowHigh !== null
                        ? windowHigh.toFixed(chartPrecision)
                        : "—"}{" "}
                      L{" "}
                      {windowLow !== null
                        ? windowLow.toFixed(chartPrecision)
                        : "—"}
                    </span>
                    <span className="nfi-candle-range">
                      ΣV {fmtCompact(windowVolume)}
                    </span>
                  </>
                )}
                {lastRsi !== null && !narrow ? (
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
            <CandleChart
              candles={candles}
              overlays={overlays}
              showVolume={cfg.showVolume}
              subplot={subplot}
              tradeMarkers={positionMarkers}
            />
          </div>
        ) : (
          <EmptyState
            title="No candles"
            hint={
              strategyFallback !== undefined
                ? `Your bot analyzes ${strategyFallback} — ${cfg.timeframe} isn't analyzed for ${cfg.pair}, so there's no live chart for it.`
                : `Freqtrade has no analyzed data for ${cfg.pair} · ${cfg.timeframe} — the pair may be off the bot's whitelist or the timeframe unanalyzed. Pick a listed pair and the strategy timeframe in the tab's ⋯ menu.`
            }
          >
            {strategyFallback !== undefined ? (
              <Button
                size="sm"
                kind="tertiary"
                onClick={() => {
                  const next = TIMEFRAME_ITEMS.find(
                    (t) => t.id === strategyFallback,
                  );

                  if (next) patch({ timeframe: next.id });
                }}
              >
                Show {strategyFallback} instead
              </Button>
            ) : null}
          </EmptyState>
        )}
      </WidgetFrame>
    </>
  );
}

export const PublicCandleChartWidgetDef = defineWidget({
  type: "candle-chart-public",
  hasSettings: true,
  title: "Candle Chart (Public)",
  description:
    "Shareable OHLCV candlesticks with SMA/EMA/Bollinger overlays, volume, RSI/MACD and position-history markers (entries/exits with percentages only) — no amounts or order detail, safe for public pages.",
  configSchema: PublicCandleChartConfigSchema,
  defaultConfig: PUBLIC_CANDLE_CHART_DEFAULTS,
  component: PublicCandleChartWidget,
  capabilities: [...PUBLIC_CANDLE_CAPABILITIES],
  minWidth: 560,
  minHeight: 420,
  defaultWidth: 960,
  defaultHeight: 640,
});
