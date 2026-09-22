// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Running total of closed-trade profit per instance, drawn as a Carbon line
 * chart over close time.
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
import { useCompactMode } from "./shared/size";
import { clampInt, parseCloseDate, pnlTone } from "./shared/format";
import { queryState } from "./shared/query";
import { InstanceSelect } from "./shared/InstanceSelect";
import { useClosedPositionsSource } from "./shared/sources";
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
  const closedQ = useClosedPositionsSource(cfg.instanceId, limit);
  // `instances.profit` has no fleet aggregate — the header stat only applies per instance.
  const profit = useCapability(
    "instances.profit",
    { id: cfg.instanceId },
    { enabled: cfg.instanceId !== "all" },
  );
  const state = queryState(closedQ.error, closedQ.isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<CumulativeProfitConfig>) =>
    applyWidgetSettings(panelId, "cumulative-profit", cfg, p);

  const stake = profit.data?.stakeCurrency ?? "";
  const points = (closedQ.data ?? [])
    .map((p) => ({
      at: parseCloseDate(p.closeDate),
      profit: p.closeProfitAbs ?? p.profitAbs ?? 0,
    }))
    .filter((p) => p.at !== null)
    .sort((a, b) => (a.at as number) - (b.at as number));
  let running = 0;
  const cumulative: Array<{ group: string; date: string; value: number }> = [];
  for (const point of points) {
    running += point.profit;
    cumulative.push({
      group: "Cumulative",
      date: new Date(point.at as number).toISOString(),
      value: running,
    });
  }
  const perTrade = points.map((p) => ({
    group: "Per trade",
    date: new Date(p.at as number).toISOString(),
    value: p.profit,
  }));
  const series = [
    ...(cfg.showCumulative ? cumulative : []),
    ...(cfg.showPerTrade ? perTrade : []),
  ];
  const windowProfit =
    cumulative.length > 0 ? (cumulative[cumulative.length - 1]?.value ?? 0) : 0;
  // Compact cells draw the curve alone; the headline stat needs ~250px total.
  const compact = useCompactMode(250);
  const lineOptions: LineChartOptions = {
    title: "Cumulative profit",
    axes: {
      bottom: {
        mapsTo: "date",
        scaleType: ScaleTypes.TIME,
        title: "Close time",
      },
      left: { mapsTo: "value", title: `Profit (${stake || "stake"})` },
    },
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
              label={`Window profit (${points.length} trades)`}
              value={`${windowProfit >= 0 ? "+" : ""}${windowProfit.toFixed(2)}${stake ? ` ${stake}` : ""}`}
              tone={pnlTone(windowProfit)}
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
  capabilities: [
    "instances.closed-positions",
    "instances.profit",
    "instances.closed-all",
  ],
  minWidth: 320,
  minHeight: 150,
});
