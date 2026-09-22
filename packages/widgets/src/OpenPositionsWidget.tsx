// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Open positions with expandable sub-orders — one instance or the fleet.
 *
 * The config schema carries decoding defaults for every field, so the
 * component receives a fully-resolved config straight from `decodeConfig` —
 * no manual merging of `Partial` payloads. Fleet mode (`instanceId === "all"`)
 * subscribes to the fleet aggregate and attributes rows per bot; the health
 * badge only applies per instance.
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
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import {
  InstanceIdField,
  booleanWithDefault,
  numberWithDefault,
} from "./shared/config";
import { clampInt, fmt, pnlClass } from "./shared/format";
import { queryState } from "./shared/query";
import { InstanceSelect } from "./shared/InstanceSelect";
import { OrderLines } from "./shared/OrderLines";
import { SettingsToggle } from "./shared/SettingsToggle";
import { useOpenPositionsSource } from "./shared/sources";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const OpenPositionsConfigSchema = Schema.Struct({
  /** An instance id, or `all` for every instance's positions (fleet). */
  instanceId: InstanceIdField,
  maxVisibleOrders: numberWithDefault(4),
  showHiddenCountRow: booleanWithDefault(true),
  showOrderHeaderRow: booleanWithDefault(true),
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
  showOrderSide: booleanWithDefault(true),
  showOrderPrice: booleanWithDefault(false),
  showOrderAmount: booleanWithDefault(false),
  showOrderCost: booleanWithDefault(false),
  showOrderTag: booleanWithDefault(false),
  showOrderDate: booleanWithDefault(false),
});
export type OpenPositionsConfig = typeof OpenPositionsConfigSchema.Type;

export const OPEN_POSITIONS_DEFAULTS: OpenPositionsConfig =
  Schema.decodeUnknownSync(OpenPositionsConfigSchema)({});

export function OpenPositionsWidget({
  config,
  panelId,
}: WidgetProps<OpenPositionsConfig>) {
  const cfg = config;
  const maxVisible = clampInt(cfg.maxVisibleOrders, 4, 0, 10);
  const src = useOpenPositionsSource(cfg.instanceId);
  const health = useCapability(
    "instances.health",
    { id: cfg.instanceId },
    { enabled: cfg.instanceId !== "all" },
  );
  const state = queryState(src.error, src.isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<OpenPositionsConfig>) =>
    applyWidgetSettings(panelId, "open-positions", cfg, p);

  const positions = src.data ?? [];
  /** Bot attribution column: explicit toggle, or implied by fleet mode. */
  const showBotColumn = cfg.showBot || cfg.instanceId === "all";
  const colCount =
    (showBotColumn ? 1 : 0) +
    (cfg.showPair ? 1 : 0) +
    (cfg.showDirection ? 1 : 0) +
    (cfg.showLeverage ? 1 : 0) +
    (cfg.showAmount ? 1 : 0) +
    (cfg.showStake ? 1 : 0) +
    (cfg.showOpenRate ? 1 : 0) +
    (cfg.showCurrentRate ? 1 : 0) +
    (cfg.showProfitAbs ? 1 : 0) +
    (cfg.showProfitPct ? 1 : 0) +
    (cfg.showEnterTag ? 1 : 0) +
    (cfg.showStrategy ? 1 : 0);

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
          id={`pos-hidden-${panelId}`}
          label="Hidden-count row"
          toggled={cfg.showHiddenCountRow}
          onToggle={(v) => patch({ showHiddenCountRow: v })}
        />
        <SettingsToggle
          id={`pos-header-${panelId}`}
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
              ["showLeverage", "Leverage"],
              ["showAmount", "Amount"],
              ["showStake", "Stake"],
              ["showOpenRate", "Open rate"],
              ["showCurrentRate", "Current rate"],
              ["showProfitAbs", "Profit abs"],
              ["showProfitPct", "Profit %"],
              ["showEnterTag", "Enter tag"],
              ["showStrategy", "Strategy"],
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
              id={`pos-${key}-${panelId}`}
              label={label}
              toggled={cfg[key]}
              onToggle={(v) =>
                patch({ [key]: v } as Partial<OpenPositionsConfig>)
              }
            />
          ))}
        </div>
      </WidgetSettingsModal>
      <WidgetFrame
      title={`Open Positions${health.data?.state ? ` · ${health.data.state}` : ""}`}
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
                {cfg.showLeverage ? <TableHeader>Lev</TableHeader> : null}
                {cfg.showAmount ? <TableHeader>Amount</TableHeader> : null}
                {cfg.showStake ? <TableHeader>Stake</TableHeader> : null}
                {cfg.showOpenRate ? <TableHeader>Open</TableHeader> : null}
                {cfg.showCurrentRate ? (
                  <TableHeader>Current</TableHeader>
                ) : null}
                {cfg.showProfitAbs ? <TableHeader>PnL</TableHeader> : null}
                {cfg.showProfitPct ? <TableHeader>PnL %</TableHeader> : null}
                {cfg.showEnterTag ? <TableHeader>Tag</TableHeader> : null}
                {cfg.showStrategy ? <TableHeader>Strategy</TableHeader> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {positions.map((p) => {
                const orders = p.orders ?? [];
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
                      {cfg.showLeverage ? (
                        <TableCell>
                          {p.leverage !== undefined ? `${p.leverage}x` : "—"}
                        </TableCell>
                      ) : null}
                      {cfg.showAmount ? (
                        <TableCell>{p.amount}</TableCell>
                      ) : null}
                      {cfg.showStake ? (
                        <TableCell>{p.stakeAmount.toFixed(2)}</TableCell>
                      ) : null}
                      {cfg.showOpenRate ? (
                        <TableCell>{fmt(p.openRate, 4)}</TableCell>
                      ) : null}
                      {cfg.showCurrentRate ? (
                        <TableCell>{fmt(p.currentRate, 4)}</TableCell>
                      ) : null}
                      {cfg.showProfitAbs ? (
                        <TableCell>
                          <span className={pnlClass(p.profitAbs)}>
                            {fmt(p.profitAbs, 2)}
                          </span>
                        </TableCell>
                      ) : null}
                      {cfg.showProfitPct ? (
                        <TableCell>
                          <PnlPill
                            value={p.profitPct}
                            percent={p.profitPct}
                            absolute={p.profitAbs}
                          />
                        </TableCell>
                      ) : null}
                      {cfg.showEnterTag ? (
                        <TableCell>{p.enterTag?.trim() || "—"}</TableCell>
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
    "Open positions with expandable sub-orders (last N + hidden count) — one instance or the fleet.",
  configSchema: OpenPositionsConfigSchema,
  defaultConfig: OPEN_POSITIONS_DEFAULTS,
  component: OpenPositionsWidget,
  capabilities: [
    "instances.open-positions",
    "instances.health",
    "instances.positions-all",
  ],
  minWidth: 330,
  minHeight: 140,
});
