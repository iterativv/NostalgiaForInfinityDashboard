// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Closed positions with exit data and expandable sub-orders — one instance
 * or the fleet (rows attributed per bot in fleet mode). The toolbar's
 * Search filters SERVER-SIDE (the text rides the stream subscription),
 * ordering stays client-side. Sub-orders render through the same expansion
 * pattern as the open-positions table, but start collapsed (history is
 * long; the chevron is one click away). Extends the open-positions config
 * schema instead of restating its fields.
 *
 * The table itself is the TanStack Table row model (`NfiDataTable`): the
 * "Order by" select drives its controlled sorting state (persisted as
 * widget config). The window is additionally pre-sorted with the shared
 * comparator because some sort keys (`openDate`) and some sortable columns
 * (close date, PnL) have no always-present column to host them — TanStack
 * skips sorting state without a matching column, so the pre-sort keeps the
 * ordering correct in every column configuration.
 */

import { NumberInput, Search, Tag } from "@carbon/react";
import { useStore, shallow as shallowStore } from "@tanstack/react-store";
import type { SortingState } from "@tanstack/react-table";
import { Schema } from "effect";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import {
  EmptyState,
  NfiDataTable,
  PnlPill,
  useDebouncedValue,
  useDerived,
  useLocalStore,
  WidgetFrame,
  type NfiColumnDef,
} from "@nfi/ui";
import { applyWidgetSettings } from "./shared/panelConfig";
import { booleanWithDefault, numberWithDefault } from "./shared/config";
import { clampInt, fmt, fmtDate, pnlClass } from "./shared/format";
import { queryState } from "./shared/query";
import { useTimeFormat } from "./shared/timeFormat";
import { InstanceSelect } from "./shared/InstanceSelect";
import { SubOrdersTable } from "./shared/SubOrdersTable";
import { SettingsToggle } from "./shared/SettingsToggle";
import { SettingsSelect } from "./shared/SettingsSelect";
import {
  InstanceTag,
  useInstanceColors,
  type InstanceColors,
} from "./shared/instanceColors";
import {
  useClosedPositionsSource,
  type SourcedClosedPosition,
} from "./shared/sources";
import { LoadMoreRow, useGrowingWindow, useHeldRows } from "./shared/loadMore";
import {
  sortClosedPositions,
  parseTradeTime,
  type ClosedSortKey,
  type SortDir,
} from "./shared/tradeSort";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";
import { OpenPositionsConfigSchema } from "./OpenPositionsWidget";

export const ClosedPositionsSortBy = Schema.Literal(
  "closeDate",
  "openDate",
  "pair",
  "stake",
  "profit",
  "profitPct",
);

export type ClosedPositionsSortBy = typeof ClosedPositionsSortBy.Type;

/**
 * Direction per sort key — "Order by" alone decides it (dates newest-first,
 * pair A→Z, metrics best-first), no separate direction selector.
 */
const CLOSED_SORT_DIR: Record<ClosedSortKey, SortDir> = {
  closeDate: "desc",
  openDate: "desc",
  pair: "asc",
  stake: "desc",
  profit: "desc",
  profitPct: "desc",
};

const ORDER_BY_ITEMS = [
  { id: "closeDate", text: "Close date (newest)" },
  { id: "openDate", text: "Open date (newest)" },
  { id: "pair", text: "Pair (A→Z)" },
  { id: "stake", text: "Stake (largest)" },
  { id: "profit", text: "Profit (best)" },
  { id: "profitPct", text: "Profit % (best)" },
] as const;

export const ClosedPositionsConfigSchema = Schema.Struct({
  ...OpenPositionsConfigSchema.fields,
  limit: numberWithDefault(50),
  showCloseRate: booleanWithDefault(true),
  showCloseProfit: booleanWithDefault(true),
  showExitReason: booleanWithDefault(true),
  showCloseDate: booleanWithDefault(true),
  showDuration: booleanWithDefault(false),
  sortBy: Schema.optionalWith(ClosedPositionsSortBy, {
    default: (): ClosedPositionsSortBy => "closeDate",
  }),
});

export type ClosedPositionsConfig = typeof ClosedPositionsConfigSchema.Type;

export const CLOSED_POSITIONS_DEFAULTS: ClosedPositionsConfig =
  Schema.decodeUnknownSync(ClosedPositionsConfigSchema)({});

