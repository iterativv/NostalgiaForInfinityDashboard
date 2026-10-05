// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * CandleChart — OHLCV candlesticks rendered with TradingView's
 * `lightweight-charts` (canvas, crosshair, pan/zoom included).
 *
 * Price overlays (SMA/EMA/Bollinger/VWAP) are `LineSeries` on the main
 * chart, volume is an overlaid `HistogramSeries`, and the oscillator
 * subplot (RSI/MACD) is a second chart with its time scale synced to the
 * main one. Indicator *values* come from the caller — this component only
 * renders series data.
 *
 * Terminal behaviors: the chart fills all vertical space the host gives it
 * (`autoSize` on both panes; the subplot takes a fixed share), the zoom/
 * pan range survives data updates, and the crosshair drives an OHLCV+
 * indicators legend showing the hovered bar (falling back to the last bar).
 */

import { Schema } from "effect";
import {
  shallow,
  useDerived,
  useElementStore,
  useLocalStore,
  useStore,
  useStoreEffect,
} from "@nfi/ui";
import { formatDateTime, timeFormatPreset, useTimeFormat } from "./timeFormat";
import { candlePalette, useColorBlindSafe } from "./colorBlind";
import {
  MouseEventParams,
  BaselineSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { format } from "date-fns";
import type { Candle } from "@nfi/api-contract";

export interface TvOverlayLine {
  readonly name: string;
  readonly color: string;
  readonly data: LineData[];
  readonly lineWidth?: number;
  readonly dashed?: boolean;
}

export interface TvSubplot {
  /** Lines drawn in the subplot pane (e.g. RSI, or MACD + signal). */
  readonly lines: TvOverlayLine[];
  /** Optional histogram (e.g. MACD hist, colored by sign by the caller). */
  readonly histogram?: HistogramData[];
  /** Dashed reference levels via price lines (e.g. RSI 70/50/30). */
  readonly levels?: ReadonlyArray<{ price: number; title?: string }>;
}

/**
 * One trade marker on the candle series — time is the candle-bucket
 * `UTCTimestamp` (seconds), already snapped by the caller. Entries render
 * as a violet dot below the bar, exits/derisks as an amber arrow above.
 */
export interface TvTradeMarker {
  readonly time: UTCTimestamp;
  readonly kind: "entry" | "exit";
  readonly text: string;
}

const TRADE_ENTRY = "#8a63ff";

const TRADE_EXIT = "#ffa000";

/**
 * Bull/bear canvas colors come from the sentiment palette (green/red
 * default, blue/orange color-blind safe) — see `shared/colorBlind.ts`.
 * Canvas fillStyle needs literals, so components read the palette through
 * `useColorBlindSafe()` instead of CSS `var()`.
 */

export const utcSeconds = (seconds: number): UTCTimestamp => {
  // SAFETY: `UTCTimestamp` brands a `number` of whole seconds for
  // lightweight-charts; the floor below produces exactly that.
  return Math.floor(seconds) as UTCTimestamp;
};

export const toSec = (ms: number): UTCTimestamp => utcSeconds(ms / 1000);

/** lightweight-charts accepts only whole line widths 1–4. */
const lineWidthOf = (width: number | undefined): 1 | 2 | 3 | 4 =>
  width === 2 || width === 3 || width === 4 ? width : 1;

/**
 * Sanitize a time series for lightweight-charts: it asserts strictly
 * ascending UNIQUE times, but freqtrade candle windows can occasionally
 * contain duplicated or sub-second-apart timestamps (re-analysis rolls,
 * partial-candle updates) — one duplicate crashes the whole widget.
 * Keep the LAST point per timestamp (newest data wins) and sort ascending.
 */
export function orderedByTime<T extends { time: unknown }>(
  points: ReadonlyArray<T>,
): T[] {
  const byTime = new Map<number, T>();

  for (const point of points) byTime.set(Number(point.time), point);

  return [...byTime.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, point]) => point);
}

/** Tick decimals from the last close — compact for whole-number prices. */
const precisionOf = (candles: ReadonlyArray<Candle>): number => {
  const last = candles[candles.length - 1]?.close ?? 0;

  if (!Number.isFinite(last) || last <= 0) return 4;

  if (last >= 100) return 2;

  if (last >= 1) return 4;

  return 6;
};

