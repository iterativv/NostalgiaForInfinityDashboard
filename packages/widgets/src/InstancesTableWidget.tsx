// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Table of all freqtrade connections with live status, state, strategy,
 * open count and profit per row.
 *
 * The table runs on the TanStack row model (`NfiDataTable`) with a
 * config-driven column set; each live cell owns its capability
 * subscription (`useCapability` per instance id), so cells stream
 * independently and mount/unmount cleanly as the instance list or column
 * set changes.
 */

import { Tag } from "@carbon/react";
import { shallow as shallowStore } from "@tanstack/react-store";
import { Schema } from "effect";
import type { FreqtradeInstance } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import {
  EmptyState,
  NfiDataTable,
  useDerived,
  WidgetFrame,
  type NfiColumnDef,
} from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { booleanWithDefault } from "./shared/config";
import { hostOf } from "./shared/format";
import { InstanceDot, useInstanceColors } from "./shared/instanceColors";
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

/** Up/down badge — one `instances.health` subscription per rendered cell. */
function StatusTag({ instance }: { instance: FreqtradeInstance }) {
  const health = useCapability("instances.health", { id: instance.id });
  const reachable = !health.error && health.data?.reachable === true;

  return (
    <Tag type={reachable ? "green" : "red"}>{reachable ? "up" : "down"}</Tag>
  );
}

/** Instance name with its fleet color dot and the "(env)" default marker. */
function InstanceNameCell({ instance }: { instance: FreqtradeInstance }) {
  const { colorOf } = useInstanceColors();
  const color = colorOf(instance.id);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
      }}
    >
      {color ? <InstanceDot color={color} title={instance.name} /> : null}
      <span>
        {instance.name}
        {instance.id === "default" ? (
          <span style={{ opacity: 0.55 }}> (env)</span>
        ) : null}
      </span>
    </span>
  );
}

/** Bot state + dry-run/live tag — `instances.status` per rendered cell. */
function InstanceStateCell({ instance }: { instance: FreqtradeInstance }) {
  const status = useCapability("instances.status", { id: instance.id });
  const statusData = status.data;

  return statusData ? (
    <>
      {statusData.state}{" "}
      <Tag type={statusData.dryRun ? "blue" : "red"}>
        {statusData.dryRun ? "dry-run" : "live"}
      </Tag>
    </>
  ) : (
    "—"
  );
}

/** Strategy name — shares the `instances.status` key with the state cell. */
function InstanceStrategyCell({ instance }: { instance: FreqtradeInstance }) {
  const status = useCapability("instances.status", { id: instance.id });

  return status.data?.strategy ?? "—";
}

/** Open-trade count — `instances.open-positions` per rendered cell. */
function OpenCountCell({ instance }: { instance: FreqtradeInstance }) {
  const open = useCapability("instances.open-positions", { id: instance.id });

  return open.data?.positions.length ?? "—";
}

/** Closed/all profit tag — `instances.profit` per rendered cell. */
function ProfitTag({
  instance,
  kind,
}: {
  instance: FreqtradeInstance;
  kind: "closed" | "all";
}) {
  const profit = useCapability("instances.profit", { id: instance.id });
  const profitData = profit.data;

  if (profitData === undefined) {
    return "—";
  }

  return kind === "closed" ? (
    <Tag type={profitData.profitClosedCoin >= 0 ? "green" : "red"}>
      {profitData.profitClosedCoin.toFixed(2)}{" "}
      {profitData.stakeCurrency}
    </Tag>
  ) : (
    <Tag type={profitData.profitAllCoin >= 0 ? "green" : "red"}>
      {profitData.profitAllCoin.toFixed(2)} {profitData.stakeCurrency}
    </Tag>
  );
}

/** Bot version — shares the `instances.health` key with the status cell. */
function VersionCell({ instance }: { instance: FreqtradeInstance }) {
  const health = useCapability("instances.health", { id: instance.id });

  return health.data?.version ?? "—";
}