/** Window growth cap — matches the closed-positions capability limit cap. */
const MAX_WINDOW = 5_000;

/** Column set depends on config flags + fleet mode + instance colors. */
function buildColumns([
  cfg,
  showBotColumn,
  colors,
]: readonly [
  ClosedPositionsConfig,
  boolean,
  InstanceColors,
]): NfiColumnDef<SourcedClosedPosition>[] {
  const defs: (NfiColumnDef<SourcedClosedPosition> | null)[] = [
    cfg.showRowNumber
      ? {
          id: "no",
          header: "No.",
          cell: ({ row }) => row.index + 1,
          meta: { className: "nfi-mono" },
          enableSorting: false,
        }
      : null,
    showBotColumn
      ? {
          id: "bot",
          header: "Bot",
          cell: ({ row }) => (
            <InstanceTag
              color={colors.colorOf(
                row.original.instanceId ?? row.original.instanceName,
              )}
              name={row.original.instanceName}
            />
          ),
          enableSorting: false,
        }
      : null,
    cfg.showPair
      ? {
          id: "pair",
          header: "Pair",
          accessorFn: (p) => p.pair,
          sortFn: (a, b) =>
            (a.original.pair ?? "").localeCompare(b.original.pair ?? ""),
        }
      : null,
    cfg.showDirection
      ? {
          id: "dir",
          header: "Dir",
          cell: ({ row }) => (
            <Tag type={row.original.isShort ? "red" : "green"}>
              {row.original.isShort ? "SHORT" : "LONG"}
            </Tag>
          ),
          enableSorting: false,
        }
      : null,
    cfg.showStake
      ? {
          id: "stake",
          header: "Stake",
          accessorFn: (p) => p.stakeAmount,
          cell: ({ row }) => row.original.stakeAmount.toFixed(2),
        }
      : null,
    cfg.showOpenRate
      ? {
          id: "open",
          header: "Open",
          cell: ({ row }) => fmt(row.original.openRate, 4),
          enableSorting: false,
        }
      : null,
    cfg.showCloseRate
      ? {
          id: "close",
          header: "Close",
          cell: ({ row }) => fmt(row.original.closeRate, 4),
          enableSorting: false,
        }
      : null,
    cfg.showCloseProfit
      ? {
          id: "profit",
          header: "PnL",
          accessorFn: (p) => p.closeProfitAbs ?? p.profitAbs ?? 0,
          cell: ({ row }) => {
            const profitAbs =
              row.original.closeProfitAbs ?? row.original.profitAbs;

            return (
              <span className={pnlClass(profitAbs)}>
                {fmt(profitAbs, 2)}
              </span>
            );
          },
        }
      : null,
    cfg.showProfitPct
      ? {
          id: "profitPct",
          header: "PnL %",
          accessorFn: (p) => p.closeProfitPct ?? p.profitPct ?? 0,
          cell: ({ row }) => (
            <PnlPill
              value={row.original.closeProfitPct ?? row.original.profitPct}
              percent={row.original.closeProfitPct ?? row.original.profitPct}
              absolute={row.original.closeProfitAbs ?? row.original.profitAbs}
            />
          ),
        }
      : null,
    cfg.showExitReason
      ? {
          id: "exit",
          header: "Exit reason",
          cell: ({ row }) => row.original.exitReason || "—",
          enableSorting: false,
        }
      : null,
    cfg.showCloseDate
      ? {
          id: "closeDate",
          header: "Closed",
          accessorFn: (p) => parseTradeTime(p.closeDate ?? p.openDate),
          cell: ({ row }) => fmtDate(row.original.closeDate),
          sortDescFirst: true,
        }
      : null,
    cfg.showDuration
      ? {
          id: "duration",
          header: "Duration",
          cell: ({ row }) =>
            row.original.tradeDurationSeconds !== undefined
              ? `${Math.round(row.original.tradeDurationSeconds / 60)}m`
              : "—",
          enableSorting: false,
        }
      : null,
    cfg.showStrategy
      ? {
          id: "strategy",
          header: "Strategy",
          cell: ({ row }) => row.original.strategy ?? "—",
          enableSorting: false,
        }
      : null,
  ];

  return defs.flatMap((entry) => (entry ? [entry] : []));
}

