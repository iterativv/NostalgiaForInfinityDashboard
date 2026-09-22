// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Pair Locks — pairs freqtrade currently refuses to trade.
 *
 * Backed by `instances.locks`. Shows each lock's pair, side, lock reason,
 * when it was set and when it expires, plus active-vs-expired counts.
 */

import { Tag } from "@carbon/react";
import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, Stat, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { InstanceIdField, booleanWithDefault } from "./shared/config";
import { fmtDate } from "./shared/format";
import { InstanceSelect } from "./shared/InstanceSelect";
import { queryState } from "./shared/query";
import { SettingsToggle } from "./shared/SettingsToggle";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const PAIR_LOCKS_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.locks",
];

export const PairLocksConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  showExpired: booleanWithDefault(false),
});
export type PairLocksConfig = typeof PairLocksConfigSchema.Type;

export const PAIR_LOCKS_DEFAULTS: PairLocksConfig = Schema.decodeUnknownSync(
  PairLocksConfigSchema,
)({});

export function PairLocksWidget({
  config,
  panelId,
}: WidgetProps<PairLocksConfig>) {
  const cfg = config;
  const { data, error, isLoading } = useCapability("instances.locks", {
    id: cfg.instanceId,
  });
  const state = queryState(error, isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<PairLocksConfig>) =>
    applyWidgetSettings(panelId, "pair-locks", cfg, p);

  const locks = (data?.locks ?? []).filter(
    (lock) => cfg.showExpired || lock.active,
  );
  const active = (data?.locks ?? []).filter((lock) => lock.active).length;
  const reasons = new Set(locks.map((lock) => lock.reason));

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Pair locks settings"
        widgetType="pair-locks"
      >
        <InstanceSelect
          id={`locks-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
        />
        <SettingsToggle
          id={`locks-expired-${panelId}`}
          label="Show expired locks"
          toggled={cfg.showExpired}
          onToggle={(v) => patch({ showExpired: v })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
      title="Pair Locks"
      isLoading={state.isLoading}
      error={state.error}
    >
      {locks.length > 0 ? (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
        >
          <div className="nfi-stat-grid">
            <Stat
              label="Active locks"
              value={String(active)}
              sub={`${data?.locks.length ?? 0} total`}
            />
            <Stat
              label="Pairs locked"
              value={String(new Set(locks.map((l) => l.pair)).size)}
            />
            <Stat label="Reasons" value={String(reasons.size)} />
          </div>
          <div className="nfi-table-scroll">
            <table style={{ width: "100%", fontSize: "0.8125rem" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Pair</th>
                  <th style={{ textAlign: "left" }}>Until</th>
                  <th style={{ textAlign: "left" }}>Reason</th>
                  <th style={{ textAlign: "right" }}>State</th>
                </tr>
              </thead>
              <tbody>
                {locks.map((lock) => (
                  <tr key={`${lock.id}-${lock.pair}`}>
                    <td className="nfi-mono">
                      {lock.pair}
                      {lock.side !== undefined ? (
                        <span style={{ opacity: 0.6 }}> {lock.side}</span>
                      ) : null}
                    </td>
                    <td className="nfi-mono">{fmtDate(lock.lockEndTime)}</td>
                    <td style={{ opacity: 0.8 }}>{lock.reason || "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <Tag type={lock.active ? "gray" : "outline"} size="sm">
                        {lock.active ? "locked" : "expired"}
                      </Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState
          title="No pair locks"
          hint="Locked pairs appear here while freqtrade pauses them."
        />
      )}
    </WidgetFrame>
    </>
  );
}

export const PairLocksWidgetDef = defineWidget({
  type: "pair-locks",
  hasSettings: true,
  title: "Pair Locks",
  description: "Pairs currently locked from trading, with reason and expiry.",
  configSchema: PairLocksConfigSchema,
  defaultConfig: PAIR_LOCKS_DEFAULTS,
  component: PairLocksWidget,
  capabilities: [...PAIR_LOCKS_CAPABILITIES],
  minWidth: 320,
  minHeight: 160,
});
