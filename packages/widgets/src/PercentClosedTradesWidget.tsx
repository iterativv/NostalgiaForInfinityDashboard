// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
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
import { EmptyState, Stat, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { InstanceIdField, numberWithDefault } from "./shared/config";
import {
  clampInt,
  fmtDate,
  fmtDuration,
  fmtSigned,
  pnlClass,
} from "./shared/format";
import { InstanceSelect } from "./shared/InstanceSelect";
import { queryState } from "./shared/query";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const PERCENT_CLOSED_TRADES_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.closed-positions.relative",
];

export const PercentClosedTradesConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  limit: numberWithDefault(50),
});
export type PercentClosedTradesConfig =
  typeof PercentClosedTradesConfigSchema.Type;

export const PERCENT_CLOSED_TRADES_DEFAULTS: PercentClosedTradesConfig =
  Schema.decodeUnknownSync(PercentClosedTradesConfigSchema)({});

/**
 * Public closed-trades blotter — percent P&L per trade plus window win-rate
 * stats. Backed by `instances.closed-positions.relative`: no coin/fiat
 * amounts ever leave the backend.
 */
export function PercentClosedTradesWidget({
  config,
  panelId,
}: WidgetProps<PercentClosedTradesConfig>) {
  const cfg = config;
  const limit = clampInt(cfg.limit, 50, 10, 500);
  const { data, error, isLoading } = useCapability(
    "instances.closed-positions.relative",
    { id: cfg.instanceId, limit: String(limit) },
  );
  const state = queryState(error, isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<PercentClosedTradesConfig>) =>
    applyWidgetSettings(panelId, "closed-positions-relative", cfg, p);

  const positions = data?.positions ?? [];
  const withPnl = positions.filter(
    (p) =>
      typeof p.closeProfitPct === "number" && Number.isFinite(p.closeProfitPct),
  );
  const wins = withPnl.filter((p) => (p.closeProfitPct ?? 0) > 0).length;
  const winRate = withPnl.length > 0 ? (wins / withPnl.length) * 100 : null;
  const avgPnl =
    withPnl.length > 0
      ? withPnl.reduce((sum, p) => sum + (p.closeProfitPct ?? 0), 0) /
        withPnl.length
      : null;
  const best = withPnl.reduce(
    (max, p) => Math.max(max, p.closeProfitPct ?? 0),
    Number.NEGATIVE_INFINITY,
  );
  const worst = withPnl.reduce(
    (min, p) => Math.min(min, p.closeProfitPct ?? 0),
    Number.POSITIVE_INFINITY,
  );

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
          label="Trades shown (last N)"
          value={limit}
          min={10}
          max={500}
          step={10}
          onChange={(_e, { value }) =>
            patch({ limit: clampInt(value, 50, 10, 500) })
          }
          size="sm"
        />
      </WidgetSettingsModal>
      <WidgetFrame
      title="Closed Trades %"
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
                label="Win rate"
                value={winRate === null ? "—" : `${winRate.toFixed(1)}%`}
                sub={`${wins}/${withPnl.length} winners`}
                tone={
                  winRate === null
                    ? "neutral"
                    : winRate >= 50
                      ? "positive"
                      : "negative"
                }
              />
              <Stat
                label="Avg P&L"
                value={avgPnl === null ? "—" : `${fmtSigned(avgPnl, 2)}%`}
                sub={`window of ${positions.length} trades`}
                tone={avgPnl !== null && avgPnl >= 0 ? "positive" : "negative"}
              />
              <Stat
                label="Best / worst"
                value={
                  Number.isFinite(best) && Number.isFinite(worst)
                    ? `${fmtSigned(best, 1)} / ${fmtSigned(worst, 1)}%`
                    : "—"
                }
                sub="per-trade close %"
              />
            </div>
            <div className="nfi-table-scroll">
              <Table size="sm" useZebraStyles={false}>
                <TableHead>
                  <TableRow>
                    <TableHeader>Pair</TableHeader>
                    <TableHeader>Dir</TableHeader>
                    <TableHeader>Close %</TableHeader>
                    <TableHeader>Since open</TableHeader>
                    <TableHeader>Held</TableHeader>
                    <TableHeader>Exit</TableHeader>
                    <TableHeader>Closed</TableHeader>
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
                      <TableCell className={pnlClass(p.closeProfitPct)}>
                        {fmtSigned(p.closeProfitPct, 2)}%
                      </TableCell>
                      <TableCell className={pnlClass(p.profitPct)}>
                        {fmtSigned(p.profitPct, 2)}%
                      </TableCell>
                      <TableCell>
                        {fmtDuration(p.tradeDurationSeconds)}
                      </TableCell>
                      <TableCell>{p.exitReason ?? "—"}</TableCell>
                      <TableCell>{fmtDate(p.closeDate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <EmptyState
            title="No closed trades"
            hint="Closed trades appear here once the bot completes its first exit."
          />
        )
      ) : null}
    </WidgetFrame>
    </>
  );
}

export const PercentClosedTradesWidgetDef = defineWidget({
  type: "closed-positions-relative",
  hasSettings: true,
  title: "Closed Trades %",
  description:
    "Public-shareable closed-trade blotter with win-rate stats and percent P&L — never absolute amounts.",
  configSchema: PercentClosedTradesConfigSchema,
  defaultConfig: PERCENT_CLOSED_TRADES_DEFAULTS,
  component: PercentClosedTradesWidget,
  capabilities: [...PERCENT_CLOSED_TRADES_CAPABILITIES],
  minWidth: 360,
  minHeight: 140,
});
