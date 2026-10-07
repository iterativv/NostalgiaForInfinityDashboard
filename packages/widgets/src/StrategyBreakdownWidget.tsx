// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Strategy breakdown — closed-trade profit attributed per strategy.
 *
 * Multi-strategy terminals need attribution, not just totals: which
 * strategy earns, which churns, and where the trade count concentrates.
 * Fleet mode (`instanceId === "all"`) groups per (strategy, instance) and
 * labels rows `strategy · instanceName` so attribution stays unambiguous.
 * Rows render through NfiDataTable in fixed order (profit best-first).
 */

import { NumberInput, Tag } from "@carbon/react";
import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import {
  EmptyState,
  NfiDataTable,
  WidgetFrame,
  type NfiColumnDef,
} from "@nfi/ui";
import { applyWidgetSettings } from "./shared/panelConfig";
import { InstanceIdField, numberWithDefault } from "./shared/config";
import { clampInt } from "./shared/format";
import { queryState, useWidgetAccess } from "./shared/query";
import { InstanceSelect } from "./shared/InstanceSelect";
import { ALL_INSTANCES } from "./shared/InstanceSelect";
import { useCapability } from "./live/live";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import { COL } from "./shared/columns";
import { NfiTableContainer, NfiTableToolbar } from "./shared/tableToolbar";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const STRATEGY_BREAKDOWN_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.tag-performance",
  "instances.tag-performance-all",
];

export const StrategyBreakdownConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  limit: numberWithDefault(200),
  minTrades: numberWithDefault(1),
});

export type StrategyBreakdownConfig = typeof StrategyBreakdownConfigSchema.Type;

export const STRATEGY_BREAKDOWN_DEFAULTS: StrategyBreakdownConfig =
  Schema.decodeUnknownSync(StrategyBreakdownConfigSchema)({});

/** One aggregated strategy row — fleet mode labels `strategy · instance`. */
interface StrategyRow {
  readonly key: string;
  readonly strategy: string;
  readonly trades: number;
  readonly wins: number;
  readonly profit: number;
  readonly winrate: number;
}

/** Static column set — module scope keeps the table inputs stable. Rows keep
 * their fixed business order (profit best-first), so no column sorts. */
const COLUMNS: NfiColumnDef<StrategyRow>[] = [
  {
    id: "strategy",
    header: COL.strategy,
    cell: ({ row }) => row.original.strategy,
    enableSorting: false,
  },
  {
    id: "trades",
    header: COL.trades,
    cell: ({ row }) => row.original.trades,
    meta: { className: "nfi-mono" },
    enableSorting: false,
  },
  {
    id: "winrate",
    header: COL.winRate,
    cell: ({ row }) => `${row.original.winrate.toFixed(1)}%`,
    meta: { className: "nfi-mono" },
    enableSorting: false,
  },
  {
    id: "profit",
    header: COL.totalProfit,
    cell: ({ row }) => (
      <Tag type={row.original.profit >= 0 ? "green" : "red"} size="sm">
        {row.original.profit >= 0 ? "+" : ""}
        {row.original.profit.toFixed(2)}
      </Tag>
    ),
    enableSorting: false,
  },
];

