// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Tag } from "@carbon/react";
import { Schema } from "effect";
import type {
  Capability,
  RelativeClosedPosition,
  RelativeTagPerformanceRow,
} from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import {
  EmptyState,
  NfiDataTable,
  shallow,
  Stat,
  useDerived,
  WidgetFrame,
  type NfiColumnDef,
} from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { InstanceIdField, stringWithDefault } from "./shared/config";
import {
  fmtDate,
  fmtDuration,
  fmtSigned,
  pnlClass,
  pnlTone,
} from "./shared/format";
import { InstanceSelect } from "./shared/InstanceSelect";
import { queryState, useWidgetAccess } from "./shared/query";
import { SettingsSelect } from "./shared/SettingsSelect";
import { useTimeFormat } from "./shared/timeFormat";
import { parseTradeTime } from "./shared/tradeSort";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import { type ExportColumn } from "./shared/export";
import { COL } from "./shared/columns";
import { NfiTableContainer, NfiTableToolbar } from "./shared/tableToolbar";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const PERCENT_ENTRY_STATS_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.tag-performance.relative",
  // Tag expansions list related trades — the widget consumes this id in
  // `renderExpandedRow`, so grants and the picker must reflect it.
  "instances.closed-positions.relative",
];

const EMPTY_TAG_ROWS: RelativeTagPerformanceRow[] = [];

/** Opportunistic detail source for tag expansions (never required). */
const TAG_POSITIONS_CAPABILITY: Capability =
  "instances.closed-positions.relative";

export const PercentEntryStatsConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  groupBy: stringWithDefault("enter"),
});

export type PercentEntryStatsConfig = typeof PercentEntryStatsConfigSchema.Type;

export const PERCENT_ENTRY_STATS_DEFAULTS: PercentEntryStatsConfig =
  Schema.decodeUnknownSync(PercentEntryStatsConfigSchema)({});

/**
 * Column set for the tag table. Rows keep their fixed business order (most
 * trades first), so every column opts out of sorting; the Share cell closes
 * over the aggregated total, which is why the array is derived, not static.
 * The first column names the grouped side (enter tags vs exit reasons).
 */
function buildColumns([aggregated, groupByExit]: readonly [
  number,
  boolean,
]): NfiColumnDef<RelativeTagPerformanceRow>[] {
  return [
    {
      id: "tag",
      header: groupByExit ? COL.exitReason : COL.enterTag,
      cell: ({ row }) => row.original.tag,
      enableSorting: false,
    },
    {
      id: "trades",
      header: COL.trades,
      cell: ({ row }) => row.original.trades,
      enableSorting: false,
    },
    {
      id: "share",
      header: COL.share,
      cell: ({ row }) =>
        aggregated > 0
          ? `${((row.original.trades / aggregated) * 100).toFixed(1)}%`
          : "—",
      enableSorting: false,
    },
    {
      id: "winrate",
      header: COL.winRate,
      cell: ({ row }) => (
        <span className={pnlClass(row.original.winrate * 2 - 1)}>
          {(row.original.winrate * 100).toFixed(1)}%
        </span>
      ),
      enableSorting: false,
    },
    {
      id: "avgPct",
      header: COL.avgPct,
      cell: ({ row }) => (
        <span className={pnlClass(row.original.profitPctAvg)}>
          {fmtSigned(row.original.profitPctAvg, 2)}%
        </span>
      ),
      enableSorting: false,
    },
    {
      id: "wl",
      header: COL.winLoss,
      cell: ({ row }) => `${row.original.wins} / ${row.original.losses}`,
      enableSorting: false,
    },
  ];
}

/**
 * Column set for one tag's related trades. Percent-only — the same window
 * the tag aggregates (newest 200 closed trades), so the expansion lists
 * exactly the positions behind the tag row: pair, direction, realized
 * close %, hold time, close date, and the *other* side's tag (exit reason
 * when grouped by entry signal, entry tag when grouped by exit reason).
 */
function buildTagPositionColumns(
  groupByExit: boolean,
): NfiColumnDef<RelativeClosedPosition>[] {
  return [
    {
      id: "pair",
      header: COL.pair,
      accessorFn: (p) => p.pair,
      enableSorting: false,
    },
    {
      id: "dir",
      header: COL.direction,
      cell: ({ row }) => (
        <Tag type={row.original.isShort ? "red" : "green"} size="sm">
          {row.original.isShort ? "SHORT" : "LONG"}
        </Tag>
      ),
      enableSorting: false,
    },
    {
      id: "closePct",
      header: COL.profitPct,
      cell: ({ row }) => (
        <span
          className={pnlClass(
            row.original.closeProfitPct ?? row.original.profitPct,
          )}
        >
          {fmtSigned(
            row.original.closeProfitPct ?? row.original.profitPct,
            2,
          )}
          %
        </span>
      ),
      enableSorting: false,
    },
    {
      id: "held",
      header: COL.duration,
      cell: ({ row }) => fmtDuration(row.original.tradeDurationSeconds),
      enableSorting: false,
    },
    {
      id: "closed",
      header: COL.closeDate,
      cell: ({ row }) => fmtDate(row.original.closeDate),
      enableSorting: false,
    },
    groupByExit
      ? {
          id: "enterTag",
          header: COL.enterTag,
          cell: ({ row }) => row.original.enterTag?.trim() || "—",
          enableSorting: false,
        }
      : {
          id: "exitReason",
          header: COL.exitReason,
          cell: ({ row }) => row.original.exitReason ?? "—",
          enableSorting: false,
        },
  ];
}

