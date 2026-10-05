// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Fleet Overview — every configured freqtrade instance on one screen.
 *
 * Backed by `instances.overview`: one server-side fan-out per instance
 * (health, status, capacity, profit, balance) with per-instance error
 * tolerance — one unreachable bot becomes an error row, never a failed
 * widget. Totals bar summarizes the whole fleet. The comparison table runs
 * on the TanStack row model (`NfiDataTable`) in fixed server order.
 */

import { shallow as shallowStore } from "@tanstack/react-store";
import { Schema } from "effect";
import type { Capability, FleetInstanceSummary } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import {
  EmptyState,
  ModeBadge,
  NfiDataTable,
  PnlPill,
  Stat,
  useDerived,
  WidgetFrame,
  type NfiColumnDef,
} from "@nfi/ui";
import { useCapability } from "./live/live";
import { booleanWithDefault } from "./shared/config";
import { COL } from "./shared/columns";
import { fmt, pnlTone } from "./shared/format";
import {
  InstanceDot,
  useInstanceColors,
  type InstanceColors,
} from "./shared/instanceColors";
import { queryState } from "./shared/query";

export const FLEET_OVERVIEW_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.overview",
];

export const FleetOverviewConfigSchema = Schema.Struct({
  showVersion: booleanWithDefault(false),
  showBalance: booleanWithDefault(true),
});

export type FleetOverviewConfig = typeof FleetOverviewConfigSchema.Type;

export const FLEET_OVERVIEW_DEFAULTS: FleetOverviewConfig =
  Schema.decodeUnknownSync(FleetOverviewConfigSchema)({});

/** Column set depends on config flags + instance colors. */
function buildColumns([
  cfg,
  colors,
]: readonly [
  FleetOverviewConfig,
  InstanceColors,
]): NfiColumnDef<FleetInstanceSummary>[] {
  const defs: (NfiColumnDef<FleetInstanceSummary> | null)[] = [
    {
      id: "bot",
      header: COL.bot,
      cell: ({ row }) => {
        const color = colors.colorOf(row.original.id);

        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              minWidth: 0,
            }}
          >
            {color ? (
              <InstanceDot color={color} title={row.original.name} />
            ) : null}
            <ModeBadge dryRun={row.original.dryRun} />
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color:
                  row.original.error === undefined &&
                  row.original.state !== "running"
                    ? "var(--cds-text-secondary)"
                    : undefined,
              }}
            >
              {row.original.error !== undefined ? (
                <span title={row.original.error}>
                  {row.original.name} · down
                </span>
              ) : (
                row.original.name
              )}
            </span>
          </span>
        );
      },
      meta: { className: "nfi-mono", style: { textAlign: "left" } },
      enableSorting: false,
    },
    {
      id: "trades",
      header: COL.trades,
      cell: ({ row }) =>
        row.original.error !== undefined
          ? "—"
          : `${row.original.openCount ?? 0} / ${
              row.original.maxOpenTrades ?? "—"
            }`,
      meta: { className: "nfi-mono", style: { textAlign: "right" } },
      enableSorting: false,
    },
    {
      id: "openProfit",
      header: COL.openProfit,
      cell: ({ row }) =>
        row.original.error !== undefined ? (
          "—"
        ) : row.original.openProfitCoin !== undefined ? (
          <PnlPill
            value={row.original.openProfitCoin}
            absolute={row.original.openProfitCoin}
          />
        ) : (
          "—"
        ),
      meta: { style: { textAlign: "right" } },
      enableSorting: false,
    },
    {
      id: "closedProfit",
      header: COL.closedProfit,
      cell: ({ row }) =>
        row.original.error !== undefined ? (
          "—"
        ) : row.original.profitClosedPercent !== undefined ? (
          <PnlPill
            value={row.original.profitClosedPercent}
            percent={row.original.profitClosedPercent}
            absolute={row.original.profitClosedCoin}
          />
        ) : row.original.profitClosedCoin !== undefined ? (
          <PnlPill
            value={row.original.profitClosedCoin}
            absolute={row.original.profitClosedCoin}
          />
        ) : (
          "—"
        ),
      meta: { style: { textAlign: "right" } },
      enableSorting: false,
    },
    cfg.showBalance
      ? {
          id: "balance",
          header: COL.balance,
          cell: ({ row }) =>
            row.original.totalStake !== undefined
              ? `${fmt(row.original.totalStake, 2)}${
                  row.original.stakeCurrency
                    ? ` ${row.original.stakeCurrency}`
                    : ""
                }`
              : "—",
          meta: { className: "nfi-mono", style: { textAlign: "right" } },
          enableSorting: false,
        }
      : null,
    {
      id: "wl",
      header: COL.winLoss,
      cell: ({ row }) => (
        <>
          <span className="nfi-pnl-positive">{row.original.wins ?? 0}</span>
          {" / "}
          <span className="nfi-pnl-negative">{row.original.losses ?? 0}</span>
        </>
      ),
      meta: { className: "nfi-mono", style: { textAlign: "right" } },
      enableSorting: false,
    },
    cfg.showVersion
      ? {
          id: "version",
          header: COL.version,
          cell: ({ row }) => row.original.version ?? "—",
          meta: { className: "nfi-mono", style: { textAlign: "right" } },
          enableSorting: false,
        }
      : null,
  ];

  return defs.flatMap((entry) => (entry ? [entry] : []));
}

