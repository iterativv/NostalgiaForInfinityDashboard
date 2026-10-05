// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Performance stats — winrate, profit factor, expectancy and averages.
 *
 * The headline numbers of any finance terminal, computed from closed
 * trades: expectancy and profit factor say whether the edge is real,
 * averages say how it behaves.
 */

import { NumberInput } from "@carbon/react";
import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, Stat, useDerived, WidgetFrame } from "@nfi/ui";
import { applyWidgetSettings } from "./shared/panelConfig";
import { COL } from "./shared/columns";
import { InstanceIdField, numberWithDefault } from "./shared/config";
import { clampInt, pnlTone } from "./shared/format";
import { queryState, useWidgetAccess } from "./shared/query";
import { InstanceSelect } from "./shared/InstanceSelect";
import { useClosedPositionsSource } from "./shared/sources";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const PERFORMANCE_STATS_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.closed-positions",
  "instances.closed-all",
];

export const PerformanceStatsConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  limit: numberWithDefault(200),
});

export type PerformanceStatsConfig = typeof PerformanceStatsConfigSchema.Type;

export const PERFORMANCE_STATS_DEFAULTS: PerformanceStatsConfig =
  Schema.decodeUnknownSync(PerformanceStatsConfigSchema)({});

export function PerformanceStatsWidget({
  config,
  panelId,
}: WidgetProps<PerformanceStatsConfig>) {
  const cfg = config;
  const limit = clampInt(cfg.limit, 200, 10, 1000);
  const access = useWidgetAccess(PERFORMANCE_STATS_CAPABILITIES);

  const src = useClosedPositionsSource(cfg.instanceId, limit, {
    enabled: access.allowed,
  });

  const state = queryState(src.error, src.isLoading);

  const accessError = access.allowed
    ? null
    : `Not authorized — needs ${access.missing.join(", ")}`;

  const showSettings = useWidgetSettingsOpen(panelId);

  const patch = (p: Partial<PerformanceStatsConfig>) =>
    applyWidgetSettings(panelId, "performance-stats", cfg, p);

  // Derived through a store: single-pass aggregation (no Math.max spread
  // over up to 1000 trades) reruns only when the snapshot changes, so
  // resize/store re-renders stay cheap.
  const stats = useDerived(src.data, (data) => {
    const profits = (data ?? []).map(
      (p) => p.closeProfitAbs ?? p.profitAbs ?? 0,
    );

    const trades = profits.length;
    let wins = 0;
    let losses = 0;
    let grossWin = 0;
    let grossLoss = 0;
    let best = 0;
    let worst = 0;

    for (let i = 0; i < profits.length; i++) {
      const v = profits[i]!;

      if (i === 0 || v > best) best = v;

      if (i === 0 || v < worst) worst = v;

      if (v > 0) {
        wins += 1;
        grossWin += v;
      } else if (v < 0) {
        losses += 1;
        grossLoss += -v;
      }
    }

    const net = grossWin - grossLoss;

    return {
      trades,
      wins,
      losses,
      grossWin,
      grossLoss,
      net,
      winrate: trades > 0 ? (wins / trades) * 100 : 0,
      profitFactor:
        grossLoss > 0
          ? grossWin / grossLoss
          : wins > 0
            ? Number.POSITIVE_INFINITY
            : 0,
      expectancy: trades > 0 ? net / trades : 0,
      avgWin: wins > 0 ? grossWin / wins : 0,
      avgLoss: losses > 0 ? grossLoss / losses : 0,
      best: trades > 0 ? best : 0,
      worst: trades > 0 ? worst : 0,
    };
  });

  const {
    trades,
    wins,
    losses,
    grossWin,
    grossLoss,
    net,
    winrate,
    profitFactor,
    expectancy,
    avgWin,
    avgLoss,
    best,
    worst,
  } = stats;

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Performance stats settings"
        widgetType="performance-stats"
      >
        <InstanceSelect
          id={`perf-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <NumberInput
          id={`perf-limit-${panelId}`}
          label="Closed trades in window"
          value={limit}
          min={10}
          max={1000}
          step={10}
          onChange={(_e, { value }) =>
            patch({ limit: clampInt(value, 200, 10, 1000) })
          }
          size="sm"
        />
      </WidgetSettingsModal>
      <WidgetFrame
        title="Performance Stats"
        isLoading={state.isLoading}
        error={accessError ?? state.error}
      >
        {trades > 0 ? (
          <div className="nfi-stat-grid nfi-stat-grid--fill">
            <Stat
              label={COL.totalProfit}
              value={`${net >= 0 ? "+" : ""}${net.toFixed(2)}`}
              sub={`${trades} trades`}
              tone={pnlTone(net)}
            />
            <Stat
              label={COL.winRate}
              value={`${winrate.toFixed(1)}%`}
              sub={`${wins}W / ${losses}L`}
            />
            <Stat
              label="Profit factor"
              value={
                Number.isFinite(profitFactor) ? profitFactor.toFixed(2) : "∞"
              }
              sub={`gross +${grossWin.toFixed(0)} / -${grossLoss.toFixed(0)}`}
            />
            <Stat
              label="Expectancy"
              value={`${expectancy >= 0 ? "+" : ""}${expectancy.toFixed(2)}`}
              sub="per trade"
              tone={pnlTone(expectancy)}
            />
            <Stat
              label="Avg win"
              value={`+${avgWin.toFixed(2)}`}
              sub={`${wins} winners`}
              tone="positive"
            />
            <Stat
              label="Avg loss"
              value={`-${avgLoss.toFixed(2)}`}
              sub={`${losses} losers`}
              tone="negative"
            />
            <Stat
              label="Best"
              value={`+${best.toFixed(2)}`}
              sub="single trade"
              tone="positive"
            />
            <Stat
              label="Worst"
              value={worst.toFixed(2)}
              sub="single trade"
              tone={pnlTone(worst)}
            />
          </div>
        ) : (
          <EmptyState
            title="No closed trades"
            hint="Close a trade (or widen the window in ⚙ settings)."
          />
        )}
      </WidgetFrame>
    </>
  );
}

export const PerformanceStatsWidgetDef = defineWidget({
  type: "performance-stats",
  hasSettings: true,
  title: "Performance Stats",
  description: "Winrate, profit factor, expectancy and win/loss averages.",
  configSchema: PerformanceStatsConfigSchema,
  defaultConfig: PERFORMANCE_STATS_DEFAULTS,
  component: PerformanceStatsWidget,
  capabilities: [...PERFORMANCE_STATS_CAPABILITIES],
  minWidth: 370,
  minHeight: 281,
  defaultWidth: 480,
  defaultHeight: 320,
});
