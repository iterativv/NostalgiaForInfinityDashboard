// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
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
import { dimColor, useInstanceColors } from "./shared/instanceColors";
import { queryState } from "./shared/query";
import { chartTimeFormats, useTimeFormat } from "./shared/timeFormat";
import { ALL_INSTANCES, InstanceSelect } from "./shared/InstanceSelect";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

/**
 * Public performance index — profit rebased per instance to an index
 * starting at 100.
 *
 * Backed by `instances.profit-history-all.relative`: every configured bot
 * draws its own curve (all-profit solid, closed-profit dimmed) in its
 * per-instance color — a performance index cannot be summed across bots,
 * so color is what attributes each line. The first visible point is always
 * exactly 100, so the shape shows without revealing scale.
 */
export const RelativeEquityConfigSchema = Schema.Struct({
  /** An instance id, or `all` (default) for the whole fleet. */
  instanceId: Schema.optionalWith(Schema.String, {
    default: (): string => ALL_INSTANCES,
  }),
});

export type RelativeEquityConfig = typeof RelativeEquityConfigSchema.Type;

export const RELATIVE_EQUITY_DEFAULTS: RelativeEquityConfig =
  Schema.decodeUnknownSync(RelativeEquityConfigSchema)({});

export function RelativeEquityWidget({
  config,
  panelId,
}: WidgetProps<RelativeEquityConfig>) {
  const cfg = config;

  const { data, error, isLoading } = useCapability(
    "instances.profit-history-all.relative",
    {},
  );

  const { colorOf } = useInstanceColors();
  const state = queryState(error, isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  // Time axis ticks follow the globally configured time format.
  const timeFormat = useTimeFormat();

  const patch = (p: Partial<RelativeEquityConfig>) =>
    applyWidgetSettings(panelId, "equity-relative", cfg, p);

  const rows = (data?.instances ?? []).filter(
    (row) =>
      cfg.instanceId === ALL_INSTANCES ||
      row.instanceId === cfg.instanceId ||
      row.instanceName === cfg.instanceId,
  );

  // One solid line per bot (all profit) + one dimmed (closed profit), both
  // in the bot's instance color — the legend reads "name · all/closed".
  const series: Array<{ group: string; date: string; value: number }> = [];
  const colorScale: Record<string, string> = {};

  for (const row of rows) {
    if (row.points.length === 0) continue;
    const name = row.instanceName || row.instanceId;
    const color = colorOf(row.instanceId) ?? undefined;
    const allGroup = `${name} · all`;
    const closedGroup = `${name} · closed`;

    for (const point of row.points) {
      series.push({
        group: allGroup,
        date: point.recordedAt,
        value: point.profitAllIndex,
      });
      series.push({
        group: closedGroup,
        date: point.recordedAt,
        value: point.profitClosedIndex,
      });
    }

    if (color) {
      colorScale[allGroup] = color;
      colorScale[closedGroup] = dimColor(color);
    }
  }

  const lineOptions: LineChartOptions = {
    title: "Performance index (base 100)",
    timeScale: { timeIntervalFormats: chartTimeFormats(timeFormat) },
    axes: {
      bottom: {
        mapsTo: "date",
        scaleType: ScaleTypes.TIME,
        title: "Time",
      },
      left: {
        mapsTo: "value",
        title: "Index",
        // The index lives around base 100 — a zero baseline would flatten
        // every curve into the top sliver of the chart.
        includeZero: false,
      },
    },
    color: { scale: colorScale },
    theme: "g100",
  };

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Performance index settings"
        widgetType="equity-relative"
      >
        <InstanceSelect
          id={`er-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
      </WidgetSettingsModal>
      <WidgetFrame
        title="Performance Index"
        isLoading={state.isLoading}
        error={state.error}
      >
        {series.length >= 4 ? (
          <ChartBox min={200}>
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

export const RelativeEquityWidgetDef = defineWidget({
  type: "equity-relative",
  hasSettings: true,
  title: "Performance Index",
  description:
    "Public-shareable performance index rebased to 100 — one colored curve per instance, never absolute profit.",
  configSchema: RelativeEquityConfigSchema,
  defaultConfig: RELATIVE_EQUITY_DEFAULTS,
  component: RelativeEquityWidget,
  capabilities: ["instances.profit-history-all.relative"],
  minWidth: 700,
  minHeight: 400,
  defaultWidth: 640,
  defaultHeight: 420,
});
