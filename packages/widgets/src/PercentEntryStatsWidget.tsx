// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@carbon/react";
import { EmptyState, Stat, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { InstanceIdField, stringWithDefault } from "./shared/config";
import { fmtSigned, pnlClass, pnlTone } from "./shared/format";
import { InstanceSelect } from "./shared/InstanceSelect";
import { queryState } from "./shared/query";
import { SettingsSelect } from "./shared/SettingsSelect";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const PERCENT_ENTRY_STATS_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.tag-performance.relative",
];

export const PercentEntryStatsConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  groupBy: stringWithDefault("enter"),
});
export type PercentEntryStatsConfig = typeof PercentEntryStatsConfigSchema.Type;

export const PERCENT_ENTRY_STATS_DEFAULTS: PercentEntryStatsConfig =
  Schema.decodeUnknownSync(PercentEntryStatsConfigSchema)({});

/**
 * Public entry/exit tag statistics — win rate and average percent per tag.
 *
 * Backed by `instances.tag-performance.relative`: tags, counts and
 * percentages only, so strategy edge is visible without revealing money.
 */
export function PercentEntryStatsWidget({
  config,
  panelId,
}: WidgetProps<PercentEntryStatsConfig>) {
  const cfg = config;
  const { data, error, isLoading } = useCapability(
    "instances.tag-performance.relative",
    { id: cfg.instanceId, groupBy: cfg.groupBy === "exit" ? "exit" : "enter" },
  );
  const state = queryState(error, isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<PercentEntryStatsConfig>) =>
    applyWidgetSettings(panelId, "tag-performance-relative", cfg, p);

  const rows = [...(data?.rows ?? [])].sort((a, b) => b.trades - a.trades);
  const aggregated = data?.aggregatedTrades ?? 0;
  const wins = rows.reduce((sum, r) => sum + r.wins, 0);
  const trades = rows.reduce((sum, r) => sum + r.trades, 0);
  const bestRow = rows.reduce<null | (typeof rows)[number]>((best, r) => {
    if (r.trades < 3) return best;
    if (!best) return r;
    return r.profitPctAvg > best.profitPctAvg ? r : best;
  }, null);

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Entry stats % settings"
        widgetType="tag-performance-relative"
      >
        <InstanceSelect
          id={`pct-tags-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
        />
        <SettingsSelect
          id={`pct-tags-group-${panelId}`}
          label="Group by"
          items={[
            { id: "enter", text: "Entry signal" },
            { id: "exit", text: "Exit reason" },
          ]}
          value={cfg.groupBy === "exit" ? "exit" : "enter"}
          onChange={(id) => patch({ groupBy: id })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
      title={`Entry Stats % · ${cfg.groupBy === "exit" ? "exit" : "enter"}`}
      isLoading={state.isLoading}
      error={state.error}
    >
      {data ? (
        rows.length > 0 ? (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
          >
            <div className="nfi-stat-grid">
              <Stat
                label="Overall win rate"
                value={
                  trades > 0 ? `${((wins / trades) * 100).toFixed(1)}%` : "—"
                }
                sub={`${trades} tagged trades`}
                tone={pnlTone(wins * 2 - trades)}
              />
              <Stat
                label="Signals"
                value={String(rows.length)}
                sub={`grouped by ${cfg.groupBy === "exit" ? "exit" : "enter"} tag`}
              />
              <Stat
                label="Best edge"
                value={bestRow ? `${fmtSigned(bestRow.profitPctAvg, 2)}%` : "—"}
                sub={
                  bestRow
                    ? `${bestRow.tag} · ≥3 trades`
                    : "needs ≥3 trades per tag"
                }
                tone={bestRow ? pnlTone(bestRow.profitPctAvg) : "neutral"}
              />
            </div>
            <div className="nfi-table-scroll">
              <Table size="sm" useZebraStyles={false}>
                <TableHead>
                  <TableRow>
                    <TableHeader>Tag</TableHeader>
                    <TableHeader>Trades</TableHeader>
                    <TableHeader>Share</TableHeader>
                    <TableHeader>Win rate</TableHeader>
                    <TableHeader>Avg %</TableHeader>
                    <TableHeader>W / L</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.tag}>
                      <TableCell>{r.tag}</TableCell>
                      <TableCell>{r.trades}</TableCell>
                      <TableCell>
                        {aggregated > 0
                          ? `${((r.trades / aggregated) * 100).toFixed(1)}%`
                          : "—"}
                      </TableCell>
                      <TableCell className={pnlClass(r.winrate * 2 - 1)}>
                        {(r.winrate * 100).toFixed(1)}%
                      </TableCell>
                      <TableCell className={pnlClass(r.profitPctAvg)}>
                        {fmtSigned(r.profitPctAvg, 2)}%
                      </TableCell>
                      <TableCell>
                        {r.wins} / {r.losses}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <EmptyState
            title="No tagged trades"
            hint="Tags appear once the strategy records entry/exit signals."
          />
        )
      ) : null}
    </WidgetFrame>
    </>
  );
}

export const PercentEntryStatsWidgetDef = defineWidget({
  type: "tag-performance-relative",
  hasSettings: true,
  title: "Entry Stats %",
  description:
    "Public-shareable win rate and average percent per entry/exit tag — never absolute amounts.",
  configSchema: PercentEntryStatsConfigSchema,
  defaultConfig: PERCENT_ENTRY_STATS_DEFAULTS,
  component: PercentEntryStatsWidget,
  capabilities: [...PERCENT_ENTRY_STATS_CAPABILITIES],
  minWidth: 340,
  minHeight: 140,
});
