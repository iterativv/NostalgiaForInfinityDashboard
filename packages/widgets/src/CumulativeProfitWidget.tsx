// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Running total of closed-trade profit per instance, drawn as a Carbon line
 * chart over close time.
 *
 * `instances.cumulative-profit` computes the running sums in SQL window
 * functions over the FULL closed history and returns the newest tail per
 * series — the widget only maps points onto the chart (the old widget
 * accumulated a fetched window client-side, so both the curve and its
 * headline started wherever the window began).
 */

import { NumberInput } from "@carbon/react";
import { Schema } from "effect";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import {
  LineChart,
  ScaleTypes,
  type LineChartOptions,
} from "@carbon/charts-react";
import { EmptyState, Stat, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { ChartBox } from "./shared/ChartBox";
import {
  InstanceIdField,
  booleanWithDefault,
  numberWithDefault,
} from "./shared/config";
import { dimColor, useInstanceColors } from "./shared/instanceColors";
import { useCompactMode } from "./shared/size";
import { clampInt, pnlTone } from "./shared/format";
import { chartTimeFormats, useTimeFormat } from "./shared/timeFormat";
import { queryState } from "./shared/query";
import { ALL_INSTANCES, InstanceSelect } from "./shared/InstanceSelect";
import { SettingsToggle } from "./shared/SettingsToggle";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const CumulativeProfitConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  limit: numberWithDefault(200),
  showCumulative: booleanWithDefault(true),
  showPerTrade: booleanWithDefault(false),
});

export type CumulativeProfitConfig = typeof CumulativeProfitConfigSchema.Type;

export const CUMULATIVE_PROFIT_DEFAULTS: CumulativeProfitConfig =
  Schema.decodeUnknownSync(CumulativeProfitConfigSchema)({});

export function CumulativeProfitWidget({
  config,
  panelId,
}: WidgetProps<CumulativeProfitConfig>) {
  const cfg = config;
  const limit = clampInt(cfg.limit, 200, 10, 500);
  const fleet = cfg.instanceId === ALL_INSTANCES;

  // SQL running sums over the full closed history; only the newest `limit`
  // points per series cross the wire.
  const view = useCapability("instances.cumulative-profit", {
    id: fleet ? undefined : cfg.instanceId,
    limit: String(limit),
  });

  // `instances.profit` has no fleet aggregate — the header stat only applies per instance.
  const profit = useCapability(
    "instances.profit",
    { id: cfg.instanceId },
    { enabled: cfg.instanceId !== "all" },
  );

  const state = queryState(view.error, view.isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const { colorOf } = useInstanceColors();

  const patch = (p: Partial<CumulativeProfitConfig>) =>
    applyWidgetSettings(panelId, "cumulative-profit", cfg, p);

  const stake = profit.data?.stakeCurrency ?? "";

  // Fleet mode draws one cumulative line PER instance (colored) — absolute
  // profit is summable, but per-bot curves answer "which instance earned
  // this". Single mode keeps the classic Cumulative/Per-trade pair.
  const series: Array<{ group: string; date: string; value: number }> = [];
  const colorScale: Record<string, string> = {};
  let totalProfit = 0;
  let tradeCount = 0;

  for (const entry of view.data?.series ?? []) {
    const label = fleet
      ? (entry.instanceName ?? entry.instanceId ?? "unknown")
      : "Cumulative";

    const color = fleet
      ? colorOf(entry.instanceId ?? entry.instanceName ?? label)
      : null;

    if (color) colorScale[label] = color;

    totalProfit += entry.totalProfit;
    tradeCount += entry.trades;

    if (cfg.showCumulative) {
      for (const point of entry.points) {
        series.push({
          group: label,
          date: point.at,
          value: point.cumulative,
        });
      }
    }

    if (cfg.showPerTrade) {
      const perLabel = fleet ? `${label} · trades` : "Per trade";

      if (color) colorScale[perLabel] = dimColor(color);

      for (const point of entry.points) {
        series.push({
          group: perLabel,
          date: point.at,
          value: point.profit,
        });
      }
    }
  }

  // Compact cells draw the curve alone; the headline stat needs ~250px total.
  const compact = useCompactMode(250);
  // Time axis ticks follow the globally configured time format.
  const timeFormat = useTimeFormat();

  const lineOptions: LineChartOptions = {
    title: "Cumulative profit",
    timeScale: { timeIntervalFormats: chartTimeFormats(timeFormat) },
    axes: {
      bottom: {
        mapsTo: "date",
        scaleType: ScaleTypes.TIME,
        title: "Close time",
      },
      left: { mapsTo: "value", title: `Profit (${stake || "stake"})` },
    },
    color: { scale: colorScale },
    theme: "g100",
  };

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Cumulative profit settings"
        widgetType="cumulative-profit"
      >
        <InstanceSelect
          id={`cp-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <NumberInput
          id={`cp-limit-${panelId}`}
          label="Closed trades in window"
          value={limit}
          min={10}
          max={500}
          step={10}
          onChange={(_e, { value }) =>
            patch({ limit: clampInt(value, 200, 10, 500) })
          }
          size="sm"
        />
        <SettingsToggle
          id={`cp-cum-${panelId}`}
          label="Cumulative series"
          toggled={cfg.showCumulative}
          onToggle={(v) => patch({ showCumulative: v })}
        />
        <SettingsToggle
          id={`cp-pt-${panelId}`}
          label="Per-trade series"
          toggled={cfg.showPerTrade}
          onToggle={(v) => patch({ showPerTrade: v })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
        title="Cumulative Profit"
        isLoading={state.isLoading}
        error={state.error}
      >
        {series.length >= 2 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
              flex: "1 1 auto",
              minHeight: 0,
            }}
          >
            {!compact ? (
              <Stat
                label={`Total profit (${tradeCount} trades)`}
                value={`${totalProfit >= 0 ? "+" : ""}${totalProfit.toFixed(2)}${stake ? ` ${stake}` : ""}`}
                tone={pnlTone(totalProfit)}
                sub="full closed history"
              />
            ) : null}
            <ChartBox min={compact ? 150 : 200}>
              {(height) => (
                <LineChart
                  data={series}
                  options={{ ...lineOptions, height: `${height}px` }}
                />
              )}
            </ChartBox>
          </div>
        ) : (
          <EmptyState
            title="Not enough closed trades"
            hint="Close at least two trades (or widen the window in ⚙ settings) to draw the curve."
          />
        )}
      </WidgetFrame>
    </>
  );
}

export const CumulativeProfitWidgetDef = defineWidget({
  type: "cumulative-profit",
  hasSettings: true,
  title: "Cumulative Profit",
  description: "Running total of closed-trade profit per instance over time.",
  configSchema: CumulativeProfitConfigSchema,
  defaultConfig: CUMULATIVE_PROFIT_DEFAULTS,
  component: CumulativeProfitWidget,
  capabilities: ["instances.cumulative-profit", "instances.profit"],
  minWidth: 450,
  minHeight: 300,
  defaultWidth: 450,
  defaultHeight: 300,
});
