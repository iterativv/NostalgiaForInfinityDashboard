// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Market movers — top gainers and losers from live open positions.
 *
 * Bloomberg terminals lead with movers; this widget ranks open positions by
 * PnL% so outsized winners/losers surface without opening the full table.
 * Both rankings render through the TanStack row model (`NfiDataTable`) in
 * fixed ranked order.
 */

import { NumberInput, Tag } from "@carbon/react";
import { shallow as shallowStore } from "@tanstack/react-store";
import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import {
  EmptyState,
  NfiDataTable,
  useDerived,
  WidgetFrame,
  type NfiColumnDef,
} from "@nfi/ui";
import { applyWidgetSettings } from "./shared/panelConfig";
import { InstanceIdField, numberWithDefault } from "./shared/config";
import { clampInt, fmt, pnlClass } from "./shared/format";
import { queryState, useWidgetAccess } from "./shared/query";
import { InstanceSelect } from "./shared/InstanceSelect";
import {
  useOpenPositionsSource,
  type SourcedOpenPosition,
} from "./shared/sources";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import { type ExportColumn } from "./shared/export";
import { COL } from "./shared/columns";
import { NfiTableContainer, NfiTableToolbar } from "./shared/tableToolbar";
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

/** Column set: the Bot column appears only on fleet ("all") views. */
function buildColumns([
  showBot,
]: readonly [boolean]): NfiColumnDef<SourcedOpenPosition>[] {
  const defs: (NfiColumnDef<SourcedOpenPosition> | null)[] = [
    {
      id: "pair",
      header: COL.pair,
      cell: ({ row }) => row.original.pair,
      meta: { className: "nfi-mono" },
      enableSorting: false,
    },
    showBot
      ? {
          id: "bot",
          header: COL.bot,
          cell: ({ row }) =>
            row.original.instanceName ?? row.original.instanceId,
          enableSorting: false,
        }
      : null,
    {
      id: "profitPct",
      header: COL.profitPct,
      cell: ({ row }) => (
        <Tag
          type={(row.original.profitPct ?? 0) >= 0 ? "green" : "red"}
          size="sm"
        >
          {fmt(row.original.profitPct, 2)}%
        </Tag>
      ),
      enableSorting: false,
    },
    {
      id: "profitAbs",
      header: COL.profit,
      cell: ({ row }) => (
        <span className={`nfi-mono ${pnlClass(row.original.profitAbs)}`}>
          {fmt(row.original.profitAbs, 2)}
        </span>
      ),
      enableSorting: false,
    },
  ];

  return defs.flatMap((entry) => (entry ? [entry] : []));
}

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

  // Derived through a store: sorting + slicing on every Panel re-render
  // (resize/store ticks) stalled the main thread on large position lists.
  const { gainers, losers } = useDerived(
    [data, count] as const,
    ([positions, n]) => {
      const ranked = [...(positions ?? [])].sort(
        (a, b) => (b.profitPct ?? 0) - (a.profitPct ?? 0),
      );

      return {
        gainers: ranked.filter((p) => (p.profitPct ?? 0) >= 0).slice(0, n),
        losers: [...ranked]
          .reverse()
          .filter((p) => (p.profitPct ?? 0) < 0)
          .slice(0, n),
      };
    },
    { inputs: shallowStore },
  );

  // Column set derived through a store: rebuilt only when fleet mode changes.
  const columns = useDerived([showBot] as const, buildColumns, {
    inputs: shallowStore,
  });

  const exportColumns: ReadonlyArray<ExportColumn<SourcedOpenPosition>> = [
    { header: COL.bot, value: (p) => p.instanceName ?? p.instanceId ?? "" },
    { header: COL.pair, value: (p) => p.pair },
    { header: COL.profitPct, value: (p) => p.profitPct },
    { header: COL.profit, value: (p) => p.profitAbs },
    { header: COL.stake, value: (p) => p.stakeAmount },
    { header: COL.openDate, value: (p) => p.openDate },
  ];

  const exportRows = useDerived(
    [gainers, losers] as const,
    ([gainers, losers]) => [...gainers, ...losers],
    { inputs: shallowStore },
  );

  const section = (title: string, rows: typeof gainers) => (
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
          <NfiDataTable
            columns={columns}
            data={rows}
            getRowId={(p) => `${p.instanceId ?? cfg.instanceId}-${p.tradeId}`}
          />
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
        <NfiTableContainer>
          <NfiTableToolbar
            label="Market movers table actions"
            exportMenu={{
              filenameBase: `market-movers-${cfg.instanceId}`,
              columns: exportColumns,
              rows: exportRows,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {section("Gainers", gainers)}
            {section("Losers", losers)}
          </div>
        </NfiTableContainer>
      </WidgetFrame>
    </>
  );
}

export const MarketMoversWidgetDef = defineWidget({
  type: "market-movers",
  hasSettings: true,
  title: "Market Movers",
  description: "Top gaining and losing open positions by profit %.",
  configSchema: MarketMoversConfigSchema,
  defaultConfig: MARKET_MOVERS_DEFAULTS,
  component: MarketMoversWidget,
  capabilities: [...MARKET_MOVERS_CAPABILITIES],
  minWidth: 375,
  minHeight: 350,
  defaultWidth: 480,
  defaultHeight: 380,
});
