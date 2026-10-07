// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Public closed-trades table — percent P&L per trade plus window win-rate
 * stats (the "non-sensitive" twin of the closed trades table).
 *
 * Backed by `instances.closed-positions.relative`: no coin/fiat amounts
 * ever leave the backend. Mirrors the main table's affordances — trade-ID
 * rows, server-side search (rides the stream subscription), "Order by",
 * growing-window infinite load, column toggles and an expandable sub-order
 * facet list (relative orders carry no prices/amounts).
 *
 * The table itself is the TanStack Table row model (`NfiDataTable`): the
 * "Order by" select drives its controlled sorting state (persisted as
 * widget config). The window is additionally pre-sorted with the shared
 * comparator because some sort keys (`openDate`) and some sortable columns
 * (close date) have no always-present column to host them — TanStack skips
 * sorting state without a matching column, so the pre-sort keeps the
 * ordering correct in every column configuration.
 */

import { NumberInput, Tag } from "@carbon/react";
import { useStore, shallow as shallowStore } from "@tanstack/react-store";
import type { SortingState } from "@tanstack/react-table";
import type { Capability, RelativeClosedPosition } from "@nfi/api-contract";
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
import {
  InstanceIdField,
  booleanWithDefault,
  numberWithDefault,
} from "./shared/config";
import {
  clampInt,
  fmtDate,
  fmtDuration,
  fmtSigned,
  pnlClass,
} from "./shared/format";
import { InstanceSelect } from "./shared/InstanceSelect";
import { queryState } from "./shared/query";
import { LoadMoreRow, useGrowingWindow, useHeldRows } from "./shared/loadMore";
import { RelativeOrdersFacets } from "./shared/RelativeOrdersFacets";
import { SettingsSelect } from "./shared/SettingsSelect";
import { SettingsToggle } from "./shared/SettingsToggle";
import {
  sortRelativeClosed,
  parseTradeTime,
  type RelClosedSortKey,
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

export const PERCENT_CLOSED_TRADES_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.closed-positions.relative",
];

export const PercentClosedSortBy = Schema.Literal(
  "closeDate",
  "openDate",
  "pair",
  "profitPct",
);

export type PercentClosedSortBy = typeof PercentClosedSortBy.Type;

/** Direction per sort key — "Order by" alone decides it. */
const REL_CLOSED_SORT_DIR: Record<RelClosedSortKey, SortDir> = {
  closeDate: "desc",
  openDate: "desc",
  pair: "asc",
  profitPct: "desc",
};

const ORDER_BY_ITEMS: ReadonlyArray<{
  id: RelClosedSortKey;
  text: string;
}> = [
  { id: "closeDate", text: "Close date (newest)" },
  { id: "openDate", text: "Open date (newest)" },
  { id: "pair", text: "Pair (A→Z)" },
  { id: "profitPct", text: "Profit % (best)" },
];

export const PercentClosedTradesConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  /** Page size for the growing window (also the initial window). */
  limit: numberWithDefault(50),
  /** Position id column (freqtrade trade id). */
  showTradeId: booleanWithDefault(true),
  showDirection: booleanWithDefault(true),
  showHeld: booleanWithDefault(true),
  showExit: booleanWithDefault(true),
  showClosed: booleanWithDefault(true),
  showTag: booleanWithDefault(false),
  showStrategy: booleanWithDefault(false),
  sortBy: Schema.optionalWith(PercentClosedSortBy, {
    default: (): PercentClosedSortBy => "closeDate",
  }),
});

export type PercentClosedTradesConfig =
  typeof PercentClosedTradesConfigSchema.Type;

export const PERCENT_CLOSED_TRADES_DEFAULTS: PercentClosedTradesConfig =
  Schema.decodeUnknownSync(PercentClosedTradesConfigSchema)({});

/** Window growth cap — matches the relative closed capability limit cap. */
const MAX_WINDOW = 5_000;

