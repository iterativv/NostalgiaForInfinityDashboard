// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Position candles (public) — the shareable twin of `position-candle`.
 *
 * Same follow-the-open-position behavior (quick-selector chips, `Auto`
 * tracking the newest open position), but built only from market data and
 * `.relative` position payloads: entry/exit markers carry direction,
 * percentages and tags — never amounts, prices or order detail.
 *
 * Profit/loss shading without absolutes: the dashed baseline sits at the
 * allocation-weighted entry-bucket close (purely public inputs — entry
 * dates plus candle closes), so the green/red area still reads profit vs
 * loss at a glance. All four capabilities live in the anonymous seed
 * grant, so the widget renders signed-out on shared pages.
 */

import { Button, NumberInput } from "@carbon/react";
import { Schema } from "effect";
import { RSI } from "lightweight-charts-indicators";
import type {
  Capability,
  RelativeClosedPosition,
  RelativeOpenPosition,
} from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import {
  EmptyState,
  shallow,
  useDerived,
  useLocalStore,
  useStoreEffect,
  WidgetFrame,
} from "@nfi/ui";
import { useCapability } from "./live/live";
import { useWidgetConfigSink } from "./shared/sessionConfig";
import {
  InstanceIdField,
  booleanWithDefault,
  numberWithDefault,
  stringWithDefault,
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
  type TvTradeMarker,
} from "./shared/CandleChart";
import {
  buildPositionHistoryMarkers,
  earliestEntrySecond,
  parsePositionTime,
  positionDirection,
  positionExitText,
  timeframeSeconds,
  type PositionMarkerEvent,
} from "./shared/tradeOverlay";
import { fitWindowToEntry } from "./shared/positionFit";
import { parseTradeTime } from "./shared/tradeSort";
import {
  buildIndicatorOverlays,
  buildIndicatorSubplot,
  lastPlotValue,
  type IndicatorBar,
} from "./shared/candleOverlays";
import {
  PositionPairChips,
  type PositionChipOption,
} from "./shared/PositionPairChips";
import { useCandlePending } from "./shared/candlePending";
import { useStrategyTimeframe } from "./shared/strategyTimeframe";

/** OHLCV candles (public market data). */
export const POSITION_CANDLE_PUBLIC_MARKET: Capability = "instances.candles";

/** Pair whitelist for the pair switcher (public market data). */
export const POSITION_CANDLE_PUBLIC_PAIRS: Capability = "instances.pairs";

/** Open positions, percentages/weights only (shareable). */
export const POSITION_CANDLE_PUBLIC_OPEN: Capability =
  "instances.open-positions.relative";

/** Closed positions window, percentages only (shareable). */
export const POSITION_CANDLE_PUBLIC_CLOSED: Capability =
  "instances.closed-positions.relative";

export const POSITION_CANDLE_PUBLIC_CAPABILITIES: ReadonlyArray<Capability> = [
  POSITION_CANDLE_PUBLIC_MARKET,
  POSITION_CANDLE_PUBLIC_PAIRS,
  POSITION_CANDLE_PUBLIC_OPEN,
  POSITION_CANDLE_PUBLIC_CLOSED,
];

export const PositionCandlePublicTimeframe = Schema.Literal(
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
);

export type PositionCandlePublicTimeframe =
  typeof PositionCandlePublicTimeframe.Type;

export const PositionCandlePublicSubplot = Schema.Literal("none", "rsi", "macd");

export type PositionCandlePublicSubplot =
  typeof PositionCandlePublicSubplot.Type;

export const PositionCandlePublicConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  /** Followed pair — empty means auto (newest open position). */
  pair: stringWithDefault(""),
  timeframe: Schema.optionalWith(PositionCandlePublicTimeframe, {
    default: (): PositionCandlePublicTimeframe => "5m",
  }),
  limit: numberWithDefault(200),
  showSma20: booleanWithDefault(true),
  showSma50: booleanWithDefault(true),
  showEma12: booleanWithDefault(false),
  showBollinger: booleanWithDefault(false),
  showVwap: booleanWithDefault(true),
  showVolume: booleanWithDefault(true),
  /** Position-history markers — always on (legacy flag). */
  showPositions: booleanWithDefault(true),
  /** Entry-level line with green/red profit/loss shading — always on (legacy). */
  showEntryLevel: booleanWithDefault(true),
  subplot: Schema.optionalWith(PositionCandlePublicSubplot, {
    default: (): PositionCandlePublicSubplot => "rsi",
  }),
});

