// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import {
  LineChart,
  ScaleTypes,
  type LineChartOptions,
} from "@carbon/charts-react";
import { EmptyState, shallow, useDerived, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { ChartBox } from "./shared/ChartBox";
import { InstanceIdField } from "./shared/config";
import { queryState } from "./shared/query";
import { chartTimeFormats, useTimeFormat } from "./shared/timeFormat";
import { ALL_INSTANCES, InstanceSelect } from "./shared/InstanceSelect";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";
import { Schema } from "effect";

export const EquityCurveConfigSchema = Schema.Struct({
  /** Which bot's recorded history to chart, or `all` for the fleet total. */
  instanceId: InstanceIdField,
});

export type EquityCurveConfig = typeof EquityCurveConfigSchema.Type;

export const EQUITY_CURVE_DEFAULTS: EquityCurveConfig =
  Schema.decodeUnknownSync(EquityCurveConfigSchema)({});

/**
 * Equity curve — recorded all/closed profit for ANY configured instance
 * (`instances.profit-history`; the poller snapshots every bot, so each has
 * its own curve). `all` charts the fleet-total merged history
 * (`instances.profit-history-all`).
 */
export function EquityCurveWidget({
  config,
  panelId,
}: WidgetProps<EquityCurveConfig>) {
  const fleet = config.instanceId === ALL_INSTANCES;

  const perInstance = useCapability(
    "instances.profit-history",
    { id: config.instanceId },
    { enabled: !fleet },
  );

  const fleetView = useCapability(
    "instances.profit-history-all",
    {},
    { enabled: fleet },
  );

  const data = fleet ? fleetView.data : perInstance.data;
  const error = fleet ? fleetView.error : perInstance.error;
  const isLoading = fleet ? fleetView.isLoading : perInstance.isLoading;

  const state = queryState(error, isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const timeFormat = useTimeFormat();

  const patch = (p: Partial<EquityCurveConfig>) =>
    applyWidgetSettings(panelId, "equity", config, p);

  // Derived with stable identities: Carbon redraws on new data/options
  // identity, so inline objects rebuilt every re-render redrew the SVG.
  const { series, lineOptions } = useDerived(
    [data, timeFormat] as const,
    ([points, format]) => {
      const series = (points?.points ?? []).flatMap((point) => [
        {
          group: "All profit",
          date: point.recordedAt,
          value: point.profitAllCoin,
        },
        {
          group: "Closed profit",
          date: point.recordedAt,
          value: point.profitClosedCoin,
        },
      ]);

      const lineOptions: LineChartOptions = {
        title: "Equity curve",
        timeScale: { timeIntervalFormats: chartTimeFormats(format) },
        axes: {
          bottom: { mapsTo: "date", scaleType: ScaleTypes.TIME, title: "Time" },
          left: {
            mapsTo: "value",
            title: "Profit (stake)",
            // Zoom to the recorded profit range — recorded snapshots start at
            // the bot's current profit, so a zero baseline crams the whole
            // curve into a thin band and hides its shape.
            includeZero: false,
          },
        },
        theme: "g100",
      };

      return { series, lineOptions };
    },
    { inputs: shallow },
  );

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
          allowAll
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
  capabilities: ["instances.profit-history", "instances.profit-history-all"],
  minWidth: 700,
  minHeight: 400,
  defaultWidth: 640,
  defaultHeight: 420,
});
