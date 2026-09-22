// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
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
import { InstanceIdField } from "./shared/config";
import { ALL_INSTANCES, InstanceSelect } from "./shared/InstanceSelect";
import { queryState } from "./shared/query";
import { useOpenPositionsSource } from "./shared/sources";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const OPEN_TRADES_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.open-positions",
  "instances.positions-all",
];

export const OpenTradesConfigSchema = Schema.Struct({
  /** An instance id, or `all` for every open position in the fleet. */
  instanceId: InstanceIdField,
});
export type OpenTradesConfig = typeof OpenTradesConfigSchema.Type;

export const OPEN_TRADES_DEFAULTS: OpenTradesConfig = Schema.decodeUnknownSync(
  OpenTradesConfigSchema,
)({});

export function OpenTradesWidget({
  config,
  panelId,
}: WidgetProps<OpenTradesConfig>) {
  const cfg = config;
  const source = useOpenPositionsSource(cfg.instanceId);
  const state = queryState(source.error, source.isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<OpenTradesConfig>) =>
    applyWidgetSettings(panelId, "open-trades", cfg, p);

  const positions = source.data ?? [];
  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Open trades settings"
        widgetType="open-trades"
      >
        <InstanceSelect
          id={`open-trades-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
      </WidgetSettingsModal>
      <WidgetFrame
      title="Open Trades"
      isLoading={state.isLoading}
      error={state.error}
    >
      {positions.length > 0 ? (
        <div className="nfi-table-scroll">
          <Table size="sm" useZebraStyles={false}>
            <TableHead>
              <TableRow>
                <TableHeader>Pair</TableHeader>
                {cfg.instanceId === ALL_INSTANCES ? (
                  <TableHeader>Bot</TableHeader>
                ) : null}
                <TableHeader>Stake</TableHeader>
                <TableHeader>Open rate</TableHeader>
                <TableHeader>Profit %</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {positions.map((position) => (
                <TableRow
                  key={`${position.instanceId ?? cfg.instanceId}-${position.tradeId}`}
                >
                  <TableCell>{position.pair}</TableCell>
                  {cfg.instanceId === ALL_INSTANCES ? (
                    <TableCell>{position.instanceName ?? "—"}</TableCell>
                  ) : null}
                  <TableCell>{position.stakeAmount.toFixed(2)}</TableCell>
                  <TableCell>{position.openRate.toFixed(4)}</TableCell>
                  <TableCell>
                    <Tag
                      type={(position.profitPct ?? 0) >= 0 ? "green" : "red"}
                    >
                      {(position.profitPct ?? 0).toFixed(2)}%
                    </Tag>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title="No open trades" hint="Flat is a position too." />
      )}
    </WidgetFrame>
    </>
  );
}

export const OpenTradesWidgetDef = defineWidget({
  type: "open-trades",
  hasSettings: true,
  title: "Open Trades",
  description:
    "Live positions with entry, current rate and PnL — one instance or the fleet.",
  configSchema: OpenTradesConfigSchema,
  defaultConfig: OPEN_TRADES_DEFAULTS,
  component: OpenTradesWidget,
  capabilities: [...OPEN_TRADES_CAPABILITIES],
  minWidth: 320,
  minHeight: 140,
});
