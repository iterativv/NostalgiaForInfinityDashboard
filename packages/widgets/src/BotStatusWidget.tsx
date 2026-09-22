// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, Stat, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { InstanceIdField } from "./shared/config";
import { InstanceSelect } from "./shared/InstanceSelect";
import { queryState } from "./shared/query";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const BOT_STATUS_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.status",
];

export const BotStatusConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
});
export type BotStatusConfig = typeof BotStatusConfigSchema.Type;

export const BOT_STATUS_DEFAULTS: BotStatusConfig = Schema.decodeUnknownSync(
  BotStatusConfigSchema,
)({});

export function BotStatusWidget({
  config,
  panelId,
}: WidgetProps<BotStatusConfig>) {
  const cfg = config;
  const { data, error, isLoading } = useCapability("instances.status", {
    id: cfg.instanceId,
  });
  const state = queryState(error, isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<BotStatusConfig>) =>
    applyWidgetSettings(panelId, "bot-status", cfg, p);

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Bot status settings"
        widgetType="bot-status"
      >
        <InstanceSelect
          id={`bot-status-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
      title="Bot Status"
      isLoading={state.isLoading}
      error={state.error}
    >
      {data ? (
        <div className="nfi-stat-grid nfi-stat-grid--fill">
          <Stat
            label="State"
            value={data.state}
            sub={
              data.dryRun === undefined
                ? undefined
                : data.dryRun
                  ? "dry-run"
                  : "live trading"
            }
            tone={data.state === "running" ? "positive" : "neutral"}
          />
          <Stat label="Strategy" value={data.strategy ?? "—"} />
          <Stat label="Exchange" value={data.exchange ?? "—"} />
          <Stat
            label="Mode"
            value={data.tradingMode ?? "—"}
            sub={data.stakeCurrency ? `stake ${data.stakeCurrency}` : undefined}
          />
        </div>
      ) : (
        <EmptyState
          title="No status"
          hint="Is the backend connected to freqtrade?"
        />
      )}
    </WidgetFrame>
    </>
  );
}

export const BotStatusWidgetDef = defineWidget({
  type: "bot-status",
  hasSettings: true,
  title: "Bot Status",
  description:
    "Freqtrade state, strategy, exchange and run mode for one instance.",
  configSchema: BotStatusConfigSchema,
  defaultConfig: BOT_STATUS_DEFAULTS,
  component: BotStatusWidget,
  capabilities: [...BOT_STATUS_CAPABILITIES],
  minWidth: 240,
  minHeight: 100,
});
