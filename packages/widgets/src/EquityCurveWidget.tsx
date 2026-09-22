// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import {
  LineChart,
  ScaleTypes,
  type LineChartOptions,
} from "@carbon/charts-react";
import { EmptyState, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { ChartBox } from "./shared/ChartBox";
import { InstanceIdField } from "./shared/config";
import { queryState } from "./shared/query";
import { InstanceSelect } from "./shared/InstanceSelect";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";
import { Schema } from "effect";

export const EquityCurveConfigSchema = Schema.Struct({
  /** Which bot's recorded profit history to chart. */
  instanceId: InstanceIdField,
});
export type EquityCurveConfig = typeof EquityCurveConfigSchema.Type;

export const EQUITY_CURVE_DEFAULTS: EquityCurveConfig = Schema.decodeUnknownSync(
  EquityCurveConfigSchema,
)({});

/**
 * Equity curve — recorded all/closed profit for ANY configured instance
 * (`instances.profit-history`; the poller snapshots every bot, so each
 * has its own curve).
 */
export function EquityCurveWidget({
  config,
  panelId,
}: WidgetProps<EquityCurveConfig>) {
  const { data, error, isLoading } = useCapability("instances.profit-history", {
    id: config.instanceId,
  });
  const state = queryState(error, isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<EquityCurveConfig>) =>
    applyWidgetSettings(panelId, "equity", config, p);
  const points = data?.points ?? [];
  const series = points.flatMap((point) => [
    { group: "All profit", date: point.recordedAt, value: point.profitAllCoin },
    {
      group: "Closed profit",
      date: point.recordedAt,
      value: point.profitClosedCoin,
    },
  ]);
  const lineOptions: LineChartOptions = {
    title: "Equity curve",
    axes: {
      bottom: { mapsTo: "date", scaleType: ScaleTypes.TIME, title: "Time" },
      left: { mapsTo: "value", title: "Profit (stake)" },
    },
    theme: "g100",
  };
  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Equity curve settings"
        widgetType="equity"
      >
        <InstanceSelect
          id={`equity-inst-${panelId}`}
          value={config.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
        title="Equity Curve"
        isLoading={state.isLoading}
        error={state.error}
      >
      {series.length >= 4 ? (
        <ChartBox min={180}>
          {(height) => (
            <LineChart
              data={series}
              options={{ ...lineOptions, height: `${height}px` }}
            />
          )}
        </ChartBox>
      ) : (
        <EmptyState
          title="Collecting history…"
          hint="The backend records a snapshot every minute while it runs. Check back soon."
        />
      )}
      </WidgetFrame>
    </>
  );
}

export const EquityCurveWidgetDef = defineWidget({
  type: "equity",
  hasSettings: true,
  title: "Equity Curve",
  description:
    "Recorded profit history for any instance — the backend snapshots every bot.",
  configSchema: EquityCurveConfigSchema,
  defaultConfig: EQUITY_CURVE_DEFAULTS,
  component: EquityCurveWidget,
  capabilities: ["instances.profit-history"],
  minWidth: 340,
  minHeight: 180,
});
