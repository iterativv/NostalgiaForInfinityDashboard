// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Open positions with expandable sub-orders — one instance or the fleet.
 *
 * The config schema carries decoding defaults for every field, so the
 * component receives a fully-resolved config straight from `decodeConfig` —
 * no manual merging of `Partial` payloads. Fleet mode (`instanceId === "all"`)
 * subscribes to the fleet aggregate and attributes rows per bot; the health
 * badge only applies per instance. The toolbar's Search filters SERVER-SIDE
 * (the text rides the stream subscription), ordering stays client-side.
 *
 * The table itself is the TanStack Table row model (`NfiDataTable`): the
 * "Order by" select drives its controlled sorting state (persisted as widget
 * config), and every position starts EXPANDED showing its latest
 * `maxVisibleOrders` sub-orders, with a "Load older" button inside each
 * expansion revealing more (see SubOrdersTable).
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
import type { SourcedOpenPosition } from "./shared/sources";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import {
  InstanceIdField,
  booleanWithDefault,
  numberWithDefault,
} from "./shared/config";
import { clampInt, fmt, fmtDate, pnlClass } from "./shared/format";
import { queryState } from "./shared/query";
import { InstanceSelect } from "./shared/InstanceSelect";
import { SubOrdersTable } from "./shared/SubOrdersTable";
import { SettingsToggle } from "./shared/SettingsToggle";
import { SettingsSelect } from "./shared/SettingsSelect";
import { useTimeFormat } from "./shared/timeFormat";
import {
  InstanceTag,
  useInstanceColors,
  type InstanceColors,
} from "./shared/instanceColors";
import { useOpenPositionsSource } from "./shared/sources";
import { parseTradeTime, type OpenSortKey, type SortDir } from "./shared/tradeSort";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const OpenPositionsSortBy = Schema.Literal(
  "openDate",
  "pair",
  "stake",
  "profitPct",
  "profitAbs",
);

export type OpenPositionsSortBy = typeof OpenPositionsSortBy.Type;

/**
 * Direction per sort key — "Order by" alone decides it (dates newest-first,
 * pair A→Z, metrics best-first), no separate direction selector.
 */
const OPEN_SORT_DIR: Record<OpenSortKey, SortDir> = {
  openDate: "desc",
  pair: "asc",
  stake: "desc",
  profitPct: "desc",
  profitAbs: "desc",
};

const ORDER_BY_ITEMS = [
  { id: "openDate", text: "Open date (newest)" },
  { id: "pair", text: "Pair (A→Z)" },
  { id: "stake", text: "Stake (largest)" },
  { id: "profitPct", text: "Profit % (best)" },
  { id: "profitAbs", text: "Profit abs (best)" },
] as const;

export const OpenPositionsConfigSchema = Schema.Struct({
  /** An instance id, or `all` for every instance's positions (fleet). */
  instanceId: InstanceIdField,
  /** Latest sub-orders shown in an expansion before "Load older". */
  maxVisibleOrders: numberWithDefault(5),
  /** Row-number column (1 = first row of the current ordering). */
  showRowNumber: booleanWithDefault(true),
  showBot: booleanWithDefault(false),
  showPair: booleanWithDefault(true),
  showDirection: booleanWithDefault(false),
  showLeverage: booleanWithDefault(false),
  showAmount: booleanWithDefault(false),
  showStake: booleanWithDefault(true),
  showOpenRate: booleanWithDefault(true),
  showCurrentRate: booleanWithDefault(false),
  showProfitAbs: booleanWithDefault(true),
  showProfitPct: booleanWithDefault(true),
  showEnterTag: booleanWithDefault(false),
  showStrategy: booleanWithDefault(false),
  showOpenDate: booleanWithDefault(true),
  sortBy: Schema.optionalWith(OpenPositionsSortBy, {
    default: (): OpenPositionsSortBy => "openDate",
  }),
});

export type OpenPositionsConfig = typeof OpenPositionsConfigSchema.Type;

export const OPEN_POSITIONS_DEFAULTS: OpenPositionsConfig =
  Schema.decodeUnknownSync(OpenPositionsConfigSchema)({});

