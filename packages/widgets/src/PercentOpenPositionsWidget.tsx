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
  Tag,
} from "@carbon/react";
import { EmptyState, Stat, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { InstanceIdField } from "./shared/config";
import { fmtAge, fmtSigned, pnlClass } from "./shared/format";
import { InstanceSelect } from "./shared/InstanceSelect";
import { queryState } from "./shared/query";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const PERCENT_OPEN_POSITIONS_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.open-positions.relative",
];

export const PercentOpenPositionsConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
});
export type PercentOpenPositionsConfig =
  typeof PercentOpenPositionsConfigSchema.Type;

export const PERCENT_OPEN_POSITIONS_DEFAULTS: PercentOpenPositionsConfig =
  Schema.decodeUnknownSync(PercentOpenPositionsConfigSchema)({});

/**
 * Public open-positions widget — percent P&L and wallet share, never amounts.
 *
 * Backed by `instances.open-positions.relative`: safe for publicly
 * shareable pages (allocation weights are shares of a server-side total
 * that is never exposed).
 */
export function PercentOpenPositionsWidget({
  config,
  panelId,
}: WidgetProps<PercentOpenPositionsConfig>) {
  const cfg = config;
  const { data, error, isLoading } = useCapability(
    "instances.open-positions.relative",
    { id: cfg.instanceId },
  );
  const state = queryState(error, isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<PercentOpenPositionsConfig>) =>
    applyWidgetSettings(panelId, "positions-open-relative", cfg, p);

  const positions = data?.positions ?? [];
  const deployed = positions.reduce(
    (sum, p) => sum + (p.allocationWeight ?? 0),
    0,
  );
  const withPnl = positions.filter(
    (p) => typeof p.profitPct === "number" && Number.isFinite(p.profitPct),
  );
  const avgPnl =
    withPnl.length > 0
      ? withPnl.reduce((sum, p) => sum + (p.profitPct ?? 0), 0) / withPnl.length
      : null;

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Open positions % settings"
        widgetType="positions-open-relative"
      >
        <InstanceSelect
          id={`pct-open-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
      title="Open Positions %"
      isLoading={state.isLoading}
      error={state.error}
    >
      {data ? (
        positions.length > 0 ? (
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
                label="Avg P&L"
                value={avgPnl === null ? "—" : `${fmtSigned(avgPnl, 2)}%`}
                sub="across open trades"
              />
              <Stat
                label="Largest"
                value={`${(positions.reduce((max, p) => Math.max(max, p.allocationWeight ?? 0), 0) * 100).toFixed(1)}%`}
                sub="single-trade wallet share"
              />
            </div>
            <div className="nfi-table-scroll">
              <Table size="sm" useZebraStyles={false}>
                <TableHead>
                  <TableRow>
                    <TableHeader>Pair</TableHeader>
                    <TableHeader>Dir</TableHeader>
                    <TableHeader>P&L %</TableHeader>
                    <TableHeader>Wallet %</TableHeader>
                    <TableHeader>Lev</TableHeader>
                    <TableHeader>Age</TableHeader>
                    <TableHeader>Tag</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {positions.map((p) => (
                    <TableRow key={p.tradeId}>
                      <TableCell>{p.pair}</TableCell>
                      <TableCell>
                        <Tag type={p.isShort ? "red" : "green"} size="sm">
                          {p.isShort ? "SHORT" : "LONG"}
                        </Tag>
                      </TableCell>
                      <TableCell className={pnlClass(p.profitPct)}>
                        {fmtSigned(p.profitPct, 2)}%
                      </TableCell>
                      <TableCell>
                        {((p.allocationWeight ?? 0) * 100).toFixed(1)}
                      </TableCell>
                      <TableCell>
                        {p.leverage !== undefined && p.leverage > 1
                          ? `${p.leverage.toFixed(1)}×`
                          : "—"}
                      </TableCell>
                      <TableCell>{fmtAge(p.openDate)}</TableCell>
                      <TableCell>{p.enterTag ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <EmptyState
            title="No open positions"
            hint="The bot is fully in cash for this instance."
          />
        )
      ) : null}
    </WidgetFrame>
    </>
  );
}

export const PercentOpenPositionsWidgetDef = defineWidget({
  type: "positions-open-relative",
  hasSettings: true,
  title: "Open Positions %",
  description:
    "Public-shareable open positions with percent P&L, wallet share and age — never absolute amounts.",
  configSchema: PercentOpenPositionsConfigSchema,
  defaultConfig: PERCENT_OPEN_POSITIONS_DEFAULTS,
  component: PercentOpenPositionsWidget,
  capabilities: [...PERCENT_OPEN_POSITIONS_CAPABILITIES],
  minWidth: 360,
  minHeight: 140,
});
