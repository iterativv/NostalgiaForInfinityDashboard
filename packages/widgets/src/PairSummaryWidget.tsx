// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Pair Summary — closed-trade attribution per pair.
 *
 * Groups the recent closed positions (one instance or the whole fleet) by
 * pair: trades, win rate, net profit and average profit %, sortable. The
 * classic freqtrade "which pairs pay the bills" view. Rows render through
 * NfiDataTable in the fixed "Sort by" order.
 */

import { NumberInput } from "@carbon/react";
import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
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
import { applyWidgetSettings } from "./shared/panelConfig";
import {
  InstanceIdField,
  booleanWithDefault,
  numberWithDefault,
} from "./shared/config";
import { clampInt, fmt, pnlClass } from "./shared/format";
import { ALL_INSTANCES, InstanceSelect } from "./shared/InstanceSelect";
import { useCapability } from "./live/live";
import { queryState, useWidgetAccess } from "./shared/query";
import { SettingsSelect } from "./shared/SettingsSelect";
import { SettingsToggle } from "./shared/SettingsToggle";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import { COL } from "./shared/columns";
import { NfiTableContainer, NfiTableToolbar } from "./shared/tableToolbar";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const PAIR_SUMMARY_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.tag-performance",
  "instances.tag-performance-all",
];

const SORTS = [
  { id: "profitAbs", text: COL.totalProfit },
  { id: "trades", text: COL.trades },
  { id: "winrate", text: COL.winRate },
  { id: "profitPctAvg", text: COL.avgPct },
  { id: "pair", text: COL.pair },
] as const;

const SortBySchema = Schema.Literal(...SORTS.map((sort) => sort.id));

export const PairSummaryConfigSchema = Schema.Struct({
  /** An instance id, or `all` for every closed position in the fleet. */
  instanceId: InstanceIdField,
  limit: numberWithDefault(200),
  minTrades: numberWithDefault(1),
  sortBy: Schema.optionalWith(SortBySchema, {
    default: (): (typeof SORTS)[number]["id"] => "profitAbs",
  }),
  showWinrate: booleanWithDefault(true),
  showAvgPct: booleanWithDefault(true),
});

export type PairSummaryConfig = typeof PairSummaryConfigSchema.Type;

export const PAIR_SUMMARY_DEFAULTS: PairSummaryConfig =
  Schema.decodeUnknownSync(PairSummaryConfigSchema)({});

interface PairRow {
  readonly pair: string;
  readonly trades: number;
  readonly wins: number;
  readonly losses: number;
  readonly winrate: number;
  readonly profitAbs: number;
  readonly profitPctAvg: number;
}

/**
 * Right alignment for the numeric columns, carried over from the raw table
 * this component used before NfiDataTable (which applies classes to cells,
 * not inline styles) — a block span fills the cell and aligns the content.
 */
const RIGHT_ALIGN = { display: "block", textAlign: "right" } as const;

/**
 * Column set: pair + trades always, win rate / avg % behind config flags.
 * Rows keep their fixed business order (the "Sort by" pick pre-sorts the
 * data), so no column opts into header sorting.
 */
function buildColumns([showWinrate, showAvgPct]: readonly [
  boolean,
  boolean,
]): NfiColumnDef<PairRow>[] {
  const defs: (NfiColumnDef<PairRow> | null)[] = [
    {
      id: "pair",
      header: COL.pair,
      cell: ({ row }) => row.original.pair,
      meta: { className: "nfi-mono" },
      enableSorting: false,
    },
    {
      id: "trades",
      header: () => <span style={RIGHT_ALIGN}>{COL.trades}</span>,
      cell: ({ row }) => (
        <span style={RIGHT_ALIGN}>
          {row.original.trades}
          <span style={{ opacity: 0.5 }}>
            {" "}
            ({row.original.wins}W/{row.original.losses}L)
          </span>
        </span>
      ),
      meta: { className: "nfi-mono" },
      enableSorting: false,
    },
    showWinrate
      ? {
          id: "winrate",
          header: () => <span style={RIGHT_ALIGN}>{COL.winRate}</span>,
          cell: ({ row }) => (
            <span style={RIGHT_ALIGN}>
              {(row.original.winrate * 100).toFixed(1)}%
            </span>
          ),
          meta: { className: "nfi-mono" },
          enableSorting: false,
        }
      : null,
    {
      id: "profitAbs",
      header: () => <span style={RIGHT_ALIGN}>{COL.totalProfit}</span>,
      cell: ({ row }) => (
        <span style={RIGHT_ALIGN}>
          <span className={pnlClass(row.original.profitAbs)}>
            {fmt(row.original.profitAbs, 2)}
          </span>
        </span>
      ),
      meta: { className: "nfi-mono" },
      enableSorting: false,
    },
    showAvgPct
      ? {
          id: "avgPct",
          header: () => <span style={RIGHT_ALIGN}>{COL.avgPct}</span>,
          cell: ({ row }) => (
            <span style={RIGHT_ALIGN}>
              <span className={pnlClass(row.original.profitPctAvg)}>
                {row.original.profitPctAvg.toFixed(2)}%
              </span>
            </span>
          ),
          meta: { className: "nfi-mono" },
          enableSorting: false,
        }
      : null,
  ];

  return defs.flatMap((entry) => (entry ? [entry] : []));
}

