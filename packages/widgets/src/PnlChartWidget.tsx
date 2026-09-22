// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  ScaleTypes,
  SimpleBarChart,
  type BarChartOptions,
} from "@carbon/charts-react";
import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, WidgetFrame } from "@nfi/ui";
import { applyWidgetSettings } from "./shared/panelConfig";
import { ChartBox } from "./shared/ChartBox";
import { InstanceIdField } from "./shared/config";
import { ALL_INSTANCES, InstanceSelect } from "./shared/InstanceSelect";
import { queryState } from "./shared/query";
import { useOpenPositionsSource } from "./shared/sources";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const PNL_CHART_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.open-positions",
  "instances.positions-all",
];

export const PnlChartConfigSchema = Schema.Struct({
  /** An instance id, or `all` for every open position in the fleet. */
  instanceId: InstanceIdField,
});
export type PnlChartConfig = typeof PnlChartConfigSchema.Type;

export const PNL_CHART_DEFAULTS: PnlChartConfig = Schema.decodeUnknownSync(
  PnlChartConfigSchema,
)({});

/** Carbon g100 profit/loss palette — green gains, red losses. */
const PNL_PROFIT_FILL = "#42be65";
const PNL_LOSS_FILL = "#fa4d56";

export function PnlChartWidget({
  config,
  panelId,
}: WidgetProps<PnlChartConfig>) {
  const cfg = config;
  const source = useOpenPositionsSource(cfg.instanceId);
  const state = queryState(source.error, source.isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<PnlChartConfig>) =>
    applyWidgetSettings(panelId, "pnl-chart", cfg, p);

  const positions = source.data ?? [];
  // One bar per position; fleet views disambiguate duplicate pairs with the
  // instance name.
  const bars = positions.map((position, index) => ({
    group:
      cfg.instanceId === ALL_INSTANCES && position.instanceName
        ? `${position.pair} · ${position.instanceName}`
        : `${position.pair} #${position.tradeId}`,
    value: Number((position.profitPct ?? 0).toFixed(2)),
    key: `${position.instanceId ?? cfg.instanceId}-${position.tradeId}-${index}`,
  }));
  // Color each bar by sign so profit reads green and loss reads red at a
  // glance (Carbon maps `color.scale` group names to fills).
  const colorScale: Record<string, string> = {};
  for (const bar of bars) {
    colorScale[bar.group] = bar.value >= 0 ? PNL_PROFIT_FILL : PNL_LOSS_FILL;
  }
  const barOptions: BarChartOptions = {
    title: "Open-trade PnL (%)",
    axes: {
      left: { mapsTo: "value", title: "Profit %" },
      bottom: { mapsTo: "group", scaleType: ScaleTypes.LABELS, title: "Pair" },
    },
    color: { scale: colorScale },
    theme: "g100",
  };
  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="PnL chart settings"
        widgetType="pnl-chart"
      >
        <InstanceSelect
          id={`pnl-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
      </WidgetSettingsModal>
      <WidgetFrame
      title="PnL Chart"
      isLoading={state.isLoading}
      error={state.error}
    >
      {bars.length > 0 ? (
        <ChartBox min={150}>
          {(height) => (
            <SimpleBarChart
              data={bars}
              options={{ ...barOptions, height: `${height}px` }}
            />
          )}
        </ChartBox>
      ) : (
        <EmptyState
          title="No open trades"
          hint="Open a position to see PnL bars."
        />
      )}
    </WidgetFrame>
    </>
  );
}

export const PnlChartWidgetDef = defineWidget({
  type: "pnl-chart",
  hasSettings: true,
  title: "PnL Chart",
  description:
    "Per-trade profit distribution across open positions — one instance or the fleet.",
  configSchema: PnlChartConfigSchema,
  defaultConfig: PNL_CHART_DEFAULTS,
  component: PnlChartWidget,
  capabilities: [...PNL_CHART_CAPABILITIES],
  minWidth: 320,
  minHeight: 150,
});
