// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Tag } from "@carbon/react";
import { useStore, shallow as shallowStore } from "@tanstack/react-store";
import type { SortingState } from "@tanstack/react-table";
import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import {
  EmptyState,
  NfiDataTable,
  useDebouncedValue,
  useDerived,
  useLocalStore,
  WidgetFrame,
  type NfiColumnDef,
} from "@nfi/ui";
import { applyWidgetSettings } from "./shared/panelConfig";
import { InstanceIdField, booleanWithDefault } from "./shared/config";
import { fmtDate } from "./shared/format";
import { ALL_INSTANCES, InstanceSelect } from "./shared/InstanceSelect";
import {
  InstanceTag,
  useInstanceColors,
  type InstanceColors,
} from "./shared/instanceColors";
import { queryState } from "./shared/query";
import {
  useOpenPositionsSource,
  type SourcedOpenPosition,
} from "./shared/sources";
import {
  parseTradeTime,
  sortOpenPositions,
  type OpenSortKey,
  type SortDir,
} from "./shared/tradeSort";

import { SettingsSelect } from "./shared/SettingsSelect";
import { SettingsToggle } from "./shared/SettingsToggle";
import {} from "./shared/export";
import { COL } from "./shared/columns";
import { NfiTableContainer, NfiTableToolbar } from "./shared/tableToolbar";
import { useTimeFormat } from "./shared/timeFormat";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const OPEN_TRADES_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.open-positions",
  "instances.positions-all",
];

export const OpenTradesSortBy = Schema.Literal(
  "openDate",
  "pair",
  "stake",
  "profitPct",
);

export type OpenTradesSortBy = typeof OpenTradesSortBy.Type;

export const OpenTradesConfigSchema = Schema.Struct({
  /** An instance id, or `all` for every open position in the fleet. */
  instanceId: InstanceIdField,
  /** Position id column (freqtrade trade id). */
  showTradeId: booleanWithDefault(true),
  sortBy: Schema.optionalWith(OpenTradesSortBy, {
    default: (): OpenTradesSortBy => "openDate",
  }),
});

export type OpenTradesConfig = typeof OpenTradesConfigSchema.Type;

export const OPEN_TRADES_DEFAULTS: OpenTradesConfig = Schema.decodeUnknownSync(
  OpenTradesConfigSchema,
)({});

const OPEN_SORT_ITEMS: ReadonlyArray<{ id: OpenSortKey; text: string }> = [
  { id: "openDate", text: "Open date (newest)" },
  { id: "pair", text: "Pair" },
  { id: "stake", text: "Stake" },
  { id: "profitPct", text: "Profit %" },
];

/** Direction per sort key — "Order by" alone decides it. */
const OPEN_TRADES_SORT_DIR: Record<OpenSortKey, SortDir> = {
  openDate: "desc",
  pair: "asc",
  stake: "desc",
  profitPct: "desc",
  profitAbs: "desc",
};

const EMPTY_POSITIONS: ReadonlyArray<SourcedOpenPosition> = [];

