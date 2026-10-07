// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Position candles — the chart that follows your open positions.
 *
 * The sensitive twin of `position-candle-public`: instead of a fixed pair,
 * the widget watches every open position (one instance or the whole fleet)
 * and charts the selected one. The quick-selector chip row jumps between
 * open pairs without opening settings; `Auto` tracks the newest open
 * position as trades open and close, and a followed pair the chart watches
 * closing hands control back to auto instead of parking on its history
 * (pinning an already-closed pair stays a deliberate history review).
 *
 * The toolbar pair combobox (and the ⚙ picker) lists EVERY pair with trade
 * history (SQL over the mirror — including long-delisted pairs the
 * whitelist forgot), and a pinned pair loads its FULL closed history, so a
 * pick is a complete all-trades chart review, not just the newest window.
 * Switching pairs auto-focuses the latest position: the window re-fits to
 * cover its entry → now, and the view pans to its newest marker.
 *
 * Entry/exit markers and tags are always built from the pair's sub-orders
 * (violet entry dots labeled with the order tag, amber exit arrows), and
 * the focused position's entry level shades its profit/loss area green/red
 * — the same trade overlay as `candle-chart`. The pager (‹ i/x ›) steps
 * through every position of the pair, open and closed, newest first;
 * stepping never touches the timeframe (the window fit is a per-pair
 * decision) — it recenters the view on the focused entry and, when that
 * entry predates the loaded candles, pages history back until it is
 * covered (the pager's spinner).
 */

import { Button, NumberInput } from "@carbon/react";
import { Schema } from "effect";
import { RSI } from "lightweight-charts-indicators";
import type { Capability } from "@nfi/api-contract";
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
import { ALL_INSTANCES, InstanceSelect } from "./shared/InstanceSelect";
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
  averageEntryPrice as computeAverageEntry,
  buildHistoryPnlSpans,
  buildTradeMarkers,
  earliestEntrySecond,
  timeframeSeconds,
  type HistoryPnlSpan,
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
import { PositionPager } from "./shared/PositionPager";
import {
  useClosedPositionsSource,
  useOpenPositionsSource,
  type SourcedClosedPosition,
  type SourcedOpenPosition,
} from "./shared/sources";
import { useCandleHistory, mergeOlderCandles } from "./shared/candleHistory";
import { useCandlePending } from "./shared/candlePending";
import { useStrategyTimeframe } from "./shared/strategyTimeframe";

export const POSITION_CANDLE_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.candles",
  "instances.pairs",
  "instances.plot-config",
  "instances.open-positions",
  "instances.closed-positions",
  "instances.positions-all",
  "instances.closed-all",
  // History pair picker: every pair the scope actually traded.
  "instances.traded-pairs",
];

export const PositionCandleTimeframe = Schema.Literal(
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
);

export type PositionCandleTimeframe = typeof PositionCandleTimeframe.Type;

export const PositionCandleSubplot = Schema.Literal("none", "rsi", "macd");

export type PositionCandleSubplot = typeof PositionCandleSubplot.Type;

export const PositionCandleConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  /** Followed pair — empty means auto (newest open position). */
  pair: stringWithDefault(""),
  timeframe: Schema.optionalWith(PositionCandleTimeframe, {
    default: (): PositionCandleTimeframe => "5m",
  }),
  limit: numberWithDefault(200),
  showSma20: booleanWithDefault(false),
  showSma50: booleanWithDefault(false),
  showEma12: booleanWithDefault(false),
  showBollinger: booleanWithDefault(false),
  showVwap: booleanWithDefault(false),
  showVolume: booleanWithDefault(false),
  /** Violet entry dots + amber exit arrows — always on (legacy flag). */
  showTrades: booleanWithDefault(true),
  /** Blue dashed avg-entry line with green/red PnL fill — always on (legacy). */
  showAvgEntry: booleanWithDefault(true),
  subplot: Schema.optionalWith(PositionCandleSubplot, {
    default: (): PositionCandleSubplot => "none",
  }),
});

export type PositionCandleConfig = typeof PositionCandleConfigSchema.Type;

export const POSITION_CANDLE_DEFAULTS: PositionCandleConfig =
  Schema.decodeUnknownSync(PositionCandleConfigSchema)({});

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
  readonly id: PositionCandleSubplot;
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
  readonly bots: string;
  /** Instance owning the largest-stake position (drives candles on fleet). */
  readonly ownerInstanceId: string;
  readonly newestOpen: number;
}

/**
 * Stable empty input for `useDerived(..., bucketByPair)`: an inline
 * `?? []` would mint a fresh (never-equal) array on every render while the
 * query is uncached, and `useDerived`'s render-time `setState` would then
 * re-render forever (page-unresponsive). See `PairUniverseWidget`.
 */
const EMPTY_SOURCED_OPEN: ReadonlyArray<SourcedOpenPosition> = [];

const EMPTY_PAIRS: ReadonlyArray<string> = [];

