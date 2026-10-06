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
import { useWidgetConfigSink } from "./shared/sessionConfig";
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
  averageEntryPrice as computeAverageEntry,
  buildTradeMarkers,
  earliestEntrySecond,
  timeframeSeconds,
} from "./shared/tradeOverlay";

export const CANDLE_MARKET_CAPABILITY: Capability = "instances.candles";

export const CANDLE_INDICATORS_CAPABILITY: Capability = "instances.plot-config";

/** Open positions feed the avg-entry line + entry markers (gated). */
export const CANDLE_TRADES_CAPABILITY: Capability = "instances.open-positions";

/** Closed positions feed exit/derisk markers within the window (gated). */
export const CANDLE_CLOSED_CAPABILITY: Capability = "instances.closed-positions";

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
  /** Violet entry dots + amber exit arrows from the pair's sub-orders. */
  showTrades: booleanWithDefault(true),
  /** Blue dashed avg-entry line with green/red PnL fill. */
  showAvgEntry: booleanWithDefault(true),
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

  // Indicator libraries preserve the input bar time unit (seconds here —
  // `bars` are already `Math.floor(ms / 1000)`). Convert with `utcSeconds`
  // (identity for whole seconds), NOT `toSec` (ms → s) — the latter divided
  // twice and pinned every overlay to 1970 (see screenshot: SMA/VWAP/RSI
  // starting at 1970 while candles render at 2026).
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

  // `candles` here are `bars` (time already in seconds) — see `toLineData`.
  for (const c of candles) {
    const v = c.volume ?? 0;
    pv += ((c.high + c.low + c.close) / 3) * v;
    vol += v;

    if (vol > 0) out.push({ time: utcSeconds(c.time), value: pv / vol });
  }

  return out;
};

/** Header chip for the pair's open position(s): `11 @ 0.3456 (+2.10%)`. */
function PositionChip({
  positions,
  avgEntry,
  precision,
  compact,
}: {
  positions: ReadonlyArray<{ amount: number; profitPct?: number }>;
  avgEntry: number;
  precision: number;
  compact: boolean;
}) {
  const single = positions.length === 1 ? positions[0] : undefined;
  const pct = single?.profitPct;
  const hasPct = pct !== undefined && Number.isFinite(pct);

  if (compact && !hasPct) return null;

  const totalAmount = positions.reduce(
    (sum, p) => sum + (Number.isFinite(p.amount) ? p.amount : 0),
    0,
  );

  const title =
    positions.length === 1
      ? `Open position · avg entry ${avgEntry.toFixed(precision)}`
      : `${positions.length} open positions · avg entry ${avgEntry.toFixed(precision)}`;

  return (
    <span className="nfi-candle-range" title={title}>
      {compact ? null : (
        <>
          {fmtCompact(totalAmount)} @ {avgEntry.toFixed(precision)}{" "}
        </>
      )}
      {hasPct ? (
        <span
          className={pct >= 0 ? "nfi-pnl-positive" : "nfi-pnl-negative"}
        >
          ({pct >= 0 ? "+" : ""}
          {pct.toFixed(2)}%)
        </span>
      ) : null}
    </span>
  );
}

