// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Market movers — top gainers and losers from live open positions.
 *
 * Bloomberg terminals lead with movers; this widget ranks open positions by
 * PnL% so outsized winners/losers surface without opening the full table.
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
import { clampInt, fmt, pnlClass } from "./shared/format";
import { queryState, useWidgetAccess } from "./shared/query";
import { InstanceSelect } from "./shared/InstanceSelect";
import { useOpenPositionsSource } from "./shared/sources";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const MARKET_MOVERS_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.open-positions",
  "instances.positions-all",
];

export const MarketMoversConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  count: numberWithDefault(5),
});
export type MarketMoversConfig = typeof MarketMoversConfigSchema.Type;

export const MARKET_MOVERS_DEFAULTS: MarketMoversConfig =
  Schema.decodeUnknownSync(MarketMoversConfigSchema)({});

export function MarketMoversWidget({
  config,
  panelId,
}: WidgetProps<MarketMoversConfig>) {
  const cfg = config;
  const count = clampInt(cfg.count, 5, 1, 20);
  const access = useWidgetAccess(MARKET_MOVERS_CAPABILITIES);
  const { data, error, isLoading } = useOpenPositionsSource(cfg.instanceId, {
    enabled: access.allowed,
  });
  const state = queryState(error, isLoading);
  const accessError = access.allowed
    ? null
    : `Not authorized — needs ${access.missing.join(", ")}`;
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<MarketMoversConfig>) =>
    applyWidgetSettings(panelId, "market-movers", cfg, p);

  const showBot = cfg.instanceId === "all";
  const ranked = [...(data ?? [])].sort(
    (a, b) => (b.profitPct ?? 0) - (a.profitPct ?? 0),
  );
  const gainers = ranked.filter((p) => (p.profitPct ?? 0) >= 0).slice(0, count);
  const losers = [...ranked]
    .reverse()
    .filter((p) => (p.profitPct ?? 0) < 0)
    .slice(0, count);

  const section = (title: string, rows: typeof ranked) => (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
      <span
        style={{
          fontSize: "0.75rem",
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          opacity: 0.7,
        }}
      >
        {title}
      </span>
      {rows.length > 0 ? (
        <div className="nfi-table-scroll">
          <Table size="sm" useZebraStyles={false}>
            <TableHead>
              <TableRow>
                <TableHeader>Pair</TableHeader>
                {showBot ? <TableHeader>Bot</TableHeader> : null}
                <TableHeader>PnL %</TableHeader>
                <TableHeader>PnL</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((p) => (
                <TableRow
                  key={`${p.instanceId ?? cfg.instanceId}-${p.tradeId}`}
                >
                  <TableCell className="nfi-mono">{p.pair}</TableCell>
                  {showBot ? (
                    <TableCell>{p.instanceName ?? p.instanceId}</TableCell>
                  ) : null}
                  <TableCell>
                    <Tag
                      type={(p.profitPct ?? 0) >= 0 ? "green" : "red"}
                      size="sm"
                    >
                      {fmt(p.profitPct, 2)}%
                    </Tag>
                  </TableCell>
                  <TableCell className={`nfi-mono ${pnlClass(p.profitAbs)}`}>
                    {fmt(p.profitAbs, 2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title={`No ${title.toLowerCase()} yet`} />
      )}
    </div>
  );

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Market movers settings"
        widgetType="market-movers"
      >
        <InstanceSelect
          id={`movers-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <NumberInput
          id={`movers-count-${panelId}`}
          label="Rows per side"
          value={count}
          min={1}
          max={20}
          step={1}
          onChange={(_e, { value }) =>
            patch({ count: clampInt(value, 5, 1, 20) })
          }
          size="sm"
        />
      </WidgetSettingsModal>
      <WidgetFrame
      title="Market Movers"
      isLoading={state.isLoading}
      error={accessError ?? state.error}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {section("Gainers", gainers)}
        {section("Losers", losers)}
      </div>
    </WidgetFrame>
    </>
  );
}

export const MarketMoversWidgetDef = defineWidget({
  type: "market-movers",
  hasSettings: true,
  title: "Market Movers",
  description: "Top gaining and losing open positions by PnL%.",
  configSchema: MarketMoversConfigSchema,
  defaultConfig: MARKET_MOVERS_DEFAULTS,
  component: MarketMoversWidget,
  capabilities: [...MARKET_MOVERS_CAPABILITIES],
  minWidth: 320,
  minHeight: 140,
});
