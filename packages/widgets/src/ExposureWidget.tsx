// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Exposure — stake allocation across open pairs (donut + concentration).
 *
 * Answers "where is my capital?" at a glance: total deployed stake, share
 * per pair, and the largest single-pair concentration. `instances.exposure`
 * computes the per-pair sums AND their shares in SQL over the mirror; the
 * widget renders the rows verbatim (it used to fold the position list
 * client-side with a Map).
 */

import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { DonutChart, type DonutChartOptions } from "@carbon/charts-react";
import { EmptyState, Stat, WidgetFrame } from "@nfi/ui";
import { applyWidgetSettings } from "./shared/panelConfig";
import { ChartBox } from "./shared/ChartBox";
import { InstanceIdField, booleanWithDefault } from "./shared/config";
import { useCompactMode } from "./shared/size";
import { queryState, useWidgetAccess } from "./shared/query";
import { ALL_INSTANCES, InstanceSelect } from "./shared/InstanceSelect";
import { useCapability } from "./live/live";
import { SettingsToggle } from "./shared/SettingsToggle";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const EXPOSURE_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.exposure",
];

export const ExposureConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  showChart: booleanWithDefault(true),
});

export type ExposureConfig = typeof ExposureConfigSchema.Type;

export const EXPOSURE_DEFAULTS: ExposureConfig = Schema.decodeUnknownSync(
  ExposureConfigSchema,
)({});

export function ExposureWidget({
  config,
  panelId,
}: WidgetProps<ExposureConfig>) {
  const cfg = config;
  const fleet = cfg.instanceId === ALL_INSTANCES;
  const access = useWidgetAccess(EXPOSURE_CAPABILITIES);

  const view = useCapability(
    "instances.exposure",
    { id: fleet ? undefined : cfg.instanceId },
    { enabled: access.allowed },
  );

  const state = queryState(view.error, view.isLoading);

  const accessError = access.allowed
    ? null
    : `Not authorized — needs ${access.missing.join(", ")}`;

  const showSettings = useWidgetSettingsOpen(panelId);

  const patch = (p: Partial<ExposureConfig>) =>
    applyWidgetSettings(panelId, "exposure", cfg, p);

  const summary = view.data?.summary;

  // SQL rows, already sorted by stake (share included) — straight to chart.
  const allocation = (view.data?.rows ?? []).map((row) => ({
    group: row.pair,
    value: row.stake,
  }));

  const total = summary?.deployed ?? 0;
  const positions = summary?.positions ?? 0;
  const pairs = summary?.pairs ?? 0;
  const top = view.data?.rows[0];
  const concentration = (top?.share ?? 0) * 100;

  const donutOptions: DonutChartOptions = {
    title: "Exposure",
    donut: { center: { label: total > 0 ? total.toFixed(0) : "" } },
    theme: "g100",
  };

  // Compact cells get the ranked share list — the donut needs ~280px total.
  const compact = useCompactMode(280);

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Exposure settings"
        widgetType="exposure"
      >
        <InstanceSelect
          id={`expo-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <SettingsToggle
          id={`expo-chart-${panelId}`}
          label="Allocation chart"
          toggled={cfg.showChart}
          onToggle={(v) => patch({ showChart: v })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
        title="Exposure"
        isLoading={state.isLoading}
        error={accessError ?? state.error}
      >
        {positions > 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
              flex: "1 1 auto",
              minHeight: 0,
            }}
          >
            <div className="nfi-stat-grid">
              <Stat
                label="Deployed stake"
                value={total.toFixed(2)}
                sub={`${positions} open positions`}
              />
              <Stat
                label="Pairs"
                value={String(pairs)}
                sub={top ? `top ${top.pair}` : undefined}
              />
              <Stat
                label="Concentration"
                value={`${concentration.toFixed(1)}%`}
                sub="largest pair share"
              />
            </div>
            {cfg.showChart && allocation.length > 1 && !compact ? (
              <ChartBox min={180}>
                {(height) => (
                  <DonutChart
                    data={allocation}
                    options={{ ...donutOptions, height: `${height}px` }}
                  />
                )}
              </ChartBox>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.25rem",
                  flex: "1 1 auto",
                  minHeight: 0,
                  overflowY: "auto",
                }}
              >
                {(view.data?.rows ?? []).slice(0, 10).map((row) => (
                  <div
                    key={row.pair}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "0.5rem",
                      fontSize: "0.875rem",
                    }}
                  >
                    <span className="nfi-mono">{row.pair}</span>
                    <span className="nfi-mono">
                      {(row.share * 100).toFixed(1)}% · {row.stake.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            title="No exposure"
            hint="Flat — open a position to see allocation."
          />
        )}
      </WidgetFrame>
    </>
  );
}

export const ExposureWidgetDef = defineWidget({
  type: "exposure",
  hasSettings: true,
  title: "Exposure",
  description: "Deployed stake allocation across open pairs.",
  configSchema: ExposureConfigSchema,
  defaultConfig: EXPOSURE_DEFAULTS,
  component: ExposureWidget,
  capabilities: [...EXPOSURE_CAPABILITIES],
  minWidth: 370,
  minHeight: 348,
  defaultWidth: 370,
  defaultHeight: 360,
});