export function PairSummaryWidget({
  config,
  panelId,
}: WidgetProps<PairSummaryConfig>) {
  const cfg = config;
  const limit = clampInt(cfg.limit, 200, 10, 500);
  const minTrades = clampInt(cfg.minTrades, 1, 1, 100);
  const access = useWidgetAccess(PAIR_SUMMARY_CAPABILITIES);

  // One SQL GROUP BY over the FULL mirror history: pairs are the dimension,
  // minTrades the HAVING, sortBy the ORDER BY — the widget renders the
  // grouped rows verbatim (no client-side window to drop trades).
  const sortParam = cfg.sortBy === "pair" ? null : cfg.sortBy;

  const perInstance = useCapability(
    "instances.tag-performance",
    {
      id: cfg.instanceId,
      limit: String(limit),
      groupBy: "pair",
      minTrades: String(minTrades),
      sortBy: sortParam ?? undefined,
      sortDir: "desc",
    },
    { enabled: access.allowed && cfg.instanceId !== ALL_INSTANCES },
  );

  const fleetView = useCapability(
    "instances.tag-performance-all",
    {
      limit: String(limit),
      groupBy: "pair",
      minTrades: String(minTrades),
      sortBy: sortParam ?? undefined,
      sortDir: "desc",
    },
    { enabled: access.allowed && cfg.instanceId === ALL_INSTANCES },
  );

  const data =
    cfg.instanceId === ALL_INSTANCES ? fleetView.data : perInstance.data;

  const state = queryState(
    cfg.instanceId === ALL_INSTANCES ? fleetView.error : perInstance.error,
    cfg.instanceId === ALL_INSTANCES
      ? fleetView.isLoading
      : perInstance.isLoading,
  );

  const accessError = access.allowed
    ? null
    : `Not authorized — needs ${access.missing.join(", ")}`;

  const showSettings = useWidgetSettingsOpen(panelId);

  const patch = (p: Partial<PairSummaryConfig>) =>
    applyWidgetSettings(panelId, "pair-summary", cfg, p);

  const rows: PairRow[] =
    cfg.sortBy === "pair"
      ? [...(data?.rows ?? [])]
          .map((row) => ({ ...row, pair: row.tag }))
          .sort((a, b) => a.pair.localeCompare(b.pair))
      : (data?.rows ?? []).map((row) => ({ ...row, pair: row.tag }));

  // Footer metrics come from the server's full-set SQL aggregate — summing
  // the (LIMITed) rows client-side would silently drop every pair past the
  // window. The row-reduce fallback only covers snapshots from before the
  // field existed.
  const totals = data?.totals;

  const netProfit = totals
    ? totals.profitAbs
    : rows.reduce((sum, row) => sum + row.profitAbs, 0);

  const totalTrades = totals
    ? totals.trades
    : rows.reduce((sum, row) => sum + row.trades, 0);

  const best = data?.best
    ? { pair: data.best.tag, profitAbs: data.best.value }
    : rows.reduce<PairRow | undefined>(
        (acc, row) =>
          acc === undefined || row.profitAbs > acc.profitAbs ? row : acc,
        undefined,
      );

  const worst = data?.worst
    ? { pair: data.worst.tag, profitAbs: data.worst.value }
    : rows.reduce<PairRow | undefined>(
        (acc, row) =>
          acc === undefined || row.profitAbs < acc.profitAbs ? row : acc,
        undefined,
      );

  // Column set derived through a store: rebuilt only when the win-rate /
  // avg-% flags flip; row order is fixed by the "Sort by" pick (data
  // pre-sorted above).
  const columns = useDerived(
    [cfg.showWinrate, cfg.showAvgPct] as const,
    buildColumns,
    { inputs: shallow },
  );

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Pair summary settings"
        widgetType="pair-summary"
      >
        <InstanceSelect
          id={`pair-summary-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <SettingsSelect
          id={`pair-summary-sort-${panelId}`}
          label="Sort by"
          items={SORTS.map((sort) => ({ id: sort.id, text: sort.text }))}
          value={cfg.sortBy}
          onChange={(sortBy) =>
            patch({ sortBy: Schema.decodeUnknownSync(SortBySchema)(sortBy) })
          }
        />
        <NumberInput
          id={`pair-summary-limit-${panelId}`}
          label="Closed trades window"
          value={limit}
          min={10}
          max={500}
          step={10}
          onChange={(_e, { value }) =>
            patch({ limit: clampInt(value, 200, 10, 500) })
          }
          size="sm"
        />
        <NumberInput
          id={`pair-summary-min-${panelId}`}
          label="Min trades per pair"
          value={minTrades}
          min={1}
          max={100}
          step={1}
          onChange={(_e, { value }) =>
            patch({ minTrades: clampInt(value, 1, 1, 100) })
          }
          size="sm"
        />
        <SettingsToggle
          id={`pair-summary-winrate-${panelId}`}
          label="Win rate column"
          toggled={cfg.showWinrate}
          onToggle={(v) => patch({ showWinrate: v })}
        />
        <SettingsToggle
          id={`pair-summary-avg-${panelId}`}
          label="Avg % column"
          toggled={cfg.showAvgPct}
          onToggle={(v) => patch({ showAvgPct: v })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
        title="Pair Summary"
        isLoading={state.isLoading}
        error={accessError ?? state.error}
      >
        {rows.length > 0 ? (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
          >
            <div className="nfi-stat-grid">
              <Stat
                label={COL.totalProfit}
                value={fmt(netProfit, 2)}
                sub={`${totalTrades} closed trades`}
              />
              <Stat
                label="Pairs traded"
                value={String(rows.length)}
                sub={
                  cfg.instanceId === ALL_INSTANCES ? "fleet-wide" : undefined
                }
              />
              <Stat
                label="Best / worst"
                value={best && worst ? `${best.pair} / ${worst.pair}` : "—"}
                sub={
                  best && worst
                    ? `${fmt(best.profitAbs, 2)} / ${fmt(worst.profitAbs, 2)}`
                    : undefined
                }
              />
            </div>
            <NfiTableContainer>
              <NfiTableToolbar
                label="Pair summary table actions"
                exportMenu={{
                  filenameBase: `pair-summary-${cfg.instanceId}`,
                  dataset: "tag-performance",
                  params: {
                    instanceId:
                      cfg.instanceId === ALL_INSTANCES
                        ? undefined
                        : cfg.instanceId,
                    groupBy: "pair",
                    minTrades,
                    sortBy: sortParam ?? undefined,
                    sortDir: "desc",
                  },
                  disabled: rows.length === 0,
                }}
              />
              <div className="nfi-table-scroll">
                <NfiDataTable
                  columns={columns}
                  data={rows}
                  getRowId={(row) => row.pair}
                />
              </div>
            </NfiTableContainer>
          </div>
        ) : (
          <EmptyState
            title="No closed trades"
            hint="Pair attribution appears once trades close."
          />
        )}
      </WidgetFrame>
    </>
  );
}

export const PairSummaryWidgetDef = defineWidget({
  type: "pair-summary",
  hasSettings: true,
  title: "Pair Summary",
  description: "Closed-trade attribution per pair — one instance or the fleet.",
  configSchema: PairSummaryConfigSchema,
  defaultConfig: PAIR_SUMMARY_DEFAULTS,
  component: PairSummaryWidget,
  capabilities: [...PAIR_SUMMARY_CAPABILITIES],
  minWidth: 446,
  minHeight: 287,
  defaultWidth: 480,
  defaultHeight: 360,
});