/** Column set depends on config flags + fleet mode + instance colors. */
function buildColumns([
  cfg,
  showBotColumn,
  colors,
]: readonly [
  OpenPositionsConfig,
  boolean,
  InstanceColors,
]): NfiColumnDef<SourcedOpenPosition>[] {
  const defs: (NfiColumnDef<SourcedOpenPosition> | null)[] = [
    cfg.showRowNumber
      ? {
          id: "no",
          header: "No.",
          // Display position under the CURRENT ordering — `row.index` is the
          // data-array position, which sorting can reorder away.
          cell: ({ row }) => row.getDisplayIndex() + 1,
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
    cfg.showLeverage
      ? {
          id: "lev",
          header: "Lev",
          cell: ({ row }) =>
            row.original.leverage !== undefined
              ? `${row.original.leverage}x`
              : "—",
          enableSorting: false,
        }
      : null,
    cfg.showAmount
      ? {
          id: "amount",
          header: "Amount",
          cell: ({ row }) => row.original.amount,
          enableSorting: false,
        }
      : null,
    cfg.showStake
      ? {
          id: "stake",
          header: "Stake",
          accessorFn: (p) => p.stakeAmount,
          cell: ({ row }) => row.original.stakeAmount.toFixed(2),
          meta: { className: "nfi-mono" },
        }
      : null,
    cfg.showOpenRate
      ? {
          id: "open",
          header: "Open",
          cell: ({ row }) => fmt(row.original.openRate, 4),
          meta: { className: "nfi-mono" },
          enableSorting: false,
        }
      : null,
    cfg.showCurrentRate
      ? {
          id: "current",
          header: "Current",
          cell: ({ row }) => fmt(row.original.currentRate, 4),
          meta: { className: "nfi-mono" },
          enableSorting: false,
        }
      : null,
    cfg.showProfitAbs
      ? {
          id: "profitAbs",
          header: "PnL",
          accessorFn: (p) => p.profitAbs ?? 0,
          cell: ({ row }) => (
            <span className={pnlClass(row.original.profitAbs)}>
              {fmt(row.original.profitAbs, 2)}
            </span>
          ),
          meta: { className: "nfi-mono" },
        }
      : null,
    cfg.showProfitPct
      ? {
          id: "profitPct",
          header: "PnL %",
          accessorFn: (p) => p.profitPct ?? 0,
          cell: ({ row }) => (
            <PnlPill
              value={row.original.profitPct}
              percent={row.original.profitPct}
              absolute={row.original.profitAbs}
            />
          ),
        }
      : null,
    cfg.showEnterTag
      ? {
          id: "tag",
          header: "Tag",
          cell: ({ row }) => row.original.enterTag?.trim() || "—",
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
    cfg.showOpenDate
      ? {
          id: "openDate",
          header: "Opened",
          accessorFn: (p) => parseTradeTime(p.openDate),
          cell: ({ row }) => fmtDate(row.original.openDate),
          sortDescFirst: true,
        }
      : null,
  ];

  return defs.flatMap((entry) => (entry ? [entry] : []));
}

const EMPTY_POSITIONS: ReadonlyArray<SourcedOpenPosition> = [];

export function OpenPositionsWidget({
  config,
  panelId,
}: WidgetProps<OpenPositionsConfig>) {
  const cfg = config;
  const maxVisible = clampInt(cfg.maxVisibleOrders, 5, 1, 50);
  const filterStore = useLocalStore("");
  const filter = useStore(filterStore, (s) => s);
  // Debounced: the search text is part of the stream subscription key, so
  // the server only re-queries after the user pauses typing.
  const debouncedSearch = useDebouncedValue(filter, 400);
  const hasSearch = debouncedSearch.trim().length > 0;

  const src = useOpenPositionsSource(cfg.instanceId, {
    search: debouncedSearch,
  });

  const colors = useInstanceColors();

  const health = useCapability(
    "instances.health",
    { id: cfg.instanceId },
    { enabled: cfg.instanceId !== "all" },
  );

  const state = queryState(src.error, src.isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  // fmtDate/sub-order dates read the global time-format store; this read
  // re-renders the table when the configured format changes.
  useTimeFormat();

  const patch = (p: Partial<OpenPositionsConfig>) =>
    applyWidgetSettings(panelId, "open-positions", cfg, p);

  const patchFlag = (key: keyof OpenPositionsConfig, v: boolean): void => {
    // SAFETY: `key` iterates the boolean settings keys rendered in this
    // modal, so the computed entry is a valid Partial (TS cannot express a
    // computed partial from a union key).
    patch({ [key]: v } as Partial<OpenPositionsConfig>);
  };

  const positions = src.data ?? EMPTY_POSITIONS;
  /** Bot attribution column: explicit toggle, or implied by fleet mode. */
  const showBotColumn = cfg.showBot || cfg.instanceId === "all";

  // Column set derived through a store: rebuilt only when the widget config,
  // fleet mode, or instance colors actually change.
  const columns = useDerived(
    [cfg, showBotColumn, colors] as const,
    buildColumns,
    { inputs: shallowStore },
  );

  // Server already filtered; ordering is the table's controlled sorting
  // state — "Order by" persists as widget config, TanStack Table sorts.
  // SAFETY: the config schema validates `sortBy` into the closed
  // `OpenSortKey` set (defaulting to `openDate`), so the direction-table
  // index is total despite the schema's wider string typing.
  const sorting: SortingState = [
    {
      id: cfg.sortBy,
      desc: OPEN_SORT_DIR[cfg.sortBy as OpenSortKey] === "desc",
    },
  ];

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Open positions settings"
        widgetType="open-positions"
      >
        <InstanceSelect
          id={`pos-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <NumberInput
          id={`pos-max-${panelId}`}
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
          id={`pos-sort-${panelId}`}
          label="Order by"
          items={ORDER_BY_ITEMS.map((item) => ({ ...item }))}
          value={cfg.sortBy}
          onChange={(id) =>
            patch({
              sortBy: Schema.decodeUnknownSync(OpenPositionsSortBy)(id),
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
              ["showLeverage", "Leverage"],
              ["showAmount", "Amount"],
              ["showStake", "Stake"],
              ["showOpenRate", "Open rate"],
              ["showCurrentRate", "Current rate"],
              ["showProfitAbs", "Profit abs"],
              ["showProfitPct", "Profit %"],
              ["showEnterTag", "Enter tag"],
              ["showStrategy", "Strategy"],
              ["showOpenDate", "Open date"],
            ] as const
          ).map(([key, label]) => (
            <SettingsToggle
              key={key}
              id={`pos-${key}-${panelId}`}
              label={label}
              toggled={cfg[key]}
              onToggle={(v) => patchFlag(key, v)}
            />
          ))}
        </div>
      </WidgetSettingsModal>
      <WidgetFrame
        title={`Open Positions${health.data?.state ? ` · ${health.data.state}` : ""}`}
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
                  placeholder="Filter pair, bot, strategy…"
                  labelText="Filter open positions"
                  value={filter}
                  onChange={(e) =>
                    filterStore.setState(() => e.target.value ?? "")
                  }
                />
              </div>
              <div style={{ flex: "0 0 170px" }}>
                <SettingsSelect
                  id={`pos-sort-inline-${panelId}`}
                  label="Order by"
                  items={ORDER_BY_ITEMS.map((item) => ({ ...item }))}
                  value={cfg.sortBy}
                  onChange={(id) =>
                    patch({
                      sortBy: Schema.decodeUnknownSync(OpenPositionsSortBy)(id),
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
                  defaultExpanded
                />
              </div>
            ) : (
              <EmptyState
                title="No matches"
                hint={`No open positions match "${debouncedSearch.trim()}".`}
              />
            )}
          </div>
        ) : (
          <EmptyState
            title="No open positions"
            hint="Flat is a position too. Pick an instance in ⚙ settings."
          />
        )}
      </WidgetFrame>
    </>
  );
}

export const OpenPositionsWidgetDef = defineWidget({
  type: "open-positions",
  hasSettings: true,
  title: "Open Positions",
  description:
    "Open positions with expandable sub-orders (expanded by default, latest first) — one instance or the fleet.",
  configSchema: OpenPositionsConfigSchema,
  defaultConfig: OPEN_POSITIONS_DEFAULTS,
  component: OpenPositionsWidget,
  capabilities: [
    "instances.open-positions",
    "instances.health",
    "instances.positions-all",
  ],
  // Width floor covers the dashboard-column set (bot, pair, dir, amount,
  // stake, open, current, pnl%, opened) plus the expander column at its
  // intrinsic content width so the table never needs a horizontal
  // scrollbar; height pins chrome + header + a few readable rows — longer
  // fleets scroll vertically.
  minWidth: 1020,
  minHeight: 300,
  defaultWidth: 1000,
  defaultHeight: 460,
});