/**
 * Bucket closed positions by the grouped tag (trimmed `enterTag` /
 * `exitReason` strings — the backend aggregates the same trimmed keys with
 * an `"unknown"` fallback for blank tags), newest first. Powers the
 * per-tag expansion: each bucket lists exactly the positions behind its
 * tag row in the shared newest-200 window.
 */
export function groupPositionsByTag(
  positions: ReadonlyArray<RelativeClosedPosition>,
  groupByExit: boolean,
): Map<string, RelativeClosedPosition[]> {
  const map = new Map<string, RelativeClosedPosition[]>();

  for (const p of positions) {
    const source = groupByExit ? p.exitReason : p.enterTag;
    const trimmed = source?.trim();

    const key = trimmed !== undefined && trimmed.length > 0 ? trimmed : "unknown";
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }

  for (const list of map.values()) {
    list.sort(
      (a, b) =>
        parseTradeTime(b.closeDate ?? b.openDate) -
        parseTradeTime(a.closeDate ?? a.openDate),
    );
  }

  return map;
}

/**
 * Public entry/exit tag statistics — win rate and average percent per tag.
 *
 * Backed by `instances.tag-performance.relative`: tags, counts and
 * percentages only, so strategy edge is visible without revealing money.
 * Rows render through NfiDataTable in fixed order (most trades first).
 * Expanding a tag lists its related trades from
 * `instances.closed-positions.relative` (same newest-200 window the tags
 * aggregate, matched on the exact grouped tag) — opportunistic detail
 * that stays hidden when the grant lacks that id.
 */
