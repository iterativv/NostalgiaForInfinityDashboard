// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Wallet History — recorded stake-balance over time for every configured
 * instance, drawn as one Carbon line per bot (freqtrade-UI style), with each
 * bot's starting balance as a flat reference series. Data comes from the
 * server's own sqlite snapshots (`instances.balance-history`), so the curves
 * persist even while freqtrade is unreachable; freqtrade's starting capital
 * (from `/balance`) draws the flat baseline.
 */

import { NumberInput } from "@carbon/react";
import { Schema } from "effect";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import {
  LineChart,
  ScaleTypes,
  type LineChartOptions,
} from "@carbon/charts-react";
import { EmptyState, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { ChartBox } from "./shared/ChartBox";
import {
  InstanceIdField,
  booleanWithDefault,
  numberWithDefault,
} from "./shared/config";
import { useCompactMode } from "./shared/size";
import { clampInt, fmt } from "./shared/format";
import { queryState } from "./shared/query";
import { InstanceSelect } from "./shared/InstanceSelect";
import { SettingsToggle } from "./shared/SettingsToggle";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const WalletHistoryConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  /** Snapshot window per instance (oldest points dropped). */
  limit: numberWithDefault(500),
  showStartingBalance: booleanWithDefault(true),
});
export type WalletHistoryConfig = typeof WalletHistoryConfigSchema.Type;

export const WALLET_HISTORY_DEFAULTS: WalletHistoryConfig =
  Schema.decodeUnknownSync(WalletHistoryConfigSchema)({});

interface ChartPoint {
  group: string;
  date: string;
  value: number;
}

export function WalletHistoryWidget({
  config,
  panelId,
}: WidgetProps<WalletHistoryConfig>) {
  const cfg = config;
  const limit = clampInt(cfg.limit, 500, 50, 500);
  const fleet = useCapability("instances.balance-history", {
    limit: String(limit),
  });
  const state = queryState(fleet.error, fleet.isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<WalletHistoryConfig>) =>
    applyWidgetSettings(panelId, "wallet-history", cfg, p);

  const stakeCurrency = fleet.data?.stakeCurrency;
  const rows = (fleet.data?.instances ?? []).filter(
    (row) =>
      cfg.instanceId === "all" ||
      row.instanceId === cfg.instanceId ||
      row.instanceName === cfg.instanceId,
  );
  const series: ChartPoint[] = [];
  for (const row of rows) {
    if (row.points.length === 0) continue;
    const name = row.instanceName || row.instanceId;
    const window = row.points.slice(-limit);
    for (const point of window) {
      series.push({ group: name, date: point.recordedAt, value: point.totalStake });
    }
    if (
      cfg.showStartingBalance &&
      row.startingCapital !== undefined &&
      window.length > 0
    ) {
      const first = window[0];
      const last = window[window.length - 1];
      if (first && last) {
        series.push({
          group: `${name} — start`,
          date: first.recordedAt,
          value: row.startingCapital,
        });
        series.push({
          group: `${name} — start`,
          date: last.recordedAt,
          value: row.startingCapital,
        });
      }
    }
  }
  const latest = new Map<string, number>();
  for (const row of rows) {
    const last = row.points[row.points.length - 1];
    if (last) {
      latest.set(row.instanceName || row.instanceId, last.totalStake);
    }
  }
  // Compact cells draw the curves alone; the wallet list needs ~250px total.
  const compact = useCompactMode(250);
  const lineOptions: LineChartOptions = {
    title: "Wallet history",
    axes: {
      bottom: {
        mapsTo: "date",
        scaleType: ScaleTypes.TIME,
        title: "Recorded at",
      },
      left: {
        mapsTo: "value",
        title: `Wallet (${stakeCurrency ?? "stake"})`,
      },
    },
    theme: "g100",
  };

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Wallet history settings"
        widgetType="wallet-history"
      >
        <InstanceSelect
          id={`wh-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <NumberInput
          id={`wh-limit-${panelId}`}
          label="Snapshots per instance"
          value={limit}
          min={50}
          max={500}
          step={50}
          onChange={(_e, { value }) =>
            patch({ limit: clampInt(value, 500, 50, 500) })
          }
          size="sm"
        />
        <SettingsToggle
          id={`wh-start-${panelId}`}
          label="Starting balance lines"
          toggled={cfg.showStartingBalance}
          onToggle={(v) => patch({ showStartingBalance: v })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
      title="Wallet History"
      isLoading={state.isLoading}
      error={state.error}
    >
      {series.length >= 2 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            flex: "1 1 auto",
            minHeight: 0,
          }}
        >
          {!compact && latest.size > 0 ? (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "0.25rem 1rem",
                fontSize: "0.75rem",
              }}
            >
              {[...latest.entries()].map(([name, value]) => (
                <span key={name} className="nfi-mono">
                  {name}:{" "}
                  {fmt(value, 2)}
                  {stakeCurrency ? ` ${stakeCurrency}` : ""}
                </span>
              ))}
            </div>
          ) : null}
          <ChartBox min={compact ? 150 : 200}>
            {(height) => (
              <LineChart
                data={series}
                options={{ ...lineOptions, height: `${height}px` }}
              />
            )}
          </ChartBox>
        </div>
      ) : (
        <EmptyState
          title="No wallet history yet"
          hint="The server records balance snapshots on its poll cadence — curves appear after the first snapshots land (or once a freqtrade instance is reachable)."
        />
      )}
    </WidgetFrame>
    </>
  );
}

export const WalletHistoryWidgetDef = defineWidget({
  type: "wallet-history",
  hasSettings: true,
  title: "Wallet History",
  description:
    "Recorded wallet balance over time for every instance, with starting-balance reference lines.",
  configSchema: WalletHistoryConfigSchema,
  defaultConfig: WALLET_HISTORY_DEFAULTS,
  component: WalletHistoryWidget,
  capabilities: ["instances.balance-history"],
  minWidth: 320,
  minHeight: 150,
});
