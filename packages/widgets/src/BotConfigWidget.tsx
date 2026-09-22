// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Tag } from "@carbon/react";
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

export const BOT_CONFIG_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.config",
];

export const BotConfigConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
});
export type BotConfigConfig = typeof BotConfigConfigSchema.Type;

export const BOT_CONFIG_DEFAULTS: BotConfigConfig = Schema.decodeUnknownSync(
  BotConfigConfigSchema,
)({});

export function BotConfigWidget({
  config,
  panelId,
}: WidgetProps<BotConfigConfig>) {
  const cfg = config;
  const { data, error, isLoading } = useCapability("instances.config", {
    id: cfg.instanceId,
  });
  const state = queryState(error, isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<BotConfigConfig>) =>
    applyWidgetSettings(panelId, "bot-config", cfg, p);

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Bot config settings"
        widgetType="bot-config"
      >
        <InstanceSelect
          id={`bot-config-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
      title="Bot Config"
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
          <div className="nfi-stat-grid nfi-stat-grid--fill">
            <Stat label="Strategy" value={data.strategy ?? "—"} />
            <Stat label="Exchange" value={data.exchange ?? "—"} />
            <Stat
              label="Stake"
              value={`${String(data.stakeAmount ?? "—")} ${data.stakeCurrency ?? ""}`}
            />
            <Stat
              label="Max open trades"
              value={String(data.maxOpenTrades ?? "—")}
            />
          </div>
          {data.dryRun !== undefined ? (
            // alignSelf keeps the pill content-sized — a stretched flex child
            // would smear one word across the whole cell.
            <Tag
              type={data.dryRun ? "blue" : "red"}
              size="sm"
              style={{ alignSelf: "flex-start" }}
            >
              {data.dryRun ? "dry-run" : "live"}
            </Tag>
          ) : null}
        </div>
      ) : (
        <EmptyState title="No config" />
      )}
    </WidgetFrame>
    </>
  );
}

export const BotConfigWidgetDef = defineWidget({
  type: "bot-config",
  hasSettings: true,
  title: "Bot Config",
  description: "Strategy, stake, limits and dry-run summary for one instance.",
  configSchema: BotConfigConfigSchema,
  defaultConfig: BOT_CONFIG_DEFAULTS,
  component: BotConfigWidget,
  capabilities: [...BOT_CONFIG_CAPABILITIES],
  minWidth: 260,
  minHeight: 140,
});
