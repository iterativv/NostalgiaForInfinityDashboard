// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Position candles — the chart that follows your open positions.
 *
 * The sensitive twin of `position-candle-public`: instead of a fixed pair,
 * the widget watches every open position (one instance or the whole fleet)
 * and charts the selected one. The quick-selector chip row jumps between
 * open pairs without opening settings; `Auto` tracks the newest open
 * position as trades open and close.
 *
 * Entry/exit markers and tags are always built from the pair's sub-orders
 * (violet entry dots labeled with the order tag, amber exit arrows), and
 * the stake-weighted avg-entry line shades the profit/loss area green/red
 * — the same trade overlay as `candle-chart`, driven by the followed
 * position instead of a pinned pair.
 */

import { NumberInput } from "@carbon/react";
import { Schema } from "effect";
import { RSI } from "lightweight-charts-indicators";
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
  buildTradeMarkers,
  timeframeSeconds,
} from "./shared/tradeOverlay";
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
import {
  useClosedPositionsSource,
  useOpenPositionsSource,
  type SourcedOpenPosition,
} from "./shared/sources";

export const POSITION_CANDLE_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.candles",
  "instances.pairs",
  "instances.plot-config",
  "instances.open-positions",
  "instances.closed-positions",
  "instances.positions-all",
  "instances.closed-all",
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
  subplot: Schema.optionalWith(PositionCandleSubplot, {
    default: (): PositionCandleSubplot => "rsi",
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
    .sort((a, b) => b.newestOpen - a.newestOpen || a.pair.localeCompare(b.pair));
}

/** Header chip for the followed position(s): `3 @ 0.3456 (+2.10%)`. */
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
  const cfg = config;
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

  // Quick-selector source: every open position (fleet-aware).
  const openSrc = useOpenPositionsSource(cfg.instanceId, {
    enabled: tradesAccess.allowed,
  });

  const buckets = useDerived(openSrc.data ?? EMPTY_SOURCED_OPEN, bucketByPair);

  const pinned = cfg.pair.trim();

  const pinnedBucket = pinned
    ? (buckets.find((b) => b.pair === pinned) ?? null)
    : null;

  // Auto mode follows the newest open position; a pinned pair stays put
  // even after it closes (history review) until the user picks another.
  const effectivePair = pinned || buckets[0]?.pair || "";
  const autoActive = pinned.length === 0 || pinnedBucket === null;

  // On fleet views candles come from the followed pair's largest-stake
  // owner (same pair, same market there); single-instance is direct.
  const candleInstanceId =
    fleet && !autoActive && pinnedBucket
      ? (pinnedBucket.ownerInstanceId || cfg.instanceId)
      : fleet
        ? (buckets.find((b) => b.pair === effectivePair)?.ownerInstanceId ||
          cfg.instanceId)
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

  const closedSrc = useClosedPositionsSource(cfg.instanceId, 200, {
    enabled: tradesAccess.allowed,
  });

  const state = queryState(
    market.allowed ? (candlesQ.error ?? openSrc.error) : null,
    market.allowed && (candlesQ.isLoading || openSrc.isLoading),
  );

  const marketError = market.allowed
    ? null
    : `Not authorized — needs ${market.missing.join(", ")}`;

  const showSettings = useWidgetSettingsOpen(panelId);

  const patch = (p: Partial<PositionCandleConfig>) =>
    applyWidgetSettings(panelId, "position-candle", cfg, p);

  const candles = useDerived(candlesQ.data, (data) => data?.candles ?? []);

  // Pair self-heal (same as candle-chart): adopt the settled variant when
  // the followed pair is not on the whitelist.
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
    [openSrc.data, effectivePair] as const,
    ([data, pair]) => (data ?? []).filter((p) => p.pair === pair),
    { inputs: shallow },
  );

  const pairClosed = useDerived(
    [closedSrc.data, effectivePair] as const,
    ([data, pair]) => (data ?? []).filter((p) => p.pair === pair),
    { inputs: shallow },
  );

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

  const candleSecs = useDerived(
    bars,
    (src): number[] => src.map((b) => b.time),
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
  const availablePairs = pairsQ.data?.pairs ?? EMPTY_PAIRS;

  const chipOptions: PositionChipOption[] = buckets.map((b) => ({
    key: b.pair,
    label: b.pair,
    pnl: b.pnl,
    count: fleet ? b.count : undefined,
    detail: fleet && b.bots ? b.bots : undefined,
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
          label="Pair (empty = follow open positions)"
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
              <SettingsToggle
                id={`posc-trades-${panelId}`}
                label="Trade markers"
                toggled={cfg.showTrades}
                onToggle={(v) => patch({ showTrades: v })}
              />
              <SettingsToggle
                id={`posc-avgent-${panelId}`}
                label="Avg entry + PnL"
                toggled={cfg.showAvgEntry}
                onToggle={(v) => patch({ showAvgEntry: v })}
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
            <PositionPairChips
              options={chipOptions}
              activeKey={pinned.length > 0 ? pinned : null}
              autoActive={pinned.length === 0}
              onAuto={() => patch({ pair: "" })}
              onPick={(key) => patch({ pair: key })}
            />
            <div className="nfi-candle-toolbar">
              {availablePairs.length > 0 ? (
                <span title={`${candles.length} candles loaded`}>
                  <PairCombobox
                    id={`posc-pair-${panelId}`}
                    value={effectivePair}
                    pairs={availablePairs}
                    onChange={(pair) => patch({ pair })}
                  />
                </span>
              ) : (
                <span
                  className="nfi-candle-pair"
                  title={`${candles.length} candles loaded`}
                >
                  {effectivePair}
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
                  >
                    {tf.text}
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
            <CandleChart
              candles={candles}
              overlays={overlays}
              showVolume={cfg.showVolume}
              subplot={subplot}
              tradeMarkers={tradeMarkers}
              avgEntryPrice={avgEntry}
            />
          </div>
        ) : (
          <EmptyState
            title={
              effectivePair.length === 0
                ? "No open positions"
                : "No candles"
            }
            hint={
              effectivePair.length === 0
                ? "Flat is a position too — the chart follows your next open trade automatically. Pick an instance in ⚙ settings."
                : `Freqtrade has no analyzed data for ${effectivePair} · ${cfg.timeframe} — the pair may be off the bot's whitelist or the timeframe unanalyzed.`
            }
          />
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
