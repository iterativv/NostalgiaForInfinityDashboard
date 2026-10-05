// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * NFI tag performance — closed-trade stats grouped by NFI `enter_tag` (or
 * `exit_reason`), aggregated by the backend.
 *
 * Grouping and sort keys are Effect Literals, so an invalid persisted value
 * fails decode (→ Panel placeholder) instead of silently mis-sorting.
 * Rows render through NfiDataTable in the fixed "Sort by" order.
 */

import { NumberInput, Tag } from "@carbon/react";
import { Schema } from "effect";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { TagGroupBy, type TagPerformanceRow } from "@nfi/api-contract";
import {
  EmptyState,
  NfiDataTable,
  shallow,
  useDerived,
  WidgetFrame,
  type NfiColumnDef,
} from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import {
  InstanceIdField,
  booleanWithDefault,
  numberWithDefault,
} from "./shared/config";
import { clampInt, pnlClass } from "./shared/format";
import { queryState } from "./shared/query";
import { ALL_INSTANCES, InstanceSelect } from "./shared/InstanceSelect";
import { SettingsSelect } from "./shared/SettingsSelect";
import { SettingsToggle } from "./shared/SettingsToggle";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import { type ExportColumn } from "./shared/export";
import { COL } from "./shared/columns";
import { NfiTableContainer, NfiTableToolbar } from "./shared/tableToolbar";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const TagSortKey = Schema.Literal(
  "profitAbs",
  "trades",
  "winrate",
  "profitPctAvg",
  "tag",
);

export type TagSortKey = typeof TagSortKey.Type;

export const TagPerformanceConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  limit: numberWithDefault(200),
  groupBy: Schema.optionalWith(TagGroupBy, {
    default: (): TagGroupBy => "enter",
  }),
  minTrades: numberWithDefault(1),
  sortBy: Schema.optionalWith(TagSortKey, {
    default: (): TagSortKey => "profitAbs",
  }),
  showWins: booleanWithDefault(true),
  showLosses: booleanWithDefault(true),
  showWinrate: booleanWithDefault(true),
  showProfitAbs: booleanWithDefault(true),
  showAvgPct: booleanWithDefault(true),
});

export type TagPerformanceConfig = typeof TagPerformanceConfigSchema.Type;

export const TAG_PERFORMANCE_DEFAULTS: TagPerformanceConfig =
  Schema.decodeUnknownSync(TagPerformanceConfigSchema)({});

const TAG_GROUP_ITEMS = [
  { id: "enter", text: "Entry tags (enter_tag)" },
  { id: "exit", text: "Exit reasons (exit_reason)" },
] as const;

const TAG_SORT_ITEMS: ReadonlyArray<{
  readonly id: TagSortKey;
  readonly text: string;
}> = [
  { id: "profitAbs", text: COL.totalProfit },
  { id: "trades", text: COL.trades },
  { id: "winrate", text: COL.winRate },
  { id: "profitPctAvg", text: COL.avgPct },
  { id: "tag", text: COL.enterTag },
];

/**
 * Column set depends on the visible-metric flags, the grouping (first
 * column's header) and the stake currency (profit header). Rows keep their
 * fixed business order (the "Sort by" pick pre-sorts the data), so no
 * column opts into header sorting.
 */