export function ClosedPositionsWidget({
  config,
  panelId,
}: WidgetProps<ClosedPositionsConfig>) {
  const cfg = config;
  const maxVisible = clampInt(cfg.maxVisibleOrders, 5, 1, 50);

  /** Page size for the growing window (also the initial window). */
  const pageSize = clampInt(cfg.limit, 50, 10, 200);
  const filterStore = useLocalStore("");
  const filter = useStore(filterStore, (s) => s);

  // Debounced: the search text is part of the stream subscription key, so
  // the server only re-queries after the user pauses typing.
  const debouncedSearch = useDebouncedValue(filter, 400);
  const hasSearch = debouncedSearch.trim().length > 0;

  // Growing window (infinite load): the limit rides the subscription, so a
  // bigger window is one re-subscribe; held rows keep the table painted
  // while the deeper history streams in.
  const datasetKey = `${cfg.instanceId}|${debouncedSearch}`;

  const { size: windowSize, loadMore } = useGrowingWindow(
    pageSize,
    MAX_WINDOW,
    datasetKey,
  );

  const src = useClosedPositionsSource(cfg.instanceId, windowSize, {
    search: debouncedSearch,
  });

  const held = useHeldRows(src, datasetKey);
  const colors = useInstanceColors();

  const state = queryState(
    held.rows.length > 0 ? null : src.error,
    held.firstLoading,
  );

  const showSettings = useWidgetSettingsOpen(panelId);

  // fmtDate/sub-order dates read the global time-format store; this read
  // re-renders the table when the configured format changes.
  useTimeFormat();

  const patch = (p: Partial<ClosedPositionsConfig>) =>
    applyWidgetSettings(panelId, "closed-positions", cfg, p);

  const patchFlag = (key: keyof ClosedPositionsConfig, v: boolean): void => {
    // SAFETY: `key` iterates the boolean settings keys rendered in this
    // modal, so the computed entry is a valid Partial (TS cannot express a
    // computed partial from a union key).
    patch({ [key]: v } as Partial<ClosedPositionsConfig>);
  };

  // Server already filtered; ordering is the table's controlled sorting
  // state — "Order by" persists as widget config. This pre-sort keeps
  // keys/columns TanStack cannot host (see file header) in the same order.
  const positions = useDerived(
    [held.rows, cfg.sortBy] as const,
    ([rows, sortBy]) =>
      sortClosedPositions(rows, sortBy, CLOSED_SORT_DIR[sortBy]),
    { inputs: shallowStore, output: shallowStore },
  );

  /**
   * Deeper history probably exists: the window can still grow AND either
   * the backend's closed-trade total exceeds the rows shown, or (searches,
   * where `total` counts every trade, not matches) the current window came
   * back completely full.
   */
  const canLoadMore =
    windowSize < MAX_WINDOW &&
    (hasSearch
      ? held.rows.length >= windowSize
      : src.total !== undefined
        ? held.rows.length < src.total
        : held.rows.length >= windowSize);

  /** Bot attribution column: explicit toggle, or implied by fleet mode. */
  const showBotColumn = cfg.showBot || cfg.instanceId === "all";

  // Column set derived through a store: rebuilt only when the widget config,
  // fleet mode, or instance colors actually change.
  const columns = useDerived(
    [cfg, showBotColumn, colors] as const,
    buildColumns,
    { inputs: shallowStore },
  );

  // Sort ids match the config keys for the columns that host them.
  const sorting: SortingState = [
    { id: cfg.sortBy, desc: CLOSED_SORT_DIR[cfg.sortBy] === "desc" },
  ];

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Closed positions settings"
        widgetType="closed-positions"
      >
        <InstanceSelect
          id={`cpos-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <NumberInput
          id={`cpos-limit-${panelId}`}
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
        <NumberInput
          id={`cpos-max-${panelId}`}
          label="Sub-orders initially shown (latest first)"
          value={maxVisible}
          min={1}
          max={50}
          step={1}
          onChange={(_e, { value }) =>
            patch({ maxVisibleOrders: clampInt(value, 5, 1, 50) })
          }
          size="sm"
        />
        <SettingsSelect
          id={`cpos-sort-${panelId}`}
          label="Order by"
          items={ORDER_BY_ITEMS.map((item) => ({ ...item }))}
          value={cfg.sortBy}
          onChange={(id) =>
            patch({
              sortBy: Schema.decodeUnknownSync(ClosedPositionsSortBy)(id),
            })
          }
        />
        <div className="nfi-settings-toggles">
          {(
            [
              ["showRowNumber", "Row number"],
              ["showBot", "Bot"],
              ["showPair", "Pair"],
              ["showDirection", "Direction"],
              ["showStake", "Stake"],
              ["showOpenRate", "Open rate"],
              ["showCloseRate", "Close rate"],
              ["showCloseProfit", "Close profit"],
              ["showProfitPct", "Profit %"],
              ["showExitReason", "Exit reason"],
              ["showCloseDate", "Close date"],
              ["showDuration", "Duration"],
              ["showStrategy", "Strategy"],
              ["showEnterTag", "Enter tag"],
            ] as const
          ).map(([key, label]) => (
            <SettingsToggle
              key={key}
              id={`cpos-${key}-${panelId}`}
              label={label}
              toggled={cfg[key]}
              onToggle={(v) => patchFlag(key, v)}
            />
          ))}
        </div>
      </WidgetSettingsModal>
      <WidgetFrame
        title="Closed Positions"
        isLoading={state.isLoading}
        error={state.error}
      >
        {positions.length > 0 || hasSearch ? (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
          >
            <div
              style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}
            >
              <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                <Search
                  size="sm"
                  placeholder="Filter pair, bot, exit reason…"
                  labelText="Filter closed positions"
                  value={filter}
                  onChange={(e) =>
                    filterStore.setState(() => e.target.value ?? "")
                  }
                />
              </div>
              <div style={{ flex: "0 0 170px" }}>
                <SettingsSelect
                  id={`cpos-sort-inline-${panelId}`}
                  label="Order by"
                  items={ORDER_BY_ITEMS.map((item) => ({ ...item }))}
                  value={cfg.sortBy}
                  onChange={(id) =>
                    patch({
                      sortBy: Schema.decodeUnknownSync(ClosedPositionsSortBy)(
                        id,
                      ),
                    })
                  }
                />
              </div>
            </div>
            {positions.length > 0 ? (
              <div className="nfi-table-scroll">
                <NfiDataTable
                  columns={columns}
                  data={positions}
                  getRowId={(p) =>
                    `${p.instanceId ?? cfg.instanceId}-${p.tradeId}`
                  }
                  sorting={sorting}
                  renderExpandedRow={(row) => (
                    <SubOrdersTable
                      rowKey={row.id}
                      orders={row.original.orders ?? []}
                      initiallyVisible={maxVisible}
                    />
                  )}
                />
                <LoadMoreRow
                  onLoadMore={loadMore}
                  shown={held.rows.length}
                  total={hasSearch ? undefined : src.total}
                  loading={held.loadingMore}
                  done={!canLoadMore}
                  atLimit={windowSize >= MAX_WINDOW}
                  error={held.rows.length > 0 ? src.error : null}
                  rearm={held.rows.length}
                />
              </div>
            ) : (
              <EmptyState
                title="No matches"
                hint={`No closed positions match "${debouncedSearch.trim()}".`}
              />
            )}
          </div>
        ) : (
          <EmptyState
            title="No closed positions"
            hint="Closed trades appear here. Pick an instance in ⚙ settings."
          />
        )}
      </WidgetFrame>
    </>
  );
}

export const ClosedPositionsWidgetDef = defineWidget({
  type: "closed-positions",
  hasSettings: true,
  title: "Closed Positions",
  description:
    "Closed positions with exit data and expandable sub-orders — one instance or the fleet.",
  configSchema: ClosedPositionsConfigSchema,
  defaultConfig: CLOSED_POSITIONS_DEFAULTS,
  component: ClosedPositionsWidget,
  capabilities: ["instances.closed-positions", "instances.closed-all"],
  // Width floor is the dashboard-column set's intrinsic content width
  // (bot, pair, dir, stake, open, close, pnl%, exit reason, close date)
  // plus the expander column so the table never scrolls sideways; height
  // pins chrome + header + several readable rows and lets history scroll
  // vertically.
  minWidth: 1300,
  minHeight: 400,
  defaultWidth: 1100,
  defaultHeight: 480,
});
