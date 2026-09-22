// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { DonutChart, type DonutChartOptions } from "@carbon/charts-react";
import { EmptyState, Stat, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { ChartBox } from "./shared/ChartBox";
import { InstanceIdField } from "./shared/config";
import { useCompactMode } from "./shared/size";
import { ALL_INSTANCES, InstanceSelect } from "./shared/InstanceSelect";
import { queryState } from "./shared/query";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const BALANCE_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.balance",
  "instances.overview",
];

export const BalanceConfigSchema = Schema.Struct({
  /** An instance id, or `all` for the fleet wallet (per-instance donut). */
  instanceId: InstanceIdField,
});
export type BalanceConfig = typeof BalanceConfigSchema.Type;

export const BALANCE_DEFAULTS: BalanceConfig = Schema.decodeUnknownSync(
  BalanceConfigSchema,
)({});

export function BalanceWidget({ config, panelId }: WidgetProps<BalanceConfig>) {
  const cfg = config;
  const fleet = cfg.instanceId === ALL_INSTANCES;
  const perInstanceView = useCapability(
    "instances.balance",
    { id: fleet ? "default" : cfg.instanceId },
    { enabled: !fleet },
  );
  const fleetView = useCapability("instances.overview", {}, { enabled: fleet });
  const error = fleet ? fleetView.error : perInstanceView.error;
  const isLoading = fleet ? fleetView.isLoading : perInstanceView.isLoading;
  const state = queryState(error, isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<BalanceConfig>) =>
    applyWidgetSettings(panelId, "balance", cfg, p);

  // Fleet view: allocation donut over instance wallets.
  const fleetAllocation = (fleetView.data?.instances ?? [])
    .filter((row) => (row.totalStake ?? 0) > 0)
    .map((row) => ({ group: row.name, value: row.totalStake ?? 0 }));
  const fleetStake = fleetView.data?.totals.stakeCurrency;

  const allocation = fleet
    ? fleetAllocation
    : (perInstanceView.data?.currencies ?? [])
        .filter((currency) => currency.total > 0)
        .map((currency) => ({
          group: currency.currency,
          value: currency.total,
        }));
  const total = fleet
    ? (fleetView.data?.totals.totalStake ?? 0)
    : (perInstanceView.data?.totalStake ?? 0);
  const stakeLabel = fleet
    ? (fleetStake ?? "—")
    : (perInstanceView.data?.stakeCurrency ?? "—");
  // Compact cells (short rows in dense grid presets) get the ranked list —
  // a donut needs ~250px to read, below that it would clip or scroll.
  const compact = useCompactMode(250);
  const donutOptions: DonutChartOptions = {
    title: "Allocation",
    donut: { center: { label: `${total.toFixed(0)} ${stakeLabel}` } },
    theme: "g100",
  };
  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Balance settings"
        widgetType="balance"
      >
        <InstanceSelect
          id={`balance-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
      </WidgetSettingsModal>
      <WidgetFrame
      title="Balance"
      isLoading={state.isLoading}
      error={state.error}
    >
      {(
        fleet
          ? fleetView.data !== undefined
          : perInstanceView.data !== undefined
      ) ? (
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
            label={`Total (${stakeLabel})`}
            value={total.toFixed(2)}
            sub={`${allocation.length} ${fleet ? "wallets" : "currencies"}`}
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
              {fleet
                ? (fleetView.data?.instances ?? [])
                    .filter((row) => (row.totalStake ?? 0) > 0)
                    .slice(0, 8)
                    .map((row) => (
                      <div
                        key={row.id}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "0.5rem",
                          fontSize: "0.875rem",
                        }}
                      >
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {row.name}
                        </span>
                        <span
                          className="nfi-mono"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {(row.totalStake ?? 0).toFixed(2)}{" "}
                          {row.stakeCurrency ?? ""}
                        </span>
                      </div>
                    ))
                : (perInstanceView.data?.currencies ?? [])
                    .filter((currency) => currency.total > 0)
                    .slice(0, 8)
                    .map((currency) => (
                      <div
                        key={currency.currency}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: "0.5rem",
                          fontSize: "0.875rem",
                        }}
                      >
                        <span>{currency.currency}</span>
                        <span
                          className="nfi-mono"
                          style={{ fontVariantNumeric: "tabular-nums" }}
                        >
                          {currency.total.toFixed(4)}
                        </span>
                      </div>
                    ))}
            </div>
          )}
        </div>
      ) : (
        <EmptyState title="No balance data" />
      )}
    </WidgetFrame>
    </>
  );
}

export const BalanceWidgetDef = defineWidget({
  type: "balance",
  hasSettings: true,
  title: "Balance",
  description:
    "Wallet balances normalized to the stake currency — one instance or the fleet.",
  configSchema: BalanceConfigSchema,
  defaultConfig: BALANCE_DEFAULTS,
  component: BalanceWidget,
  capabilities: [...BALANCE_CAPABILITIES],
  minWidth: 280,
  minHeight: 100,
});
