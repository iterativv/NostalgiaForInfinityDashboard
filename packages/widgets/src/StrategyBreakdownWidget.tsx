// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Strategy breakdown — closed-trade profit attributed per strategy.
 *
 * Multi-strategy terminals need attribution, not just totals: which
 * strategy earns, which churns, and where the trade count concentrates.
 * Fleet mode (`instanceId === "all"`) groups per (strategy, instance) and
 * labels rows `strategy · instanceName` so attribution stays unambiguous.
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
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, WidgetFrame } from "@nfi/ui";
import { applyWidgetSettings } from "./shared/panelConfig";
import { InstanceIdField, numberWithDefault } from "./shared/config";
import { clampInt } from "./shared/format";
import { queryState, useWidgetAccess } from "./shared/query";
import { InstanceSelect } from "./shared/InstanceSelect";
import { useClosedPositionsSource } from "./shared/sources";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const STRATEGY_BREAKDOWN_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.closed-positions",
  "instances.closed-all",
];

export const StrategyBreakdownConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  limit: numberWithDefault(200),
  minTrades: numberWithDefault(1),
});
export type StrategyBreakdownConfig = typeof StrategyBreakdownConfigSchema.Type;

export const STRATEGY_BREAKDOWN_DEFAULTS: StrategyBreakdownConfig =
  Schema.decodeUnknownSync(StrategyBreakdownConfigSchema)({});

export function StrategyBreakdownWidget({
  config,
  panelId,
}: WidgetProps<StrategyBreakdownConfig>) {
  const cfg = config;
  const limit = clampInt(cfg.limit, 200, 10, 1000);
  const minTrades = clampInt(cfg.minTrades, 1, 0, 100);
  const access = useWidgetAccess(STRATEGY_BREAKDOWN_CAPABILITIES);
  const src = useClosedPositionsSource(cfg.instanceId, limit, {
    enabled: access.allowed,
  });
  const state = queryState(src.error, src.isLoading);
  const accessError = access.allowed
    ? null
    : `Not authorized — needs ${access.missing.join(", ")}`;
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<StrategyBreakdownConfig>) =>
    applyWidgetSettings(panelId, "strategy-breakdown", cfg, p);

  /** Fleet rows are per-instance; group by (strategy, instance) there. */
  const fleet = cfg.instanceId === "all";
  const groups = new Map<
    string,
    { strategy: string; trades: number; wins: number; profit: number }
  >();
  for (const p of src.data ?? []) {
    const name = (p.strategy ?? "unknown").trim() || "unknown";
    const key = fleet ? `${name}|${p.instanceName ?? ""}` : name;
    const entry = groups.get(key) ?? {
      strategy: fleet && p.instanceName ? `${name} · ${p.instanceName}` : name,
      trades: 0,
      wins: 0,
      profit: 0,
    };
    const profit = p.closeProfitAbs ?? p.profitAbs ?? 0;
    entry.trades += 1;
    if (profit > 0) entry.wins += 1;
    entry.profit += profit;
    groups.set(key, entry);
  }
  const rows = [...groups.entries()]
    .map(([key, g]) => ({
      key,
      ...g,
      winrate: g.trades > 0 ? (g.wins / g.trades) * 100 : 0,
    }))
    .filter((r) => r.trades >= minTrades)
    .sort((a, b) => b.profit - a.profit);

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
        <div className="nfi-table-scroll">
          <Table size="sm" useZebraStyles={false}>
            <TableHead>
              <TableRow>
                <TableHeader>Strategy</TableHeader>
                <TableHeader>Trades</TableHeader>
                <TableHeader>Winrate</TableHeader>
                <TableHeader>Profit</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>{row.strategy}</TableCell>
                  <TableCell className="nfi-mono">{row.trades}</TableCell>
                  <TableCell className="nfi-mono">
                    {row.winrate.toFixed(1)}%
                  </TableCell>
                  <TableCell>
                    <Tag type={row.profit >= 0 ? "green" : "red"} size="sm">
                      {row.profit >= 0 ? "+" : ""}
                      {row.profit.toFixed(2)}
                    </Tag>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
  minWidth: 340,
  minHeight: 140,
});