/** Position-side CSV/XLSX columns (all fields, not just the visible set). */
/** Column set depends on the row-number toggle, fleet mode + colors. */
function buildColumns([cfg, showBotColumn, colors]: readonly [
  OpenTradesConfig,
  boolean,
  InstanceColors,
]): NfiColumnDef<SourcedOpenPosition>[] {
  const defs: (NfiColumnDef<SourcedOpenPosition> | null)[] = [
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
    showBotColumn
      ? {
          id: "bot",
          header: COL.bot,
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
    {
      id: "stake",
      header: COL.stake,
      accessorFn: (p) => p.stakeAmount,
      cell: ({ row }) => row.original.stakeAmount.toFixed(2),
    },
    {
      id: "open",
      header: COL.openRate,
      cell: ({ row }) => row.original.openRate.toFixed(4),
      enableSorting: false,
    },
    {
      id: "profitPct",
      header: COL.profitPct,
      accessorFn: (p) => p.profitPct ?? 0,
      cell: ({ row }) => (
        <Tag type={(row.original.profitPct ?? 0) >= 0 ? "green" : "red"}>
          {(row.original.profitPct ?? 0).toFixed(2)}%
        </Tag>
      ),
    },
    {
      id: "openDate",
      header: COL.openDate,
      accessorFn: (p) => parseTradeTime(p.openDate),
      cell: ({ row }) => fmtDate(row.original.openDate),
      sortDescFirst: true,
    },
  ];

  return defs.flatMap((entry) => (entry ? [entry] : []));
}

export function OpenTradesWidget({
  config,
  panelId,
}: WidgetProps<OpenTradesConfig>) {
  const cfg = config;
  useTimeFormat();
  const filterStore = useLocalStore("");
  const filter = useStore(filterStore, (s) => s);
  // Debounced: the search text is part of the stream subscription key, so
  // the server only re-queries after the user pauses typing.
  const debouncedSearch = useDebouncedValue(filter, 400);
  const hasSearch = debouncedSearch.trim().length > 0;

  const source = useOpenPositionsSource(cfg.instanceId, {
    search: debouncedSearch,
  });

  const colors = useInstanceColors();
  const state = queryState(source.error, source.isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);

  const patch = (p: Partial<OpenTradesConfig>) =>
    applyWidgetSettings(panelId, "open-trades", cfg, p);

  // Server already filtered; ordering is the table's controlled sorting
  // state — "Order by" persists as widget config, TanStack Table sorts. The
  // rows are also pre-sorted with the shared comparator so the trade-ID
  // column stays aligned with the displayed order.
  const positions = useDerived(
    [source.data ?? EMPTY_POSITIONS, cfg.sortBy] as const,
    ([rows, sortBy]) =>
      sortOpenPositions(rows, sortBy, OPEN_TRADES_SORT_DIR[sortBy]),
    { inputs: shallowStore, output: shallowStore },
  );

  const showBotColumn = cfg.instanceId === ALL_INSTANCES;

  // Column set derived through a store: rebuilt only when the widget config,
  // fleet mode, or instance colors actually change.
  const columns = useDerived(
    [cfg, showBotColumn, colors] as const,
    buildColumns,
    { inputs: shallowStore },
  );

  // Sort ids match the config keys; every key has an always-present column.
  const sorting: SortingState = [
    { id: cfg.sortBy, desc: OPEN_TRADES_SORT_DIR[cfg.sortBy] === "desc" },
  ];

  // "Order by" writes widget config — shared by the settings modal and
  // the table toolbar below.
  const onSortChange = (id: string): void => {
    patch({ sortBy: Schema.decodeUnknownSync(OpenTradesSortBy)(id) });
  };

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Open trades settings"
        widgetType="open-trades"
      >
        <InstanceSelect
          id={`open-trades-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <SettingsSelect
          id={`open-trades-sort-${panelId}`}
          label="Order by"
          items={OPEN_SORT_ITEMS.map((i) => ({ ...i }))}
          value={cfg.sortBy}
          onChange={onSortChange}
        />
        <SettingsToggle
          id={`open-trades-rowno-${panelId}`}
          label="Trade ID"
          toggled={cfg.showTradeId}
          onToggle={(v) => patch({ showTradeId: v })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
        title="Open Trades"
        isLoading={state.isLoading}
        error={state.error}
      >
        {positions.length === 0 && !hasSearch ? (
          <EmptyState title="No open trades" hint="Flat is a position too." />
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
          >
            {positions.length > 0 ? (
              <NfiTableContainer>
                <NfiTableToolbar
                  label="Open trades table actions"
                  search={{
                    id: `open-trades-filter-${panelId}`,
                    value: filter,
                    onChange: (value) => filterStore.setState(() => value),
                    placeholder: "Filter pair, bot, strategy…",
                    labelText: "Filter open trades",
                  }}
                  orderBy={{
                    id: `open-trades-sort-inline-${panelId}`,
                    value: cfg.sortBy,
                    items: OPEN_SORT_ITEMS.map((i) => ({ ...i })),
                    onChange: onSortChange,
                  }}
                  exportMenu={{
                    filenameBase: `open-trades-${cfg.instanceId}`,
                    dataset: "open-trades",
                    params: {
                      instanceId:
                        cfg.instanceId === ALL_INSTANCES
                          ? undefined
                          : cfg.instanceId,
                      search: debouncedSearch,
                    },
                    disabled: positions.length === 0,
                  }}
                />
                <div className="nfi-table-scroll">
                  <NfiDataTable
                    columns={columns}
                    data={positions}
                    getRowId={(p) =>
                      `${p.instanceId ?? cfg.instanceId}-${p.tradeId}`
                    }
                    sorting={sorting}
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
        )}
      </WidgetFrame>
    </>
  );
}

export const OpenTradesWidgetDef = defineWidget({
  type: "open-trades",
  hasSettings: true,
  title: "Open Trades",
  description:
    "Live positions with entry, current rate and PnL — one instance or the fleet.",
  configSchema: OpenTradesConfigSchema,
  defaultConfig: OPEN_TRADES_DEFAULTS,
  component: OpenTradesWidget,
  capabilities: [...OPEN_TRADES_CAPABILITIES],
  minWidth: 424,
  minHeight: 242,
  defaultWidth: 480,
  defaultHeight: 380,
});
