// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Daily / Weekly / Monthly Profit — bucketed profit bars.
 *
 * Backed by `instances.profit-daily` (one instance) or
 * `instances.profit-daily-all` (every instance merged by bucket date).
 * Green bars are profitable buckets, red are losses; the stat row sums the
 * window and shows the best/worst bucket.
 */

import {
  ScaleTypes,
  SimpleBarChart,
  type BarChartOptions,
} from "@carbon/charts-react";
import { NumberInput } from "@carbon/react";
import { Schema } from "effect";
import type { Capability, ProfitBucketKind } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, Stat, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { ChartBox } from "./shared/ChartBox";
import { InstanceIdField, numberWithDefault } from "./shared/config";
import { useCompactMode } from "./shared/size";
import { clampInt, fmt, pnlTone } from "./shared/format";
import { ALL_INSTANCES, InstanceSelect } from "./shared/InstanceSelect";
import { queryState } from "./shared/query";
import { SettingsSelect } from "./shared/SettingsSelect";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const DAILY_PROFIT_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.profit-daily",
  "instances.profit-daily-all",
];

const PROFIT_FILL = "#42be65";
const LOSS_FILL = "#fa4d56";

export const DailyProfitConfigSchema = Schema.Struct({
  /** An instance id, or `all` for fleet buckets merged by date. */
  instanceId: InstanceIdField,
  bucket: Schema.optionalWith(Schema.Literal("daily", "weekly", "monthly"), {
    default: (): ProfitBucketKind => "daily",
  }),
  /** Timescale: number of buckets kept from freqtrade. */
  days: numberWithDefault(30),
});
export type DailyProfitConfig = typeof DailyProfitConfigSchema.Type;

export const DAILY_PROFIT_DEFAULTS: DailyProfitConfig =
  Schema.decodeUnknownSync(DailyProfitConfigSchema)({});

const BUCKETS: Array<{ id: ProfitBucketKind; text: string }> = [
  { id: "daily", text: "Daily" },
  { id: "weekly", text: "Weekly" },
  { id: "monthly", text: "Monthly" },
];

export function DailyProfitWidget({
  config,
  panelId,
}: WidgetProps<DailyProfitConfig>) {
  const cfg = config;
  const days = clampInt(cfg.days, 30, 7, 100);
  const fleet = cfg.instanceId === ALL_INSTANCES;
  const perInstanceView = useCapability(
    "instances.profit-daily",
    {
      id: fleet ? "default" : cfg.instanceId,
      bucket: cfg.bucket,
      days: String(days),
    },
    { enabled: !fleet },
  );
  const fleetView = useCapability(
    "instances.profit-daily-all",
    { bucket: cfg.bucket, days: String(days) },
    { enabled: fleet },
  );
  const view = fleet ? fleetView : perInstanceView;
  const state = queryState(view.error, view.isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<DailyProfitConfig>) =>
    applyWidgetSettings(panelId, "daily-profit", cfg, p);

  // Compact cells draw the buckets alone; the stat row needs ~260px total.
  const compact = useCompactMode(260);
  const buckets = view.data?.buckets ?? [];
  // TIME scale: bucket dates along a time axis. LABELS with a month of daily
  // buckets rotates one label per day and eats the whole chart (bars become
  // unreadable in any cell the grid presets produce).
  const bars = buckets.map((bucket) => ({
    group: bucket.date,
    value: Number(bucket.profitAbs.toFixed(2)),
    date: new Date(
      bucket.date.includes("T") ? bucket.date : bucket.date.replace(" ", "T"),
    ),
  }));
  const colorScale: Record<string, string> = {};
  for (const bar of bars) {
    colorScale[bar.group] = bar.value >= 0 ? PROFIT_FILL : LOSS_FILL;
  }
  const barOptions: BarChartOptions = {
    title: `${cfg.bucket[0]!.toUpperCase()}${cfg.bucket.slice(1)} profit`,
    axes: {
      left: { mapsTo: "value", title: "Profit" },
      bottom: {
        mapsTo: "date",
        scaleType: ScaleTypes.TIME,
        title:
          cfg.bucket === "daily"
            ? "Day"
            : cfg.bucket === "weekly"
              ? "Week"
              : "Month",
      },
    },
    timeScale: { addSpaceOnEdges: 1 },
    color: { scale: colorScale },
    // One legend entry per bucket is noise — the stat row above already
    // summarizes the window; the bars need the vertical space instead.
    legend: { enabled: false },
    theme: "g100",
  };
  const total = buckets.reduce((sum, bucket) => sum + bucket.profitAbs, 0);
  const trades = buckets.reduce((sum, bucket) => sum + bucket.trades, 0);
  const best = buckets.reduce<number | undefined>(
    (acc, bucket) =>
      acc === undefined || bucket.profitAbs > acc ? bucket.profitAbs : acc,
    undefined,
  );
  const worst = buckets.reduce<number | undefined>(
    (acc, bucket) =>
      acc === undefined || bucket.profitAbs < acc ? bucket.profitAbs : acc,
    undefined,
  );

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Profit buckets settings"
        widgetType="daily-profit"
      >
        <InstanceSelect
          id={`daily-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <SettingsSelect
          id={`daily-bucket-${panelId}`}
          label="Bucket"
          items={BUCKETS}
          value={cfg.bucket}
          onChange={(bucket) => patch({ bucket: bucket as ProfitBucketKind })}
        />
        <NumberInput
          id={`daily-days-${panelId}`}
          label="Buckets (timescale)"
          value={days}
          min={7}
          max={100}
          step={1}
          onChange={(_e, { value }) =>
            patch({ days: clampInt(value, 30, 7, 100) })
          }
          size="sm"
        />
      </WidgetSettingsModal>
      <WidgetFrame
      title="Daily Profit"
      isLoading={state.isLoading}
      error={state.error}
    >
      {buckets.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            flex: "1 1 auto",
            minHeight: 0,
          }}
        >
          {!compact ? (
            <div className="nfi-stat-grid">
              <Stat
                label="Window profit"
                value={fmt(total, 2)}
                tone={pnlTone(total)}
                sub={`${buckets.length} buckets`}
              />
              <Stat label="Trades" value={String(trades)} />
              <Stat
                label="Best / worst"
                value={`${fmt(best, 2)} / ${fmt(worst, 2)}`}
              />
            </div>
          ) : null}
          <ChartBox min={compact ? 150 : 200}>
            {(height) => (
              <SimpleBarChart
                data={bars}
                options={{ ...barOptions, height: `${height}px` }}
              />
            )}
          </ChartBox>
        </div>
      ) : (
        <EmptyState
          title="No profit buckets"
          hint="Profit history appears once trades close."
        />
      )}
    </WidgetFrame>
    </>
  );
}

export const DailyProfitWidgetDef = defineWidget({
  type: "daily-profit",
  hasSettings: true,
  title: "Daily Profit",
  description:
    "Profit bars per day, week or month — one instance or the fleet.",
  configSchema: DailyProfitConfigSchema,
  defaultConfig: DAILY_PROFIT_DEFAULTS,
  component: DailyProfitWidget,
  capabilities: [...DAILY_PROFIT_CAPABILITIES],
  minWidth: 320,
  minHeight: 150,
});