export function PercentEntryStatsWidget({
  config,
  panelId,
}: WidgetProps<PercentEntryStatsConfig>) {
  const cfg = config;
  const groupByExit = cfg.groupBy === "exit";

  // Window lock: the tag aggregation and the expansion detail below must
  // read the SAME newest-200 window — pass the limit explicitly instead of
  // relying on the backend default, so the per-tag expansions can never
  // silently disagree with the tag rows.
  const { data, error, isLoading } = useCapability(
    "instances.tag-performance.relative",
    { id: cfg.instanceId, limit: "200", groupBy: groupByExit ? "exit" : "enter" },
  );

  // Related-trades detail for expansions: same newest-200 window the tags
  // aggregate. Opportunistic — the tag table stands alone without it.
  const positionsAccess = useWidgetAccess([TAG_POSITIONS_CAPABILITY]);

  const positionsQ = useCapability(
    "instances.closed-positions.relative",
    { id: cfg.instanceId, limit: "200" },
    { enabled: positionsAccess.allowed },
  );

  const state = queryState(error, isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);

  // fmtDate reads the global time-format store; this read re-renders rows
  // when the configured format changes.
  useTimeFormat();

  const patch = (p: Partial<PercentEntryStatsConfig>) =>
    applyWidgetSettings(panelId, "tag-performance-relative", cfg, p);

  // Sorted by trade count with a STABLE reference between data updates:
  // TanStack rebuilds its row model (and wipes manual expansion) whenever
  // the data identity changes, so a fresh sorted array every render made
  // the tag chevrons appear dead. Derive through a store instead (with a
  // stable empty fallback — a fresh `[]` while loading would defeat it).
  const rows = useDerived(data?.rows ?? EMPTY_TAG_ROWS, (unsorted) =>
    [...unsorted].sort((a, b) => b.trades - a.trades),
  );

  const aggregated = data?.aggregatedTrades ?? 0;
  const wins = rows.reduce((sum, r) => sum + r.wins, 0);
  const trades = rows.reduce((sum, r) => sum + r.trades, 0);

  const bestRow = rows.reduce<null | (typeof rows)[number]>((best, r) => {
    if (r.trades < 3) return best;

    if (!best) return r;

    return r.profitPctAvg > best.profitPctAvg ? r : best;
  }, null);

  // Columns depend on the aggregated total (Share %) and the grouped
  // side (first header); ordering itself is fixed (most trades first,
  // pre-sorted above).
  const columns = useDerived([aggregated, groupByExit] as const, buildColumns, {
    inputs: shallow,
  });

  // Positions bucketed by the exact grouped tag (raw strings on both
  // sides — the backend groups the same way), newest first. The sub-table
  // columns depend only on the group-by side, so they are static per
  // render of this widget instance.
  const positionsByTag = useDerived(
    [positionsQ.data, groupByExit] as const,
    ([posData, byExit]) =>
      groupPositionsByTag(posData?.positions ?? [], byExit),
    { inputs: shallow },
  );

  const tagPositionColumns = useDerived(
    [groupByExit] as const,
    ([byExit]) => buildTagPositionColumns(byExit),
    { inputs: shallow },
  );

  const exportColumns: ReadonlyArray<ExportColumn<RelativeTagPerformanceRow>> =
    [
      {
        header: groupByExit ? COL.exitReason : COL.enterTag,
        value: (r) => r.tag,
      },
      { header: COL.trades, value: (r) => r.trades },
      { header: COL.wins, value: (r) => r.wins },
      { header: COL.losses, value: (r) => r.losses },
      { header: COL.winRate, value: (r) => r.winrate },
      { header: COL.avgPct, value: (r) => r.profitPctAvg },
    ];

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Entry stats % settings"
        widgetType="tag-performance-relative"
      >
        <InstanceSelect
          id={`pct-tags-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
        />
        <SettingsSelect
          id={`pct-tags-group-${panelId}`}
          label="Group by"
          items={[
            { id: "enter", text: "Entry signal" },
            { id: "exit", text: "Exit reason" },
          ]}
          value={cfg.groupBy === "exit" ? "exit" : "enter"}
          onChange={(id) => patch({ groupBy: id })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
        title={`Entry Stats % · ${cfg.groupBy === "exit" ? "exit" : "enter"}`}
        isLoading={state.isLoading}
        error={state.error}
      >
        {data ? (
          rows.length > 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
              }}
            >
              <div className="nfi-stat-grid">
                <Stat
                  label="Overall win rate"
                  value={
                    trades > 0 ? `${((wins / trades) * 100).toFixed(1)}%` : "—"
                  }
                  sub={`${trades} tagged trades`}
                  tone={pnlTone(wins * 2 - trades)}
                />
                <Stat
                  label="Signals"
                  value={String(rows.length)}
                  sub={`grouped by ${cfg.groupBy === "exit" ? "exit" : "enter"} tag`}
                />
                <Stat
                  label="Best edge"
                  value={
                    bestRow ? `${fmtSigned(bestRow.profitPctAvg, 2)}%` : "—"
                  }
                  sub={
                    bestRow
                      ? `${bestRow.tag} · ≥3 trades`
                      : "needs ≥3 trades per tag"
                  }
                  tone={bestRow ? pnlTone(bestRow.profitPctAvg) : "neutral"}
                />
              </div>
              <NfiTableContainer>
                <NfiTableToolbar
                  label="Entry stats table actions"
                  exportMenu={{
                    filenameBase: `entry-stats-pct-${cfg.instanceId}`,
                    columns: exportColumns,
                    rows,
                  }}
                />
                <div className="nfi-table-scroll">
                  <NfiDataTable
                    columns={columns}
                    data={rows}
                    getRowId={(r) => r.tag}
                    renderExpandedRow={(row) => {
                    if (!positionsAccess.allowed) {
                      return (
                        <p className="nfi-suborders-empty">
                          Position detail needs
                          `instances.closed-positions.relative`.
                        </p>
                      );
                    }

                    const related = positionsByTag.get(row.original.tag) ?? [];

                    if (related.length === 0) {
                      return (
                        <p className="nfi-suborders-empty">
                          No positions in this window carry this tag.
                        </p>
                      );
                    }

                    return (
                      <div className="nfi-suborders">
                        <p className="nfi-suborders-caption">
                          {related.length}{" "}
                          {related.length === 1 ? "trade" : "trades"} ·{" "}
                          {row.original.tag}
                        </p>
                        <div className="nfi-table-scroll">
                          <NfiDataTable
                            columns={tagPositionColumns}
                            data={related}
                            getRowId={(p) => `${cfg.instanceId}-${p.tradeId}`}
                          />
                        </div>
                      </div>
                    );
                  }}
                />
              </div>
              </NfiTableContainer>
            </div>
          ) : (
            <EmptyState
              title="No tagged trades"
              hint="Tags appear once the strategy records entry/exit signals."
            />
          )
        ) : null}
      </WidgetFrame>
    </>
  );
}

export const PercentEntryStatsWidgetDef = defineWidget({
  type: "tag-performance-relative",
  hasSettings: true,
  title: "Entry Stats %",
  description:
    "Public-shareable win rate and average percent per entry/exit tag — expand a tag for its underlying trades. Never absolute amounts.",
  configSchema: PercentEntryStatsConfigSchema,
  defaultConfig: PERCENT_ENTRY_STATS_DEFAULTS,
  component: PercentEntryStatsWidget,
  capabilities: [...PERCENT_ENTRY_STATS_CAPABILITIES],
  minWidth: 666,
  minHeight: 342,
  defaultWidth: 960,
  defaultHeight: 440,
});
