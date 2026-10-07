// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Pair Locks — pairs freqtrade currently refuses to trade.
 *
 * Backed by `instances.locks` (one instance) or `instances.locks-all`
 * (fleet aggregate, tagged per bot). Shows each lock's pair, side, lock
 * reason, when it was set and when it expires, plus active-vs-expired
 * counts. The table runs on the TanStack row model (`NfiDataTable`) in
 * fixed server order.
 */

import { Tag } from "@carbon/react";
import { shallow as shallowStore } from "@tanstack/react-store";
import { Schema } from "effect";
import type { Capability, PairLock, TaggedPairLock } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import {
  EmptyState,
  NfiDataTable,
  Stat,
  useDerived,
  WidgetFrame,
  type NfiColumnDef,
} from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { COL } from "./shared/columns";
import { InstanceIdField, booleanWithDefault } from "./shared/config";
import { fmtDate } from "./shared/format";
import { ALL_INSTANCES, InstanceSelect } from "./shared/InstanceSelect";
import { useTimeFormat } from "./shared/timeFormat";
import {
  InstanceTag,
  useInstanceColors,
  type InstanceColors,
} from "./shared/instanceColors";
import { queryState } from "./shared/query";
import { SettingsToggle } from "./shared/SettingsToggle";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const PAIR_LOCKS_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.locks",
  "instances.locks-all",
];

export const PairLocksConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  showExpired: booleanWithDefault(false),
});

export type PairLocksConfig = typeof PairLocksConfigSchema.Type;

export const PAIR_LOCKS_DEFAULTS: PairLocksConfig = Schema.decodeUnknownSync(
  PairLocksConfigSchema,
)({});

/** Column set: the Bot column appears only on fleet ("all") views. */
function buildColumns([
  fleet,
  colors,
]: readonly [boolean, InstanceColors]): NfiColumnDef<
  PairLock | TaggedPairLock
>[] {
  const defs: (NfiColumnDef<PairLock | TaggedPairLock> | null)[] = [
    {
      id: "pair",
      header: COL.pair,
      cell: ({ row }) => (
        <>
          {row.original.pair ?? "—"}
          {row.original.side !== undefined && row.original.side !== "" ? (
            <span style={{ opacity: 0.6 }}> {row.original.side}</span>
          ) : null}
        </>
      ),
      meta: { className: "nfi-mono", style: { textAlign: "left" } },
      enableSorting: false,
    },
    fleet
      ? {
          id: "bot",
          header: COL.bot,
          cell: ({ row }) => {
            const botId =
              "instanceId" in row.original
                ? row.original.instanceId
                : undefined;

            const botName =
              "instanceName" in row.original
                ? row.original.instanceName
                : undefined;

            return (
              <InstanceTag
                color={colors.colorOf(botId ?? botName)}
                name={botName}
              />
            );
          },
          meta: { style: { textAlign: "left" } },
          enableSorting: false,
        }
      : null,
    {
      id: "until",
      header: COL.until,
      cell: ({ row }) => fmtDate(row.original.lockEndTime),
      meta: { className: "nfi-mono", style: { textAlign: "left" } },
      enableSorting: false,
    },
    {
      id: "reason",
      header: COL.lockReason,
      cell: ({ row }) => (
        <span style={{ opacity: 0.8 }}>{row.original.reason || "—"}</span>
      ),
      meta: { style: { textAlign: "left" } },
      enableSorting: false,
    },
    {
      id: "state",
      header: COL.status,
      cell: ({ row }) => (
        <Tag type={row.original.active ? "gray" : "outline"} size="sm">
          {row.original.active ? "locked" : "expired"}
        </Tag>
      ),
      meta: { style: { textAlign: "right" } },
      enableSorting: false,
    },
  ];

  return defs.flatMap((entry) => (entry ? [entry] : []));
}