export type PositionCandlePublicConfig =
  typeof PositionCandlePublicConfigSchema.Type;

export const POSITION_CANDLE_PUBLIC_DEFAULTS: PositionCandlePublicConfig =
  Schema.decodeUnknownSync(PositionCandlePublicConfigSchema)({});

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
  readonly id: PositionCandlePublicSubplot;
  readonly text: string;
}> = [
  { id: "none", text: "None" },
  { id: "rsi", text: "RSI (14)" },
  { id: "macd", text: "MACD (12, 26, 9)" },
];

interface PairBucket {
  readonly pair: string;
  readonly count: number;
  readonly pnl: number | undefined;
  readonly newestOpen: number;
}

/**
 * Stable empty input for `useDerived(..., bucketByPair)`: an inline
 * `?? []` would mint a fresh (never-equal) array on every render while the
 * query is uncached, and `useDerived`'s render-time `setState` would then
 * re-render forever — the page-unresponsive freeze seen when adding this
 * widget to a fresh (anonymous) layout whose `.relative` key has no cache
 * yet. See `PairUniverseWidget` for the same rule.
 */
const EMPTY_RELATIVE_OPEN: ReadonlyArray<RelativeOpenPosition> = [];

const EMPTY_PAIRS: ReadonlyArray<string> = [];

function bucketByPair(
  positions: ReadonlyArray<RelativeOpenPosition>,
): PairBucket[] {
  const groups = new Map<
    string,
    { count: number; pnlSum: number; pnlCount: number; newestOpen: number }
  >();

  for (const p of positions) {
    const entry = groups.get(p.pair) ?? {
      count: 0,
      pnlSum: 0,
      pnlCount: 0,
      newestOpen: 0,
    };

    entry.count += 1;

    if (p.profitPct !== undefined && Number.isFinite(p.profitPct)) {
      entry.pnlSum += p.profitPct;
      entry.pnlCount += 1;
    }

    entry.newestOpen = Math.max(entry.newestOpen, parseTradeTime(p.openDate));
    groups.set(p.pair, entry);
  }

  return [...groups.entries()]
    .map(([pair, g]): PairBucket => ({
      pair,
      count: g.count,
      pnl: g.pnlCount > 0 ? g.pnlSum / g.pnlCount : undefined,
      newestOpen: g.newestOpen,
    }))
    .sort((a, b) => b.newestOpen - a.newestOpen || a.pair.localeCompare(b.pair));
}

const cleanTag = (tag: string | undefined): string =>
  (tag ?? "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();

function entryLabel(
  isShort: boolean | undefined,
  enterTag: string | undefined,
): string {
  const tag = cleanTag(enterTag);

  return tag.length > 0
    ? `${positionDirection(isShort)} · ${tag}`
    : positionDirection(isShort);
}

function exitLabel(
  position: RelativeClosedPosition,
): string {
  const base = positionExitText(
    position.isShort,
    position.closeProfitPct,
    position.profitPct,
  );

  const tag = cleanTag(position.exitReason);

  return tag.length > 0 ? `${base} · ${tag}` : base;
}

/**
 * Entry-level baseline from public inputs only: allocation-weighted
 * average of the entry-bucket candle closes. Positions missing weights
 * (or a fully weightless set) fall back to equal shares; entries outside
 * the loaded window (or with unparseable dates) are skipped — null hides
 * the line instead of guessing.
 */
export function entryLevelBaseline(
  open: ReadonlyArray<RelativeOpenPosition>,
  candles: ReadonlyArray<{ time: number; close: number }>,
  tfSeconds: number,
): number | null {
  if (open.length === 0 || candles.length === 0 || tfSeconds <= 0) return null;

  const closeByBucket = new Map<number, number>();

  for (const c of candles) {
    if (!Number.isFinite(c.close)) continue;
    closeByBucket.set(
      Math.floor(Math.floor(c.time / 1000) / tfSeconds) * tfSeconds,
      c.close,
    );
  }

  if (closeByBucket.size === 0) return null;

  const buckets = [...closeByBucket.keys()].sort((a, b) => a - b);
  const equalShare = 1 / open.length;

  const weighted = open.every(
    (p) =>
      p.allocationWeight !== undefined &&
      Number.isFinite(p.allocationWeight) &&
      (p.allocationWeight ?? 0) > 0,
  );

  let valueSum = 0;
  let weightSum = 0;

  for (const p of open) {
    const at = parsePositionTime(p.openDate);

    if (at === null) continue;
    const bucket = Math.floor(Math.floor(at / 1000) / tfSeconds) * tfSeconds;
    let close = closeByBucket.get(bucket);

    if (close === undefined) {
      let nearest: number | null = null;
      let nearestDist = Infinity;

      for (const b of buckets) {
        const dist = Math.abs(b - bucket);

        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = b;
        }
      }

      if (nearest === null || nearestDist > tfSeconds) continue;
      close = closeByBucket.get(nearest);
    }

    if (close === undefined) continue;
    const weight = weighted ? (p.allocationWeight ?? 0) : equalShare;

    valueSum += close * weight;
    weightSum += weight;
  }

  if (weightSum <= 0) return null;

  return valueSum / weightSum;
}