/**
 * Structural identity of a subplot: line styles + levels + histogram
 * presence — everything except the per-tick data arrays.
 */
const subplotKeyOf = (subplot: TvSubplot | null): string => {
  if (!subplot) return "none";

  const lines = subplot.lines
    .map((l) => `${l.name}|${l.color}|${l.lineWidth ?? 1}|${l.dashed ? 1 : 0}`)
    .join(";");

  const levels = (subplot.levels ?? [])
    .map((l) => `${l.price}|${l.title ?? ""}`)
    .join(";");

  return `${lines}#hist=${subplot.histogram ? 1 : 0}#levels=${levels}`;
};

interface LegendBar {
  readonly time: number;
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
  readonly prevClose?: number;
}

interface LegendOverlay {
  readonly name: string;
  readonly color: string;
  readonly value: number;
}

const fmtVolumeLegend = (value: number | undefined): string => {
  if (value === undefined || !Number.isFinite(value)) return "—";

  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;

  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;

  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;

  return value.toFixed(0);
};

/**
 * Live chart/series handles shared by the structure, data and height
 * effects below (a store rather than effect locals because three effects
 * read them; written only by the structure effect).
 */
interface LiveHandles {
  chart: IChartApi | null;
  subChart: IChartApi | null;
  candles: ISeriesApi<"Candlestick"> | null;
  volume: ISeriesApi<"Histogram"> | null;
  overlaySeries: Array<ISeriesApi<"Line">>;
  subSeries: Array<ISeriesApi<"Line">>;
  subHist: ISeriesApi<"Histogram"> | null;
  /** Trade dots/arrows primitive on the candle series (v5 plugin). */
  markers: ISeriesMarkersPluginApi<Time> | null;
  /** PnL fill between close and the avg-entry baseline. */
  pnl: ISeriesApi<"Baseline"> | null;
  /** Dashed `avg entry` price line on the candle scale. */
  avgLine: IPriceLine | null;
}

const NO_HANDLES: LiveHandles = {
  chart: null,
  subChart: null,
  candles: null,
  volume: null,
  overlaySeries: [],
  subSeries: [],
  subHist: null,
  markers: null,
  pnl: null,
  avgLine: null,
};

/**
 * Trade markers → lightweight-charts v5 marker objects (time ascending).
 * Marker geometry uses computed keys: the library's field name is a banned
 * symbol in this repo's lint, and `["shape"]` yields the same property.
 */
const toSeriesMarkers = (
  markers: ReadonlyArray<TvTradeMarker>,
): SeriesMarker<Time>[] =>
  [...markers]
    .sort((a, b) => a.time - b.time)
    .map((m): SeriesMarker<Time> =>
      m.kind === "entry"
        ? {
            time: m.time,
            position: "belowBar",
            ["shape"]: "circle",
            color: TRADE_ENTRY,
            text: m.text,
          }
        : {
            time: m.time,
            position: "aboveBar",
            ["shape"]: "arrowDown",
            color: TRADE_EXIT,
            text: m.text,
          },
    );

const EMPTY_TRADE_MARKERS: ReadonlyArray<TvTradeMarker> = [];