function buildColumns([cfg, stake]: readonly [
  TagPerformanceConfig,
  string,
]): NfiColumnDef<TagPerformanceRow>[] {
  const defs: (NfiColumnDef<TagPerformanceRow> | null)[] = [
    {
      id: "tag",
      header: cfg.groupBy === "enter" ? COL.enterTag : COL.exitReason,
      cell: ({ row }) => (
        <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          {row.original.tag}
        </span>
      ),
      enableSorting: false,
    },
    {
      id: "trades",
      header: COL.trades,
      cell: ({ row }) => row.original.trades,
      enableSorting: false,
    },
    cfg.showWins
      ? {
          id: "wins",
          header: COL.wins,
          cell: ({ row }) => row.original.wins,
          enableSorting: false,
        }
      : null,
    cfg.showLosses
      ? {
          id: "losses",
          header: COL.losses,
          cell: ({ row }) => row.original.losses,
          enableSorting: false,
        }
      : null,
    cfg.showWinrate
      ? {
          id: "winrate",
          header: COL.winRate,
          cell: ({ row }) => `${(row.original.winrate * 100).toFixed(1)}%`,
          enableSorting: false,
        }
      : null,
    cfg.showProfitAbs
      ? {
          id: "profitAbs",
          header: () => (
            <span
              title={
                stake ? `Total profit in ${stake}` : "Total profit"
              }
            >
              {COL.totalProfit}
            </span>
          ),
          cell: ({ row }) => (
            <Tag type={row.original.profitAbs >= 0 ? "green" : "red"}>
              {row.original.profitAbs.toFixed(2)}
            </Tag>
          ),
          enableSorting: false,
        }
      : null,
    cfg.showAvgPct
      ? {
          id: "avgPct",
          header: COL.avgPct,
          cell: ({ row }) => (
            <span className={pnlClass(row.original.profitPctAvg)}>
              {row.original.profitPctAvg.toFixed(2)}%
            </span>
          ),
          enableSorting: false,
        }
      : null,
  ];

  return defs.flatMap((entry) => (entry ? [entry] : []));
}