export function PositionCandlePublicWidget({
  config,
  panelId,
}: WidgetProps<PositionCandlePublicConfig>) {
  // Session-aware binding — this widget renders for anonymous visitors on
  // shared pages, where the panel sink refuses writes; patches then live
  // in a per-browser session layer instead of being silent no-ops.
  const { config: cfg, patch } = useWidgetConfigSink(
    panelId,
    "position-candle-public",
    config,
  );

  const limit = clampInt(cfg.limit, 200, 20, 1000);

  const marketAccess = useWidgetAccess([
    POSITION_CANDLE_PUBLIC_MARKET,
    POSITION_CANDLE_PUBLIC_PAIRS,
  ]);

  const positionsAccess = useWidgetAccess([
    POSITION_CANDLE_PUBLIC_OPEN,
    POSITION_CANDLE_PUBLIC_CLOSED,
  ]);

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

  const buckets = useDerived(
    openRelQ.data?.positions ?? EMPTY_RELATIVE_OPEN,
    bucketByPair,
  );

  const pinned = cfg.pair.trim();

  const pinnedOpen = pinned
    ? (buckets.some((b) => b.pair === pinned) ?? false)
    : false;

  const effectivePair = pinned || buckets[0]?.pair || "";

  const candlesQ = useCapability(
    "instances.candles",
    {
      id: cfg.instanceId,
      pair: effectivePair,
      timeframe: cfg.timeframe,
      limit: String(limit),
    },
    { enabled: marketAccess.allowed && effectivePair.length > 0 },
  );

  const pairsQ = useCapability(
    "instances.pairs",
    { id: cfg.instanceId, timeframe: cfg.timeframe },
    { enabled: marketAccess.allowed },
  );

  const accessError = marketAccess.allowed
    ? null
    : `Not authorized — needs ${marketAccess.missing.join(", ")}`;

  const showSettings = useWidgetSettingsOpen(panelId);

  const candles = useDerived(candlesQ.data, (data) => data?.candles ?? []);

  // Same timeframe-switch grace as the sensitive twin: hold loading instead
  // of flashing "no analyzed data" while the fresh seed is in flight.
  const candlesPending = useCandlePending(
    `${cfg.instanceId}|${effectivePair}|${cfg.timeframe}|${limit}`,
    candles.length >= 2,
    candlesQ.isLoading,
  );

  const state = queryState(
    marketAccess.allowed ? (candlesQ.error ?? openRelQ.error) : null,
    marketAccess.allowed &&
      (candlesQ.isLoading || openRelQ.isLoading || candlesPending),
  );

  // Opportunistic like the public candle twin: anonymous grants lack
  // `instances.config`, so shared pages keep the generic copy.
  const strategyTf = useStrategyTimeframe(cfg.instanceId);

  const strategyFallback =
    strategyTf !== undefined &&
    strategyTf !== cfg.timeframe &&
    TIMEFRAME_ITEMS.some((t) => t.id === strategyTf)
      ? strategyTf
      : undefined;

  // Pair self-heal: same settled-variant adoption as the other charts.
  useStoreEffect(() => {
    const whitelist = pairsQ.data?.pairs;

    if (!whitelist || whitelist.length === 0 || effectivePair.length === 0)
      return;

    if (whitelist.includes(effectivePair)) return;
    const base = effectivePair.split("/")[0] ?? effectivePair;
    const settled = whitelist.find((p) => p === `${effectivePair}:USDT`);
    const byBase = whitelist.find((p) => (p.split("/")[0] ?? "") === base);
    const next = settled ?? byBase;

    if (next) patch({ pair: next });
  }, [pairsQ.data, effectivePair]);

  const bars = useDerived(candles, (src): IndicatorBar[] =>
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

  const pairOpen = useDerived(
    [openRelQ.data, effectivePair] as const,
    ([data, pair]) => (data?.positions ?? []).filter((p) => p.pair === pair),
    { inputs: shallow },
  );

  const pairClosed = useDerived(
    [closedRelQ.data, effectivePair] as const,
    ([data, pair]) => (data?.positions ?? []).filter((p) => p.pair === pair),
    { inputs: shallow },
  );

  // Short direction drives the PnL fill side (see CandleChart
  // `avgEntryIsShort`): all-short follows invert, mixed defaults to long.
  const followedIsShort = useDerived(
    [pairOpen] as const,
    ([open]): boolean =>
      open.length > 0 && open.every((p) => p.isShort === true),
    { inputs: shallow },
  );

  // Entry-anchored fill start (relative payloads carry no order times, so
  // the open dates back it): shading covers entry → newest, never the
  // pre-entry history that made the old fill misleading.
  const entrySince = useDerived(
    [pairOpen, cfg.timeframe] as const,
    ([open, timeframe]): number | null => {
      const at = earliestEntrySecond(open);

      if (at === null) return at;

      const tfSec = timeframeSeconds(timeframe);

      if (tfSec === null) return at;

      return Math.floor(at / tfSec) * tfSec;
    },
    { inputs: shallow },
  );

  // Window auto-fit (same policy as the sensitive twin): zoom out until
  // the followed position's entry → now fits in the window, at most once
  // per (pair, entry) so manual picks are never fought over.
  const fitKeyStore = useLocalStore<string | null>(null);

  useStoreEffect(() => {
    const entrySec = earliestEntrySecond(pairOpen);

    if (entrySec === null || effectivePair.length === 0) return;

    const fit = fitWindowToEntry(entrySec, cfg.timeframe, limit);

    if (fit === null) return;

    const fitKey = `${effectivePair}@${entrySec}`;

    if (fitKeyStore.state === fitKey) return;
    fitKeyStore.setState(() => fitKey);
    patch({ timeframe: fit.timeframe, limit: fit.limit });
  }, [pairOpen, cfg.timeframe, limit, effectivePair]);

  // Data-shortfall refit (same policy as the sensitive twin): when the
  // bot's rolling analyzed window starts AFTER the entry, one coarser
  // step lands on the exchange-backed timeframe that reaches it.
  const refitKeyStore = useLocalStore<string | null>(null);

  useStoreEffect(() => {
    const entrySec = earliestEntrySecond(pairOpen);

    if (entrySec === null || effectivePair.length === 0) return;

    const firstCandle = candles[0];

    if (!firstCandle || Math.floor(firstCandle.time / 1000) <= entrySec)
      return;

    const refitKey = `${effectivePair}@${entrySec}`;

    if (refitKeyStore.state === refitKey) return;

    const fit = fitWindowToEntry(entrySec, cfg.timeframe, limit, {
      mode: "coarser-only",
    });

    if (fit === null) return;
    refitKeyStore.setState(() => refitKey);
    patch({ timeframe: fit.timeframe, limit: fit.limit });
  }, [pairOpen, candles, cfg.timeframe, limit, effectivePair]);

  const positionMarkers = useDerived(
    [
      pairOpen,
      pairClosed,
      bars,
      cfg.timeframe,
      positionsAccess.allowed,
    ] as const,
    ([open, closed, bars, timeframe, allowed]): TvTradeMarker[] => {
      // Position charts always show markers (no toggle).
      if (!allowed || bars.length === 0) return [];

      const tfSec = timeframeSeconds(timeframe);

      if (tfSec === null) return [];

      const secs = bars.map((b) => b.time);
      const events: PositionMarkerEvent[] = [];

      for (const p of open) {
        const at = parsePositionTime(p.openDate);

        if (at === null) continue;
        events.push({
          timeMs: at,
          kind: "entry",
          text: entryLabel(p.isShort, p.enterTag),
        });
      }

      for (const p of closed) {
        const opened = parsePositionTime(p.openDate);

        if (opened !== null)
          events.push({
            timeMs: opened,
            kind: "entry",
            text: entryLabel(p.isShort, p.enterTag),
          });

        const closedAt =
          p.closeDate !== undefined ? parsePositionTime(p.closeDate) : null;

        if (closedAt !== null) {
          events.push({
            timeMs: closedAt,
            kind: "exit",
            text: exitLabel(p),
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

  // Profit/loss area from public inputs: entry-level baseline + close
  // series fill (see `entryLevelBaseline`). Null = entries predate the
  // loaded window, so the line stays hidden instead of guessing.
  const entryBaseline = useDerived(
    [pairOpen, candles, cfg.timeframe] as const,
    ([open, candles, timeframe]): number | null => {
      // Position charts always show the entry level (no toggle).
      const tfSec = timeframeSeconds(timeframe);

      if (tfSec === null) return null;

      return entryLevelBaseline(open, candles, tfSec);
    },
    { inputs: shallow },
  );

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
    ([bars, showSma20, showSma50, showEma12, showBollinger, showVwap]) =>
      buildIndicatorOverlays(bars, {
        showSma20,
        showSma50,
        showEma12,
        showBollinger,
        showVwap,
      }),
    { inputs: shallow },
  );

  const rsiPlots = useDerived(
    [bars, cfg.subplot] as const,
    ([bars, kind]) =>
      bars.length > 0 && kind === "rsi"
        ? RSI.calculate(bars, { length: 14 }).plots.plot0
        : [],
    { inputs: shallow },
  );

  const subplot = useDerived(
    [bars, cfg.subplot, palette] as const,
    ([bars, kind, pal]) => buildIndicatorSubplot(bars, kind, pal),
    { inputs: shallow },
  );

  const lastRsi = cfg.subplot === "rsi" ? lastPlotValue(rsiPlots) : null;
  const narrow = useNarrowMode(420);
  const availablePairs = pairsQ.data?.pairs ?? EMPTY_PAIRS;

  // Exchange-sourced candles (backend fallback for unanalyzed timeframes).
  const isMarketData = candlesQ.data?.source === "exchange";

  const chipOptions: PositionChipOption[] = buckets.map((b) => ({
    key: b.pair,
    label: b.pair,
    pnl: b.pnl,
    count: b.count > 1 ? b.count : undefined,
  }));

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

  const followedPnl =
    pairOpen.length > 0
      ? pairOpen.reduce(
          (acc, p) => ({
            sum:
              acc.sum +
              (p.profitPct !== undefined && Number.isFinite(p.profitPct)
                ? p.profitPct
                : 0),
            count:
              acc.count +
              (p.profitPct !== undefined && Number.isFinite(p.profitPct)
                ? 1
                : 0),
          }),
          { sum: 0, count: 0 },
        )
      : null;

  const followedAvg =
    followedPnl && followedPnl.count > 0
      ? followedPnl.sum / followedPnl.count
      : null;

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Position chart (public) settings"
        widgetType="position-candle-public"
      >
        <InstanceSelect
          id={`poscp-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
        />
        <PairCombobox
          id={`poscp-pair-${panelId}`}
          label="Pair (empty = follow open positions)"
          value={cfg.pair}
          pairs={availablePairs}
          onChange={(pair) => patch({ pair })}
        />
        <SettingsSelect
          id={`poscp-tf-${panelId}`}
          label="Timeframe"
          items={TIMEFRAME_ITEMS.map((i) => ({ ...i }))}
          value={cfg.timeframe}
          onChange={(id) =>
            patch({
              timeframe: Schema.decodeUnknownSync(
                PositionCandlePublicTimeframe,
              )(id),
            })
          }
        />
        <NumberInput
          id={`poscp-limit-${panelId}`}
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
            id={`poscp-sma20-${panelId}`}
            label="SMA 20"
            toggled={cfg.showSma20}
            onToggle={(v) => patch({ showSma20: v })}
          />
          <SettingsToggle
            id={`poscp-sma50-${panelId}`}
            label="SMA 50"
            toggled={cfg.showSma50}
            onToggle={(v) => patch({ showSma50: v })}
          />
          <SettingsToggle
            id={`poscp-ema-${panelId}`}
            label="EMA 12"
            toggled={cfg.showEma12}
            onToggle={(v) => patch({ showEma12: v })}
          />
          <SettingsToggle
            id={`poscp-bb-${panelId}`}
            label="Bollinger"
            toggled={cfg.showBollinger}
            onToggle={(v) => patch({ showBollinger: v })}
          />
          <SettingsToggle
            id={`poscp-vwap-${panelId}`}
            label="VWAP"
            toggled={cfg.showVwap}
            onToggle={(v) => patch({ showVwap: v })}
          />
          <SettingsToggle
            id={`poscp-vol-${panelId}`}
            label="Volume"
            toggled={cfg.showVolume}
            onToggle={(v) => patch({ showVolume: v })}
          />
        </div>
        <SettingsSelect
          id={`poscp-sub-${panelId}`}
          label="Subplot"
          items={SUBPLOT_ITEMS.map((i) => ({ ...i }))}
          value={cfg.subplot}
          onChange={(id) =>
            patch({
              subplot: Schema.decodeUnknownSync(PositionCandlePublicSubplot)(
                id,
              ),
            })
          }
        />
      </WidgetSettingsModal>
      <WidgetFrame
        title={
          effectivePair
            ? `Position · ${effectivePair} · ${cfg.timeframe}${pinned.length === 0 && buckets.length > 0 ? " · auto" : ""}`
            : "Position Chart (Public)"
        }
        isLoading={state.isLoading}
        error={accessError ?? state.error}
      >
        {effectivePair.length > 0 && candles.length >= 2 ? (
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
              <span
                className="nfi-candle-pair"
                title={`${candles.length} candles loaded`}
              >
                {effectivePair}
              </span>
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
              {positionsAccess.allowed ? (
                <PositionPairChips
                  options={chipOptions}
                  activeKey={pinned.length > 0 ? pinned : null}
                  autoActive={pinned.length === 0}
                  onAuto={() => patch({ pair: "" })}
                  onPick={(key) => patch({ pair: key })}
                />
              ) : null}
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
                {followedAvg !== null ? (
                  <span
                    className="nfi-candle-range"
                    title={`${pairOpen.length} open position${pairOpen.length === 1 ? "" : "s"} · average open PnL`}
                  >
                    {fmtCompact(
                      pairOpen.reduce(
                        (s, p) => s + (p.allocationWeight ?? 0),
                        0,
                      ) * 100,
                    )}
                    % wt{" "}
                    <span
                      className={
                        followedAvg >= 0
                          ? "nfi-pnl-positive"
                          : "nfi-pnl-negative"
                      }
                    >
                      ({followedAvg >= 0 ? "+" : ""}
                      {followedAvg.toFixed(2)}%)
                    </span>
                  </span>
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
            <CandleChart
              candles={candles}
              overlays={overlays}
              showVolume={cfg.showVolume}
              subplot={subplot}
              tradeMarkers={positionMarkers}
              avgEntryPrice={entryBaseline}
              avgEntryIsShort={followedIsShort}
              avgEntrySince={entrySince}
              followMarkers
              avgEntryTitle={
                entryBaseline !== null
                  ? `entry lvl ${entryBaseline.toFixed(chartPrecision)}`
                  : undefined
              }
            />
            {!pinnedOpen && pinned.length > 0 ? (
              <p style={{ fontSize: "0.75rem", opacity: 0.6, margin: 0 }}>
                {pinned} has no open position — showing its history. Pick a
                chip in the toolbar to follow a live one.
              </p>
            ) : null}
          </div>
        ) : (
          <EmptyState
            title={effectivePair.length === 0 ? "No open positions" : "No candles"}
            hint={
              effectivePair.length === 0
                ? "Flat is a position too — the chart follows your next open trade automatically. Pick an instance in ⚙ settings."
                : strategyFallback !== undefined
                  ? `Your bot analyzes ${strategyFallback} — ${cfg.timeframe} isn't analyzed for ${effectivePair}, so there's no live chart for it.`
                  : `Freqtrade has no analyzed data for ${effectivePair} · ${cfg.timeframe} — the pair may be off the bot's whitelist or the timeframe unanalyzed.`
            }
          >
            {effectivePair.length > 0 && strategyFallback !== undefined ? (
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

export const PositionCandlePublicWidgetDef = defineWidget({
  type: "position-candle-public",
  hasSettings: true,
  title: "Position Chart (Public)",
  description:
    "Shareable candle chart that follows open positions — quick-switch chips per pair, entry/exit markers with tags and percentages, and entry-level profit/loss shading. No amounts or order detail.",
  configSchema: PositionCandlePublicConfigSchema,
  defaultConfig: POSITION_CANDLE_PUBLIC_DEFAULTS,
  component: PositionCandlePublicWidget,
  capabilities: [...POSITION_CANDLE_PUBLIC_CAPABILITIES],
  minWidth: 560,
  minHeight: 420,
  defaultWidth: 960,
  defaultHeight: 640,
});