export function PairLocksWidget({
  config,
  panelId,
}: WidgetProps<PairLocksConfig>) {
  const cfg = config;
  const fleet = cfg.instanceId === ALL_INSTANCES;
  const colors = useInstanceColors();

  // Expired-vs-active is a SQL WHERE on the mirror (includeExpired).
  const includeExpired = cfg.showExpired ? "true" : undefined;

  const perInstance = useCapability(
    "instances.locks",
    { id: fleet ? "default" : cfg.instanceId, includeExpired },
    { enabled: !fleet },
  );

  const fleetView = useCapability(
    "instances.locks-all",
    { includeExpired },
    { enabled: fleet },
  );

  const data = fleet ? fleetView.data : perInstance.data;
  const error = fleet ? fleetView.error : perInstance.error;
  const isLoading = fleet ? fleetView.isLoading : perInstance.isLoading;

  const state = queryState(error, isLoading);
  const showSettings = useWidgetSettingsOpen(panelId);
  // fmtDate reads the global time-format store; this read re-renders rows
  // when the configured format changes.
  useTimeFormat();

  // Column set derived through a store: rebuilt only when fleet mode or the
  // instance colors actually change.
  const columns = useDerived([fleet, colors] as const, buildColumns, {
    inputs: shallowStore,
  });

  const patch = (p: Partial<PairLocksConfig>) =>
    applyWidgetSettings(panelId, "pair-locks", cfg, p);

  // Backend payloads vary across freqtrade versions (bare array vs
  // `{locks}`, extra fields) — the client normalizes to `{locks}`, but
  // guard the array here too so a foreign body can never throw the render.
  const locks = Array.isArray(data?.locks) ? data.locks : [];

  // Active count for the header stat: with the SQL filter active the
  // expired rows never left the database, so read the stat from an
  // active-only subscription instead of filtering in the client.
  const activePerInstance = useCapability(
    "instances.locks",
    { id: fleet ? "default" : cfg.instanceId },
    { enabled: !fleet && cfg.showExpired },
  );

  const activeFleet = useCapability(
    "instances.locks-all",
    {},
    { enabled: fleet && cfg.showExpired },
  );

  const activeSource = cfg.showExpired
    ? (fleet ? activeFleet.data : activePerInstance.data)
    : { locks };

  const active = (Array.isArray(activeSource?.locks) ? activeSource.locks : []).filter(
    (lock) => lock.active,
  ).length;

  const reasons = new Set(
    locks.map((lock) => lock.reason ?? ""),
  );

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Pair locks settings"
        widgetType="pair-locks"
      >
        <InstanceSelect
          id={`locks-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <SettingsToggle
          id={`locks-expired-${panelId}`}
          label="Show expired locks"
          toggled={cfg.showExpired}
          onToggle={(v) => patch({ showExpired: v })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
        title="Pair Locks"
        isLoading={state.isLoading}
        error={state.error}
      >
        {locks.length > 0 ? (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
          >
            <div className="nfi-stat-grid">
              <Stat
                label="Active locks"
                value={String(active)}
                sub={`${data?.countOnRecord ?? locks.length} total`}
              />
              <Stat
                label="Pairs locked"
                value={String(new Set(locks.map((l) => l.pair)).size)}
              />
              <Stat label="Reasons" value={String(reasons.size)} />
            </div>
            <div
              className="nfi-table-scroll"
              style={{ width: "100%", fontSize: "0.8125rem" }}
            >
              <NfiDataTable
                columns={columns}
                data={locks}
                getRowId={(lock, index) => {
                  const botId =
                    "instanceId" in lock ? lock.instanceId : undefined;

                  // Index suffix: freqtrade reuses small lock ids across
                  // restarts, and fleet rows from different bots can share
                  // id+pair when attribution is missing — duplicate keys
                  // collapse expansion/selection state and warn in dev.
                  return `${botId ?? cfg.instanceId}-${lock.id}-${lock.pair}-${index}`;
                }}
              />
            </div>
          </div>
        ) : (
          <EmptyState
            title={
              (data?.countOnRecord ?? 0) > 0
                ? "No active locks"
                : "No pair locks"
            }
            hint={
              (data?.countOnRecord ?? 0) > 0
                ? `${data?.countOnRecord ?? 0} locks on record ${fleet ? "across the fleet" : `on “${cfg.instanceId}”`} — enable “Show expired locks” in Settings to review them.`
                : `Nothing is paused right now — that is the normal state. Freqtrade locks a pair only while a protection (cooldown, max drawdown, …) pauses it, and each lock clears automatically at its expiry. Showing ${fleet ? "the whole fleet" : `“${cfg.instanceId}”`}; switch instances in Settings if you expected locks elsewhere.`
            }
          />
        )}
      </WidgetFrame>
    </>
  );
}

export const PairLocksWidgetDef = defineWidget({
  type: "pair-locks",
  hasSettings: true,
  title: "Pair Locks",
  description:
    "Pairs freqtrade has temporarily paused. A lock appears only while a protection (cooldown, max drawdown, …) holds the pair, with the reason and when it clears — an empty list simply means nothing is paused right now.",
  configSchema: PairLocksConfigSchema,
  defaultConfig: PAIR_LOCKS_DEFAULTS,
  component: PairLocksWidget,
  capabilities: [...PAIR_LOCKS_CAPABILITIES],
  minWidth: 551,
  minHeight: 208,
  defaultWidth: 560,
  defaultHeight: 320,
});
