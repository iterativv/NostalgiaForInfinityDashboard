// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { defineWidget } from "@nfi/widget-sdk";
import {
  LineChart,
  ScaleTypes,
  type LineChartOptions,
} from "@carbon/charts-react";
import { EmptyState, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { ChartBox } from "./shared/ChartBox";
import { EmptyConfigSchema } from "./shared/config";
import { queryState } from "./shared/query";

/**
 * Public equity widget — performance rebased to an index starting at 100.
 *
 * Backed by `bot.profit-history.relative`: the first visible point is always
 * exactly 100, so the curve shows shape without revealing scale.
 */
export function RelativeEquityWidget() {
  const { data, error, isLoading } = useCapability(
    "bot.profit-history.relative",
    {},
  );
  const state = queryState(error, isLoading);
  const points = data?.points ?? [];
  const series = points.flatMap((point) => [
    {
      group: "All (index)",
      date: point.recordedAt,
      value: point.profitAllIndex,
    },
    {
      group: "Closed (index)",
      date: point.recordedAt,
      value: point.profitClosedIndex,
    },
  ]);
  const lineOptions: LineChartOptions = {
    title: "Performance index (base 100)",
    axes: {
      bottom: { mapsTo: "date", scaleType: ScaleTypes.TIME, title: "Time" },
      left: { mapsTo: "value", title: "Index" },
    },
    theme: "g100",
  };
  return (
    <WidgetFrame
      title="Performance Index"
      isLoading={state.isLoading}
      error={state.error}
    >
      {series.length >= 4 ? (
        <ChartBox min={200}>
          {(height) => (
            <LineChart
              data={series}
              options={{ ...lineOptions, height: `${height}px` }}
            />
          )}
        </ChartBox>
      ) : (
        <EmptyState
          title="Collecting history…"
          hint="The backend records a snapshot every minute while it runs. Check back soon."
        />
      )}
    </WidgetFrame>
  );
}

export const RelativeEquityWidgetDef = defineWidget({
  type: "equity-relative",
  title: "Performance Index",
  description:
    "Public-shareable performance index rebased to 100 — never absolute profit.",
  configSchema: EmptyConfigSchema,
  defaultConfig: {},
  component: RelativeEquityWidget,
  capabilities: ["bot.profit-history.relative"],
  minWidth: 340,
  minHeight: 200,
});