export function StrategyBreakdownWidget({
  config,
  panelId,
}: WidgetProps<StrategyBreakdownConfig>) {
  const cfg = config;
  const limit = clampInt(cfg.limit, 200, 10, 1000);
  const minTrades = clampInt(cfg.minTrades, 1, 0, 100);
  const access = useWidgetAccess(STRATEGY_BREAKDOWN_CAPABILITIES);

  // One SQL GROUP BY over the FULL mirror history: strategy is the
  // dimension, minTrades the HAVING, profit the ORDER BY. Fleet mode groups
  // per (strategy, instance) server-side — attribution stays unambiguous
  // without any client-side window.
  const fleet = cfg.instanceId === ALL_INSTANCES;

  const perInstance = useCapability(
    "instances.tag-performance",
    {
      id: cfg.instanceId,
      limit: String(limit),
      groupBy: "strategy",
      minTrades: String(minTrades),
      sortBy: "profitAbs",
      sortDir: "desc",
    },
    { enabled: access.allowed && !fleet },
  );

  const fleetView = useCapability(
    "instances.tag-performance-all",
    {
      limit: String(limit),
      groupBy: "strategy",
      minTrades: String(minTrades),
      sortBy: "profitAbs",
      sortDir: "desc",
    },
    { enabled: access.allowed && fleet },
  );

  const data = fleet ? fleetView.data : perInstance.data;

  const state = queryState(
    fleet ? fleetView.error : perInstance.error,
    fleet ? fleetView.isLoading : perInstance.isLoading,
  );

  const accessError = access.allowed
    ? null
    : `Not authorized — needs ${access.missing.join(", ")}`;

  const showSettings = useWidgetSettingsOpen(panelId);

  const patch = (p: Partial<StrategyBreakdownConfig>) =>
    applyWidgetSettings(panelId, "strategy-breakdown", cfg, p);

  const rows: StrategyRow[] = (data?.rows ?? []).map((row) => ({
    key: fleet ? `${row.tag}|${row.instanceId ?? ""}` : row.tag,
    strategy:
      fleet && row.instanceName ? `${row.tag} · ${row.instanceName}` : row.tag,
    trades: row.trades,
    wins: row.wins,
    profit: row.profitAbs,
    // Repo winrate is a 0..1 fraction; the table shows percent.
    winrate: row.winrate * 100,
  }));

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Strategy breakdown settings"
        widgetType="strategy-breakdown"
      >
        <InstanceSelect
          id={`strat-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <NumberInput
          id={`strat-limit-${panelId}`}
          label="Closed trades in window"
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
          id={`strat-min-${panelId}`}
          label="Minimum trades per strategy"
          value={minTrades}
          min={0}
          max={100}
          step={1}
          onChange={(_e, { value }) =>
            patch({ minTrades: clampInt(value, 1, 0, 100) })
          }
          size="sm"
        />
      </WidgetSettingsModal>
      <WidgetFrame
        title="Strategy Breakdown"
        isLoading={state.isLoading}
        error={accessError ?? state.error}
      >
        {rows.length > 0 ? (
          <NfiTableContainer>
            <NfiTableToolbar
              label="Strategy breakdown table actions"
              exportMenu={{
                filenameBase: `strategy-breakdown-${cfg.instanceId}`,
                dataset: "tag-performance",
                params: {
                  instanceId:
                    cfg.instanceId === ALL_INSTANCES
                      ? undefined
                      : cfg.instanceId,
                  groupBy: "strategy",
                  minTrades,
                  sortBy: "profitAbs",
                  sortDir: "desc",
                },
                disabled: rows.length === 0,
              }}
            />
            <div className="nfi-table-scroll">
              <NfiDataTable
                columns={COLUMNS}
                data={rows}
                getRowId={(row) => row.key}
              />
            </div>
          </NfiTableContainer>
        ) : (
          <EmptyState
            title="No strategy data"
            hint="No closed trades in the window."
          />
        )}
      </WidgetFrame>
    </>
  );
}

export const StrategyBreakdownWidgetDef = defineWidget({
  type: "strategy-breakdown",
  hasSettings: true,
  title: "Strategy Breakdown",
  description: "Closed-trade profit attributed per strategy.",
  configSchema: StrategyBreakdownConfigSchema,
  defaultConfig: STRATEGY_BREAKDOWN_DEFAULTS,
  component: StrategyBreakdownWidget,
  capabilities: [...STRATEGY_BREAKDOWN_CAPABILITIES],
  minWidth: 480,
  minHeight: 170,
  defaultWidth: 480,
  defaultHeight: 340,
});
