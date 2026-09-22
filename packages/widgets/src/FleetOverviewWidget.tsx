// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Fleet Overview — every configured freqtrade instance on one screen.
 *
 * Backed by `instances.overview`: one server-side fan-out per instance
 * (health, status, capacity, profit, balance) with per-instance error
 * tolerance — one unreachable bot becomes an error row, never a failed
 * widget. Totals bar summarizes the whole fleet.
 */

import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, ModeBadge, PnlPill, Stat, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { booleanWithDefault } from "./shared/config";
import { fmt, pnlTone } from "./shared/format";
import { queryState } from "./shared/query";

export const FLEET_OVERVIEW_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.overview",
];

export const FleetOverviewConfigSchema = Schema.Struct({
  showVersion: booleanWithDefault(false),
  showBalance: booleanWithDefault(true),
});
export type FleetOverviewConfig = typeof FleetOverviewConfigSchema.Type;

export const FLEET_OVERVIEW_DEFAULTS: FleetOverviewConfig =
  Schema.decodeUnknownSync(FleetOverviewConfigSchema)({});

export function FleetOverviewWidget({
  config,
}: WidgetProps<FleetOverviewConfig>) {
  const cfg = config;
  const { data, error, isLoading } = useCapability("instances.overview", {});
  const state = queryState(error, isLoading);
  const stake = data?.totals.stakeCurrency;

  return (
    <WidgetFrame
      title="Fleet Overview"
      isLoading={state.isLoading}
      error={state.error}
    >
      {data && data.instances.length > 0 ? (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
        >
          <div className="nfi-stat-grid">
            <Stat
              label="Instances"
              value={`${data.totals.reachableCount}/${data.totals.instanceCount}`}
              sub="reachable"
            />
            <Stat label="Open trades" value={String(data.totals.openCount)} />
            <Stat
              label="Open profit"
              value={`${fmt(data.totals.openProfitCoin, 2)}${stake ? ` ${stake}` : ""}`}
              tone={pnlTone(data.totals.openProfitCoin)}
            />
            <Stat
              label="Closed profit"
              value={`${fmt(data.totals.profitClosedCoin, 2)}${stake ? ` ${stake}` : ""}`}
              tone={pnlTone(data.totals.profitClosedCoin)}
            />
            <Stat
              label="W/L"
              value={`${fmt(data.totals.wins, 0)} / ${fmt(data.totals.losses, 0)}`}
            />
            {cfg.showBalance ? (
              <Stat
                label="Fleet wallet"
                value={`${fmt(data.totals.totalStake, 2)}${stake ? ` ${stake}` : ""}`}
              />
            ) : null}
          </div>
          <div className="nfi-table-scroll">
            <table style={{ width: "100%", fontSize: "0.8125rem" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Bot Name</th>
                  <th style={{ textAlign: "right" }}>Trades</th>
                  <th style={{ textAlign: "right" }}>Open Profit</th>
                  <th style={{ textAlign: "right" }}>Closed Profit</th>
                  {cfg.showBalance ? (
                    <th style={{ textAlign: "right" }}>Balance</th>
                  ) : null}
                  <th style={{ textAlign: "right" }}>W/L</th>
                  {cfg.showVersion ? (
                    <th style={{ textAlign: "right" }}>Ver</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {data.instances.map((row) => (
                  <tr key={row.id}>
                    <td className="nfi-mono">
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.375rem",
                          minWidth: 0,
                        }}
                      >
                        <ModeBadge dryRun={row.dryRun} />
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            color:
                              row.error === undefined && row.state !== "running"
                                ? "var(--cds-text-secondary)"
                                : undefined,
                          }}
                        >
                          {row.error !== undefined ? (
                            <span title={row.error}>{row.name} · down</span>
                          ) : (
                            row.name
                          )}
                        </span>
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }} className="nfi-mono">
                      {row.error !== undefined
                        ? "—"
                        : `${row.openCount ?? 0} / ${row.maxOpenTrades ?? "—"}`}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {row.error !== undefined ? (
                        "—"
                      ) : row.openProfitCoin !== undefined ? (
                        <PnlPill
                          value={row.openProfitCoin}
                          absolute={row.openProfitCoin}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {row.error !== undefined ? (
                        "—"
                      ) : row.profitClosedPercent !== undefined ? (
                        <PnlPill
                          value={row.profitClosedPercent}
                          percent={row.profitClosedPercent}
                          absolute={row.profitClosedCoin}
                        />
                      ) : row.profitClosedCoin !== undefined ? (
                        <PnlPill
                          value={row.profitClosedCoin}
                          absolute={row.profitClosedCoin}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    {cfg.showBalance ? (
                      <td style={{ textAlign: "right" }} className="nfi-mono">
                        {row.totalStake !== undefined
                          ? `${fmt(row.totalStake, 2)}${row.stakeCurrency ? ` ${row.stakeCurrency}` : ""}`
                          : "—"}
                      </td>
                    ) : null}
                    <td style={{ textAlign: "right" }} className="nfi-mono">
                      <span className="nfi-pnl-positive">{row.wins ?? 0}</span>
                      {" / "}
                      <span className="nfi-pnl-negative">{row.losses ?? 0}</span>
                    </td>
                    {cfg.showVersion ? (
                      <td style={{ textAlign: "right" }} className="nfi-mono">
                        {row.version ?? "—"}
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
          title="No instances"
          hint="Connect freqtrade instances on the System page → Freqtrade Instances."
        />
      )}
    </WidgetFrame>
  );
}

export const FleetOverviewWidgetDef = defineWidget({
  type: "fleet-overview",
  hasSettings: false,
  title: "Bot Comparison",
  description:
    "Trades, open/closed profit, balance and W/L for every configured instance in one table.",
  configSchema: FleetOverviewConfigSchema,
  defaultConfig: FLEET_OVERVIEW_DEFAULTS,
  component: FleetOverviewWidget,
  capabilities: [...FLEET_OVERVIEW_CAPABILITIES],
  minWidth: 380,
  minHeight: 160,
});
