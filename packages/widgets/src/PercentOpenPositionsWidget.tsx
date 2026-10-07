// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Public open-trades table — percent P&L, wallet share and age, never
 * amounts (the "non-sensitive" twin of the open trades table).
 *
 * Profit % is the WHOLE-STAKE view (freqtrade's `total_profit_ratio`, the
 * same convention as closed-trade % and NFI's calc_total_profit): realized
 * P/L from NFI de-risks / grind exits is included, unlike `/status`'s
 * remaining-position-only `profit_ratio`, which drifts once a trade has
 * partial exits.
 *
 * Backed by `instances.open-positions.relative`: safe for publicly
 * shareable pages (allocation weights are shares of a server-side total
 * that is never exposed). Mirrors the main table's affordances — trade-ID
 * rows, server-side search, "Order by", column toggles and an expandable
 * sub-order facet list (relative orders carry no prices/amounts).
 *
 * The table itself is the TanStack Table row model (`NfiDataTable`): the
 * "Order by" select drives its controlled sorting state (persisted as
 * widget config). The rows are additionally pre-sorted with the shared
 * comparator because the default sort key (`openDate`) has no column to
 * host it — TanStack skips sorting state without a matching column, so the
 * pre-sort keeps the ordering correct in every column configuration.
 */

import { Tag } from "@carbon/react";
import { useStore, shallow as shallowStore } from "@tanstack/react-store";
import type { SortingState } from "@tanstack/react-table";
import type { Capability, RelativeOpenPosition } from "@nfi/api-contract";
import { Schema } from "effect";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import {
  EmptyState,
  NfiDataTable,
  Stat,
  useDebouncedValue,
  useDerived,
  useLocalStore,
  WidgetFrame,
  type NfiColumnDef,
} from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { InstanceIdField, booleanWithDefault } from "./shared/config";
import { fmtAge, fmtSigned, pnlClass } from "./shared/format";
import { InstanceSelect } from "./shared/InstanceSelect";
import { queryState } from "./shared/query";
import { RelativeOrdersFacets } from "./shared/RelativeOrdersFacets";
import { SettingsSelect } from "./shared/SettingsSelect";
import { SettingsToggle } from "./shared/SettingsToggle";
import {
  sortRelativeOpen,
  type RelOpenSortKey,
  type SortDir,
} from "./shared/tradeSort";
import { useTimeFormat } from "./shared/timeFormat";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import { COL } from "./shared/columns";
import { NfiTableContainer, NfiTableToolbar } from "./shared/tableToolbar";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const PERCENT_OPEN_POSITIONS_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.open-positions.relative",
];

export const PercentOpenSortBy = Schema.Literal(
  "openDate",
  "pair",
  "profitPct",
  "weight",
);

export type PercentOpenSortBy = typeof PercentOpenSortBy.Type;

/** Direction per sort key — "Order by" alone decides it. */
const REL_OPEN_SORT_DIR: Record<RelOpenSortKey, SortDir> = {
  openDate: "desc",
  pair: "asc",
  profitPct: "desc",
  weight: "desc",
};

const ORDER_BY_ITEMS: ReadonlyArray<{ id: RelOpenSortKey; text: string }> = [
  { id: "openDate", text: "Open date (newest)" },
  { id: "pair", text: "Pair (A→Z)" },
  { id: "profitPct", text: "Profit % (best)" },
  { id: "weight", text: "Wallet % (largest)" },
];

export const PercentOpenPositionsConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  /** Position id column (freqtrade trade id). */
  showTradeId: booleanWithDefault(true),
  showDirection: booleanWithDefault(true),
  /** Wallet share column (`allocationWeight` as percent). */
  showWallet: booleanWithDefault(true),
  showLeverage: booleanWithDefault(true),
  showAge: booleanWithDefault(true),
  showTag: booleanWithDefault(true),
  showStrategy: booleanWithDefault(false),
  sortBy: Schema.optionalWith(PercentOpenSortBy, {
    default: (): PercentOpenSortBy => "openDate",
  }),
});

export type PercentOpenPositionsConfig =
  typeof PercentOpenPositionsConfigSchema.Type;

export const PERCENT_OPEN_POSITIONS_DEFAULTS: PercentOpenPositionsConfig =
  Schema.decodeUnknownSync(PercentOpenPositionsConfigSchema)({});

const EMPTY_POSITIONS: ReadonlyArray<RelativeOpenPosition> = [];

