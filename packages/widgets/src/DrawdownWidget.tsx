// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Drawdown — how deep is the hole, and how long has it lasted.
 *
 * `instances.drawdown` computes the underwater curve AND its scalars in
 * SQL over the FULL recorded snapshot history (running peak = window
 * MAX): the `limit` option only trims the rendered curve — max drawdown,
 * current drawdown and the all-time peak always cover every recorded
 * point (the old widget scanned a fetched window client-side, so its
 * "max" only measured the visible slice).
 */

import {
  LineChart,
  ScaleTypes,
  type LineChartOptions,
} from "@carbon/charts-react";
import { NumberInput } from "@carbon/react";
import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, Stat, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { ChartBox } from "./shared/ChartBox";
import { InstanceIdField, numberWithDefault } from "./shared/config";
import { useCompactMode } from "./shared/size";
import { clampInt, fmt, pnlTone } from "./shared/format";
import { chartTimeFormats, useTimeFormat } from "./shared/timeFormat";
import { queryState } from "./shared/query";
import { ALL_INSTANCES, InstanceSelect } from "./shared/InstanceSelect";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const DRAWDOWN_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.drawdown",
];

export const DrawdownConfigSchema = Schema.Struct({
  /** Which bot's recorded history to chart. */
  instanceId: InstanceIdField,
  /** Snapshot window (points) rendered on the curve. */
  limit: numberWithDefault(500),
});

export type DrawdownConfig = typeof DrawdownConfigSchema.Type;

export const DRAWDOWN_DEFAULTS: DrawdownConfig = Schema.decodeUnknownSync(
  DrawdownConfigSchema,
)({});

export function DrawdownWidget({
  config,
  panelId,
}: WidgetProps<DrawdownConfig>) {
  const cfg = config;
  const fleet = cfg.instanceId === ALL_INSTANCES;

  const windowLimit = String(
    Math.max(50, Math.min(1000, Math.round(cfg.limit))),
  );

  const view = useCapability("instances.drawdown", {
    id: fleet ? undefined : cfg.instanceId,
    limit: windowLimit,
  });

  const state = queryState(view.error, view.isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  // Time axis ticks follow the globally configured time format.
  const timeFormat = useTimeFormat();

  const patch = (p: Partial<DrawdownConfig>) =>
    applyWidgetSettings(panelId, "drawdown", cfg, p);

  const data = view.data;
  const curve = data?.points ?? [];
  const maxDrawdown = data?.maxDrawdown ?? 0;
  const current = data?.currentDrawdown ?? 0;
  const peakValue = data?.peakValue ?? 0;

  // Compact cells draw the underwater curve alone; the stat row needs the
  // full ~260px budget to stay above it without clipping the chart.
  const compact = useCompactMode(260);

  const chartData = curve.map((point) => ({
    group: "Drawdown %",
    date: point.recordedAt.slice(0, 16).replace("T", " "),
    value: point.drawdown,
  }));

  const options: LineChartOptions = {
    title: "Underwater curve (%)",
    timeScale: { timeIntervalFormats: chartTimeFormats(timeFormat) },
    axes: {
      left: { mapsTo: "value", title: "Drawdown %" },
      bottom: {
        mapsTo: "date",
        scaleType: ScaleTypes.TIME,
      },
    },
    points: { radius: 1 },
    color: { scale: { "Drawdown %": "#fa4d56" } },
    theme: "g100",
  };

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Drawdown settings"
        widgetType="drawdown"
      >
        <InstanceSelect
          id={`drawdown-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <NumberInput
          id={`drawdown-limit-${panelId}`}
          label="Snapshot window (points)"
          value={cfg.limit}
          min={50}
          max={1000}
          step={50}
          onChange={(_e, { value }) =>
            patch({ limit: clampInt(value, 500, 50, 1000) })
          }
          size="sm"
        />
      </WidgetSettingsModal>
      <WidgetFrame
        title="Drawdown"
        isLoading={state.isLoading}
        error={state.error}
      >
        {curve.length > 1 ? (
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
              <div className="nfi-stat-grid">
                <Stat
                  label="Max drawdown"
                  value={`${maxDrawdown.toFixed(2)}%`}
                  tone="negative"
                  sub="from profit peak"
                />
                <Stat
                  label="Current"
                  value={`${current.toFixed(2)}%`}
                  tone={pnlTone(-current)}
                  sub="vs. peak now"
                />
                <Stat
                  label="All-time peak"
                  value={fmt(peakValue, 2)}
                  sub="profit high-water mark"
                />
              </div>
            ) : null}
            <ChartBox min={compact ? 150 : 200}>
              {(height) => (
                <LineChart
                  data={chartData}
                  options={{ ...options, height: `${height}px` }}
                />
              )}
            </ChartBox>
          </div>
        ) : (
          <EmptyState
            title="No history yet"
            hint="Drawdown appears once the panel records profit snapshots for this instance."
          />
        )}
      </WidgetFrame>
    </>
  );
}

export const DrawdownWidgetDef = defineWidget({
  type: "drawdown",
  hasSettings: true,
  title: "Drawdown",
  description:
    "Underwater curve from any instance's recorded profit history — max and current drawdown.",
  configSchema: DrawdownConfigSchema,
  defaultConfig: DRAWDOWN_DEFAULTS,
  component: DrawdownWidget,
  capabilities: [...DRAWDOWN_CAPABILITIES],
  minWidth: 475,
  minHeight: 375,
  defaultWidth: 475,
  defaultHeight: 375,
});