/** Column set depends on the config's show* flags. */
function buildColumns([
  cfg,
]: readonly [InstancesTableConfig]): NfiColumnDef<FreqtradeInstance>[] {
  const defs: (NfiColumnDef<FreqtradeInstance> | null)[] = [
    cfg.showStatus
      ? {
          id: "status",
          header: "Status",
          cell: ({ row }) => <StatusTag instance={row.original} />,
          enableSorting: false,
        }
      : null,
    cfg.showName
      ? {
          id: "name",
          header: "Name",
          cell: ({ row }) => <InstanceNameCell instance={row.original} />,
          enableSorting: false,
        }
      : null,
    cfg.showHost
      ? {
          id: "host",
          header: "Host",
          cell: ({ row }) => (
            <span title={row.original.baseUrl}>
              {hostOf(row.original.baseUrl)}
            </span>
          ),
          enableSorting: false,
        }
      : null,
    cfg.showState
      ? {
          id: "state",
          header: "State",
          cell: ({ row }) => <InstanceStateCell instance={row.original} />,
          enableSorting: false,
        }
      : null,
    cfg.showStrategy
      ? {
          id: "strategy",
          header: "Strategy",
          cell: ({ row }) => <InstanceStrategyCell instance={row.original} />,
          enableSorting: false,
        }
      : null,
    cfg.showOpenCount
      ? {
          id: "openCount",
          header: "Open",
          cell: ({ row }) => <OpenCountCell instance={row.original} />,
          enableSorting: false,
        }
      : null,
    cfg.showClosedProfit
      ? {
          id: "closedProfit",
          header: "Closed P&L",
          cell: ({ row }) => (
            <ProfitTag instance={row.original} kind="closed" />
          ),
          enableSorting: false,
        }
      : null,
    cfg.showAllProfit
      ? {
          id: "allProfit",
          header: "All P&L",
          cell: ({ row }) => <ProfitTag instance={row.original} kind="all" />,
          enableSorting: false,
        }
      : null,
    cfg.showVersion
      ? {
          id: "version",
          header: "Version",
          cell: ({ row }) => <VersionCell instance={row.original} />,
          enableSorting: false,
        }
      : null,
  ];

  return defs.flatMap((entry) => (entry ? [entry] : []));
}

const EMPTY_INSTANCES: ReadonlyArray<FreqtradeInstance> = [];

export function InstancesTableWidget({
  config,
  panelId,
}: WidgetProps<InstancesTableConfig>) {
  const cfg = config;
  const list = useCapability("instances.list", {});
  const state = queryState(list.error, list.isLoading);
  const instances = list.data?.instances ?? EMPTY_INSTANCES;
  const showSettings = useWidgetSettingsOpen(panelId);

  // Column set derived through a store: rebuilt only when the widget config
  // actually changes.
  const columns = useDerived([cfg] as const, buildColumns, {
    inputs: shallowStore,
  });

  const patch = (p: Partial<InstancesTableConfig>) =>
    applyWidgetSettings(panelId, "instances-table", cfg, p);

  const patchFlag = (key: keyof InstancesTableConfig, v: boolean): void => {
    // SAFETY: `key` iterates the boolean settings keys rendered in this
    // modal, so the computed entry is a valid Partial (TS cannot express a
    // computed partial from a union key).
    patch({ [key]: v } as Partial<InstancesTableConfig>);
  };

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
            onToggle={(v) => patchFlag(key, v)}
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
            <NfiDataTable
              columns={columns}
              data={instances}
              getRowId={(instance) => instance.id}
            />
          </div>
        ) : (
          <EmptyState
            title="No instances"
            hint="Add connections via the aside → Manage freqtrade instances."
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
  minWidth: 1120,
  minHeight: 250,
  defaultWidth: 960,
  defaultHeight: 480,
});