/** Column set depends on the widget config's column toggles. */
function buildColumns([cfg]: readonly [
  PercentOpenPositionsConfig,
]): NfiColumnDef<RelativeOpenPosition>[] {
  const defs: (NfiColumnDef<RelativeOpenPosition> | null)[] = [
    cfg.showTradeId
      ? {
          id: "tradeId",
          header: COL.tradeId,
          cell: ({ row }) => row.original.tradeId,
          meta: { className: "nfi-mono" },
          enableSorting: false,
        }
      : null,
    {
      id: "pair",
      header: COL.pair,
      accessorFn: (p) => p.pair,
      sortFn: (a, b) =>
        (a.original.pair ?? "").localeCompare(b.original.pair ?? ""),
    },
    cfg.showDirection
      ? {
          id: "dir",
          header: COL.direction,
          cell: ({ row }) => (
            <Tag type={row.original.isShort ? "red" : "green"} size="sm">
              {row.original.isShort ? "SHORT" : "LONG"}
            </Tag>
          ),
          enableSorting: false,
        }
      : null,
    {
      id: "profitPct",
      header: COL.profitPct,
      accessorFn: (p) => p.profitPct ?? 0,
      cell: ({ row }) => (
        <span className={pnlClass(row.original.profitPct)}>
          {fmtSigned(row.original.profitPct, 2)}%
        </span>
      ),
    },
    cfg.showWallet
      ? {
          id: "weight",
          header: COL.walletPct,
          accessorFn: (p) => p.allocationWeight ?? 0,
          cell: ({ row }) =>
            ((row.original.allocationWeight ?? 0) * 100).toFixed(1),
        }
      : null,
    cfg.showLeverage
      ? {
          id: "lev",
          header: COL.leverage,
          cell: ({ row }) =>
            row.original.leverage !== undefined && row.original.leverage > 1
              ? `${row.original.leverage.toFixed(1)}×`
              : "—",
          enableSorting: false,
        }
      : null,
    cfg.showAge
      ? {
          id: "age",
          header: COL.age,
          cell: ({ row }) => fmtAge(row.original.openDate),
          enableSorting: false,
        }
      : null,
    cfg.showTag
      ? {
          id: "tag",
          header: COL.enterTag,
          cell: ({ row }) => row.original.enterTag?.trim() || "—",
          enableSorting: false,
        }
      : null,
    cfg.showStrategy
      ? {
          id: "strategy",
          header: COL.strategy,
          cell: ({ row }) => row.original.strategy ?? "—",
          enableSorting: false,
        }
      : null,
  ];

  return defs.flatMap((entry) => (entry ? [entry] : []));
}

