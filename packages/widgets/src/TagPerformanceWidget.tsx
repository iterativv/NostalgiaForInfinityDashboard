// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * NFI tag performance — closed-trade stats grouped by NFI `enter_tag` (or
 * `exit_reason`), aggregated by the backend.
 *
 * Grouping and sort keys are Effect Literals, so an invalid persisted value
 * fails decode (→ Panel placeholder) instead of silently mis-sorting.
 */

import {
  NumberInput,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
} from "@carbon/react";
import { Schema } from "effect";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { TagGroupBy } from "@nfi/api-contract";
import { EmptyState, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import {
  InstanceIdField,
  booleanWithDefault,
  numberWithDefault,
} from "./shared/config";
import { clampInt, pnlClass } from "./shared/format";
import { queryState } from "./shared/query";
import { InstanceSelect } from "./shared/InstanceSelect";
import { SettingsSelect } from "./shared/SettingsSelect";
import { SettingsToggle } from "./shared/SettingsToggle";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
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
  sortAsc: booleanWithDefault(false),
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
  { id: "profitAbs", text: "Total profit" },
  { id: "trades", text: "Trades" },
  { id: "winrate", text: "Winrate" },
  { id: "profitPctAvg", text: "Avg %" },
  { id: "tag", text: "Tag" },
];

export function TagPerformanceWidget({
  config,
  panelId,
}: WidgetProps<TagPerformanceConfig>) {
  const cfg = config;
  const limit = clampInt(cfg.limit, 200, 10, 1000);
  const minTrades = clampInt(cfg.minTrades, 1, 0, 100);
  const groupBy = cfg.groupBy;
  const sortBy = cfg.sortBy;
  const { data, error, isLoading } = useCapability(
    "instances.tag-performance",
    {
      id: cfg.instanceId,
      limit: String(limit),
      groupBy,
    },
  );
  const profit = useCapability("instances.profit", { id: cfg.instanceId });
  const state = queryState(error, isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<TagPerformanceConfig>) =>
    applyWidgetSettings(panelId, "tag-performance", cfg, p);

  const stake = profit.data?.stakeCurrency ?? "";
  const rows = (data?.rows ?? [])
    .filter((r) => r.trades >= minTrades)
    .sort((a, b) => {
      const av = sortBy === "tag" ? a.tag : a[sortBy];
      const bv = sortBy === "tag" ? b.tag : b[sortBy];
      const cmp =
        typeof av === "string"
          ? av.localeCompare(bv as string)
          : (av as number) - (bv as number);
      return cfg.sortAsc ? cmp : -cmp;
    });
  const groupItems = TAG_GROUP_ITEMS.map((i) => ({ ...i }));
  const sortItems = TAG_SORT_ITEMS.map((i) => ({ ...i }));

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
        />
        <SettingsSelect
          id={`tag-group-${panelId}`}
          label="Group by"
          items={groupItems}
          value={groupBy}
          onChange={(id) => patch({ groupBy: id as typeof groupBy })}
        />
        <SettingsSelect
          id={`tag-sort-${panelId}`}
          label="Sort by"
          items={sortItems}
          value={sortBy}
          onChange={(id) => patch({ sortBy: id as typeof sortBy })}
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
        <SettingsToggle
          id={`tag-asc-${panelId}`}
          label="Ascending sort"
          toggled={cfg.sortAsc}
          onToggle={(v) => patch({ sortAsc: v })}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0 0.75rem",
          }}
        >
          {(
            [
              ["showWins", "Wins"],
              ["showLosses", "Losses"],
              ["showWinrate", "Winrate"],
              ["showProfitAbs", "Total profit"],
              ["showAvgPct", "Avg %"],
            ] as const
          ).map(([key, label]) => (
            <SettingsToggle
              key={key}
              id={`tag-${key}-${panelId}`}
              label={label}
              toggled={cfg[key]}
              onToggle={(v) =>
                patch({ [key]: v } as Partial<TagPerformanceConfig>)
              }
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
        <div className="nfi-table-scroll">
          <Table size="sm" useZebraStyles={false}>
            <TableHead>
              <TableRow>
                <TableHeader>
                  {groupBy === "enter" ? "Tag" : "Exit reason"}
                </TableHeader>
                <TableHeader>Trades</TableHeader>
                {cfg.showWins ? <TableHeader>W</TableHeader> : null}
                {cfg.showLosses ? <TableHeader>L</TableHeader> : null}
                {cfg.showWinrate ? <TableHeader>Winrate</TableHeader> : null}
                {cfg.showProfitAbs ? (
                  <TableHeader>Total {stake}</TableHeader>
                ) : null}
                {cfg.showAvgPct ? <TableHeader>Avg %</TableHeader> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.tag}>
                  <TableCell>
                    <span style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                      {row.tag}
                    </span>
                  </TableCell>
                  <TableCell>{row.trades}</TableCell>
                  {cfg.showWins ? <TableCell>{row.wins}</TableCell> : null}
                  {cfg.showLosses ? <TableCell>{row.losses}</TableCell> : null}
                  {cfg.showWinrate ? (
                    <TableCell>{(row.winrate * 100).toFixed(1)}%</TableCell>
                  ) : null}
                  {cfg.showProfitAbs ? (
                    <TableCell>
                      <Tag type={row.profitAbs >= 0 ? "green" : "red"}>
                        {row.profitAbs.toFixed(2)}
                      </Tag>
                    </TableCell>
                  ) : null}
                  {cfg.showAvgPct ? (
                    <TableCell>
                      <span className={pnlClass(row.profitPctAvg)}>
                        {row.profitPctAvg.toFixed(2)}%
                      </span>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          title="No tag data"
          hint="No closed trades in the window (or below the minimum). Widen the window in ⚙ settings."
        />
      )}
      {data ? (
        <p style={{ fontSize: "0.75rem", opacity: 0.65, marginTop: "0.5rem" }}>
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
  capabilities: ["instances.tag-performance", "instances.profit"],
  minWidth: 340,
  minHeight: 140,
});
