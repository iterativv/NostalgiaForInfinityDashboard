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
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  TradeMarkerPrimitive,
  positionTradeMarkers,
} from "./tradeMarkerOverlay";
import type { HistoryPnlSpan } from "./tradeOverlay";
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
 * `UTCTimestamp` (seconds), already snapped by the caller. Entries draw a
 * violet arrow below the bar, exits/derisks an amber arrow above; the
 * marker's labels stack as pills at the arrow's far end (see
 * `shared/tradeMarkerOverlay.ts`).
 */
export interface TvTradeMarker {
  readonly time: UTCTimestamp;
  readonly kind: "entry" | "exit";
  readonly labels: readonly string[];
}

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

/** Visible logical range in bar-index coordinates (fractional allowed). */
export interface VisibleRange {
  readonly from: number;
  readonly to: number;
}

/**
 * Zoom-out expansion so the bar at `index` reads in view: returns the
 * widened range (`pad` bars of context, `from` clamped at 0), or null when
 * the bar is already visible. Only ever widens — the caller's zoom level
 * otherwise survives untouched.
 */
export function expandRangeToInclude(
  range: VisibleRange,
  index: number,
  pad = 6,
): VisibleRange | null {
  if (index >= range.from && index <= range.to) return null;

  if (index < range.from) {
    return { from: Math.max(0, index - pad), to: range.to };
  }

  return { from: range.from, to: index + pad };
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
  /** Trade arrow+label primitive on the candle series (custom, v5). */
  markers: TradeMarkerPrimitive | null;
  /** PnL fill between close and the avg-entry baseline. */
  pnl: ISeriesApi<"Baseline"> | null;
  /** Per-trade PnL areas for past (closed) trades, newest drawn last. */
  pastPnl: Array<ISeriesApi<"Baseline">>;
  /**
   * Structure generation — bumps on every chart recreate so keyed rebuilds
   * (past PnL areas) never skip re-attaching onto the fresh chart.
   */
  gen: number;
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
  pastPnl: [],
  gen: 0,
  avgLine: null,
};

const EMPTY_TRADE_MARKERS: ReadonlyArray<TvTradeMarker> = [];

const EMPTY_PNL_SPANS: ReadonlyArray<HistoryPnlSpan> = [];

/** PnL area fills: the chart's top/bottom band color contract. */
interface PnlFills {
  readonly topFillColor1: string;
  readonly topFillColor2: string;
  readonly bottomFillColor1: string;
  readonly bottomFillColor2: string;
}

/**
 * PnL area fills. An explicit outcome (a realized percentage) paints the
 * whole span ONE hue — green for a winner, red for a loser — so a past
 * trade reads by its result, not by where price wiggled relative to the
 * entry. Without an outcome (open positions, percentage-less history) the
 * fills fall back to the live geometric split around the entry, swapped
 * for shorts.
 */
const pnlFills = (
  palette: ReturnType<typeof candlePalette>,
  isShort: boolean,
  profitPct: number | null | undefined,
): PnlFills => {
  const outcome =
    profitPct !== null &&
    profitPct !== undefined &&
    Number.isFinite(profitPct) &&
    profitPct !== 0
      ? profitPct > 0
        ? "up"
        : "down"
      : null;

  if (outcome === null) {
    return {
      topFillColor1: isShort ? palette.pnlDown1 : palette.pnlUp1,
      topFillColor2: isShort ? palette.pnlDown2 : palette.pnlUp2,
      bottomFillColor1: isShort ? palette.pnlUp1 : palette.pnlDown1,
      bottomFillColor2: isShort ? palette.pnlUp2 : palette.pnlDown2,
    };
  }

  const fill1 = outcome === "up" ? palette.pnlUp1 : palette.pnlDown1;
  const fill2 = outcome === "up" ? palette.pnlUp2 : palette.pnlDown2;

  return {
    topFillColor1: fill1,
    topFillColor2: fill2,
    bottomFillColor1: fill1,
    bottomFillColor2: fill2,
  };
};

/**
 * Visible-range distance from the oldest bar that fires `onRequestOlder`:
 * a few screens of context stay pannable while the next page loads.
 */
