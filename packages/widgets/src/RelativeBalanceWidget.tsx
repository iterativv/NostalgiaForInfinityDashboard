// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { DonutChart, type DonutChartOptions } from "@carbon/charts-react";
import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, Stat, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { ChartBox } from "./shared/ChartBox";
import { InstanceIdField } from "./shared/config";
import { useCompactMode } from "./shared/size";
import { InstanceSelect } from "./shared/InstanceSelect";
import { queryState } from "./shared/query";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const RELATIVE_BALANCE_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.balance.relative",
];

export const RelativeBalanceConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
});
export type RelativeBalanceConfig = typeof RelativeBalanceConfigSchema.Type;

export const RELATIVE_BALANCE_DEFAULTS: RelativeBalanceConfig =
  Schema.decodeUnknownSync(RelativeBalanceConfigSchema)({});

/**
 * Public allocation widget — wallet mix as percentages, never amounts.
 *
 * Backed by `instances.balance.relative`: safe for publicly shareable pages
 * because the response cannot reveal absolute balances for any options.
 */
export function RelativeBalanceWidget({
  config,
  panelId,
}: WidgetProps<RelativeBalanceConfig>) {
  const cfg = config;
  const { data, error, isLoading } = useCapability(
    "instances.balance.relative",
    { id: cfg.instanceId },
  );
  const state = queryState(error, isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<RelativeBalanceConfig>) =>
    applyWidgetSettings(panelId, "balance-relative", cfg, p);

  const allocation = (data?.currencies ?? [])
    .filter((currency) => currency.weight > 0)
    .map((currency) => ({
      group: currency.currency,
      value: Number((currency.weight * 100).toFixed(2)),
    }));
  const top =
    allocation.length > 0
      ? allocation.reduce((a, b) => (b.value > a.value ? b : a))
      : null;
  // Compact cells get the ranked percentage list — a donut needs ~250px.
  const compact = useCompactMode(250);
  const donutOptions: DonutChartOptions = {
    title: "Allocation %",
    donut: {
      center: {
        label: top ? `${top.group} ${top.value.toFixed(1)}%` : "",
      },
    },
    theme: "g100",
  };
  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Allocation settings"
        widgetType="balance-relative"
      >
        <InstanceSelect
          id={`rel-balance-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
      title="Allocation %"
      isLoading={state.isLoading}
      error={state.error}
    >
      {data ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            flex: "1 1 auto",
            minHeight: 0,
          }}
        >
          <Stat
            label="Tracked currencies"
            value={String(data.currencies.length)}
            sub={
              top
                ? `largest ${top.group} ${top.value.toFixed(1)}%`
                : "no allocation"
            }
          />
          {allocation.length > 1 && !compact ? (
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
              {allocation.slice(0, 10).map((entry) => (
                <div
                  key={entry.group}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                    fontSize: "0.875rem",
                  }}
                >
                  <span>{entry.group}</span>
                  <span
                    className="nfi-mono"
                    style={{ fontVariantNumeric: "tabular-nums" }}
                  >
                    {entry.value.toFixed(2)}%
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <EmptyState title="No allocation data" />
      )}
    </WidgetFrame>
    </>
  );
}

export const RelativeBalanceWidgetDef = defineWidget({
  type: "balance-relative",
  hasSettings: true,
  title: "Allocation %",
  description:
    "Public-shareable wallet mix as percentages for one instance — never absolute amounts.",
  configSchema: RelativeBalanceConfigSchema,
  defaultConfig: RELATIVE_BALANCE_DEFAULTS,
  component: RelativeBalanceWidget,
  capabilities: [...RELATIVE_BALANCE_CAPABILITIES],
  minWidth: 280,
  minHeight: 120,
});