export function TagPerformanceWidget({
  config,
  panelId,
}: WidgetProps<TagPerformanceConfig>) {
  const cfg = config;
  const fleet = cfg.instanceId === ALL_INSTANCES;
  const limit = clampInt(cfg.limit, 200, 10, 1000);
  const minTrades = clampInt(cfg.minTrades, 1, 0, 100);
  const groupBy = cfg.groupBy;
  const sortBy = cfg.sortBy;

  const perInstance = useCapability(
    "instances.tag-performance",
    {
      id: cfg.instanceId,
      limit: String(limit),
      groupBy,
    },
    { enabled: !fleet },
  );

  const fleetView = useCapability(
    "instances.tag-performance-all",
    { limit: String(limit), groupBy },
    { enabled: fleet },
  );

  // Currency label only: the fleet takes it from the overview totals
  // (per-bot `/profit` reads need a concrete instance id).
  const perProfit = useCapability(
    "instances.profit",
    { id: cfg.instanceId },
    { enabled: !fleet },
  );

  const overview = useCapability("instances.overview", {}, { enabled: fleet });

  const data = fleet ? fleetView.data : perInstance.data;

  const error = fleet
    ? (fleetView.error ?? overview.error)
    : (perInstance.error ?? perProfit.error);

  const isLoading = fleet
    ? fleetView.isLoading || overview.isLoading
    : perInstance.isLoading || perProfit.isLoading;

  const state = queryState(error, isLoading);

  const showSettings = useWidgetSettingsOpen(panelId);

  const patch = (p: Partial<TagPerformanceConfig>) =>
    applyWidgetSettings(panelId, "tag-performance", cfg, p);

  const patchFlag = (key: keyof TagPerformanceConfig, v: boolean): void => {
    // SAFETY: `key` iterates the boolean settings keys rendered in this
    // modal, so the computed entry is a valid Partial (TS cannot express a
    // computed partial from a union key).
    patch({ [key]: v } as Partial<TagPerformanceConfig>);
  };

  const stake = fleet
    ? (overview.data?.totals.stakeCurrency ?? "")
    : (perProfit.data?.stakeCurrency ?? "");

  // Column set derived through a store: rebuilt only when the widget config
  // or the stake-currency label actually changes; row order is fixed by the
  // "Sort by" pick (data pre-sorted above).
  const columns = useDerived([cfg, stake] as const, buildColumns, {
    inputs: shallow,
  });

  const rows = (data?.rows ?? [])
    .filter((r) => r.trades >= minTrades)
    .sort((a, b) => {
      // Metrics sort best-first; the tag name sorts A→Z — the "sort by"
      // pick alone decides both, no separate direction toggle.
      if (sortBy === "tag") return a.tag.localeCompare(b.tag);

      return b[sortBy] - a[sortBy];
    });

  const groupItems = TAG_GROUP_ITEMS.map((i) => ({ ...i }));

  const sortItems = TAG_SORT_ITEMS.map((i) => ({
    ...i,
    text:
      i.id === "tag"
        ? groupBy === "enter"
          ? COL.enterTag
          : COL.exitReason
        : i.text,
  }));

  const exportColumns: ReadonlyArray<ExportColumn<TagPerformanceRow>> = [
    {
      header: groupBy === "enter" ? COL.enterTag : COL.exitReason,
      value: (r) => r.tag,
    },
    { header: COL.trades, value: (r) => r.trades },
    { header: COL.wins, value: (r) => r.wins },
    { header: COL.losses, value: (r) => r.losses },
    { header: COL.winRate, value: (r) => r.winrate },
    { header: COL.totalProfit, value: (r) => r.profitAbs },
    { header: COL.avgPct, value: (r) => r.profitPctAvg },
  ];

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Tag performance settings"
        widgetType="tag-performance"
      >
        <InstanceSelect
          id={`tag-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <SettingsSelect
          id={`tag-group-${panelId}`}
          label="Group by"
          items={groupItems}
          value={groupBy}
          onChange={(id) =>
            patch({ groupBy: Schema.decodeUnknownSync(TagGroupBy)(id) })
          }
        />
        <SettingsSelect
          id={`tag-sort-${panelId}`}
          label="Sort by"
          items={sortItems}
          value={sortBy}
          onChange={(id) =>
            patch({ sortBy: Schema.decodeUnknownSync(TagSortKey)(id) })
          }
        />
        <NumberInput
          id={`tag-limit-${panelId}`}
          label="Closed trades aggregated"
          value={limit}
          min={10}
          max={1000}
          step={10}
          onChange={(_e, { value }) =>
            patch({ limit: clampInt(value, 200, 10, 1000) })
          }
          size="sm"
        />
        <NumberInput
          id={`tag-min-${panelId}`}
          label="Minimum trades per tag"
          value={minTrades}
          min={0}
          max={100}
          step={1}
          onChange={(_e, { value }) =>
            patch({ minTrades: clampInt(value, 1, 0, 100) })
          }
          size="sm"
        />
        <div className="nfi-settings-toggles">
          {(
            [
              ["showWins", COL.wins],
              ["showLosses", COL.losses],
              ["showWinrate", COL.winRate],
              ["showProfitAbs", COL.totalProfit],
              ["showAvgPct", COL.avgPct],
            ] as const
          ).map(([key, label]) => (
            <SettingsToggle
              key={key}
              id={`tag-${key}-${panelId}`}
              label={label}
              toggled={cfg[key]}
              onToggle={(v) => patchFlag(key, v)}
            />
          ))}
        </div>
      </WidgetSettingsModal>
      <WidgetFrame
        title={groupBy === "enter" ? "NFI Entry Tags" : "Exit Reasons"}
        isLoading={state.isLoading}
        error={state.error}
      >
        {rows.length > 0 ? (
          <NfiTableContainer>
            <NfiTableToolbar
              label="Tag performance table actions"
              exportMenu={{
                filenameBase: `tag-performance-${cfg.instanceId}`,
                columns: exportColumns,
                rows,
              }}
            />
            <div className="nfi-table-scroll">
              <NfiDataTable
                columns={columns}
                data={rows}
                getRowId={(row) => row.tag}
              />
            </div>
          </NfiTableContainer>
        ) : (
          <EmptyState
            title="No tag data"
            hint="No closed trades in the window (or below the minimum). Widen the window in ⚙ settings."
          />
        )}
        {data ? (
          <p
            style={{ fontSize: "0.75rem", opacity: 0.65, marginTop: "0.5rem" }}
          >
            {data.aggregatedTrades} closed trades aggregated · NFI entry signals
            live in enter_tag; exit signals in exit_reason.
          </p>
        ) : null}
      </WidgetFrame>
    </>
  );
}

export const TagPerformanceWidgetDef = defineWidget({
  type: "tag-performance",
  hasSettings: true,
  title: "NFI Tag Performance",
  description:
    "Closed-trade performance grouped by NFI enter_tag (or exit_reason).",
  configSchema: TagPerformanceConfigSchema,
  defaultConfig: TAG_PERFORMANCE_DEFAULTS,
  component: TagPerformanceWidget,
  capabilities: [
    "instances.tag-performance",
    "instances.tag-performance-all",
    "instances.profit",
    "instances.overview",
  ],
  minWidth: 748,
  minHeight: 268,
  defaultWidth: 960,
  defaultHeight: 440,
});
