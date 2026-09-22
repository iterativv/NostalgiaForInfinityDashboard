// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Pair Summary — closed-trade attribution per pair.
 *
 * Groups the recent closed positions (one instance or the whole fleet) by
 * pair: trades, win rate, net profit and average profit %, sortable. The
 * classic freqtrade "which pairs pay the bills" view.
 */

import { NumberInput } from "@carbon/react";
import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, Stat, WidgetFrame } from "@nfi/ui";
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
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const PAIR_SUMMARY_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.closed-positions",
  "instances.closed-all",
];

const SORTS = [
  { id: "profitAbs", text: "Net profit" },
  { id: "trades", text: "Trades" },
  { id: "winrate", text: "Win rate" },
  { id: "profitPctAvg", text: "Avg %" },
  { id: "pair", text: "Pair (A→Z)" },
] as const;

export const PairSummaryConfigSchema = Schema.Struct({
  /** An instance id, or `all` for every closed position in the fleet. */
  instanceId: InstanceIdField,
  limit: numberWithDefault(200),
  minTrades: numberWithDefault(1),
  sortBy: Schema.optionalWith(Schema.Literal(...SORTS.map((s) => s.id)), {
    default: (): (typeof SORTS)[number]["id"] => "profitAbs",
  }),
  sortAsc: booleanWithDefault(false),
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
    .map(([pair, entry]) => ({
      pair,
      trades: entry.trades,
      wins: entry.wins,
      losses: entry.losses,
      winrate: entry.trades > 0 ? entry.wins / entry.trades : 0,
      profitAbs: entry.profitAbs,
      profitPctSum: entry.pctSum,
      profitPctAvg: entry.trades > 0 ? entry.pctSum / entry.trades : 0,
    }))
    .filter((row) => row.trades >= minTrades)
    .sort((a, b) => {
      const direction = cfg.sortAsc ? 1 : -1;
      const key = cfg.sortBy;
      if (key === "pair")
        return a.pair.localeCompare(b.pair) * (cfg.sortAsc ? 1 : -1);
      return ((a[key] as number) - (b[key] as number)) * direction;
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
            patch({ sortBy: sortBy as PairSummaryConfig["sortBy"] })
          }
        />
        <SettingsToggle
          id={`pair-summary-asc-${panelId}`}
          label="Ascending"
          toggled={cfg.sortAsc}
          onToggle={(v) => patch({ sortAsc: v })}
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
              label="Net profit"
              value={fmt(netProfit, 2)}
              sub={`${totalTrades} closed trades`}
            />
            <Stat
              label="Pairs traded"
              value={String(rows.length)}
              sub={cfg.instanceId === ALL_INSTANCES ? "fleet-wide" : undefined}
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
          <div className="nfi-table-scroll">
            <table style={{ width: "100%", fontSize: "0.8125rem" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Pair</th>
                  <th style={{ textAlign: "right" }}>Trades</th>
                  {cfg.showWinrate ? (
                    <th style={{ textAlign: "right" }}>Win rate</th>
                  ) : null}
                  <th style={{ textAlign: "right" }}>Net profit</th>
                  {cfg.showAvgPct ? (
                    <th style={{ textAlign: "right" }}>Avg %</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.pair}>
                    <td className="nfi-mono">{row.pair}</td>
                    <td style={{ textAlign: "right" }} className="nfi-mono">
                      {row.trades}
                      <span style={{ opacity: 0.5 }}>
                        {" "}
                        ({row.wins}W/{row.losses}L)
                      </span>
                    </td>
                    {cfg.showWinrate ? (
                      <td style={{ textAlign: "right" }} className="nfi-mono">
                        {(row.winrate * 100).toFixed(1)}%
                      </td>
                    ) : null}
                    <td
                      style={{ textAlign: "right" }}
                      className={`nfi-mono ${pnlClass(row.profitAbs)}`}
                    >
                      {fmt(row.profitAbs, 2)}
                    </td>
                    {cfg.showAvgPct ? (
                      <td
                        style={{ textAlign: "right" }}
                        className={`nfi-mono ${pnlClass(row.profitPctAvg)}`}
                      >
                        {row.profitPctAvg.toFixed(2)}%
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
  minWidth: 340,
  minHeight: 140,
});