/** Backward history pages the pager may pull per focus anchor. */
const PAGER_BACKFILL_MAX_PAGES = 8;

function bucketByPair(
  positions: ReadonlyArray<SourcedOpenPosition>,
): PairBucket[] {
  const groups = new Map<
    string,
    {
      count: number;
      pnlSum: number;
      pnlCount: number;
      bots: Set<string>;
      ownerInstanceId: string;
      ownerStake: number;
      newestOpen: number;
    }
  >();

  for (const p of positions) {
    const entry = groups.get(p.pair) ?? {
      count: 0,
      pnlSum: 0,
      pnlCount: 0,
      bots: new Set<string>(),
      ownerInstanceId: p.instanceId ?? "",
      ownerStake: -1,
      newestOpen: 0,
    };

    entry.count += 1;

    if (p.profitPct !== undefined && Number.isFinite(p.profitPct)) {
      entry.pnlSum += p.profitPct;
      entry.pnlCount += 1;
    }

    const bot = p.instanceName ?? p.instanceId;

    if (bot) entry.bots.add(bot);

    if (
      p.instanceId !== undefined &&
      Number.isFinite(p.stakeAmount) &&
      p.stakeAmount > entry.ownerStake
    ) {
      entry.ownerStake = p.stakeAmount;
      entry.ownerInstanceId = p.instanceId;
    }

    entry.newestOpen = Math.max(entry.newestOpen, parseTradeTime(p.openDate));
    groups.set(p.pair, entry);
  }

  return [...groups.entries()]
    .map(([pair, g]): PairBucket => ({
      pair,
      count: g.count,
      pnl: g.pnlCount > 0 ? g.pnlSum / g.pnlCount : undefined,
      bots: [...g.bots].join(", "),
      ownerInstanceId: g.ownerInstanceId,
      newestOpen: g.newestOpen,
    }))
    .sort(
      (a, b) => b.newestOpen - a.newestOpen || a.pair.localeCompare(b.pair),
    );
}

/** Header chip for the followed position(s): `3 @ 0.3456 (+2.10%)`. */
function PositionChip({
  positions,
  avgEntry,
  precision,
  compact,
  kind = "open",
}: {
  positions: ReadonlyArray<{
    amount: number;
    profitPct?: number;
    closeProfitPct?: number;
  }>;
  avgEntry: number;
  precision: number;
  compact: boolean;

  /** `closed` reads the realized pct (closeProfitPct first) and says so. */
  kind?: "open" | "closed";
}) {
  const single = positions.length === 1 ? positions[0] : undefined;

  const pctCandidates =
    kind === "closed" && single !== undefined
      ? [single.closeProfitPct, single.profitPct]
      : [single?.profitPct];

  const pct = pctCandidates.find((v) => v !== undefined && Number.isFinite(v));

  const hasPct = pct !== undefined && Number.isFinite(pct);

  if (compact && !hasPct) return null;

  const totalAmount = positions.reduce(
    (sum, p) => sum + (Number.isFinite(p.amount) ? p.amount : 0),
    0,
  );

  const title =
    positions.length === 1
      ? `${kind === "closed" ? "Closed position" : "Open position"} · avg entry ${avgEntry.toFixed(precision)}`
      : `${positions.length} open positions · avg entry ${avgEntry.toFixed(precision)}`;

  return (
    <span className="nfi-candle-range" title={title}>
      {compact ? null : (
        <>
          {fmtCompact(totalAmount)} @ {avgEntry.toFixed(precision)}{" "}
        </>
      )}
      {hasPct ? (
        <span className={pct >= 0 ? "nfi-pnl-positive" : "nfi-pnl-negative"}>
          ({pct >= 0 ? "+" : ""}
          {pct.toFixed(2)}%)
        </span>
      ) : null}
    </span>
  );
}