const LOAD_OLDER_TRIGGER_BARS = 12;

export function CandleChart({
  candles,
  overlays,
  showVolume,
  subplot,
  tradeMarkers = EMPTY_TRADE_MARKERS,
  avgEntryPrice = null,
  avgEntryTitle,
  avgEntryIsShort = false,
  avgEntryProfitPct = null,
  avgEntrySince = null,
  avgEntryUntil = null,
  avgEntryLineVisible = true,
  historyPnlSpans = EMPTY_PNL_SPANS,
  followMarkers = false,
  focusBarTime = null,
  onRequestOlder,
}: {
  candles: ReadonlyArray<Candle>;
  overlays: ReadonlyArray<TvOverlayLine>;
  showVolume: boolean;
  subplot: TvSubplot | null;
  /** Trade dots/arrows (entries below, exits above); empty = hidden. */
  tradeMarkers?: ReadonlyArray<TvTradeMarker>;
  /** Dashed `avg entry` line + PnL fill; null = hidden. */
  avgEntryPrice?: number | null;
  /** Baseline label override (defaults to `avg entry`; keep it number-free — the axis label already shows the price). */
  avgEntryTitle?: string;
  /**
   * True when the followed position is short: profit sits BELOW the entry
   * (price falling), so the green/red PnL fills swap sides. Long (default)
   * keeps profit above the entry. Ignored when `avgEntryProfitPct` gives
   * the area an explicit outcome.
   */
  avgEntryIsShort?: boolean;
  /**
   * Signed realized percentage of the followed position — when set (closed
   * position), the PnL area's hue follows the OUTCOME: green wash for a
   * winner, red for a loser, regardless of where price wiggled. Undefined
   * (open position) keeps the live geometric split around the entry.
   */
  avgEntryProfitPct?: number | null;
  /**
   * Entry-anchored fill start (whole UTC seconds, already snapped to the
   * candle bucket by the caller): the PnL area covers entry → newest
   * instead of the whole window, so pre-entry history never shades.
   * Null (default) keeps the full-window fill. The dashed level line
   * always spans the window regardless.
   */
  avgEntrySince?: number | null;
  /**
   * Entry-anchored fill END (whole UTC seconds, snapped to the candle
   * bucket): a followed CLOSED position stops the PnL area at its exit —
   * shading profit/loss over the sessions after the close would be
   * fiction. Null (default, open positions) keeps the fill running to the
   * newest bar.
   */
  avgEntryUntil?: number | null;
  /**
   * Draw the dashed entry-level price line (with its axis label). False
   * keeps the PnL area but hides the line — a followed closed position
   * has no live entry level left to track.
   */
  avgEntryLineVisible?: boolean;
  /**
   * Profit/loss areas for PAST (closed) trades on this pair — one shaded
   * entry→exit span per trade, green above / red below the trade's entry
   * (sides swapped for shorts). The followed position's own area comes
   * from `avgEntryPrice` + `avgEntrySince`/`avgEntryUntil`; spans should
   * exclude it to avoid double shading. Newest span draws last.
   */
  historyPnlSpans?: ReadonlyArray<HistoryPnlSpan>;
  /**
   * Follow the newest trade marker: when the marker set changes (pair or
   * timeframe switch, fresh entry) and its newest bar sits outside the
   * current view, zoom out just enough to include it. Never zooms in and
   * never reacts to candle ticks, so free panning is undisturbed.
   */
  followMarkers?: boolean;
  /**
   * Bar time (whole UTC seconds, snapped bucket) to keep the view centered
   * on — the position pager's anchor. When it changes (or the loaded
   * window is replaced), the visible range recenters so the bar sits about
   * a third in, keeping the current zoom level. Null = no focus.
   */
  focusBarTime?: number | null;
  /**
   * Infinite scroll-back: called whenever the visible range approaches the
   * oldest loaded bar (within `LOAD_OLDER_TRIGGER_BARS`). Fires per pan
   * frame while near the edge — the requester must self-throttle (the
   * `useCandleHistory` hook no-ops while a page is in flight or history
   * is exhausted). Omit to keep the chart bounded to the given candles.
   */
  onRequestOlder?: () => void;
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

  // History-page requester for the scroll-back trigger below — a live box
  // so the range subscription (registered once per chart structure) reads
  // the latest callback without re-subscribing per render.
  const requestOlderStore = useLocalStore<(() => void) | null>(null);

  if (requestOlderStore.state !== onRequestOlder) {
    requestOlderStore.setState(() => onRequestOlder ?? null);
  }

  /** Fires the requester when the view nears the oldest loaded bar. */
  const triggerOlderIfNeeded = (from: number): void => {
    if (from > LOAD_OLDER_TRIGGER_BARS) return;

    requestOlderStore.state?.();
  };

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

    // Trade arrows + label pills (custom primitive — data arrives via the
    // trade overlay effect below, so toggles never rebuild the chart).
    const markers = new TradeMarkerPrimitive();

    candleSeries.attachPrimitive(markers);

    handlesStore.setState((h) => ({ ...h, markers }));

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
          triggerOlderIfNeeded(range.from);
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
        if (range) {
          rangeStore.setState(() => range);
          triggerOlderIfNeeded(range.from);
        }
      });
    }

    // Preserve the user's zoom/pan across structure rebuilds (toggles);
    // per-tick data updates never touch the time scale.
    const savedRange = rangeStore.state;

    if (savedRange) {
      chart.timeScale().setVisibleLogicalRange(savedRange);
      subChart?.timeScale().setVisibleLogicalRange(savedRange);
    } else {
      // Initial zoom: keep enough pixels per bar that the time axis never
      // starts crowded — a narrow pane shows a shorter window instead of
      // squeezing the whole dataset (200+ bars once history accumulates
      // behind fitContent). Logical units are one per bar, so this adapts
      // to any timeframe; the user's own zoom/pan is never touched after
      // first paint. ~68px allowance covers the right price scale plus the
      // rightOffset; 9px/bar is lightweight-charts' comfortable minimum.
      const minPixelsPerBar = 9;
      const usableWidth = Math.max(0, (priceEl.clientWidth || 600) - 68);

      const visibleBars = Math.max(
        20,
        Math.min(candleData.length, Math.floor(usableWidth / minPixelsPerBar)),
      );

      const to = candleData.length + 4;
      const from = Math.max(0, to - visibleBars);
      chart.timeScale().setVisibleLogicalRange({ from, to });
      subChart?.timeScale().setVisibleLogicalRange({ from, to });
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
      // gen survives + bumps: keyed rebuilds below must re-attach onto the
      // next chart even when their inputs didn't change across the toggle.
      handlesStore.setState((h) => ({ ...NO_HANDLES, gen: h.gen + 1 }));
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
  // Oldest loaded bar (whole seconds) of the previous data frame — detects
  // history prepends so the visible TIME range can be restored after
  // `setData` (logical indexes shift when older bars prepend, and the
  // default behavior after a prepend drags the view leftward with them).
  const prevOldestStore = useLocalStore<number | null>(null);

  useStoreEffect(() => {
    if (!hasCandles) return;

    const chart = handlesStore.state.chart;
    const nextOldest = candleData[0] ? Number(candleData[0].time) : null;
    const prevOldest = prevOldestStore.state;

    const prepended =
      chart !== null &&
      prevOldest !== null &&
      nextOldest !== null &&
      nextOldest < prevOldest;

    const restoreRange =
      prepended && chart ? chart.timeScale().getVisibleRange() : null;

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

    // Keep the user's view anchored to the same time span the prepended
    // bars slid underneath it. The restore also re-fires the range
    // subscription, which re-arms the next history page if the edge is
    // still close.
    if (restoreRange && chart) {
      try {
        chart.timeScale().setVisibleRange(restoreRange);
      } catch {
        // Chart mid-rebuild — next tick repairs.
      }
    }

    prevOldestStore.setState(() => nextOldest);
  }, [candleData, volumeData, overlays, subplot, showVolume, hasCandles]);

  // --- Trade overlay: markers + avg-entry line + PnL fill -------------------
  // Managed here (never in the structure effect) so marker/order updates
  // never rebuild the chart: every structure rebuild also re-runs the data
  // effect above, which runs before this one, so recreated handles are
  // always repopulated in the same commit.
  //
  // Markers anchor to their candle bar (exit → high, entry → low) so the
  // primitive can start each leader arrow at the right wick.
  const positionedMarkers = useDerived(
    [tradeMarkers, candleData] as const,
    ([markers, candles]) => positionTradeMarkers(markers, candles),
    { inputs: shallow },
  );

  // Marker-set identity for the follow logic below: the effect re-runs on
  // every candle tick, but the zoom only moves when the markers themselves
  // change.
  const markerKeyStore = useLocalStore<string | null>(null);

  // Past-trade PnL areas rebuild only on this key's change (see below).
  const pastPnlKeyStore = useLocalStore<string | null>(null);

  // View-focus identity: recenter only when the anchor bar or the loaded
  // window actually changes — never on live ticks or history prepends'
  // per-frame updates.
  const focusKeyStore = useLocalStore<string | null>(null);

  useStoreEffect(() => {
    if (!hasCandles) return;
    const chart = handlesStore.state.chart;
    const candleSeries = handlesStore.state.candles;

    if (!chart || !candleSeries) return;

    try {
      handlesStore.state.markers?.setMarkers(positionedMarkers);
    } catch {
      // Stale primitive mid-rebuild — next tick repairs.
    }

    if (followMarkers) {
      const key = positionedMarkers
        .map((m) => `${m.time}:${m.kind}`)
        .join(",");

      if (markerKeyStore.state !== key) {
        markerKeyStore.setState(() => key);

        if (positionedMarkers.length > 0 && candleData.length > 0) {
          let newest = Number(positionedMarkers[0]!.time);

          for (const marker of positionedMarkers) {
            newest = Math.max(newest, Number(marker.time));
          }

          let at = candleData.length - 1;

          for (let i = 0; i < candleData.length; i++) {
            if (Number(candleData[i]!.time) <= newest) at = i;
          }

          const range = chart.timeScale().getVisibleLogicalRange();

          if (range) {
            const widened = expandRangeToInclude(range, at);

            if (widened) {
              try {
                chart.timeScale().setVisibleLogicalRange(widened);
              } catch {
                // Chart mid-rebuild — next tick repairs.
              }
            }
          }
        }
      }
    }

    // View focus: recenter on the anchor bar (runs after the marker-follow
    // block above, so an explicit focus wins on pair/position switches).
    if (focusBarTime !== null && Number.isFinite(focusBarTime) && focusBarTime > 0) {
      const key = `${focusBarTime}|${candleData[0] ? Number(candleData[0].time) : 0}`;

      if (focusKeyStore.state !== key) {
        focusKeyStore.setState(() => key);

        let at = -1;

        for (let i = candleData.length - 1; i >= 0; i--) {
          if (Number(candleData[i]!.time) <= focusBarTime) {
            at = i;
            break;
          }
        }

        if (at >= 0) {
          let span = 120;

          try {
            const range = chart.timeScale().getVisibleLogicalRange();

            if (range) span = Math.max(20, range.to - range.from);
          } catch {
            // Chart mid-rebuild — the default span still focuses.
          }

          try {
            chart.timeScale().setVisibleLogicalRange({
              from: at - Math.round(span * 0.3),
              to: at + Math.round(span * 0.7),
            });
          } catch {
            // Chart mid-rebuild — next keyed change repairs.
          }
        }
      }
    }

    // Past-trade PnL areas: one baseline per span, rebuilt only when the
    // spans, palette or the candle series they read from actually change —
    // not on every live tick (past trades' windows are frozen).
    const pastPnlSpanKey = `${handlesStore.state.gen}|${paletteKey}|${candleData.length}|${
      candleData[0] ? Number(candleData[0].time) : 0
    }|${historyPnlSpans
      .map(
        (span) =>
          `${span.since}:${span.until}:${span.entry}:${span.isShort ? 1 : 0}:${
            span.profitPct ?? ""
          }`,
      )
      .join(";")}`;

    if (pastPnlKeyStore.state !== pastPnlSpanKey) {
      pastPnlKeyStore.setState(() => pastPnlSpanKey);

      for (const series of handlesStore.state.pastPnl) {
        try {
          chart.removeSeries(series);
        } catch {
          // Already removed with the chart — no-op.
        }
      }

      handlesStore.setState((h) => ({ ...h, pastPnl: [] }));

      const created: Array<ISeriesApi<"Baseline">> = [];

      for (const span of historyPnlSpans) {
        const data = orderedByTime(
          candleData
            .filter(
              (d) =>
                Number(d.time) >= span.since && Number(d.time) <= span.until,
            )
            .map((d) => ({
              time: d.time,
              value: d.close,
            })),
        );

        if (data.length === 0) continue;

        try {
          const series = chart.addSeries(BaselineSeries, {
            baseValue: { type: "price", price: span.entry },
            topLineColor: "transparent",
            bottomLineColor: "transparent",
            ...pnlFills(palette, span.isShort, span.profitPct),
            lineWidth: 1,
            crosshairMarkerVisible: false,
            lastValueVisible: false,
            priceLineVisible: false,
          });

          series.setData(data);
          created.push(series);
        } catch {
          // Chart mid-rebuild — next keyed change repairs.
        }
      }

      handlesStore.setState((h) => ({ ...h, pastPnl: created }));
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

      // Hue: a closed follow paints by its realized outcome; an open
      // position keeps the live geometric split (see `pnlFills`).
      const fills = pnlFills(palette, avgEntryIsShort, avgEntryProfitPct);

      if (!pnl) {
        pnl = chart.addSeries(BaselineSeries, {
          baseValue: { type: "price", price: avg },
          topLineColor: "transparent",
          bottomLineColor: "transparent",
          ...fills,
          lineWidth: 1,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        handlesStore.setState((h) => ({ ...h, pnl }));
      } else {
        pnl.applyOptions({
          baseValue: { type: "price", price: avg },
          ...fills,
        });
      }

      if (candleData.length > 0) {
        // Entry-anchored: shade entry → newest only, and stop at the exit
        // bucket for a followed closed position. `setData([])` clears the
        // fill when the window doesn't reach the trade at all (never
        // stale).
        const since =
          avgEntrySince !== null &&
          Number.isFinite(avgEntrySince) &&
          avgEntrySince > 0
            ? avgEntrySince
            : null;

        const until =
          avgEntryUntil !== null &&
          Number.isFinite(avgEntryUntil) &&
          avgEntryUntil > 0
            ? avgEntryUntil
            : null;

        pnl.setData(
          orderedByTime(
            candleData
              .filter(
                (d) =>
                  (since === null || Number(d.time) >= since) &&
                  (until === null || Number(d.time) <= until),
              )
              .map((d) => ({
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

        handlesStore.setState((h) => ({ ...h, avgLine: null }));
      }

      // The dashed level line only tracks LIVE entry levels (open
      // positions); a followed closed position keeps its PnL area but no
      // level to follow. The axis label carries the price — the title
      // stays number-free so the value never renders twice side by side.
      if (avgEntryLineVisible) {
        const line = candleSeries.createPriceLine({
          price: avg,
          color: palette.avgEntry,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: avgEntryTitle ?? "avg entry",
        });

        handlesStore.setState((h) => ({ ...h, avgLine: line }));
      }
    } catch {
      // Chart not ready — next tick repairs.
    }
  }, [
    positionedMarkers,
    avgEntryPrice,
    avgEntryTitle,
    avgEntryIsShort,
    avgEntryProfitPct,
    avgEntrySince,
    avgEntryUntil,
    avgEntryLineVisible,
    historyPnlSpans,
    followMarkers,
    focusBarTime,
    candleData,
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
        position: "relative",
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
      {/* Legend floats above the chart (see .nfi-candle-legend) — never a
          flow sibling, so hover text can't shift the panes. */}
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
