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
import { queryState, useWidgetAccess } from "./shared/query";
import { SettingsSelect } from "./shared/SettingsSelect";
import { useClosedPositionsSource } from "./shared/sources";
import { SettingsToggle } from "./shared/SettingsToggle";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import { type ExportColumn } from "./shared/export";
import { COL } from "./shared/columns";
import { NfiTableContainer, NfiTableToolbar } from "./shared/tableToolbar";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const PAIR_SUMMARY_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.closed-positions",
  "instances.closed-all",
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
  readonly profitPctSum: number;
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

  const source = useClosedPositionsSource(cfg.instanceId, limit, {
    enabled: access.allowed,
  });

  const state = queryState(source.error, source.isLoading);

  const accessError = access.allowed
    ? null
    : `Not authorized — needs ${access.missing.join(", ")}`;

  const showSettings = useWidgetSettingsOpen(panelId);

  const patch = (p: Partial<PairSummaryConfig>) =>
    applyWidgetSettings(panelId, "pair-summary", cfg, p);

  const positions = source.data ?? [];

  const byPair = new Map<
    string,
    {
      trades: number;
      wins: number;
      losses: number;
      profitAbs: number;
      pctSum: number;
    }
  >();

  for (const position of positions) {
    const profitAbs = position.closeProfitAbs ?? position.profitAbs ?? 0;
    const profitPct = position.closeProfitPct ?? position.profitPct ?? 0;

    const entry = byPair.get(position.pair) ?? {
      trades: 0,
      wins: 0,
      losses: 0,
      profitAbs: 0,
      pctSum: 0,
    };

    entry.trades += 1;

    if (profitAbs > 0) entry.wins += 1;
    else if (profitAbs < 0) entry.losses += 1;
    entry.profitAbs += profitAbs;
    entry.pctSum += profitPct;
    byPair.set(position.pair, entry);
  }

  const rows: PairRow[] = [...byPair.entries()]
    .flatMap(([pair, entry]) =>
      entry.trades < minTrades
        ? []
        : [
            {
              pair,
              trades: entry.trades,
              wins: entry.wins,
              losses: entry.losses,
              winrate: entry.trades > 0 ? entry.wins / entry.trades : 0,
              profitAbs: entry.profitAbs,
              profitPctSum: entry.pctSum,
              profitPctAvg: entry.trades > 0 ? entry.pctSum / entry.trades : 0,
            },
          ],
    )
    .sort((a, b) => {
      const key = cfg.sortBy;

      // Metrics sort best-first; the pair name sorts A→Z — the "sort by"
      // pick alone decides both, no separate direction toggle.
      if (key === "pair") return a.pair.localeCompare(b.pair);

      return b[key] - a[key];
    });

  const netProfit = rows.reduce((sum, row) => sum + row.profitAbs, 0);
  const totalTrades = rows.reduce((sum, row) => sum + row.trades, 0);

  const best = rows.reduce<PairRow | undefined>(
    (acc, row) =>
      acc === undefined || row.profitAbs > acc.profitAbs ? row : acc,
    undefined,
  );

  const worst = rows.reduce<PairRow | undefined>(
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

  const exportColumns: ReadonlyArray<ExportColumn<PairRow>> = [
    { header: COL.pair, value: (r) => r.pair },
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
                  columns: exportColumns,
                  rows,
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
