// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Drawdown — how deep is the hole, and how long has it lasted.
 *
 * Computes the underwater curve from the recorded profit history
 * (`instances.profit-history`, minute snapshots of ANY configured
 * instance): the running peak of all-time profit vs. its current level.
 * Shows max drawdown, current drawdown and the peak, plus the underwater
 * line chart.
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
import { queryState } from "./shared/query";
import { InstanceSelect } from "./shared/InstanceSelect";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const DRAWDOWN_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.profit-history",
];

export const DrawdownConfigSchema = Schema.Struct({
  /** Which bot's recorded history to chart. */
  instanceId: InstanceIdField,
  /** Snapshot window (points) used for the curve. */
  limit: numberWithDefault(500),
});
export type DrawdownConfig = typeof DrawdownConfigSchema.Type;

export const DRAWDOWN_DEFAULTS: DrawdownConfig = Schema.decodeUnknownSync(
  DrawdownConfigSchema,
)({});

interface DrawdownPoint {
  readonly date: string;
  readonly drawdown: number;
}

export function DrawdownWidget({
  config,
  panelId,
}: WidgetProps<DrawdownConfig>) {
  const cfg = config;
  const { data, error, isLoading } = useCapability("instances.profit-history", {
    id: cfg.instanceId,
    limit: String(Math.max(50, Math.min(1000, Math.round(cfg.limit)))),
  });
  const state = queryState(error, isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<DrawdownConfig>) =>
    applyWidgetSettings(panelId, "drawdown", cfg, p);

  const points = data?.points ?? [];
  // Underwater curve: distance of all-time profit from its running peak.
  const curve: DrawdownPoint[] = [];
  let peak = Number.NEGATIVE_INFINITY;
  let maxDrawdown = 0;
  let peakValue = 0;
  for (const point of points) {
    const equity = point.profitAllCoin;
    peak = Math.max(peak, equity);
    peakValue = peak;
    const drawdown = peak > 0 ? ((equity - peak) / peak) * 100 : 0;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
    curve.push({
      date: point.recordedAt.slice(0, 16).replace("T", " "),
      drawdown: Number(drawdown.toFixed(2)),
    });
  }
  const current = curve[curve.length - 1]?.drawdown ?? 0;
  // Compact cells draw the underwater curve alone; the stat row needs the
  // full ~260px budget to stay above it without clipping the chart.
  const compact = useCompactMode(260);
  const chartData = curve.map((point) => ({
    group: "Drawdown %",
    date: point.date,
    value: point.drawdown,
  }));
  const options: LineChartOptions = {
    title: "Underwater curve (%)",
    axes: {
      left: { mapsTo: "value", title: "Drawdown %" },
      bottom: { mapsTo: "date", scaleType: ScaleTypes.TIME },
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
  minWidth: 320,
  minHeight: 150,
});
