// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Performance stats — winrate, profit factor, expectancy and averages.
 *
 * The headline numbers of any finance terminal, computed from closed
 * trades: expectancy and profit factor say whether the edge is real,
 * averages say how it behaves. Every number arrives precomputed from
 * `instances.performance-stats` — one SQL aggregate over the FULL closed
 * history (the old widget folded a fetched window client-side, so every
 * metric silently stopped at the window edge).
 */

import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, Stat, WidgetFrame } from "@nfi/ui";
import { applyWidgetSettings } from "./shared/panelConfig";
import { COL } from "./shared/columns";
import { InstanceIdField } from "./shared/config";
import { pnlTone } from "./shared/format";
import { queryState, useWidgetAccess } from "./shared/query";
import { ALL_INSTANCES, InstanceSelect } from "./shared/InstanceSelect";
import { useCapability } from "./live/live";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const PERFORMANCE_STATS_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.performance-stats",
];

export const PerformanceStatsConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
});

export type PerformanceStatsConfig = typeof PerformanceStatsConfigSchema.Type;

export const PERFORMANCE_STATS_DEFAULTS: PerformanceStatsConfig =
  Schema.decodeUnknownSync(PerformanceStatsConfigSchema)({});

export function PerformanceStatsWidget({
  config,
  panelId,
}: WidgetProps<PerformanceStatsConfig>) {
  const cfg = config;
  const fleet = cfg.instanceId === ALL_INSTANCES;
  const access = useWidgetAccess(PERFORMANCE_STATS_CAPABILITIES);

  // One SQL aggregate over every closed trade in scope (instance or fleet)
  // — the widget renders the row verbatim, no client-side folding.
  const view = useCapability(
    "instances.performance-stats",
    { id: fleet ? undefined : cfg.instanceId },
    { enabled: access.allowed },
  );

  const state = queryState(view.error, view.isLoading);
  const stats = view.data;

  const accessError = access.allowed
    ? null
    : `Not authorized — needs ${access.missing.join(", ")}`;

  const showSettings = useWidgetSettingsOpen(panelId);

  const patch = (p: Partial<PerformanceStatsConfig>) =>
    applyWidgetSettings(panelId, "performance-stats", cfg, p);

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
      </WidgetSettingsModal>
      <WidgetFrame
        title="Performance Stats"
        isLoading={state.isLoading}
        error={accessError ?? state.error}
      >
        {stats && stats.trades > 0 ? (
          <div className="nfi-stat-grid nfi-stat-grid--fill">
            <Stat
              label={COL.totalProfit}
              value={`${stats.net >= 0 ? "+" : ""}${stats.net.toFixed(2)}`}
              sub={`${stats.trades} trades`}
              tone={pnlTone(stats.net)}
            />
            <Stat
              label={COL.winRate}
              value={`${stats.winrate.toFixed(1)}%`}
              sub={`${stats.wins}W / ${stats.losses}L`}
            />
            <Stat
              label="Profit factor"
              value={
                stats.grossLoss === 0
                  ? stats.wins > 0
                    ? "∞"
                    : "0.00"
                  : stats.profitFactor.toFixed(2)
              }
              sub={`gross +${stats.grossWin.toFixed(0)} / -${stats.grossLoss.toFixed(0)}`}
            />
            <Stat
              label="Expectancy"
              value={`${stats.expectancy >= 0 ? "+" : ""}${stats.expectancy.toFixed(2)}`}
              sub="per trade"
              tone={pnlTone(stats.expectancy)}
            />
            <Stat
              label="Avg win"
              value={`+${stats.avgWin.toFixed(2)}`}
              sub={`${stats.wins} winners`}
              tone="positive"
            />
            <Stat
              label="Avg loss"
              value={`-${stats.avgLoss.toFixed(2)}`}
              sub={`${stats.losses} losers`}
              tone="negative"
            />
            <Stat
              label="Best"
              value={`+${stats.best.toFixed(2)}`}
              sub="single trade"
              tone="positive"
            />
            <Stat
              label="Worst"
              value={stats.worst.toFixed(2)}
              sub="single trade"
              tone={pnlTone(stats.worst)}
            />
          </div>
        ) : (
          <EmptyState
            title="No closed trades"
            hint="Stats appear once this instance (or the fleet) closes trades."
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
