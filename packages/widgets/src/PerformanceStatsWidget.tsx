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
import { EmptyState, Stat, WidgetFrame } from "@nfi/ui";
import { applyWidgetSettings } from "./shared/panelConfig";
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

  const profits = (src.data ?? []).map(
    (p) => p.closeProfitAbs ?? p.profitAbs ?? 0,
  );
  const trades = profits.length;
  const wins = profits.filter((v) => v > 0);
  const losses = profits.filter((v) => v < 0);
  const grossWin = wins.reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(losses.reduce((s, v) => s + v, 0));
  const net = grossWin - grossLoss;
  const winrate = trades > 0 ? (wins.length / trades) * 100 : 0;
  const profitFactor =
    grossLoss > 0
      ? grossWin / grossLoss
      : wins.length > 0
        ? Number.POSITIVE_INFINITY
        : 0;
  const expectancy = trades > 0 ? net / trades : 0;
  const avgWin = wins.length > 0 ? grossWin / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const best = trades > 0 ? Math.max(...profits) : 0;
  const worst = trades > 0 ? Math.min(...profits) : 0;

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
        <div className="nfi-stat-grid">
          <Stat
            label="Net profit"
            value={`${net >= 0 ? "+" : ""}${net.toFixed(2)}`}
            sub={`${trades} trades`}
            tone={pnlTone(net)}
          />
          <Stat
            label="Winrate"
            value={`${winrate.toFixed(1)}%`}
            sub={`${wins.length}W / ${losses.length}L`}
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
            sub={`${wins.length} winners`}
            tone="positive"
          />
          <Stat
            label="Avg loss"
            value={`-${avgLoss.toFixed(2)}`}
            sub={`${losses.length} losers`}
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
  minWidth: 320,
  minHeight: 180,
});
