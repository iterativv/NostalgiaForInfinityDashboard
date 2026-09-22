// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, Stat, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { InstanceIdField } from "./shared/config";
import { pnlTone } from "./shared/format";
import { ALL_INSTANCES, InstanceSelect } from "./shared/InstanceSelect";
import { queryState } from "./shared/query";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const PROFIT_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.profit",
  "instances.overview",
];

export const ProfitConfigSchema = Schema.Struct({
  /** An instance id, or `all` for fleet totals (instances.overview). */
  instanceId: InstanceIdField,
});
export type ProfitConfig = typeof ProfitConfigSchema.Type;

export const PROFIT_DEFAULTS: ProfitConfig = Schema.decodeUnknownSync(
  ProfitConfigSchema,
)({});

export function ProfitWidget({ config, panelId }: WidgetProps<ProfitConfig>) {
  const cfg = config;
  const fleet = cfg.instanceId === ALL_INSTANCES;
  const perInstanceView = useCapability(
    "instances.profit",
    { id: fleet ? "default" : cfg.instanceId },
    { enabled: !fleet },
  );
  const fleetView = useCapability("instances.overview", {}, { enabled: fleet });
  const error = fleet ? fleetView.error : perInstanceView.error;
  const isLoading = fleet ? fleetView.isLoading : perInstanceView.isLoading;
  const state = queryState(error, isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<ProfitConfig>) =>
    applyWidgetSettings(panelId, "profit", cfg, p);

  const closed = fleet
    ? (fleetView.data?.totals.profitClosedCoin ?? 0)
    : perInstanceView.data?.profitClosedCoin;
  const all = fleet
    ? (fleetView.data?.totals.profitAllCoin ?? 0)
    : perInstanceView.data?.profitAllCoin;
  const stake = fleet
    ? (fleetView.data?.totals.stakeCurrency ?? "—")
    : (perInstanceView.data?.stakeCurrency ?? "—");
  const trades = fleet
    ? (fleetView.data?.instances.reduce(
        (sum, row) => sum + (row.closedTradeCount ?? 0),
        0,
      ) ?? 0)
    : perInstanceView.data?.tradeCount;
  const closedTrades = fleet
    ? (fleetView.data?.instances.reduce(
        (sum, row) => sum + (row.closedTradeCount ?? 0),
        0,
      ) ?? 0)
    : perInstanceView.data?.closedTradeCount;

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Profit settings"
        widgetType="profit"
      >
        <InstanceSelect
          id={`profit-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
      </WidgetSettingsModal>
      <WidgetFrame title="Profit" isLoading={state.isLoading} error={state.error}>
      {closed !== undefined ? (
        <div className="nfi-stat-grid nfi-stat-grid--fill">
          <Stat
            label="Closed profit"
            value={`${closed.toFixed(2)} ${stake}`}
            tone={pnlTone(closed)}
            sub={
              fleet
                ? `${fleetView.data?.totals.reachableCount ?? 0}/${fleetView.data?.totals.instanceCount ?? 0} instances`
                : undefined
            }
          />
          <Stat
            label="All profit"
            value={`${all?.toFixed(2) ?? "—"} ${stake}`}
            tone={pnlTone(all ?? 0)}
            sub={
              closed !== undefined && all !== undefined
                ? `${(all - closed >= 0 ? "+" : "") + (all - closed).toFixed(2)} open`
                : undefined
            }
          />
          <Stat
            label="Closed trades"
            value={String(closedTrades ?? "—")}
            sub={trades !== undefined ? `${trades} total` : undefined}
          />
          {fleet ? (
            <Stat
              label="Open trades"
              value={String(fleetView.data?.totals.openCount ?? "—")}
              sub="across the fleet"
            />
          ) : null}
        </div>
      ) : (
        <EmptyState title="No profit data" />
      )}
    </WidgetFrame>
    </>
  );
}

export const ProfitWidgetDef = defineWidget({
  type: "profit",
  hasSettings: true,
  title: "Profit",
  description:
    "Closed and all-time profit in stake currency — one instance or fleet totals.",
  configSchema: ProfitConfigSchema,
  defaultConfig: PROFIT_DEFAULTS,
  component: ProfitWidget,
  capabilities: [...PROFIT_CAPABILITIES],
  minWidth: 280,
  minHeight: 100,
});