export function PercentOpenPositionsWidget({
  config,
  panelId,
}: WidgetProps<PercentOpenPositionsConfig>) {
  const cfg = config;

  const filterStore = useLocalStore("");
  const filter = useStore(filterStore, (s) => s);

  // Debounced: the search text is part of the stream subscription key, so
  // the server only re-queries after the user pauses typing.
  const debouncedSearch = useDebouncedValue(filter, 400);
  const hasSearch = debouncedSearch.trim().length > 0;

  const { data, error, isLoading } = useCapability(
    "instances.open-positions.relative",
    { id: cfg.instanceId, search: debouncedSearch },
  );

  const state = queryState(error, isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);

  // fmtAge reads the global time-format store; re-render rows when the
  // configured format changes.
  useTimeFormat();

  const patch = (p: Partial<PercentOpenPositionsConfig>) =>
    applyWidgetSettings(panelId, "positions-open-relative", cfg, p);

  const patchFlag = (
    key: keyof PercentOpenPositionsConfig,
    v: boolean,
  ): void => {
    // SAFETY: `key` iterates the boolean settings keys rendered in this
    // modal, so the computed entry is a valid Partial (TS cannot express a
    // computed partial from a union key).
    patch({ [key]: v } as Partial<PercentOpenPositionsConfig>);
  };

  // Server already filtered; ordering is the table's controlled sorting
  // state — "Order by" persists as widget config. This pre-sort keeps the
  // `openDate` key (no hosting column) in the same order.
  const positions = useDerived(
    [data?.positions, cfg.sortBy] as const,
    ([rows, sortBy]) =>
      sortRelativeOpen(
        rows ?? EMPTY_POSITIONS,
        sortBy,
        REL_OPEN_SORT_DIR[sortBy],
      ),
    { inputs: shallowStore, output: shallowStore },
  );

  // Footer metrics arrive server-side (SQL open summary against the
  // never-exposed wallet total); the local fallbacks only cover snapshots
  // from before the field existed.
  const stats = data?.stats;

  const deployed =
    stats?.deployedWeight ??
    positions.reduce((sum, p) => sum + (p.allocationWeight ?? 0), 0);

  const withPnl = positions.filter(
    (p) => p.profitPct !== undefined && Number.isFinite(p.profitPct),
  );

  const avgPnl =
    stats?.avgProfitPct ??
    (withPnl.length > 0
      ? withPnl.reduce((sum, p) => sum + (p.profitPct ?? 0), 0) / withPnl.length
      : null);

  const largestShare =
    stats?.largestWeight ??
    positions.reduce((max, p) => Math.max(max, p.allocationWeight ?? 0), 0);

  // Column set derived through a store: rebuilt only when the widget
  // config actually changes.
  const columns = useDerived([cfg] as const, buildColumns, {
    inputs: shallowStore,
  });

  // Sort ids match the config keys for the columns that host them.
  const sorting: SortingState = [
    { id: cfg.sortBy, desc: REL_OPEN_SORT_DIR[cfg.sortBy] === "desc" },
  ];

  // "Order by" writes widget config — shared by the settings modal and
  // the table toolbar below.
  const onSortChange = (id: string): void => {
    patch({ sortBy: Schema.decodeUnknownSync(PercentOpenSortBy)(id) });
  };

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Open trades % settings"
        widgetType="positions-open-relative"
      >
        <InstanceSelect
          id={`pct-open-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
        />
        <SettingsSelect
          id={`pct-open-sort-${panelId}`}
          label="Order by"
          items={ORDER_BY_ITEMS.map((i) => ({ ...i }))}
          value={cfg.sortBy}
          onChange={onSortChange}
        />
        <div className="nfi-settings-toggles">
          {(
            [
              ["showTradeId", COL.tradeId],
              ["showDirection", "Direction"],
              ["showWallet", COL.walletPct],
              ["showLeverage", "Leverage"],
              ["showAge", "Age"],
              ["showTag", "Enter tag"],
              ["showStrategy", "Strategy"],
            ] as const
          ).map(([key, label]) => (
            <SettingsToggle
              key={key}
              id={`pct-open-${key}-${panelId}`}
              label={label}
              toggled={cfg[key]}
              onToggle={(v) => patchFlag(key, v)}
            />
          ))}
        </div>
      </WidgetSettingsModal>
      <WidgetFrame
        title="Open Trades %"
        isLoading={state.isLoading}
        error={state.error}
      >
        {positions.length > 0 || hasSearch ? (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
          >
            <div className="nfi-stat-grid">
              <Stat
                label="Open"
                value={String(positions.length)}
                sub={`${(deployed * 100).toFixed(1)}% of wallet deployed`}
              />
              <Stat
                label={COL.avgPct}
                value={avgPnl === null ? "—" : `${fmtSigned(avgPnl, 2)}%`}
                sub="across open trades"
              />
              <Stat
                label="Largest"
                value={`${(largestShare * 100).toFixed(1)}%`}
                sub="single-trade wallet share"
              />
            </div>
            {positions.length > 0 ? (
              <NfiTableContainer>
                <NfiTableToolbar
                  label="Open trades table actions"
                  search={{
                    id: `pct-open-filter-${panelId}`,
                    value: filter,
                    onChange: (value) => filterStore.setState(() => value),
                    placeholder: "Filter pair, strategy, tag…",
                    labelText: "Filter open trades",
                  }}
                  orderBy={{
                    id: `pct-open-sort-inline-${panelId}`,
                    value: cfg.sortBy,
                    items: ORDER_BY_ITEMS.map((i) => ({ ...i })),
                    onChange: onSortChange,
                  }}
                  exportMenu={{
                    filenameBase: `open-trades-pct-${cfg.instanceId}`,
                    dataset: "open-trades-relative",
                    params: {
                      instanceId: cfg.instanceId,
                      search: debouncedSearch,
                    },
                    disabled: positions.length === 0,
                  }}
                />
                <div className="nfi-table-scroll">
                  <NfiDataTable
                    columns={columns}
                    data={positions}
                    getRowId={(p) => `${cfg.instanceId}-${p.tradeId}`}
                    sorting={sorting}
                    renderExpandedRow={(row) => (
                      <RelativeOrdersFacets
                        orders={row.original.orders ?? []}
                      />
                    )}
                  />
                </div>
              </NfiTableContainer>
            ) : (
              <EmptyState
                title="No matches"
                hint={`No open trades match "${debouncedSearch.trim()}".`}
              />
            )}
          </div>
        ) : (
          <EmptyState
            title="No open trades"
            hint="The bot is fully in cash for this instance."
          />
        )}
      </WidgetFrame>
    </>
  );
}

export const PercentOpenPositionsWidgetDef = defineWidget({
  type: "positions-open-relative",
  hasSettings: true,
  title: "Open Trades %",
  description:
    "Public-shareable open trades with percent P&L, wallet share and age — never absolute amounts.",
  configSchema: PercentOpenPositionsConfigSchema,
  defaultConfig: PERCENT_OPEN_POSITIONS_DEFAULTS,
  component: PercentOpenPositionsWidget,
  capabilities: [...PERCENT_OPEN_POSITIONS_CAPABILITIES],
  minWidth: 860,
  minHeight: 320,
  defaultWidth: 960,
  defaultHeight: 460,
});
