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
import { dimColor, useInstanceColors } from "./shared/instanceColors";
import { useCompactMode } from "./shared/size";
import { clampInt, fmt } from "./shared/format";
import { chartTimeFormats, useTimeFormat } from "./shared/timeFormat";
import { queryState } from "./shared/query";
import { InstanceSelect } from "./shared/InstanceSelect";
import { SettingsSelect } from "./shared/SettingsSelect";
import { SettingsToggle } from "./shared/SettingsToggle";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

/** Aggregation granularity — one point per bucket (bucket's last sample). */
const WalletBucket = Schema.Literal("6h", "day", "week");

export type WalletBucket = typeof WalletBucket.Type;

const BUCKET_ITEMS: ReadonlyArray<{ id: WalletBucket; text: string }> = [
  { id: "6h", text: "Every 6 hours" },
  { id: "day", text: "Daily" },
  { id: "week", text: "Weekly" },
];

export const WalletHistoryConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  /**
   * Aggregation bucket (default daily): raw per-minute snapshots make a
   * jittery, fast-moving curve that only spans hours — bucketed reads span
   * weeks. Server-side aggregation, one point per bucket.
   */
  bucket: Schema.optionalWith(WalletBucket, {
    default: (): WalletBucket => "day",
  }),
  /** Max points per instance after bucketing. */
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

  // Instance selection and the per-instance point window are SQL clauses
  // (WHERE + LIMIT) — the client renders whatever the database returned.
  const fleet = useCapability(
    "instances.balance-history",
    cfg.instanceId === "all"
      ? { limit: String(limit), bucket: cfg.bucket }
      : {
          limit: String(limit),
          bucket: cfg.bucket,
          id: cfg.instanceId,
        },
  );

  const state = queryState(fleet.error, fleet.isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const { colorOf } = useInstanceColors();

  const patch = (p: Partial<WalletHistoryConfig>) =>
    applyWidgetSettings(panelId, "wallet-history", cfg, p);

  const stakeCurrency = fleet.data?.stakeCurrency;

  const rows = fleet.data?.instances ?? [];

  const series: ChartPoint[] = [];
  // Per-instance colors: solid for the curve, dimmed for the start line.
  const colorScale: Record<string, string> = {};

  for (const row of rows) {
    if (row.points.length === 0) continue;
    const name = row.instanceName || row.instanceId;
    const window = row.points;
    const color = colorOf(row.instanceId);

    if (color) {
      colorScale[name] = color;
      colorScale[`${name} — start`] = dimColor(color);
    }

    for (const point of window) {
      series.push({
        group: name,
        date: point.recordedAt,
        value: point.totalStake,
      });
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
  // Time axis ticks follow the globally configured time format.
  const timeFormat = useTimeFormat();

  const lineOptions: LineChartOptions = {
    title: "Wallet history",
    timeScale: { timeIntervalFormats: chartTimeFormats(timeFormat) },
    axes: {
      bottom: {
        mapsTo: "date",
        scaleType: ScaleTypes.TIME,
        title: "Recorded at",
      },
      left: {
        mapsTo: "value",
        title: `Wallet (${stakeCurrency ?? "stake"})`,
        // Zoom the vertical axis to the recorded balances: a zero baseline
        // squeezes a ~100-115 wallet into a flat band at the top of the
        // chart, wasting most of the panel height.
        includeZero: false,
      },
    },
    color: { scale: colorScale },
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
        <SettingsSelect
          id={`wh-bucket-${panelId}`}
          label="Granularity"
          items={BUCKET_ITEMS.map((i) => ({ ...i }))}
          value={cfg.bucket}
          onChange={(id) =>
            patch({ bucket: Schema.decodeUnknownSync(WalletBucket)(id) })
          }
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
                    {name}: {fmt(value, 2)}
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
            hint="The server records balance snapshots on its stream cadence — curves appear after the first snapshots land (or once a freqtrade instance is reachable)."
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
  minWidth: 700,
  minHeight: 400,
  defaultWidth: 700,
  defaultHeight: 400,
});
