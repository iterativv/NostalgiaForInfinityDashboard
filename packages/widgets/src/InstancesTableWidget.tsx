// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Table of all freqtrade connections with live status, state, strategy,
 * open count and profit per row.
 *
 * Each row owns its capability subscriptions (`useCapability` per instance
 * id), so rows stream independently and mount/unmount cleanly as the
 * instance list changes.
 */

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
import type { FreqtradeInstance } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { booleanWithDefault } from "./shared/config";
import { hostOf } from "./shared/format";
import { queryState } from "./shared/query";
import { SettingsToggle } from "./shared/SettingsToggle";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const InstancesTableConfigSchema = Schema.Struct({
  showName: booleanWithDefault(true),
  showHost: booleanWithDefault(true),
  showStatus: booleanWithDefault(true),
  showState: booleanWithDefault(true),
  showStrategy: booleanWithDefault(true),
  showOpenCount: booleanWithDefault(true),
  showClosedProfit: booleanWithDefault(true),
  showAllProfit: booleanWithDefault(true),
  showVersion: booleanWithDefault(false),
});
export type InstancesTableConfig = typeof InstancesTableConfigSchema.Type;

export const INSTANCES_TABLE_DEFAULTS: InstancesTableConfig =
  Schema.decodeUnknownSync(InstancesTableConfigSchema)({});

function InstanceTableRow({
  instance,
  cfg,
}: {
  instance: FreqtradeInstance;
  cfg: InstancesTableConfig;
}) {
  const health = useCapability("instances.health", { id: instance.id });
  const status = useCapability("instances.status", { id: instance.id });
  const profit = useCapability("instances.profit", { id: instance.id });
  const open = useCapability("instances.open-positions", { id: instance.id });
  const healthData = health.data;
  const statusData = status.data;
  const profitData = profit.data;
  const openCount = open.data?.positions.length;
  const reachable = !health.error && healthData?.reachable === true;
  return (
    <TableRow>
      {cfg.showStatus ? (
        <TableCell>
          <Tag type={reachable ? "green" : "red"}>
            {reachable ? "up" : "down"}
          </Tag>
        </TableCell>
      ) : null}
      {cfg.showName ? (
        <TableCell>
          {instance.name}
          {instance.id === "default" ? (
            <span style={{ opacity: 0.55 }}> (env)</span>
          ) : null}
        </TableCell>
      ) : null}
      {cfg.showHost ? (
        <TableCell title={instance.baseUrl}>
          {hostOf(instance.baseUrl)}
        </TableCell>
      ) : null}
      {cfg.showState ? (
        <TableCell>
          {statusData ? (
            <>
              {statusData.state}{" "}
              <Tag type={statusData.dryRun ? "blue" : "red"}>
                {statusData.dryRun ? "dry-run" : "live"}
              </Tag>
            </>
          ) : (
            "—"
          )}
        </TableCell>
      ) : null}
      {cfg.showStrategy ? (
        <TableCell>{statusData?.strategy ?? "—"}</TableCell>
      ) : null}
      {cfg.showOpenCount ? <TableCell>{openCount ?? "—"}</TableCell> : null}
      {cfg.showClosedProfit ? (
        <TableCell>
          {profitData ? (
            <Tag type={profitData.profitClosedCoin >= 0 ? "green" : "red"}>
              {profitData.profitClosedCoin.toFixed(2)}{" "}
              {profitData.stakeCurrency}
            </Tag>
          ) : (
            "—"
          )}
        </TableCell>
      ) : null}
      {cfg.showAllProfit ? (
        <TableCell>
          {profitData ? (
            <Tag type={profitData.profitAllCoin >= 0 ? "green" : "red"}>
              {profitData.profitAllCoin.toFixed(2)} {profitData.stakeCurrency}
            </Tag>
          ) : (
            "—"
          )}
        </TableCell>
      ) : null}
      {cfg.showVersion ? (
        <TableCell>{healthData?.version ?? "—"}</TableCell>
      ) : null}
    </TableRow>
  );
}

export function InstancesTableWidget({
  config,
  panelId,
}: WidgetProps<InstancesTableConfig>) {
  const cfg = config;
  const list = useCapability("instances.list", {});
  const state = queryState(list.error, list.isLoading);
  const instances = list.data?.instances ?? [];
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<InstancesTableConfig>) =>
    applyWidgetSettings(panelId, "instances-table", cfg, p);

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Instances table settings"
        widgetType="instances-table"
      >
        {(
          [
            ["showName", "Name"],
            ["showHost", "Host"],
            ["showStatus", "Status"],
            ["showState", "State"],
            ["showStrategy", "Strategy"],
            ["showOpenCount", "Open count"],
            ["showClosedProfit", "Closed profit"],
            ["showAllProfit", "All profit"],
            ["showVersion", "Version"],
          ] as const
        ).map(([key, label]) => (
          <SettingsToggle
            key={key}
            id={`it-${key}-${panelId}`}
            label={label}
            toggled={cfg[key]}
            onToggle={(v) =>
              patch({ [key]: v } as Partial<InstancesTableConfig>)
            }
          />
        ))}
      </WidgetSettingsModal>
      <WidgetFrame
      title="Connected Instances"
      isLoading={state.isLoading}
      error={state.error}
    >
      {instances.length > 0 ? (
        <div className="nfi-table-scroll">
          <Table size="sm" useZebraStyles={false}>
            <TableHead>
              <TableRow>
                {cfg.showStatus ? <TableHeader>Status</TableHeader> : null}
                {cfg.showName ? <TableHeader>Name</TableHeader> : null}
                {cfg.showHost ? <TableHeader>Host</TableHeader> : null}
                {cfg.showState ? <TableHeader>State</TableHeader> : null}
                {cfg.showStrategy ? <TableHeader>Strategy</TableHeader> : null}
                {cfg.showOpenCount ? <TableHeader>Open</TableHeader> : null}
                {cfg.showClosedProfit ? (
                  <TableHeader>Closed P&L</TableHeader>
                ) : null}
                {cfg.showAllProfit ? <TableHeader>All P&L</TableHeader> : null}
                {cfg.showVersion ? <TableHeader>Version</TableHeader> : null}
              </TableRow>
            </TableHead>
            <TableBody>
              {instances.map((instance) => (
                <InstanceTableRow
                  key={instance.id}
                  instance={instance}
                  cfg={cfg}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          title="No instances"
          hint="Add connections in the Freqtrade Instances widget."
        />
      )}
    </WidgetFrame>
    </>
  );
}

export const InstancesTableWidgetDef = defineWidget({
  type: "instances-table",
  hasSettings: true,
  title: "Connected Instances",
  description:
    "Table of all freqtrade connections with live status, strategy and profit.",
  configSchema: InstancesTableConfigSchema,
  defaultConfig: INSTANCES_TABLE_DEFAULTS,
  component: InstancesTableWidget,
  capabilities: [
    "instances.list",
    "instances.health",
    "instances.status",
    "instances.profit",
    "instances.open-positions",
  ],
  minWidth: 380,
  minHeight: 160,
});
