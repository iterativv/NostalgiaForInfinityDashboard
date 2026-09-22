// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Closed positions with exit data and expandable sub-orders — one instance or
 * the fleet (rows attributed per bot in fleet mode).
 * Extends the open-positions config schema instead of restating its fields.
 */

import { Fragment } from "react";
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
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, PnlPill, WidgetFrame } from "@nfi/ui";
import { applyWidgetSettings } from "./shared/panelConfig";
import { booleanWithDefault, numberWithDefault } from "./shared/config";
import { clampInt, fmt, fmtDate, pnlClass } from "./shared/format";
import { queryState } from "./shared/query";
import { InstanceSelect } from "./shared/InstanceSelect";
import { OrderLines } from "./shared/OrderLines";
import { SettingsToggle } from "./shared/SettingsToggle";
import { useClosedPositionsSource } from "./shared/sources";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";
import { OpenPositionsConfigSchema } from "./OpenPositionsWidget";

export const ClosedPositionsConfigSchema = Schema.Struct({
  ...OpenPositionsConfigSchema.fields,
  limit: numberWithDefault(50),
  showCloseRate: booleanWithDefault(true),
  showCloseProfit: booleanWithDefault(true),
  showExitReason: booleanWithDefault(true),
  showCloseDate: booleanWithDefault(true),
  showDuration: booleanWithDefault(false),
});
export type ClosedPositionsConfig = typeof ClosedPositionsConfigSchema.Type;

export const CLOSED_POSITIONS_DEFAULTS: ClosedPositionsConfig =
  Schema.decodeUnknownSync(ClosedPositionsConfigSchema)({});

