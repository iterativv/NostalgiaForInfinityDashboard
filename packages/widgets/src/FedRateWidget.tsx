// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Fed rate — the Federal Reserve policy stance at a glance.
 *
 * Server-scraped from free public sources (no API key, no freqtrade):
 * the NY Fed Markets API first (EFFR + FOMC target range + SOFR/OBFR),
 * FRED public CSVs as fallback. Shows the current target range, the
 * effective rate (EFFR) with its day-over-day move, SOFR/OBFR prints and
 * the recent history as a line chart. Public macro data — safe for the
 * anonymous grant and the shareable pages.
 */

import {
  LineChart,
  ScaleTypes,
  type LineChartOptions,
} from "@carbon/charts-react";
import { Tag } from "@carbon/react";
import type { Capability } from "@nfi/api-contract";
import { defineWidget } from "@nfi/widget-sdk";
import { EmptyState, Stat, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { ChartBox } from "./shared/ChartBox";
import { EmptyConfigSchema } from "./shared/config";
import { queryState } from "./shared/query";
import { chartTimeFormats, useTimeFormat } from "./shared/timeFormat";
import { useCompactMode } from "./shared/size";

export const FED_RATE_CAPABILITIES: ReadonlyArray<Capability> = [
  "macro.fed-rate",
];

const pct = (value: number | undefined): string =>
  value === undefined ? "—" : `${value.toFixed(2)}%`;

export function FedRateWidget() {
  const { data, error, isLoading } = useCapability("macro.fed-rate", {});
  const state = queryState(error, isLoading);
  // Time axis ticks follow the globally configured time format.
  const timeFormat = useTimeFormat();
  // Compact cells keep the headline range + chart; the stat row needs the
  // full budget to stay readable above it.
  const compact = useCompactMode(280);

  const history = data?.history ?? [];

  const chartData = history.flatMap((point) => {
    const rows = [];

    if (point.effective !== undefined) {
      rows.push({
        group: "Effective (EFFR)",
        date: point.date,
        value: point.effective,
      });
    }

    if (point.targetUpper !== undefined) {
      rows.push({
        group: "Target upper",
        date: point.date,
        value: point.targetUpper,
      });
    }

    if (point.targetLower !== undefined) {
      rows.push({
        group: "Target lower",
        date: point.date,
        value: point.targetLower,
      });
    }

    return rows;
  });

  const options: LineChartOptions = {
    title: "Fed funds rate (%)",
    timeScale: { timeIntervalFormats: chartTimeFormats(timeFormat) },
    axes: {
      left: { mapsTo: "value", title: "Rate %" },
      bottom: {
        mapsTo: "date",
        scaleType: ScaleTypes.TIME,
      },
    },
    points: { radius: 1 },
    color: {
      scale: {
        "Effective (EFFR)": "#0f62fe",
        "Target upper": "#fa4d56",
        "Target lower": "#24a148",
      },
    },
    theme: "g100",
  };

  const change = data?.effectiveChange;

  const changeTone =
    change === undefined || change === 0
      ? "neutral"
      : change > 0
        ? "negative"
        : "positive";

  const changeSub =
    change === undefined
      ? "vs. prior day"
      : `${change > 0 ? "+" : ""}${change.toFixed(2)}pp vs. prior day`;

  return (
    <WidgetFrame
      title="Fed Rate"
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
          {!compact ? (
            <div className="nfi-stat-grid">
              <Stat
                label="Target range"
                value={`${data.targetLower.toFixed(2)} – ${data.targetUpper.toFixed(2)}%`}
                sub={`FOMC · eff. ${data.effectiveDate ?? "—"}`}
              />
              <Stat
                label="Effective (EFFR)"
                value={pct(data.effective)}
                tone={changeTone}
                sub={changeSub}
              />
              <Stat
                label="SOFR"
                value={pct(data.sofr)}
                sub="secured overnight"
              />
              <Stat
                label="OBFR"
                value={pct(data.obfr)}
                sub={
                  data.volumeBillions !== undefined
                    ? `$${data.volumeBillions}b EFFR volume`
                    : "overnight bank funding"
                }
              />
            </div>
          ) : (
            <div className="nfi-stat-grid">
              <Stat
                label="Target range"
                value={`${data.targetLower.toFixed(2)} – ${data.targetUpper.toFixed(2)}%`}
                tone={changeTone}
                sub={
                  data.effective !== undefined
                    ? `EFFR ${data.effective.toFixed(2)}% (${changeSub})`
                    : changeSub
                }
              />
            </div>
          )}
          <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
            {data.sources.map((source) => (
              <Tag
                key={source.name}
                type={source.ok ? "green" : "red"}
                size="sm"
                title={source.href}
              >
                {source.name} {source.ok ? "● live" : "● down"}
              </Tag>
            ))}
          </div>
          {chartData.length > 1 ? (
            <ChartBox min={compact ? 150 : 180}>
              {(height) => (
                <LineChart
                  data={chartData}
                  options={{ ...options, height: `${height}px` }}
                />
              )}
            </ChartBox>
          ) : null}
        </div>
      ) : (
        <EmptyState
          title="No Fed data"
          hint="Is the backend able to reach the NY Fed / FRED public endpoints?"
        />
      )}
    </WidgetFrame>
  );
}

export const FedRateWidgetDef = defineWidget({
  type: "fed-rate",
  title: "Fed Rate",
  description:
    "Federal Reserve policy rate: FOMC target range, EFFR, SOFR/OBFR and history — scraped from free NY Fed + FRED sources.",
  configSchema: EmptyConfigSchema,
  defaultConfig: {},
  component: FedRateWidget,
  capabilities: [...FED_RATE_CAPABILITIES],
  minWidth: 600,
  minHeight: 340,
  defaultWidth: 360,
  defaultHeight: 260,
});
