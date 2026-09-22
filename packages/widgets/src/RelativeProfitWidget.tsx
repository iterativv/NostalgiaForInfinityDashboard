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
import { InstanceSelect } from "./shared/InstanceSelect";
import { queryState } from "./shared/query";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const RELATIVE_PROFIT_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.profit.relative",
];

export const RelativeProfitConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
});
export type RelativeProfitConfig = typeof RelativeProfitConfigSchema.Type;

export const RELATIVE_PROFIT_DEFAULTS: RelativeProfitConfig =
  Schema.decodeUnknownSync(RelativeProfitConfigSchema)({});

/**
 * Public profit widget — percentages and counts, never coin/fiat amounts.
 *
 * Backed by `instances.profit.relative`: safe for publicly shareable pages.
 */
export function RelativeProfitWidget({
  config,
  panelId,
}: WidgetProps<RelativeProfitConfig>) {
  const cfg = config;
  const { data, error, isLoading } = useCapability(
    "instances.profit.relative",
    { id: cfg.instanceId },
  );
  const state = queryState(error, isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<RelativeProfitConfig>) =>
    applyWidgetSettings(panelId, "profit-relative", cfg, p);

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Profit settings"
        widgetType="profit-relative"
      >
        <InstanceSelect
          id={`rel-profit-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
      title="Profit %"
      isLoading={state.isLoading}
      error={state.error}
    >
      {data ? (
        <div className="nfi-stat-grid nfi-stat-grid--fill">
          <Stat
            label="Closed profit"
            value={`${data.profitClosedPercent.toFixed(2)}%`}
            sub={`${data.closedTradeCount} closed`}
            tone={pnlTone(data.profitClosedPercent)}
          />
          <Stat
            label="All profit"
            value={`${data.profitAllPercent.toFixed(2)}%`}
            sub={`${data.tradeCount} trades`}
            tone={pnlTone(data.profitAllPercent)}
          />
          <Stat
            label="Trades"
            value={String(data.tradeCount)}
            sub={`${data.closedTradeCount} closed`}
          />
        </div>
      ) : (
        <EmptyState title="No profit data" />
      )}
    </WidgetFrame>
    </>
  );
}

export const RelativeProfitWidgetDef = defineWidget({
  type: "profit-relative",
  hasSettings: true,
  title: "Profit %",
  description:
    "Public-shareable profit percentages for one instance — never absolute amounts.",
  configSchema: RelativeProfitConfigSchema,
  defaultConfig: RELATIVE_PROFIT_DEFAULTS,
  component: RelativeProfitWidget,
  capabilities: [...RELATIVE_PROFIT_CAPABILITIES],
  minWidth: 280,
  minHeight: 100,
});