export function ClosedPositionsWidget({
  config,
  panelId,
}: WidgetProps<ClosedPositionsConfig>) {
  const cfg = config;
  const maxVisible = clampInt(cfg.maxVisibleOrders, 4, 0, 10);
  const limit = clampInt(cfg.limit, 50, 1, 500);
  const src = useClosedPositionsSource(cfg.instanceId, limit);
  const state = queryState(src.error, src.isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<ClosedPositionsConfig>) =>
    applyWidgetSettings(panelId, "closed-positions", cfg, p);

  const positions = src.data ?? [];
  /** Bot attribution column: explicit toggle, or implied by fleet mode. */
  const showBotColumn = cfg.showBot || cfg.instanceId === "all";
  const colCount =
    (showBotColumn ? 1 : 0) +
    (cfg.showPair ? 1 : 0) +
    (cfg.showDirection ? 1 : 0) +
    (cfg.showStake ? 1 : 0) +
    (cfg.showOpenRate ? 1 : 0) +
    (cfg.showCloseRate ? 1 : 0) +
    (cfg.showCloseProfit ? 1 : 0) +
    (cfg.showProfitPct ? 1 : 0) +
    (cfg.showExitReason ? 1 : 0) +
    (cfg.showCloseDate ? 1 : 0) +
    (cfg.showDuration ? 1 : 0) +
    (cfg.showStrategy ? 1 : 0);

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
          label="Closed trades fetched"
          value={limit}
          min={1}
          max={500}
          step={1}
          onChange={(_e, { value }) =>
            patch({ limit: clampInt(value, 50, 1, 500) })
          }
          size="sm"
        />
        <NumberInput
          id={`cpos-max-${panelId}`}
          label="Sub-orders shown (last N)"
          value={maxVisible}
          min={0}
          max={10}
          step={1}
          onChange={(_e, { value }) =>
            patch({ maxVisibleOrders: clampInt(value, 4, 0, 10) })
          }
          size="sm"
        />
        <SettingsToggle
          id={`cpos-hidden-${panelId}`}
          label="Hidden-count row"
          toggled={cfg.showHiddenCountRow}
          onToggle={(v) => patch({ showHiddenCountRow: v })}
        />
        <SettingsToggle
          id={`cpos-header-${panelId}`}
          label="Order section header"
          toggled={cfg.showOrderHeaderRow}
          onToggle={(v) => patch({ showOrderHeaderRow: v })}
        />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0 0.75rem",
          }}
        >
          {(
            [
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
              ["showOrderSide", "Order side"],
              ["showOrderPrice", "Order price"],
              ["showOrderAmount", "Order amount"],
              ["showOrderCost", "Order cost"],
              ["showOrderTag", "Order tag"],
              ["showOrderDate", "Order date"],
            ] as const
          ).map(([key, label]) => (
            <SettingsToggle
              key={key}
              id={`cpos-${key}-${panelId}`}
              label={label}
              toggled={cfg[key]}
              onToggle={(v) =>
                patch({ [key]: v } as Partial<ClosedPositionsConfig>)
              }
            />
          ))}
        </div>
      </WidgetSettingsModal>
      <WidgetFrame
      title="Closed Positions"
      isLoading={state.isLoading}
      error={state.error}
    >
      {positions.length > 0 ? (
        <div className="nfi-table-scroll">
          <Table size="sm" useZebraStyles={false}>
            <TableHead>
              <TableRow>
                {showBotColumn ? <TableHeader>Bot</TableHeader> : null}
                {cfg.showPair ? <TableHeader>Pair</TableHeader> : null}
                {cfg.showDirection ? <TableHeader>Dir</TableHeader> : null}
                {cfg.showStake ? <TableHeader>Stake</TableHeader> : null}
                {cfg.showOpenRate ? <TableHeader>Open</TableHeader> : null}
                {cfg.showCloseRate ? <TableHeader>Close</TableHeader> : null}
                {cfg.showCloseProfit ? <TableHeader>PnL</TableHeader> : null}
                {cfg.showProfitPct ? <TableHeader>PnL %</TableHeader> : null}
                {cfg.showExitReason ? (
                  <TableHeader>Exit reason</TableHeader>
                ) : null}
                {cfg.showCloseDate ? <TableHeader>Closed</TableHeader> : null}
                {cfg.showDuration ? <TableHeader>Duration</TableHeader> : null}
                {cfg.showStrategy ? <TableHeader>Strategy</TableHeader> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {positions.map((p) => {
                const orders = p.orders ?? [];
                const profitAbs = p.closeProfitAbs ?? p.profitAbs;
                const profitPct = p.closeProfitPct ?? p.profitPct;
                return (
                  <Fragment
                    key={`${p.instanceId ?? cfg.instanceId}-${p.tradeId}`}
                  >
                    <TableRow>
                      {showBotColumn ? (
                        <TableCell>{p.instanceName ?? "—"}</TableCell>
                      ) : null}
                      {cfg.showPair ? <TableCell>{p.pair}</TableCell> : null}
                      {cfg.showDirection ? (
                        <TableCell>
                          <Tag type={p.isShort ? "red" : "green"}>
                            {p.isShort ? "SHORT" : "LONG"}
                          </Tag>
                        </TableCell>
                      ) : null}
                      {cfg.showStake ? (
                        <TableCell>{p.stakeAmount.toFixed(2)}</TableCell>
                      ) : null}
                      {cfg.showOpenRate ? (
                        <TableCell>{fmt(p.openRate, 4)}</TableCell>
                      ) : null}
                      {cfg.showCloseRate ? (
                        <TableCell>{fmt(p.closeRate, 4)}</TableCell>
                      ) : null}
                      {cfg.showCloseProfit ? (
                        <TableCell>
                          <span className={pnlClass(profitAbs)}>
                            {fmt(profitAbs, 2)}
                          </span>
                        </TableCell>
                      ) : null}
                      {cfg.showProfitPct ? (
                        <TableCell>
                          <PnlPill
                            value={profitPct}
                            percent={profitPct}
                            absolute={profitAbs}
                          />
                        </TableCell>
                      ) : null}
                      {cfg.showExitReason ? (
                        <TableCell>{p.exitReason || "—"}</TableCell>
                      ) : null}
                      {cfg.showCloseDate ? (
                        <TableCell>{fmtDate(p.closeDate)}</TableCell>
                      ) : null}
                      {cfg.showDuration ? (
                        <TableCell>
                          {p.tradeDurationSeconds !== undefined
                            ? `${Math.round(p.tradeDurationSeconds / 60)}m`
                            : "—"}
                        </TableCell>
                      ) : null}
                      {cfg.showStrategy ? (
                        <TableCell>{p.strategy ?? "—"}</TableCell>
                      ) : null}
                    </TableRow>
                    <TableRow>
                      <TableCell
                        colSpan={Math.max(1, colCount)}
                        style={{ background: "var(--cds-layer-01)" }}
                      >
                        <OrderLines
                          orders={orders}
                          total={orders.length}
                          maxVisible={maxVisible}
                          showHiddenCountRow={cfg.showHiddenCountRow}
                          showOrderHeaderRow={cfg.showOrderHeaderRow}
                          show={cfg}
                        />
                      </TableCell>
                    </TableRow>
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
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
  minWidth: 330,
  minHeight: 140,
});
