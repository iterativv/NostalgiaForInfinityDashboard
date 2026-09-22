// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Risk monitor — exposure, leverage and concentration guardrails.
 *
 * Combines balance (capital) with open positions (risk): exposure ratio,
 * unrealized PnL, max leverage, long/short split and the largest position.
 * Thresholds are display hints (warn/critical) stored per panel.
 */

import { NumberInput, Tag } from "@carbon/react";
import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, Stat, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { InstanceIdField, numberWithDefault } from "./shared/config";
import { useCompactMode } from "./shared/size";
import { clampInt } from "./shared/format";
import { queryState, useWidgetAccess } from "./shared/query";
import { InstanceSelect } from "./shared/InstanceSelect";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const RISK_MONITOR_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.open-positions",
  "instances.balance",
];

export const RiskMonitorConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  warnExposurePct: numberWithDefault(50),
  maxExposurePct: numberWithDefault(80),
});
export type RiskMonitorConfig = typeof RiskMonitorConfigSchema.Type;

export const RISK_MONITOR_DEFAULTS: RiskMonitorConfig =
  Schema.decodeUnknownSync(RiskMonitorConfigSchema)({});

export function RiskMonitorWidget({
  config,
  panelId,
}: WidgetProps<RiskMonitorConfig>) {
  const cfg = config;
  const warnAt = clampInt(cfg.warnExposurePct, 50, 1, 200);
  const maxAt = clampInt(cfg.maxExposurePct, 80, 1, 300);
  const access = useWidgetAccess(RISK_MONITOR_CAPABILITIES);
  const openQ = useCapability(
    "instances.open-positions",
    { id: cfg.instanceId },
    { enabled: access.allowed },
  );
  const balanceQ = useCapability(
    "instances.balance",
    { id: cfg.instanceId },
    { enabled: access.allowed },
  );
  const state = queryState(
    openQ.error ?? balanceQ.error,
    openQ.isLoading || balanceQ.isLoading,
  );
  const accessError = access.allowed
    ? null
    : `Not authorized — needs ${access.missing.join(", ")}`;
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<RiskMonitorConfig>) =>
    applyWidgetSettings(panelId, "risk-monitor", cfg, p);

  const positions = openQ.data?.positions ?? [];
  const deployed = positions.reduce((s, p) => s + p.stakeAmount, 0);
  const capital = balanceQ.data?.totalStake ?? 0;
  const exposurePct =
    capital > 0 ? (deployed / capital) * 100 : positions.length > 0 ? 100 : 0;
  const unrealized = positions.reduce((s, p) => s + (p.profitAbs ?? 0), 0);
  const leverages = positions.map((p) => p.leverage ?? 1);
  const maxLev = leverages.length > 0 ? Math.max(...leverages) : 1;
  const longs = positions.filter((p) => !p.isShort).length;
  const shorts = positions.filter((p) => p.isShort).length;
  const largest =
    positions.length > 0 ? Math.max(...positions.map((p) => p.stakeAmount)) : 0;
  const largestPct = deployed > 0 ? (largest / deployed) * 100 : 0;
  // Short cells drop the thresholds explainer (still in ⚙ settings).
  const compact = useCompactMode(200);
  const exposureTone =
    exposurePct >= maxAt ? "red" : exposurePct >= warnAt ? "purple" : "green";

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Risk monitor settings"
        widgetType="risk-monitor"
      >
        <InstanceSelect
          id={`risk-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
        />
        <NumberInput
          id={`risk-warn-${panelId}`}
          label="Warn exposure %"
          value={warnAt}
          min={1}
          max={200}
          step={5}
          onChange={(_e, { value }) =>
            patch({ warnExposurePct: clampInt(value, 50, 1, 200) })
          }
          size="sm"
        />
        <NumberInput
          id={`risk-max-${panelId}`}
          label="Critical exposure %"
          value={maxAt}
          min={1}
          max={300}
          step={5}
          onChange={(_e, { value }) =>
            patch({ maxExposurePct: clampInt(value, 80, 1, 300) })
          }
          size="sm"
        />
      </WidgetSettingsModal>
      <WidgetFrame
      title="Risk Monitor"
      isLoading={state.isLoading}
      error={accessError ?? state.error}
    >
      {positions.length > 0 || (balanceQ.data && capital > 0) ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            flex: "1 1 auto",
            minHeight: 0,
          }}
        >
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <Tag type={exposureTone} size="sm">
              exposure {exposurePct.toFixed(1)}%
            </Tag>
            <Tag type={unrealized >= 0 ? "green" : "red"} size="sm">
              unrealized {unrealized >= 0 ? "+" : ""}
              {unrealized.toFixed(2)}
            </Tag>
          </div>
          <div className="nfi-stat-grid nfi-stat-grid--fill">
            <Stat
              label="Deployed"
              value={deployed.toFixed(2)}
              sub={
                capital > 0
                  ? `of ${capital.toFixed(2)} capital`
                  : `${positions.length} open`
              }
            />
            <Stat
              label="Max leverage"
              value={`${maxLev}x`}
              sub={`${longs}L / ${shorts}S`}
            />
            <Stat
              label="Largest position"
              value={`${largestPct.toFixed(1)}%`}
              sub={`${largest.toFixed(2)} stake`}
            />
          </div>
          {!compact ? (
            <p style={{ fontSize: "0.75rem", opacity: 0.65 }}>
              Warn at {warnAt}% · critical at {maxAt}% of capital deployed.
            </p>
          ) : null}
        </div>
      ) : (
        <EmptyState
          title="No risk"
          hint="Flat — no open positions on this instance."
        />
      )}
    </WidgetFrame>
    </>
  );
}

export const RiskMonitorWidgetDef = defineWidget({
  type: "risk-monitor",
  hasSettings: true,
  title: "Risk Monitor",
  description: "Exposure, leverage and concentration guardrails.",
  configSchema: RiskMonitorConfigSchema,
  defaultConfig: RISK_MONITOR_DEFAULTS,
  component: RiskMonitorWidget,
  capabilities: [...RISK_MONITOR_CAPABILITIES],
  minWidth: 320,
  minHeight: 150,
});