export function FleetOverviewWidget({
  config,
}: WidgetProps<FleetOverviewConfig>) {
  const cfg = config;
  const { data, error, isLoading } = useCapability("instances.overview", {});
  const state = queryState(error, isLoading);
  const colors = useInstanceColors();
  const stake = data?.totals.stakeCurrency;

  // Column set derived through a store: rebuilt only when the widget config
  // or instance colors actually change.
  const columns = useDerived([cfg, colors] as const, buildColumns, {
    inputs: shallowStore,
  });

  return (
    <WidgetFrame
      title="Fleet Overview"
      isLoading={state.isLoading}
      error={state.error}
    >
      {data && data.instances.length > 0 ? (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
        >
          <div className="nfi-stat-grid">
            <Stat
              label="Instances"
              value={`${data.totals.reachableCount}/${data.totals.instanceCount}`}
              sub="reachable"
            />
            <Stat label="Open trades" value={String(data.totals.openCount)} />
            <Stat
              label="Open profit"
              value={`${fmt(data.totals.openProfitCoin, 2)}${stake ? ` ${stake}` : ""}`}
              tone={pnlTone(data.totals.openProfitCoin)}
            />
            <Stat
              label="Closed profit"
              value={`${fmt(data.totals.profitClosedCoin, 2)}${stake ? ` ${stake}` : ""}`}
              tone={pnlTone(data.totals.profitClosedCoin)}
            />
            <Stat
              label={COL.winLoss}
              value={`${fmt(data.totals.wins, 0)} / ${fmt(data.totals.losses, 0)}`}
            />
            {cfg.showBalance ? (
              <Stat
                label="Fleet wallet"
                value={`${fmt(data.totals.totalStake, 2)}${stake ? ` ${stake}` : ""}`}
              />
            ) : null}
          </div>
          <div
            className="nfi-table-scroll"
            style={{ width: "100%", fontSize: "0.8125rem" }}
          >
            <NfiDataTable
              columns={columns}
              data={data.instances}
              getRowId={(row) => row.id}
            />
          </div>
        </div>
      ) : (
        <EmptyState
          title="No instances"
          hint="Connect freqtrade instances on the aside → Manage freqtrade instances."
        />
      )}
    </WidgetFrame>
  );
}

export const FleetOverviewWidgetDef = defineWidget({
  type: "fleet-overview",
  hasSettings: false,
  title: "Bot Comparison",
  description:
    "Trades, open/closed profit, balance and W/L for every configured instance in one table.",
  configSchema: FleetOverviewConfigSchema,
  defaultConfig: FLEET_OVERVIEW_DEFAULTS,
  component: FleetOverviewWidget,
  capabilities: [...FLEET_OVERVIEW_CAPABILITIES],
  minWidth: 640,
  // Summary tiles + header + two bot rows; more instances scroll vertically.
  minHeight: 170,
  defaultWidth: 640,
  defaultHeight: 400,
});