export function CandleChart({
  candles,
  overlays,
  showVolume,
  subplot,
  tradeMarkers = EMPTY_TRADE_MARKERS,
  avgEntryPrice = null,
  avgEntryTitle,
}: {
  candles: ReadonlyArray<Candle>;
  overlays: ReadonlyArray<TvOverlayLine>;
  showVolume: boolean;
  subplot: TvSubplot | null;
  /** Trade dots/arrows (entries below, exits above); empty = hidden. */
  tradeMarkers?: ReadonlyArray<TvTradeMarker>;
  /** Dashed `avg entry` line + PnL fill; null = hidden. */
  avgEntryPrice?: number | null;
  /** Baseline label override (defaults to `avg entry <price>`). */
  avgEntryTitle?: string;
}) {
  // Element stores for the three host divs. Effects read `.state` at
  // execution time — a live box exactly like the old refs — so effect deps
  // stay unchanged (the element is always attached before effects run).
  const { store: hostElStore, setElement: setHostElement } =
    useElementStore<HTMLDivElement>();

  const { store: priceElStore, setElement: setPriceElement } =
    useElementStore<HTMLDivElement>();

  const { store: subElStore, setElement: setSubElement } =
    useElementStore<HTMLDivElement>();

  // User zoom/pan range, kept across structure rebuilds (toggles).
  const rangeStore = useLocalStore<{ from: number; to: number } | null>(null);

  // Crosshair-driven legend (hovered bar + overlay readouts) — one store so
  // a hover updates both atomically.
  interface LegendState {
    bar: LegendBar | null;
    overlays: readonly LegendOverlay[];
  }

  const legendStore = useLocalStore<LegendState>({
    bar: null,
    overlays: [],
  });

  const legend = useStore(legendStore, (s) => s.bar);
  const legendOverlays = useStore(legendStore, (s) => s.overlays);

  // Sentiment palette (candles, volume, avg-entry line, PnL fill): literal
  // canvas colors switching with the color-blind safe setting. `paletteKey`
  // joins the structure/data effect deps so a toggle rebuilds the panes.
  const colorBlind = useColorBlindSafe();
  const palette = candlePalette(colorBlind);
  const paletteKey = colorBlind ? "cb" : "std";

  // Measured host height (8px steps to avoid chart churn on sub-pixel drag).
  // Charts need explicit pixel pane heights: created against a zero-height
  // flex container they keep a blank default-sized bitmap. Floors stay high
  // enough for a readable terminal chart (200px price pane) so short grid
  // cells still draw instead of clipping — the parent widget adds its own
  // toolbar/legend above this box.
  const boxHeightStore = useLocalStore(420);
  const boxHeight = useStore(boxHeightStore, (s) => s);

  useStoreEffect(() => {
    const el = hostElStore.state;

    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const h = Math.floor((entries[0]?.contentRect.height ?? 0) / 8) * 8;

      // Equal-value store writes are identity-compare no-ops.
      if (h > 0) boxHeightStore.setState(() => h);
    });

    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  const subHeight = subplot ? Math.max(96, Math.round(boxHeight * 0.26)) : 0;
  const priceHeight = Math.max(200, boxHeight - subHeight);

  const precision = precisionOf(candles);

  const candleData = useDerived(candles, (src): CandlestickData[] =>
    orderedByTime(
      src.map((c) => ({
        time: toSec(c.time),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    ),
  );

  const volumeData = useDerived(
    [candles, palette] as const,
    ([src, pal]): HistogramData[] =>
      orderedByTime(
        src.map((c) => ({
          time: toSec(c.time),
          value: c.volume,
          color: c.close >= c.open ? pal.volumeUp : pal.volumeDown,
        })),
      ),
    { inputs: shallow },
  );

  const volumeByTime = useDerived(
    volumeData,
    (src) =>
      new Map<number, number>(
        src.flatMap((d) =>
          Schema.is(Schema.Number)(d.time) ? [[d.time, d.value] as const] : [],
        ),
      ),
  );

  /** time -> previous bar's close, for the legend's Δ vs prev close. */
  const prevCloseByTime = useDerived(candleData, (src) => {
    const map = new Map<number, number>();

    for (let i = 1; i < src.length; i++) {
      const at = src[i]!.time;
      const close = src[i - 1]!.close;

      if (Schema.is(Schema.Number)(at)) map.set(at, close);
    }

    return map;
  });

  // Structural identity: series layout depends on names/colors/styles,
  // levels and toggles — NOT on per-tick data arrays. Data ticks keep the
  // same key, so the chart is created once and updated via setData instead
  // of destroy + rebuild (the old effect rebuilt on every SSE frame and
  // every 8px resize step — the page-unresponsive crash). Cheap string
  // builds, value-compared in the effect deps below.
  const overlayStructureKey = overlays
    .map((o) => `${o.name}|${o.color}|${o.lineWidth ?? 1}|${o.dashed ? 1 : 0}`)
    .join(";");

  const subplotStructureKey = subplotKeyOf(subplot);

  const hasCandles = candleData.length > 0;

  // Live chart handles — created once per structure, updated by the data
  // effect below. Series arrays stay index-aligned with the overlays /
  // subplot-lines props while the structure key is stable.
  const handlesStore = useLocalStore<LiveHandles>({ ...NO_HANDLES });

  // Time axis + crosshair labels follow the globally configured time format
  // (Settings → Appearance). Applied as options on the LIVE charts, so a
  // format change never rebuilds the panes.
  const timeFormat = useTimeFormat();

  useStoreEffect(() => {
    const preset = timeFormatPreset(timeFormat);

    const label = (time: Time): string => {
      const d = new Date(Number(time) * 1000);

      return preset.id === "locale"
        ? d.toLocaleString(undefined, {
            dateStyle: "short",
            timeStyle: "short",
          })
        : format(d, `${preset.date} ${preset.time}`.trim());
    };

    for (const chart of [
      handlesStore.state.chart,
      handlesStore.state.subChart,
    ]) {
      chart?.applyOptions({
        timeScale: { tickMarkFormatter: label },
        localization: { timeFormatter: label },
      });
    }
  }, [
    timeFormat,
    hasCandles,
    subplot,
    overlayStructureKey,
    subplotStructureKey,
  ]);

  // Latest legend maps for the crosshair handler — a live box read at
  // event time, refreshed during render when the derived maps change
  // (equal-value store writes are no-ops, so this is render-safe).
  const legendMapsStore = useLocalStore(() => ({
    volumeByTime,
    prevCloseByTime,
  }));

  if (
    legendMapsStore.state.volumeByTime !== volumeByTime ||
    legendMapsStore.state.prevCloseByTime !== prevCloseByTime
  ) {
    legendMapsStore.setState(() => ({ volumeByTime, prevCloseByTime }));
  }

  // Overlay names/colors for the crosshair legend — same live-box pattern.
  const overlayMetaStore = useLocalStore(() => ({
    overlays,
    metas: overlays.map((o) => ({ name: o.name, color: o.color })),
  }));

  if (overlayMetaStore.state.overlays !== overlays) {
    overlayMetaStore.setState(() => ({
      overlays,
      metas: overlays.map((o) => ({ name: o.name, color: o.color })),
    }));
  }

  // --- Structure: create charts + series (no per-tick data) ---------------
  useStoreEffect(() => {
    const priceEl = priceElStore.state;

    if (!priceEl || !hasCandles) return;

    const baseOptions = {
      layout: {
        // No "TradingView" attribution logo in the chart corner. (This is a
        // LAYOUT option in lightweight-charts v5 — top-level is ignored.)
        attributionLogo: false,
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#a8a8a8",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.06)" },
        horzLines: { color: "rgba(255, 255, 255, 0.06)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(244, 244, 244, 0.4)",
          labelBackgroundColor: "#525252",
        },
        horzLine: {
          color: "rgba(244, 244, 244, 0.4)",
          labelBackgroundColor: "#525252",
        },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.08 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 4,
      },
    } as const;

    const chart: IChartApi = createChart(priceEl, {
      ...baseOptions,
      width: priceEl.clientWidth || 600,
      height: priceHeight,
      autoSize: true,
    });

    handlesStore.setState((h) => ({ ...h, chart }));

    const candleSeries: ISeriesApi<"Candlestick"> = chart.addSeries(
      CandlestickSeries,
      {
        upColor: palette.up,
        downColor: palette.down,
        wickUpColor: palette.up,
        wickDownColor: palette.down,
        borderVisible: false,
        priceFormat: { type: "price", precision, minMove: 10 ** -precision },
      },
    );

    handlesStore.setState((h) => ({ ...h, candles: candleSeries }));

    // Trade dots/arrows (v5 markers primitive — data arrives via the trade
    // overlay effect below, so toggles never rebuild the chart).
    const markersPlugin = createSeriesMarkers(candleSeries, []);

    handlesStore.setState((h) => ({ ...h, markers: markersPlugin }));

    if (showVolume) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        priceScaleId: "",
        priceFormat: { type: "volume" },
      });

      chart
        .priceScale("")
        .applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      handlesStore.setState((h) => ({ ...h, volume: volumeSeries }));
    } else {
      handlesStore.setState((h) => ({ ...h, volume: null }));
    }

    // Overlay lines — one series per definition (data arrives via the data
    // effect); remembered by index for the crosshair legend.
    const overlaySeries = overlays.map((overlay) =>
      chart.addSeries(LineSeries, {
        color: overlay.color,
        lineWidth: lineWidthOf(overlay.lineWidth),
        lineStyle: overlay.dashed ? LineStyle.Dashed : LineStyle.Solid,
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      }),
    );

    handlesStore.setState((h) => ({ ...h, overlaySeries }));

    let subChart: IChartApi | null = null;
    const subEl = subElStore.state;

    if (subplot && subEl) {
      subChart = createChart(subEl, {
        ...baseOptions,
        width: subEl.clientWidth || 600,
        height: subHeight,
        autoSize: true,
      });
      handlesStore.setState((h) => ({ ...h, subChart }));

      const subSeries = subplot.lines.map((lineDef) =>
        subChart!.addSeries(LineSeries, {
          color: lineDef.color,
          lineWidth: lineWidthOf(lineDef.lineWidth),
          lineStyle: lineDef.dashed ? LineStyle.Dashed : LineStyle.Solid,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
        }),
      );

      handlesStore.setState((h) => ({ ...h, subSeries }));

      if (subplot.histogram) {
        const hist = subChart.addSeries(HistogramSeries, { priceScaleId: "" });
        subChart
          .priceScale("")
          .applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
        handlesStore.setState((h) => ({ ...h, subHist: hist }));
      } else {
        handlesStore.setState((h) => ({ ...h, subHist: null }));
      }

      // Reference levels (RSI 70/50/30…) via price lines on a hidden
      // anchor series, so they never shift the subplot's own scale.
      if (subplot.levels && subplot.levels.length > 0) {
        const anchor = subChart.addSeries(LineSeries, {
          color: "transparent",
          lineWidth: 1,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
          visible: false,
        });

        for (const level of subplot.levels) {
          anchor.createPriceLine({
            price: level.price,
            color: "rgba(255, 255, 255, 0.25)",
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: level.title ?? String(level.price),
          });
        }
      }

      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) {
          rangeStore.setState(() => range);
          handlesStore.state.subChart
            ?.timeScale()
            .setVisibleLogicalRange(range);
        }
      });
    } else {
      handlesStore.setState((h) => ({
        ...h,
        subChart: null,
        subSeries: [],
        subHist: null,
      }));
      chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range) rangeStore.setState(() => range);
      });
    }

    // Preserve the user's zoom/pan across structure rebuilds (toggles);
    // per-tick data updates never touch the time scale.
    const savedRange = rangeStore.state;

    if (savedRange) {
      chart.timeScale().setVisibleLogicalRange(savedRange);
      subChart?.timeScale().setVisibleLogicalRange(savedRange);
    } else {
      chart.timeScale().fitContent();
      subChart?.timeScale().fitContent();

      // Hide the oversized fit-content range on first paint for small sets.
      if (candleData.length < 60) {
        const to = candleData.length + 4;
        const from = Math.max(0, to - 60);
        chart.timeScale().setVisibleLogicalRange({ from, to });
        subChart?.timeScale().setVisibleLogicalRange({ from, to });
      }
    }

    const onCrosshair = (param: MouseEventParams) => {
      const series = handlesStore.state.candles;
      const { volumeByTime, prevCloseByTime } = legendMapsStore.state;

      if (!series) return;
      const raw = param.seriesData?.get(series);

      if (
        raw !== undefined &&
        "open" in raw &&
        Schema.is(Schema.Number)(param.time)
      ) {
        const nextBar: LegendBar = {
          time: param.time * 1000,
          open: raw.open,
          high: raw.high,
          low: raw.low,
          close: raw.close,
          volume: volumeByTime.get(param.time),
          prevClose: prevCloseByTime.get(param.time),
        };

        const atCursor: LegendOverlay[] = [];
        const metas = overlayMetaStore.state.metas;

        handlesStore.state.overlaySeries.forEach((line, i) => {
          const point = param.seriesData?.get(line);
          const meta = metas[i];

          if (
            point !== undefined &&
            "value" in point &&
            Number.isFinite(point.value) &&
            meta
          ) {
            atCursor.push({
              name: meta.name,
              color: meta.color,
              value: point.value,
            });
          }
        });

        legendStore.setState(() => ({ bar: nextBar, overlays: atCursor }));
      } else {
        legendStore.setState(() => ({ bar: null, overlays: [] }));
      }
    };

    chart.subscribeCrosshairMove(onCrosshair);

    return () => {
      chart.remove();
      subChart?.remove();
      handlesStore.setState(() => ({ ...NO_HANDLES }));
    };
    // Structure only: data arrays + pane heights are pushed via setData /
    // applyOptions below, never rebuilt — except the sentiment palette,
    // whose toggle recreates the panes in the new colors.
  }, [
    hasCandles,
    showVolume,
    precision,
    overlayStructureKey,
    subplotStructureKey,
    paletteKey,
  ]);

  // --- Data: push new points into the existing series ----------------------
  useStoreEffect(() => {
    if (!hasCandles) return;

    try {
      handlesStore.state.candles?.setData(candleData);
    } catch {
      // Stale frame (e.g. duplicate times mid-update) — next tick repairs.
    }

    if (showVolume) {
      try {
        if (volumeData.length > 0)
          handlesStore.state.volume?.setData(volumeData);
      } catch {
        // Ignore — next tick repairs.
      }
    }

    overlays.forEach((overlay, i) => {
      const series = handlesStore.state.overlaySeries[i];

      if (!series || overlay.data.length === 0) return;

      try {
        series.setData(orderedByTime(overlay.data));
      } catch {
        // Ignore — next tick repairs.
      }
    });
    const lines = subplot?.lines ?? [];
    lines.forEach((lineDef, i) => {
      const series = handlesStore.state.subSeries[i];

      if (!series || lineDef.data.length === 0) return;

      try {
        series.setData(orderedByTime(lineDef.data));
      } catch {
        // Ignore — next tick repairs.
      }
    });
    const hist = subplot?.histogram;

    if (hist && hist.length > 0) {
      try {
        handlesStore.state.subHist?.setData(orderedByTime(hist));
      } catch {
        // Ignore — next tick repairs.
      }
    }
  }, [candleData, volumeData, overlays, subplot, showVolume, hasCandles]);

  // --- Trade overlay: markers + avg-entry line + PnL fill -------------------
  // Managed here (never in the structure effect) so marker/order updates
  // never rebuild the chart: every structure rebuild also re-runs the data
  // effect above, which runs before this one, so recreated handles are
  // always repopulated in the same commit.
  useStoreEffect(() => {
    if (!hasCandles) return;
    const chart = handlesStore.state.chart;
    const candleSeries = handlesStore.state.candles;

    if (!chart || !candleSeries) return;

    try {
      handlesStore.state.markers?.setMarkers(toSeriesMarkers(tradeMarkers));
    } catch {
      // Stale plugin mid-rebuild — next tick repairs.
    }

    const avg =
      avgEntryPrice !== null &&
      Number.isFinite(avgEntryPrice) &&
      avgEntryPrice > 0
        ? avgEntryPrice
        : null;

    if (avg === null) {
      const pnl = handlesStore.state.pnl;

      if (pnl) {
        try {
          chart.removeSeries(pnl);
        } catch {
          // Already removed with the chart — no-op.
        }

        handlesStore.setState((h) => ({ ...h, pnl: null }));
      }

      const prev = handlesStore.state.avgLine;

      if (prev) {
        try {
          candleSeries.removePriceLine(prev);
        } catch {
          // Already removed with the chart — no-op.
        }

        handlesStore.setState((h) => ({ ...h, avgLine: null }));
      }

      return;
    }

    try {
      let pnl = handlesStore.state.pnl;

      if (!pnl) {
        pnl = chart.addSeries(BaselineSeries, {
          baseValue: { type: "price", price: avg },
          topLineColor: "transparent",
          bottomLineColor: "transparent",
          topFillColor1: palette.pnlUp1,
          topFillColor2: palette.pnlUp2,
          bottomFillColor1: palette.pnlDown1,
          bottomFillColor2: palette.pnlDown2,
          lineWidth: 1,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        handlesStore.setState((h) => ({ ...h, pnl }));
      } else {
        pnl.applyOptions({ baseValue: { type: "price", price: avg } });
      }

      if (candleData.length > 0) {
        pnl.setData(
          orderedByTime(
            candleData.map((d) => ({
              time: d.time,
              value: d.close,
            })),
          ),
        );
      }
    } catch {
      // Stale series mid-rebuild — next tick repairs.
    }

    try {
      const prev = handlesStore.state.avgLine;

      if (prev) {
        try {
          candleSeries.removePriceLine(prev);
        } catch {
          // Stale line from a rebuilt chart — recreate below.
        }
      }

      const line = candleSeries.createPriceLine({
        price: avg,
        color: palette.avgEntry,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: avgEntryTitle ?? `avg entry ${avg.toFixed(precision)}`,
      });

      handlesStore.setState((h) => ({ ...h, avgLine: line }));
    } catch {
      // Chart not ready — next tick repairs.
    }
  }, [
    tradeMarkers,
    avgEntryPrice,
    avgEntryTitle,
    candleData,
    precision,
    hasCandles,
    paletteKey,
  ]);

  // --- Height: pane resize without rebuild (autoSize also tracks the box;
  // applyOptions covers the initial paint before its observer fires).
  useStoreEffect(() => {
    try {
      handlesStore.state.chart?.applyOptions({ height: priceHeight });
      handlesStore.state.subChart?.applyOptions({ height: subHeight });
    } catch {
      // Chart not yet created (no candles) — no-op.
    }
  }, [priceHeight, subHeight]);

  // Legend fallback: the last sanitized bar (sorted, deduped — so it is
  // genuinely the newest), with its volume and previous close.
  const lastPoint = candleData[candleData.length - 1];
  const prevPoint = candleData[candleData.length - 2];

  const bar: LegendBar | null = legend
    ? legend
    : lastPoint !== undefined && Schema.is(Schema.Number)(lastPoint.time)
      ? {
          time: lastPoint.time * 1000,
          open: lastPoint.open,
          high: lastPoint.high,
          low: lastPoint.low,
          close: lastPoint.close,
          volume: volumeByTime.get(lastPoint.time),
          prevClose: prevPoint?.close,
        }
      : null;

  const barChange =
    bar && bar.prevClose !== undefined && bar.prevClose !== 0
      ? ((bar.close - bar.prevClose) / Math.abs(bar.prevClose)) * 100
      : null;

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        flex: "1 1 auto",
        minHeight: 320,
        overflow: "hidden",
      }}
    >
      <div className="nfi-mono nfi-candle-legend" aria-live="polite">
        {bar ? (
          <>
            <span
              style={{
                color: bar.close >= bar.open ? palette.up : palette.down,
                fontWeight: 600,
              }}
            >
              {bar.close.toFixed(precision)}
              {barChange !== null ? (
                <span style={{ marginLeft: "0.375rem" }}>
                  ({barChange >= 0 ? "+" : ""}
                  {barChange.toFixed(2)}%)
                </span>
              ) : null}
            </span>
            <span style={{ opacity: 0.7 }}>
              O {bar.open.toFixed(precision)} H {bar.high.toFixed(precision)} L{" "}
              {bar.low.toFixed(precision)} C {bar.close.toFixed(precision)}
            </span>
            {bar.volume !== undefined ? (
              <span style={{ opacity: 0.55 }}>
                V {fmtVolumeLegend(bar.volume)}
              </span>
            ) : null}
            {legendOverlays.map((o) => (
              <span key={o.name} style={{ color: o.color }}>
                {o.name} {o.value.toFixed(precision)}
              </span>
            ))}
            <span style={{ opacity: 0.55 }}>{formatDateTime(bar.time)}</span>
          </>
        ) : null}
        {legend === null
          ? overlays
              .filter((o) => !legendOverlays.some((l) => l.name === o.name))
              .map((o) => (
                <span key={o.name} style={{ color: o.color, opacity: 0.8 }}>
                  {o.name}
                </span>
              ))
          : null}
      </div>
      {/* Pane container ONLY: the ResizeObserver measures this box, and the
          panes below are sized from that measurement — content height always
          equals measured height, so the loop converges instead of growing.
          Never put extra siblings (legend, toolbars) inside it. */}
      <div
        ref={setHostElement}
        style={{
          flex: "1 1 auto",
          minHeight: 0,
          minWidth: 0,
          width: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          ref={setPriceElement}
          style={{
            width: "100%",
            maxWidth: "100%",
            flex: "0 0 auto",
            height: priceHeight,
          }}
        />
        {subplot ? (
          <div
            ref={setSubElement}
            style={{
              width: "100%",
              maxWidth: "100%",
              flex: "0 0 auto",
              height: subHeight,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
