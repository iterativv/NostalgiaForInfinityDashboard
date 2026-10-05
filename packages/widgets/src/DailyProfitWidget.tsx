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
import { formatDateOnly, useTimeFormat } from "./shared/timeFormat";
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

const ProfitBucketSchema = Schema.Literal("daily", "weekly", "monthly");

export const DailyProfitConfigSchema = Schema.Struct({
  /** An instance id, or `all` for fleet buckets merged by date. */
  instanceId: InstanceIdField,
  bucket: Schema.optionalWith(ProfitBucketSchema, {
    default: (): ProfitBucketKind => "daily",
  }),
  /** Timescale: number of buckets kept from freqtrade. */
  days: numberWithDefault(30),
});

export type DailyProfitConfig = typeof DailyProfitConfigSchema.Type;

export const DAILY_PROFIT_DEFAULTS: DailyProfitConfig =
  Schema.decodeUnknownSync(DailyProfitConfigSchema)({});

const BUCKET_AXIS_TITLE: Record<ProfitBucketKind, string> = {
  daily: "Day",
  weekly: "Week",
  monthly: "Month",
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/**
 * Axis/tooltip label for a bucket date ("2026-09-01", optionally with a
 * time part): monthly/weekly buckets read "Sep '25" (weekly windows can
 * span years — the year keeps labels unique so Carbon never merges two
 * buckets into one group), daily reads the globally configured date format
 * (a 100-bucket window can never repeat a month+day). Parsed from the
 * string itself so bucket dates stay timezone-stable.
 */
export function bucketLabel(date: string, bucket: ProfitBucketKind): string {
  const [year, month, day] = date.split("-").map((part) => parseInt(part, 10));

  if (!year || !month || !MONTHS[month - 1]) return date;

  if (bucket !== "daily")
    return `${MONTHS[month - 1]} '${String(year).slice(2)}`;

  if (!Number.isFinite(day)) return date;

  return formatDateOnly(new Date(year, month - 1, day));
}

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
  // Bucket labels read the store inside `bucketLabel`; this read re-renders
  // the bars when the globally configured time format changes.
  useTimeFormat();

  const patch = (p: Partial<DailyProfitConfig>) =>
    applyWidgetSettings(panelId, "daily-profit", cfg, p);

  // Compact cells draw the buckets alone; the stat row needs ~260px total.
  const compact = useCompactMode(260);
  const buckets = view.data?.buckets ?? [];

  // One bar per bucket on a categorical axis. The label doubles as the
  // group (tooltip title) and the axis tick; a LABELS scale keeps every bar
  // in its own slot — a TIME scale infers the tick interval from the chart
  // width (quarterly for a year of monthly buckets) and extends the domain
  // by that interval on each edge, leaving dead space past the last bar
  // with axis ticks that never line up with the buckets.
  const bars = buckets.map((bucket) => ({
    group: bucketLabel(bucket.date, cfg.bucket),
    value: Number(bucket.profitAbs.toFixed(2)),
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
        mapsTo: "group",
        scaleType: ScaleTypes.LABELS,
        title: BUCKET_AXIS_TITLE[cfg.bucket],
      },
    },
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
          onChange={(bucket) =>
            patch({
              bucket: Schema.decodeUnknownSync(ProfitBucketSchema)(bucket),
            })
          }
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
  minWidth: 500,
  // Stat tiles + toolbar + a readable chart; the chart itself scrolls
  // horizontally for dense buckets instead of forcing a tall card.
  minHeight: 380,
  defaultWidth: 500,
  defaultHeight: 380,
});