export function CandleChartWidget({
  config,
  panelId,
}: WidgetProps<CandleChartConfig>) {
  // Session-aware binding: patches persist for signed-in visitors and
  // fall back to a per-browser session layer when the panel sink refuses
  // writes (anonymous shared dashboards) — toolbar buttons always work.
  const { config: cfg, patch } = useWidgetConfigSink(
    panelId,
    "candle-chart",
    config,
  );

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

  // Trade overlay sources (gated: without these the chart renders without
  // markers — same pattern as the indicator lock above). Closed window is
  // capped at 200 trades; markers are further cut to the candle window.
  const tradesAccess = useWidgetAccess([
    CANDLE_TRADES_CAPABILITY,
    CANDLE_CLOSED_CAPABILITY,
  ]);

  const openPosQ = useCapability(
    "instances.open-positions",
    { id: cfg.instanceId },
    { enabled: tradesAccess.allowed },
  );

  const closedPosQ = useCapability(
    "instances.closed-positions",
    { id: cfg.instanceId, limit: "200" },
    { enabled: tradesAccess.allowed },
  );

  const showSettings = useWidgetSettingsOpen(panelId);

  const candles = useDerived(candlesQ.data, (data) => data?.candles ?? []);

  // Timeframe switches refetch while a cached EMPTY result would otherwise
  // flash "no analyzed data" with no loader — hold loading through a short
  // grace so long analyses read as loading.
  const candlesPending = useCandlePending(
    `${cfg.instanceId}|${cfg.pair}|${cfg.timeframe}|${limit}`,
    candles.length >= 2,
    candlesQ.isLoading,
  );

  const state = queryState(
    candlesQ.error,
    candlesQ.isLoading || candlesPending,
  );

  const marketError = market.allowed
    ? null
    : `Not authorized — needs ${market.missing.join(", ")}`;

  // Strategy timeframe (when the grant allows reading it): the only
  // timeframe guaranteed to have live candles. Names the recovery button
  // below and marks the button row — never gates rendering by itself.
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

  // Open positions for THIS pair — the avg-entry line and the header chip.
  const pairOpen = useDerived(
    [openPosQ.data, cfg.pair] as const,
    ([data, pair]) => (data?.positions ?? []).filter((p) => p.pair === pair),
    { inputs: shallow },
  );

  // Closed positions for THIS pair — exit/derisk markers in the window.
  const pairClosed = useDerived(
    [closedPosQ.data, cfg.pair] as const,
    ([data, pair]) => (data?.positions ?? []).filter((p) => p.pair === pair),
    { inputs: shallow },
  );

  // Stake-weighted avg entry (null = no open position → no line/fill).
  const avgEntry = useDerived(
    [pairOpen, cfg.showAvgEntry, tradesAccess.allowed] as const,
    ([open, show, allowed]): number | null => {
      if (!allowed || !show || open.length === 0) return null;

      return computeAverageEntry(
        open.map((p) => ({
          openRate: p.openRate,
          stakeAmount: p.stakeAmount,
        })),
      );
    },
    { inputs: shallow },
  );

  // Short direction for the PnL fill (same as position-candle twins).
  const followedIsShort = useDerived(
    [pairOpen] as const,
    ([open]): boolean =>
      open.length > 0 && open.every((p) => p.isShort === true),
    { inputs: shallow },
  );

  // Entry-anchored fill start, snapped to the candle bucket.
  const entrySince = useDerived(
    [pairOpen, cfg.timeframe] as const,
    ([open, timeframe]): number | null => {
      const at = earliestEntrySecond(open);

      if (at === null) return null;

      const tfSec = timeframeSeconds(timeframe);

      if (tfSec === null) return at;

      return Math.floor(at / tfSec) * tfSec;
    },
    { inputs: shallow },
  );

  // Sub-orders → chart markers, snapped to the visible candle buckets.
  const candleSecs = useDerived(
    bars,
    (src): number[] => src.map((b) => b.time),
  );

  // MACD histogram sentiment colors follow the color-blind safe setting
  // (declared before the subplot derivation that closes over it).
  const palette = candlePalette(useColorBlindSafe());

  const pairOrders = useDerived(
    [pairOpen, pairClosed] as const,
    ([open, closed]) => [
      ...open.flatMap((p) => p.orders ?? []),
      ...closed.flatMap((p) => p.orders ?? []),
    ],
    { inputs: shallow },
  );

  const tradeMarkers = useDerived(
    [pairOrders, candleSecs, cfg.timeframe, cfg.showTrades, tradesAccess.allowed] as const,
    ([orders, secs, timeframe, show, allowed]): TvTradeMarker[] => {
      if (!allowed || !show || orders.length === 0 || secs.length === 0)
        return [];
      const tfSec = timeframeSeconds(timeframe);

      if (tfSec === null) return [];

      return buildTradeMarkers(orders, secs, tfSec).map((m) => ({
        time: utcSeconds(m.time),
        kind: m.kind,
        text: m.text,
      }));
    },
    { inputs: shallow },
  );

  const overlays = useDerived(
    [
      bars,
      cfg.showSma20,
      cfg.showSma50,
      cfg.showEma12,
      cfg.showBollinger,
      cfg.showVwap,
      indicatorsAccess.allowed,
    ] as const,
    ([
      bars,
      showSma20,
      showSma50,
      showEma12,
      showBollinger,
      showVwap,
      allowed,
    ]): TvOverlayLine[] => {
      if (!allowed || bars.length === 0) return [];
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
    [bars, cfg.subplot, indicatorsAccess.allowed] as const,
    ([bars, subplot, allowed]) =>
      allowed && bars.length > 0 && subplot === "rsi"
        ? RSI.calculate(bars, { length: 14 }).plots.plot0
        : [],
    { inputs: shallow },
  );

  const macdPlots = useDerived(
    [bars, cfg.subplot, indicatorsAccess.allowed] as const,
    ([bars, subplot, allowed]) =>
      allowed && bars.length > 0 && subplot === "macd"
        ? MACD.calculate(bars, {
            fastLength: 12,
            slowLength: 26,
            signalLength: 9,
          }).plots
        : null,
    { inputs: shallow },
  );

  const subplot = useDerived(
    [cfg.subplot, indicatorsAccess.allowed, rsiPlots, macdPlots, palette] as const,
    ([subplot, allowed, rsiPlots, macdPlots, pal]): TvSubplot | null => {
      if (!allowed || subplot === "none") return null;

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
  const strategyPlots = plotQ.data;

  // Exchange-sourced candles (the backend's fallback for timeframes the
  // bot never analyzed) — labelled so bot analysis vs raw market data is
  // never confused.
  const isMarketData = candlesQ.data?.source === "exchange";

  const strategyHints = strategyPlots
    ? [
        ...strategyPlots.mainPlot,
        ...Object.entries(strategyPlots.subplots).flatMap(([name, inds]) =>
          inds.map((i) => `${name}:${i}`),
        ),
      ]
    : [];

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
          onChange={(id) =>
            patch({ timeframe: Schema.decodeUnknownSync(CandleTimeframe)(id) })
          }
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
            <div className="nfi-settings-toggles">
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
              <SettingsToggle
                id={`candle-trades-${panelId}`}
                label="Trade markers"
                toggled={cfg.showTrades}
                onToggle={(v) => patch({ showTrades: v })}
              />
              <SettingsToggle
                id={`candle-avgent-${panelId}`}
                label="Avg entry + PnL"
                toggled={cfg.showAvgEntry}
                onToggle={(v) => patch({ showAvgEntry: v })}
              />
            </div>
            <SettingsSelect
              id={`candle-sub-${panelId}`}
              label="Subplot"
              items={SUBPLOT_ITEMS.map((i) => ({ ...i }))}
              value={cfg.subplot}
              onChange={(id) =>
                patch({ subplot: Schema.decodeUnknownSync(CandleSubplot)(id) })
              }
            />
          </>
        ) : (
          <p
            style={{ fontSize: "0.8125rem", color: "var(--cds-support-error)" }}
          >
            Indicators locked — needs {indicatorsAccess.missing.join(", ")}.
          </p>
        )}
        {!tradesAccess.allowed ? (
          <p
            style={{ fontSize: "0.8125rem", color: "var(--cds-support-error)" }}
          >
            Trade overlay locked — needs {tradesAccess.missing.join(", ")}.
          </p>
        ) : null}
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
              {isMarketData ? (
                <span
                  className="nfi-candle-range"
                  title={`Exchange market data — ${cfg.timeframe} isn't analyzed by this bot, so candles come straight from the exchange`}
                >
                  market
                </span>
              ) : null}
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
              {indicatorsAccess.allowed ? (
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
              ) : null}
              {indicatorsAccess.allowed ? (
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
              ) : null}
              {tradesAccess.allowed ? (
                <div
                  className="nfi-tf-group"
                  role="group"
                  aria-label="Position history"
                  title="Toggle trade markers and avg-entry line"
                >
                  <button
                    type="button"
                    className={
                      cfg.showTrades
                        ? "nfi-tf-btn nfi-tf-active"
                        : "nfi-tf-btn"
                    }
                    onClick={() => patch({ showTrades: !cfg.showTrades })}
                    aria-pressed={cfg.showTrades}
                    title="Toggle trade markers (entries/exits)"
                  >
                    Trades
                  </button>
                  <button
                    type="button"
                    className={
                      cfg.showAvgEntry
                        ? "nfi-tf-btn nfi-tf-active"
                        : "nfi-tf-btn"
                    }
                    onClick={() => patch({ showAvgEntry: !cfg.showAvgEntry })}
                    aria-pressed={cfg.showAvgEntry}
                    title="Toggle avg-entry line with PnL shading"
                  >
                    Avg
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
                {tradesAccess.allowed &&
                pairOpen.length > 0 &&
                avgEntry !== null ? (
                  <PositionChip
                    positions={pairOpen}
                    avgEntry={avgEntry}
                    precision={chartPrecision}
                    compact={narrow}
                  />
                ) : null}
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
            {strategyHints.length > 0 && !narrow ? (
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
              tradeMarkers={tradeMarkers}
              avgEntryPrice={avgEntry}
              avgEntryIsShort={followedIsShort}
              avgEntrySince={entrySince}
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

export const CandleChartWidgetDef = defineWidget({
  type: "candle-chart",
  hasSettings: true,
  title: "Candle Chart",
  description:
    "OHLCV candlesticks with SMA/EMA/Bollinger overlays, volume and RSI/MACD — plus trade markers, avg-entry line and PnL shading.",
  configSchema: CandleChartConfigSchema,
  defaultConfig: CANDLE_CHART_DEFAULTS,
  component: CandleChartWidget,
  capabilities: [
    CANDLE_MARKET_CAPABILITY,
    CANDLE_INDICATORS_CAPABILITY,
    CANDLE_TRADES_CAPABILITY,
    CANDLE_CLOSED_CAPABILITY,
  ],
  minWidth: 640,
  minHeight: 480,
  defaultWidth: 960,
  defaultHeight: 640,
});