export function PositionCandleWidget({
  config,
  panelId,
}: WidgetProps<PositionCandleConfig>) {
  // Session-aware binding — patches persist, or fall back to a per-browser
  // session layer when the panel sink refuses writes (anonymous visitors).
  const { config: cfg, patch } = useWidgetConfigSink(
    panelId,
    "position-candle",
    config,
  );

  const limit = clampInt(cfg.limit, 200, 20, 1000);
  const fleet = cfg.instanceId === ALL_INSTANCES;

  const market = useWidgetAccess([
    "instances.candles",
    "instances.pairs",
    ...(fleet ? (["instances.positions-all"] as const) : []),
  ]);

  const indicatorsAccess = useWidgetAccess(["instances.plot-config"]);

  const tradesAccess = useWidgetAccess(
    fleet
      ? ["instances.positions-all", "instances.closed-all"]
      : ["instances.open-positions", "instances.closed-positions"],
  );

  // History picker source: every pair with trades in the mirror (SQL over
  // the FULL history — includes long-delisted pairs the whitelist forgot).
  const historyAccess = useWidgetAccess(["instances.traded-pairs"]);

  const tradedQ = useCapability(
    "instances.traded-pairs",
    { id: fleet ? undefined : cfg.instanceId },
    { enabled: historyAccess.allowed },
  );

  // Quick-selector source: every open position (fleet-aware).
  const openSrc = useOpenPositionsSource(cfg.instanceId, {
    enabled: tradesAccess.allowed,
  });

  const buckets = useDerived(openSrc.data ?? EMPTY_SOURCED_OPEN, bucketByPair);

  // Closed history rides along so a followed position that exits keeps its
  // chart: newest-first window (fleet aggregate or per-instance, limit 200).
  const closedSrc = useClosedPositionsSource(cfg.instanceId, 200, {
    enabled: tradesAccess.allowed,
  });

  // Pinned pair → FULL history for that pair: the mirror search is pushed
  // to SQL (the predicate covers every closed trade, not a fetched
  // window), so a deliberate history review shows all of the pair's trade
  // markers — capped at the server's 5000-trade page. Unpinned (auto)
  // mode never pays for it.
  const pinned = cfg.pair.trim();

  const pinnedHistorySrc = useClosedPositionsSource(cfg.instanceId, 5000, {
    enabled: tradesAccess.allowed && pinned.length > 0,
    search: pinned,
  });

  const pinnedBucket = pinned
    ? (buckets.find((b) => b.pair === pinned) ?? null)
    : null;

  // Auto mode follows the newest open position; a pinned pair stays put
  // until the user picks another — EXCEPT when the chart watches it close
  // (below): a pair whose last open position exits hands control back to
  // auto so the widget updates itself instead of parking on history.
  // With a FLAT book (no open position anywhere) auto follows the newest
  // closed position's pair — the exit — instead of blanking to "No open
  // positions": the exit is exactly what there is to see once a trade
  // closes, markers included.
  const newestClosedPair = useDerived(
    closedSrc.data,
    (data): string => data?.[0]?.pair ?? "",
  );

  const effectivePair: string =
    pinned || buckets[0]?.pair || newestClosedPair || "";

  const autoActive = pinned.length === 0;

  // Closed-position auto-advance: a pin only ever pins LIVE positions.
  // When a followed pair's last open position exits — observed as the
  // transition live → absent across settled open-positions frames — the
  // pin clears and auto takes over (the next newest open position, or —
  // flat book — the newest closed position's chart). A pin set on an
  // already-closed pair (deliberate history review, including across
  // reloads) stays: only a watched close advances. Data-undefined frames
  // (instance switch, disabled feed) reset the transition tracking so a
  // loading feed can never wipe the pin.
  //
  // The tracker remembers WHICH pair was observed live, not just that some
  // pair was: without the identity, moving the pin from an open pair to a
  // history-only one reads as "the watched pair exited" and the fresh pin
  // snapped straight back to auto — the first pair change did nothing and
  // only the second pick stuck.
  const pinWasLive = useLocalStore<string | null>(null);

  useStoreEffect(() => {
    if (!tradesAccess.allowed || openSrc.data === undefined) {
      pinWasLive.setState(() => null);

      return;
    }

    if (pinned.length === 0) {
      pinWasLive.setState(() => null);

      return;
    }

    if (pinnedBucket !== null) {
      pinWasLive.setState(() => pinned);

      return;
    }

    if (pinWasLive.state === pinned) {
      // The pair we were watching just exited — hand control to auto.
      pinWasLive.setState(() => null);
      patch({ pair: "" });

      return;
    }

    // The pin moved to a pair with no open position (a deliberate pick of
    // history): forget the stale observation, keep the pin.
    pinWasLive.setState(() => null);
  }, [tradesAccess.allowed, openSrc.data, pinned, pinnedBucket]);

  // The followed pair's open and closed positions (closed window is the
  // newest-first 200). All of them form the pager's sequence, newest open
  // date first.
  const pairOpen = useDerived(
    [openSrc.data, effectivePair] as const,
    ([data, pair]) => (data ?? []).filter((p) => p.pair === pair),
    { inputs: shallow },
  );

  // Pinned pair: the search-backed FULL history (exact-pair guard — the
  // SQL needle is a substring that can also match tags/strategies). Auto
  // mode: the newest-first 200 window, exactly as before.
  const pairClosed = useDerived(
    [pinnedHistorySrc.data, closedSrc.data, effectivePair, pinned] as const,
    ([pinnedRows, windowRows, pair, pin]) => {
      if (pin.length > 0) {
        return (pinnedRows ?? []).filter((p) => p.pair === pair);
      }

      return (windowRows ?? []).filter((p) => p.pair === pair);
    },
    { inputs: shallow },
  );

  // One sequence of every position the pair ever had (open + closed),
  // OLDEST first — so the pager's `i/x` reads x/x on the newest position
  // and ‹ walks back into history.
  const pairPositions = useDerived(
    [pairOpen, pairClosed] as const,
    ([open, closed]) =>
      [...open, ...closed].sort(
        (a, b) =>
          parseTradeTime(a.openDate) - parseTradeTime(b.openDate) ||
          a.tradeId - b.tradeId,
      ),
    { inputs: shallow },
  );

  // Which of the pair's positions the chart anchors to, counted from the
  // END (0 = newest) so a freshly opened trade keeps the pager pinned on
  // x/x. Resets when the pair changes; the newest position is the default
  // anchor.
  const posStore = useLocalStore<{ pair: string; fromEnd: number }>({
    pair: "",
    fromEnd: 0,
  });

  if (posStore.state.pair !== effectivePair) {
    posStore.setState(() => ({ pair: effectivePair, fromEnd: 0 }));
  }

  const posCount = pairPositions.length;

  const fromEnd = Math.min(
    Math.max(posStore.state.fromEnd, 0),
    Math.max(0, posCount - 1),
  );

  const posIndex = posCount === 0 ? 0 : posCount - 1 - fromEnd;
  const pagerIndex = posCount - fromEnd;

  const focused = pairPositions[posIndex];

  const focusedOpen = focused?.isOpen === true;

  // On fleet views candles come from the followed pair's largest-stake
  // owner (same pair, same market there); single-instance is direct. When
  // the chart follows a closed position (flat book), the candles come from
  // that position's own bot.
  const followedClosed = useDerived(
    [pairClosed] as const,
    ([closed]): SourcedClosedPosition | undefined => closed[0],
    { inputs: shallow },
  );

  const exitFollowed = useDerived(
    [pairOpen, followedClosed] as const,
    ([open, closed]) => open.length === 0 && closed !== undefined,
    { inputs: shallow },
  );

  const candleInstanceId =
    fleet && !autoActive && pinnedBucket
      ? pinnedBucket.ownerInstanceId || cfg.instanceId
      : fleet
        ? buckets.find((b) => b.pair === effectivePair)?.ownerInstanceId ||
          (exitFollowed ? followedClosed?.instanceId : undefined) ||
          cfg.instanceId
        : cfg.instanceId;

  const candlesQ = useCapability(
    "instances.candles",
    {
      id: candleInstanceId === ALL_INSTANCES ? "default" : candleInstanceId,
      pair: effectivePair,
      timeframe: cfg.timeframe,
      limit: String(limit),
    },
    { enabled: market.allowed && effectivePair.length > 0 },
  );

  const pairsQ = useCapability(
    "instances.pairs",
    {
      id: candleInstanceId === ALL_INSTANCES ? "default" : candleInstanceId,
      timeframe: cfg.timeframe,
    },
    { enabled: market.allowed },
  );

  const marketError = market.allowed
    ? null
    : `Not authorized — needs ${market.missing.join(", ")}`;

  const showSettings = useWidgetSettingsOpen(panelId);

  const candles = useDerived(candlesQ.data, (data) => data?.candles ?? []);

  // Infinite scroll-back: older exchange pages accumulate as the user pans
  // toward the oldest bar. The merged series feeds the chart and the
  // indicator math; the auto-fit/refit effects below keep reading the LIVE
  // window's bounds so their once-per-(pair, entry) behavior is unchanged.
  const history = useCandleHistory({
    enabled: market.allowed && effectivePair.length > 0,
    instanceId:
      candleInstanceId === ALL_INSTANCES ? "default" : candleInstanceId,
    pair: effectivePair,
    timeframe: cfg.timeframe,
  });

  const allCandles = useDerived(
    [candles, history.older] as const,
    ([live, older]) =>
      older.length > 0 ? mergeOlderCandles(older, live) : live,
    { inputs: shallow },
  );

  // Timeframe/pair switches refetch in the background while a cached EMPTY
  // result for the new key would otherwise flash "no analyzed data" with no
  // loader. Hold the loading state through a short grace so long analyses
  // read as loading, and only then fall through to the honest empty state.
  const candlesPending = useCandlePending(
    `${candleInstanceId}|${effectivePair}|${cfg.timeframe}|${limit}`,
    candles.length >= 2,
    candlesQ.isLoading,
  );

  const state = queryState(
    market.allowed
      ? (candlesQ.error ?? openSrc.error ?? pinnedHistorySrc.error)
      : null,
    market.allowed &&
      (candlesQ.isLoading ||
        openSrc.isLoading ||
        candlesPending ||
        (pinned.length > 0 && pinnedHistorySrc.isLoading)),
  );

  // Strategy timeframe of the candle owner (fleet: the followed pair's
  // largest-stake owner). Names the empty-state recovery button; never
  // gates rendering by itself.
  const strategyTf = useStrategyTimeframe(
    candleInstanceId === ALL_INSTANCES ? undefined : candleInstanceId,
  );

  const strategyFallback =
    strategyTf !== undefined &&
    strategyTf !== cfg.timeframe &&
    TIMEFRAME_ITEMS.some((t) => t.id === strategyTf)
      ? strategyTf
      : undefined;

  // Pair self-heal (same as candle-chart): adopt the settled variant when
  // the followed pair is not on the whitelist. Closed-history follows are
  // exempt — exited pairs routinely drop off the whitelist, and rewriting
  // the followed pair there would navigate AWAY from the exit the user is
  // looking at (and, in auto mode, silently set a pin). A pin on any
  // TRADED pair is a deliberate history review (the picker only offers
  // pairs with trades), so self-heal never touches it either.
  const tradedSet = useDerived(
    tradedQ.data,
    (data): ReadonlySet<string> =>
      new Set((data?.pairs ?? []).map((r) => r.pair)),
    { inputs: shallow },
  );

  useStoreEffect(() => {
    const whitelist = pairsQ.data?.pairs;

    if (!whitelist || whitelist.length === 0 || effectivePair.length === 0)
      return;

    if (pinned.length === 0 && pairOpen.length === 0) return;

    if (pinned.length > 0 && tradedSet.has(pinned)) return;

    // A pin is a deliberate pick — never rewrite it while the traded set
    // is still loading: an empty set would evict any off-whitelist pin and
    // the first pair change would snap straight back. Once loaded, traded
    // pins are exempt above; only genuinely stray pins still heal.
    if (pinned.length > 0 && tradedQ.data === undefined) return;

    if (whitelist.includes(effectivePair)) return;
    const base = effectivePair.split("/")[0] ?? effectivePair;
    const settled = whitelist.find((p) => p === `${effectivePair}:USDT`);
    const byBase = whitelist.find((p) => (p.split("/")[0] ?? "") === base);
    const next = settled ?? byBase;

    if (next) patch({ pair: next });
  }, [pairsQ.data, effectivePair, pinned, pairOpen, tradedSet]);

  const bars = useDerived(allCandles, (src): IndicatorBar[] =>
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

  // Toolbar readouts (H/L/ΣV) stay scoped to the LIVE window — merged
  // history would turn them into all-time stats that never match the
  // chart's "N candles loaded" framing.
  const liveBars = useDerived(candles, (src): IndicatorBar[] =>
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

  // The focused position's entry rate anchors the entry line + PnL area.
  const avgEntry = useDerived(
    [focused, tradesAccess.allowed] as const,
    ([f, allowed]): number | null => {
      // Position charts always show the avg-entry line (no toggle) — the
      // line plus its PnL shading is the widget's core purpose. A closed
      // focus anchors it at the exit position's entry rate.
      if (!allowed || !f) return null;

      return computeAverageEntry([
        { openRate: f.openRate, stakeAmount: f.stakeAmount },
      ]);
    },
    { inputs: shallow },
  );

  // Short direction drives the PnL fill side: price below entry is profit
  // for shorts (green below), above is profit for longs.
  const focusedIsShort = useDerived(
    [focused] as const,
    ([f]): boolean => f?.isShort === true,
    { inputs: shallow },
  );

  // Entry-anchored fill start + view anchor (snapped to the candle bucket,
  // like the markers): shading covers the focused position's entry → its
  // exit (closed) or → newest (open), never pre-entry history.
  const focusedEntryBucket = useDerived(
    [focused, cfg.timeframe] as const,
    ([f, timeframe]): number | null => {
      const at = f ? earliestEntrySecond([f]) : null;

      if (at === null) return null;

      const tfSec = timeframeSeconds(timeframe);

      return tfSec === null ? at : Math.floor(at / tfSec) * tfSec;
    },
    { inputs: shallow },
  );

  // Pager coverage: whether the focused position's entry bucket sits
  // inside the loaded candle window. Paging keeps the timeframe frozen
  // (the window fit no longer zooms out per focus), so a step back can
  // anchor on a bar older than the loaded data — the driver below pages
  // history back until the entry is covered, and the flag rides
  // `focusNonce` so the view jumps to it exactly when the data lands.
  const focusedCovered = useDerived(
    [focusedEntryBucket, allCandles] as const,
    ([entry, src]): boolean =>
      entry === null ||
      src.length === 0 ||
      (src[0] !== undefined && src[0].time / 1000 <= entry),
    { inputs: shallow },
  );

  // Pull history back to the focused position: each step — and each landed
  // backward page — re-runs this and fetches one more page while the entry
  // bucket is older than the loaded window (or the exchange runs dry).
  // `loadOlder` no-ops while a page is already in flight. A per-anchor page
  // budget bounds the loop: a very old entry on a fine timeframe must not
  // stream the exchange into the chart forever — manual zoom-out stays the
  // escape hatch past the budget.
  const backfillStore = useLocalStore<{ key: string; pages: number }>({
    key: "",
    pages: 0,
  });

  useStoreEffect(() => {
    if (!market.allowed || focusedEntryBucket === null) return;

    const oldestMs = allCandles[0]?.time;

    if (oldestMs === undefined || oldestMs / 1000 <= focusedEntryBucket) return;

    const anchorKey = `${effectivePair}|${focusedEntryBucket}`;

    if (backfillStore.state.key !== anchorKey) {
      backfillStore.setState(() => ({ key: anchorKey, pages: 0 }));
    }

    if (history.loading || history.exhausted) return;

    if (backfillStore.state.pages >= PAGER_BACKFILL_MAX_PAGES) return;

    backfillStore.setState((s) => ({
      key: anchorKey,
      pages: (s.key === anchorKey ? s.pages : 0) + 1,
    }));

    history.loadOlder(oldestMs);
  }, [
    focusedEntryBucket,
    allCandles,
    history.loading,
    history.exhausted,
    market.allowed,
  ]);

  // Fill END: a focused CLOSED position stops the PnL shading at its exit
  // bucket — the trade's story ends there, and the dashed entry level goes
  // with it (no live entry left to track).
  const entryUntil = useDerived(
    [focused, focusedOpen, cfg.timeframe] as const,
    ([f, isOpen, timeframe]): number | null => {
      if (!f || isOpen || !("closeDate" in f)) return null;

      const closedAt = parseTradeTime(f.closeDate);

      if (!closedAt) return null;

      const sec = Math.floor(closedAt / 1000);
      const tfSec = timeframeSeconds(timeframe);

      return tfSec === null ? sec : Math.floor(sec / tfSec) * tfSec;
    },
    { inputs: shallow },
  );

  // Closed focus: the area paints by the realized outcome (green winner /
  // red loser) instead of the live split around the entry.
  const focusedProfitPct = useDerived(
    [focused, focusedOpen] as const,
    ([f, isOpen]): number | null => {
      if (!f || isOpen) return null;

      const pct =
        "closeProfitPct" in f
          ? [f.closeProfitPct, f.profitPct]
          : [f.profitPct];

      const resolved = pct.find((v) => v !== undefined && Number.isFinite(v));

      return resolved ?? null;
    },
    { inputs: shallow },
  );

  // Per-trade PnL areas for the pair's PAST closed trades (entry bucket →
  // exit bucket, shaded against each trade's real open rate). The focused
  // position's own window is shaded by the main avg-entry area above, so
  // spans skip it.
  const historySpans = useDerived(
    [focused, focusedOpen, pairClosed, cfg.timeframe, tradesAccess.allowed] as const,
    ([f, isOpen, closed, timeframe, allowed]): HistoryPnlSpan[] => {
      if (!allowed) return [];

      const tfSec = timeframeSeconds(timeframe);

      if (tfSec === null) return [];

      const past =
        !f || isOpen
          ? closed
          : closed.filter((p) => p.tradeId !== f.tradeId);

      return buildHistoryPnlSpans(past, tfSec, (p) =>
        Number.isFinite(p.openRate) && p.openRate > 0 ? p.openRate : null,
      );
    },
    { inputs: shallow },
  );

  // Window-fit source: the OLDEST entry second across the pair's WHOLE
  // position history (open + closed), so the fitted window covers every
  // shaded trade. Derived from the pair's positions rather than the
  // focused one on purpose: stepping with the pager changes which
  // position is anchored, not the pair's span — the timeframe/limit must
  // stay put while paging (the pager pulls history back instead). Only a
  // pair switch or a genuinely older trade changes this anchor.
  const fitSourceSec = useDerived(pairPositions, (positions): number | null => {
    let oldest: number | null = null;

    for (const position of positions) {
      const at = earliestEntrySecond([position]);

      if (at !== null && (oldest === null || at < oldest)) oldest = at;
    }

    return oldest;
  });

  // Window auto-fit: the chart must cover the pair's oldest entry (see
  // `fitSourceSec`), which the default 200 × 5m window cannot for pairs
  // traded before ~17h ago. Zoom out (timeframe and/or limit) until the
  // entry fits. Applied at most once per source instant so a user's manual
  // timeframe pick is never fought over — and never while merely paging,
  // which leaves this anchor untouched.
  const fitKeyStore = useLocalStore<string | null>(null);

  useStoreEffect(() => {
    const entrySec = fitSourceSec;

    if (entrySec === null || effectivePair.length === 0) return;

    const fit = fitWindowToEntry(entrySec, cfg.timeframe, limit);

    if (fit === null) return;

    const fitKey = `${effectivePair}@${entrySec}`;

    if (fitKeyStore.state === fitKey) return;
    fitKeyStore.setState(() => fitKey);
    patch({ timeframe: fit.timeframe, limit: fit.limit });
  }, [fitSourceSec, cfg.timeframe, limit, effectivePair]);

  // Data-shortfall refit: freqtrade only keeps a rolling analyzed window
  // (a few hundred candles), so an old entry can sit BEFORE the loaded
  // data even at max limit. One coarser step lands on the exchange-backed
  // timeframe, whose history reaches years back. Also once per source
  // instant — the user keeps whatever they switch to manually afterwards.
  const refitKeyStore = useLocalStore<string | null>(null);

  useStoreEffect(() => {
    const entrySec = fitSourceSec;

    if (entrySec === null || effectivePair.length === 0) return;

    const firstCandle = candles[0];

    if (!firstCandle || Math.floor(firstCandle.time / 1000) <= entrySec) return;

    const refitKey = `${effectivePair}@${entrySec}`;

    if (refitKeyStore.state === refitKey) return;

    const fit = fitWindowToEntry(entrySec, cfg.timeframe, limit, {
      mode: "coarser-only",
    });

    if (fit === null) return;
    refitKeyStore.setState(() => refitKey);
    patch({ timeframe: fit.timeframe, limit: fit.limit });
  }, [fitSourceSec, candles, cfg.timeframe, limit, effectivePair]);

  const candleSecs = useDerived(bars, (src): number[] =>
    src.map((b) => b.time),
  );

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
    [pairOrders, candleSecs, cfg.timeframe, tradesAccess.allowed] as const,
    ([orders, secs, timeframe, allowed]): TvTradeMarker[] => {
      // Position charts always show trade markers (no toggle).
      if (!allowed || orders.length === 0 || secs.length === 0) return [];
      const tfSec = timeframeSeconds(timeframe);

      if (tfSec === null) return [];

      return buildTradeMarkers(orders, secs, tfSec).map((m) => ({
        time: utcSeconds(m.time),
        kind: m.kind,
        labels: m.labels,
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
    ]) =>
      allowed
        ? buildIndicatorOverlays(bars, {
            showSma20,
            showSma50,
            showEma12,
            showBollinger,
            showVwap,
          })
        : [],
    { inputs: shallow },
  );

  const subplot = useDerived(
    [bars, cfg.subplot, indicatorsAccess.allowed, palette] as const,
    ([bars, kind, allowed, pal]) =>
      allowed ? buildIndicatorSubplot(bars, kind, pal) : null,
    { inputs: shallow },
  );

  const rsiPlots = useDerived(
    [bars, cfg.subplot, indicatorsAccess.allowed] as const,
    ([bars, kind, allowed]) =>
      allowed && bars.length > 0 && kind === "rsi"
        ? RSI.calculate(bars, { length: 14 }).plots.plot0
        : [],
    { inputs: shallow },
  );

  const lastRsi = cfg.subplot === "rsi" ? lastPlotValue(rsiPlots) : null;

  const narrow = useNarrowMode(420);

  // Picker list: pairs the scope actually traded (SQL over the full
  // mirror — includes delisted history the whitelist forgot). Without the
  // traded-pairs grant the picker falls back to the whitelist so pinning
  // still works; the manual-entry fallback in the combobox covers the
  // no-list case entirely.
  const tradedPickerPairs = useDerived(
    tradedQ.data,
    (data): ReadonlyArray<string> => (data?.pairs ?? []).map((r) => r.pair),
    { inputs: shallow },
  );

  const availablePairs =
    historyAccess.allowed && tradedPickerPairs.length > 0
      ? tradedPickerPairs
      : (pairsQ.data?.pairs ?? EMPTY_PAIRS);

  // Exchange-sourced candles (backend fallback for unanalyzed timeframes).
  const isMarketData = candlesQ.data?.source === "exchange";

  // Open-position chips; on a flat book a single dimmed chip names the
  // followed exit so the auto-followed closed position stays visible and
  // one click pins it for history review.
  const chipOptions: PositionChipOption[] = exitFollowed
    ? followedClosed
      ? [
          {
            key: followedClosed.pair,
            label: followedClosed.pair,
            pnl: followedClosed.closeProfitPct ?? followedClosed.profitPct,
            detail:
              followedClosed.exitReason ??
              (fleet ? followedClosed.instanceName : undefined),
            closed: true,
          },
        ]
      : []
    : buckets.map((b) => ({
        key: b.pair,
        label: b.pair,
        pnl: b.pnl,
        count: fleet ? b.count : undefined,
        detail: fleet && b.bots ? b.bots : undefined,
      }));

  const windowStats = useDerived(liveBars, (src) => {
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
        title="Position chart settings"
        widgetType="position-candle"
      >
        <InstanceSelect
          id={`posc-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <PairCombobox
          id={`posc-pair-${panelId}`}
          label="Pair — traded history (empty = follow open positions)"
          value={cfg.pair}
          pairs={availablePairs}
          onChange={(pair) => patch({ pair })}
        />
        <SettingsSelect
          id={`posc-tf-${panelId}`}
          label="Timeframe"
          items={TIMEFRAME_ITEMS.map((i) => ({ ...i }))}
          value={cfg.timeframe}
          onChange={(id) =>
            patch({
              timeframe: Schema.decodeUnknownSync(PositionCandleTimeframe)(id),
            })
          }
        />
        <NumberInput
          id={`posc-limit-${panelId}`}
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
                id={`posc-sma20-${panelId}`}
                label="SMA 20"
                toggled={cfg.showSma20}
                onToggle={(v) => patch({ showSma20: v })}
              />
              <SettingsToggle
                id={`posc-sma50-${panelId}`}
                label="SMA 50"
                toggled={cfg.showSma50}
                onToggle={(v) => patch({ showSma50: v })}
              />
              <SettingsToggle
                id={`posc-ema-${panelId}`}
                label="EMA 12"
                toggled={cfg.showEma12}
                onToggle={(v) => patch({ showEma12: v })}
              />
              <SettingsToggle
                id={`posc-bb-${panelId}`}
                label="Bollinger"
                toggled={cfg.showBollinger}
                onToggle={(v) => patch({ showBollinger: v })}
              />
              <SettingsToggle
                id={`posc-vwap-${panelId}`}
                label="VWAP"
                toggled={cfg.showVwap}
                onToggle={(v) => patch({ showVwap: v })}
              />
              <SettingsToggle
                id={`posc-vol-${panelId}`}
                label="Volume"
                toggled={cfg.showVolume}
                onToggle={(v) => patch({ showVolume: v })}
              />
            </div>
            <SettingsSelect
              id={`posc-sub-${panelId}`}
              label="Subplot"
              items={SUBPLOT_ITEMS.map((i) => ({ ...i }))}
              value={cfg.subplot}
              onChange={(id) =>
                patch({
                  subplot: Schema.decodeUnknownSync(PositionCandleSubplot)(id),
                })
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
        title={
          effectivePair
            ? `Position · ${effectivePair} · ${cfg.timeframe}${autoActive && buckets.length > 0 ? " · auto" : ""}`
            : "Position Chart"
        }
        isLoading={state.isLoading}
        error={marketError ?? state.error}
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
              {availablePairs.length > 0 ? (
                <PairCombobox
                  id={`posc-pair-jump-${panelId}`}
                  value={effectivePair}
                  pairs={availablePairs}
                  onChange={(pair) => patch({ pair })}
                />
              ) : (
                <span
                  className="nfi-candle-pair"
                  title={`${candles.length} candles loaded`}
                >
                  {effectivePair}
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
                  </button>
                ))}
              </div>
              <PositionPairChips
                options={chipOptions}
                activeKey={pinned.length > 0 ? pinned : null}
                autoActive={pinned.length === 0}
                onAuto={() => patch({ pair: "" })}
                onPick={(key) => patch({ pair: key })}
              />
              {tradesAccess.allowed ? (
                <PositionPager
                  index={pagerIndex}
                  count={posCount}
                  busy={history.loading}
                  onMove={(index) =>
                    posStore.setState((s) => ({
                      ...s,
                      fromEnd: Math.max(0, posCount - index),
                    }))
                  }
                />
              ) : null}
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
                {tradesAccess.allowed && focused && avgEntry !== null ? (
                  <PositionChip
                    positions={[focused]}
                    avgEntry={avgEntry}
                    precision={chartPrecision}
                    compact={narrow}
                    kind={focusedOpen ? "open" : "closed"}
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
            <CandleChart
              candles={allCandles}
              overlays={overlays}
              showVolume={cfg.showVolume}
              subplot={subplot}
              tradeMarkers={tradeMarkers}
              avgEntryPrice={avgEntry}
              avgEntryIsShort={focusedIsShort}
              avgEntryProfitPct={focusedProfitPct}
              avgEntrySince={focusedEntryBucket}
              avgEntryUntil={entryUntil}
              avgEntryLineVisible={focusedOpen}
              historyPnlSpans={historySpans}
              followMarkers
              focusBarTime={focusedEntryBucket}
              focusNonce={`${effectivePair}|${fromEnd}|${cfg.timeframe}|${focusedCovered ? 1 : 0}`}
              onRequestOlder={() => history.loadOlder(allCandles[0]?.time ?? 0)}
            />
          </div>
        ) : (
          <EmptyState
            title={
              effectivePair.length === 0 ? "No open positions" : "No candles"
            }
            hint={
              effectivePair.length === 0
                ? "Flat is a position too — the chart follows your next open trade automatically, or pick any traded pair in ⚙ settings."
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

export const PositionCandleWidgetDef = defineWidget({
  type: "position-candle",
  hasSettings: true,
  title: "Position Chart",
  description:
    "Candle chart that follows open positions — quick-switch chips per pair, entry/exit markers with tags, and avg-entry line with profit/loss shading.",
  configSchema: PositionCandleConfigSchema,
  defaultConfig: POSITION_CANDLE_DEFAULTS,
  component: PositionCandleWidget,
  capabilities: [...POSITION_CANDLE_CAPABILITIES],
  minWidth: 640,
  minHeight: 480,
  defaultWidth: 960,
  defaultHeight: 640,
});
