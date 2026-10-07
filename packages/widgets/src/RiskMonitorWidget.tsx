// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Risk monitor — exposure, leverage and concentration guardrails.
 *
 * `instances.exposure` computes the open-book metrics (deployed stake,
 * unrealized PnL, max leverage, long/short split, largest position) as one
 * SQL aggregate over the mirror; the wallet capital comes from the live
 * balance/overview read. The exposure ratio is the one display-time
 * division left — both operands are server-computed. Thresholds are
 * display hints (warn/critical) stored per panel.
 */

import { NumberInput, Tag } from "@carbon/react";
import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, shallow, Stat, useDerived, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { InstanceIdField, numberWithDefault } from "./shared/config";
import { useCompactMode } from "./shared/size";
import { clampInt } from "./shared/format";
import { queryState, useWidgetAccess } from "./shared/query";
import { ALL_INSTANCES, InstanceSelect } from "./shared/InstanceSelect";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const RISK_MONITOR_CAPABILITIES: ReadonlyArray<Capability> = [
  // SQL open-book aggregate (deployed/unrealized/leverage/sides/largest).
  "instances.exposure",
  "instances.balance",
  // Fleet mode (`instanceId: "all"`): capital comes from the fleet totals.
  "instances.overview",
];

export const RiskMonitorConfigSchema = Schema.Struct({
  /** An instance id, or `all` for fleet-wide risk. */
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
  const fleet = cfg.instanceId === ALL_INSTANCES;
  const access = useWidgetAccess(RISK_MONITOR_CAPABILITIES);

  const exposure = useCapability(
    "instances.exposure",
    { id: fleet ? undefined : cfg.instanceId },
    { enabled: access.allowed },
  );

  const perBalance = useCapability(
    "instances.balance",
    { id: cfg.instanceId },
    { enabled: access.allowed && !fleet },
  );

  const overview = useCapability(
    "instances.overview",
    {},
    { enabled: access.allowed && fleet },
  );

  const error = fleet
    ? (overview.error ?? exposure.error)
    : (exposure.error ?? perBalance.error);

  const isLoading = fleet
    ? overview.isLoading || exposure.isLoading
    : exposure.isLoading || perBalance.isLoading;

  const state = queryState(error, isLoading);

  const accessError = access.allowed
    ? null
    : `Not authorized — needs ${access.missing.join(", ")}`;

  const showSettings = useWidgetSettingsOpen(panelId);

  const patch = (p: Partial<RiskMonitorConfig>) =>
    applyWidgetSettings(panelId, "risk-monitor", cfg, p);

  /** Capital base for the exposure ratio: own wallet, or the fleet total. */
  const capitalBase = fleet
    ? (overview.data?.totals.totalStake ?? 0)
    : (perBalance.data?.totalStake ?? 0);

  // Derived through a store: the display ratio reruns only when the SQL
  // aggregate or the capital read changes, so store/resize re-renders
  // stay cheap.
  const risk = useDerived(
    [exposure.data, capitalBase] as const,
    ([payload, capital]) => {
      const summary = payload?.summary;
      const positions = summary?.positions ?? 0;
      const deployed = summary?.deployed ?? 0;

      return {
        positions,
        deployed,
        capital,
        exposurePct:
          capital > 0 ? (deployed / capital) * 100 : positions > 0 ? 100 : 0,
        unrealized: summary?.unrealized ?? 0,
        maxLev: summary?.maxLeverage ?? 1,
        longs: summary?.longs ?? 0,
        shorts: summary?.shorts ?? 0,
        largest: summary?.largestStake ?? 0,
        largestPct:
          deployed > 0 ? ((summary?.largestStake ?? 0) / deployed) * 100 : 0,
      };
    },
    { inputs: shallow },
  );

  const {
    positions,
    deployed,
    capital,
    exposurePct,
    unrealized,
    maxLev,
    longs,
    shorts,
    largest,
    largestPct,
  } = risk;

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
          allowAll
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
        {positions > 0 || capital > 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
              flex: "1 1 auto",
              minHeight: 0,
            }}
          >
            <div
              style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}
            >
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
                    : `${positions} open`
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
            hint={
              fleet
                ? "Flat — no open positions in the fleet."
                : "Flat — no open positions on this instance."
            }
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
  minWidth: 370,
  minHeight: 216,
  defaultWidth: 480,
  defaultHeight: 380,
});