/** Column set depends on the widget config's column toggles. */
function buildColumns([cfg]: readonly [
  PercentClosedTradesConfig,
]): NfiColumnDef<RelativeClosedPosition>[] {
  const defs: (NfiColumnDef<RelativeClosedPosition> | null)[] = [
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
      accessorFn: (p) => p.closeProfitPct ?? p.profitPct ?? 0,
      cell: ({ row }) => (
        <span className={pnlClass(row.original.closeProfitPct)}>
          {fmtSigned(row.original.closeProfitPct, 2)}%
        </span>
      ),
    },
    cfg.showHeld
      ? {
          id: "held",
          header: COL.duration,
          cell: ({ row }) => fmtDuration(row.original.tradeDurationSeconds),
          enableSorting: false,
        }
      : null,
    cfg.showExit
      ? {
          id: "exit",
          header: COL.exitReason,
          cell: ({ row }) => row.original.exitReason ?? "—",
          enableSorting: false,
        }
      : null,
    cfg.showClosed
      ? {
          id: "closeDate",
          header: COL.closeDate,
          accessorFn: (p) => parseTradeTime(p.closeDate ?? p.openDate),
          cell: ({ row }) => fmtDate(row.original.closeDate),
          sortDescFirst: true,
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

export function PercentClosedTradesWidget({
  config,
  panelId,
}: WidgetProps<PercentClosedTradesConfig>) {
  const cfg = config;
  const pageSize = clampInt(cfg.limit, 50, 10, 200);

  const filterStore = useLocalStore("");
  const filter = useStore(filterStore, (s) => s);

  // Debounced: the search text is part of the stream subscription key, so
  // the server only re-queries after the user pauses typing.
  const debouncedSearch = useDebouncedValue(filter, 400);
  const hasSearch = debouncedSearch.trim().length > 0;

  const datasetKey = `${cfg.instanceId}|${debouncedSearch}`;

  const { size: windowSize, loadMore } = useGrowingWindow(
    pageSize,
    MAX_WINDOW,
    datasetKey,
  );

  const view = useCapability("instances.closed-positions.relative", {
    id: cfg.instanceId,
    limit: String(windowSize),
    search: debouncedSearch,
  });

  const held = useHeldRows(
    {
      data: view.data?.positions,
      error: view.error,
      isLoading: view.isLoading,
      total: view.data?.totalTrades,
    },
    datasetKey,
  );

  const state = queryState(
    held.rows.length > 0 ? null : view.error,
    held.firstLoading,
  );

  const showSettings = useWidgetSettingsOpen(panelId);

  // fmtDate reads the global time-format store; this read re-renders rows
  // when the configured format changes.
  useTimeFormat();

  const patch = (p: Partial<PercentClosedTradesConfig>) =>
    applyWidgetSettings(panelId, "closed-positions-relative", cfg, p);

  const patchFlag = (
    key: keyof PercentClosedTradesConfig,
    v: boolean,
  ): void => {
    // SAFETY: `key` iterates the boolean settings keys rendered in this
    // modal, so the computed entry is a valid Partial (TS cannot express a
    // computed partial from a union key).
    patch({ [key]: v } as Partial<PercentClosedTradesConfig>);
  };

  // Server already filtered; ordering is the table's controlled sorting
  // state — "Order by" persists as widget config. This pre-sort keeps
  // keys/columns TanStack cannot host (see file header) in the same order.
  const positions = useDerived(
    [held.rows, cfg.sortBy] as const,
    ([rows, sortBy]) =>
      sortRelativeClosed(rows, sortBy, REL_CLOSED_SORT_DIR[sortBy]),
    { inputs: shallowStore, output: shallowStore },
  );

  // Footer metrics arrive server-side: `stats` is a SQL aggregate over
  // EVERY closed trade matching the current search — the loaded page may
  // be a window, the footer never is. The local fallbacks only cover
  // snapshots from before the field existed.
  const stats = view.data?.stats;

  const withPnl = positions.filter(
    (p) => p.closeProfitPct !== undefined && Number.isFinite(p.closeProfitPct),
  );

  const wins =
    stats?.wins ?? withPnl.filter((p) => (p.closeProfitPct ?? 0) > 0).length;

  const winnersBase = stats?.withPnl ?? withPnl.length;

  const winRate =
    stats?.winRatePct ??
    (withPnl.length > 0 ? (wins / withPnl.length) * 100 : null);

  const avgPnl =
    stats?.avgProfitPct ??
    (withPnl.length > 0
      ? withPnl.reduce((sum, p) => sum + (p.closeProfitPct ?? 0), 0) /
        withPnl.length
      : null);

  const best =
    stats?.bestPct ??
    withPnl.reduce(
      (max, p) => Math.max(max, p.closeProfitPct ?? 0),
      Number.NEGATIVE_INFINITY,
    );

  const worst =
    stats?.worstPct ??
    withPnl.reduce(
      (min, p) => Math.min(min, p.closeProfitPct ?? 0),
      Number.POSITIVE_INFINITY,
    );

  /**
   * Deeper history probably exists (see ClosedPositionsWidget's rule):
   * searches report the all-trades total, not match count, so a completely
   * full window is the heuristic there.
   */
  const totalTrades = view.data?.totalTrades;

  const canLoadMore =
    windowSize < MAX_WINDOW &&
    (hasSearch
      ? held.rows.length >= windowSize
      : totalTrades !== undefined
        ? held.rows.length < totalTrades
        : held.rows.length >= windowSize);

  // Column set derived through a store: rebuilt only when the widget
  // config actually changes.
  const columns = useDerived([cfg] as const, buildColumns, {
    inputs: shallowStore,
  });

  // Sort ids match the config keys for the columns that host them.
  const sorting: SortingState = [
    { id: cfg.sortBy, desc: REL_CLOSED_SORT_DIR[cfg.sortBy] === "desc" },
  ];

  // "Order by" writes widget config — shared by the settings modal and
  // the table toolbar below.
  const onSortChange = (id: string): void => {
    patch({
      sortBy: Schema.decodeUnknownSync(PercentClosedSortBy)(id),
    });
  };

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Closed trades % settings"
        widgetType="closed-positions-relative"
      >
        <InstanceSelect
          id={`pct-closed-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
        />
        <NumberInput
          id={`pct-closed-limit-${panelId}`}
          label="Trades per page (scroll loads more)"
          value={pageSize}
          min={10}
          max={200}
          step={10}
          onChange={(_e, { value }) =>
            patch({ limit: clampInt(value, 50, 10, 200) })
          }
          size="sm"
        />
        <SettingsSelect
          id={`pct-closed-sort-${panelId}`}
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
              ["showHeld", COL.duration],
              ["showExit", "Exit reason"],
              ["showClosed", "Close date"],
              ["showTag", "Enter tag"],
              ["showStrategy", "Strategy"],
            ] as const
          ).map(([key, label]) => (
            <SettingsToggle
              key={key}
              id={`pct-closed-${key}-${panelId}`}
              label={label}
              toggled={cfg[key]}
              onToggle={(v) => patchFlag(key, v)}
            />
          ))}
        </div>
      </WidgetSettingsModal>
      <WidgetFrame
        title="Closed Trades %"
        isLoading={state.isLoading}
        error={state.error}
      >
        {positions.length > 0 || hasSearch || held.firstLoading ? (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
          >
            <div className="nfi-stat-grid">
              <Stat
                label="Win rate"
                value={winRate === null ? "—" : `${winRate.toFixed(1)}%`}
                sub={`${wins}/${winnersBase} winners`}
                tone={
                  winRate === null
                    ? "neutral"
                    : winRate >= 50
                      ? "positive"
                      : "negative"
                }
              />
              <Stat
                label={COL.avgPct}
                value={avgPnl === null ? "—" : `${fmtSigned(avgPnl, 2)}%`}
                sub={
                  stats
                    ? "all matching trades"
                    : `window of ${positions.length} trades`
                }
                tone={avgPnl !== null && avgPnl >= 0 ? "positive" : "negative"}
              />
              <Stat
                label="Best / worst"
                value={
                  Number.isFinite(best) && Number.isFinite(worst)
                    ? `${fmtSigned(best, 1)}% / ${fmtSigned(worst, 1)}%`
                    : "—"
                }
                sub="per-trade close %"
              />
            </div>
            {positions.length > 0 ? (
              <NfiTableContainer>
                <NfiTableToolbar
                  label="Closed trades table actions"
                  search={{
                    id: `pct-closed-filter-${panelId}`,
                    value: filter,
                    onChange: (value) => filterStore.setState(() => value),
                    placeholder: "Filter pair, exit reason, tag…",
                    labelText: "Filter closed trades",
                  }}
                  orderBy={{
                    id: `pct-closed-sort-inline-${panelId}`,
                    value: cfg.sortBy,
                    items: ORDER_BY_ITEMS.map((i) => ({ ...i })),
                    onChange: onSortChange,
                  }}
                  exportMenu={{
                    filenameBase: `closed-trades-pct-${cfg.instanceId}`,
                    dataset: "closed-trades-relative",
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
                  <LoadMoreRow
                    onLoadMore={loadMore}
                    shown={held.rows.length}
                    total={hasSearch ? undefined : totalTrades}
                    loading={held.loadingMore}
                    done={!canLoadMore}
                    atLimit={windowSize >= MAX_WINDOW}
                    error={held.rows.length > 0 ? view.error : null}
                    rearm={held.rows.length}
                  />
                </div>
              </NfiTableContainer>
            ) : (
              <EmptyState
                title="No matches"
                hint={`No closed trades match "${debouncedSearch.trim()}".`}
              />
            )}
          </div>
        ) : (
          <EmptyState
            title="No closed trades"
            hint="Closed trades appear here once the bot completes its first exit."
          />
        )}
      </WidgetFrame>
    </>
  );
}

export const PercentClosedTradesWidgetDef = defineWidget({
  type: "closed-positions-relative",
  hasSettings: true,
  title: "Closed Trades %",
  description:
    "Public-shareable closed-trades blotter with win-rate stats and percent P&L — never absolute amounts.",
  configSchema: PercentClosedTradesConfigSchema,
  defaultConfig: PERCENT_CLOSED_TRADES_DEFAULTS,
  component: PercentClosedTradesWidget,
  capabilities: [...PERCENT_CLOSED_TRADES_CAPABILITIES],
  minWidth: 900,
  minHeight: 360,
  defaultWidth: 960,
  defaultHeight: 460,
});
