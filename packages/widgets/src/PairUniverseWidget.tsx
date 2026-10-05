// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Pair Universe — what the strategy may and may not trade.
 *
 * Backed by `instances.whitelist` + `instances.blacklist` (one instance)
 * or `instances.whitelist-all` + `instances.blacklist-all` (fleet
 * aggregate): the analyzed whitelist (with a quick filter) beside the
 * blacklist with per-entry reasons, plus counts up top. The classic
 * freqtrade pairs view.
 */

import { Search, Tag } from "@carbon/react";
import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import {
  EmptyState,
  shallow,
  Stat,
  useDebouncedValue,
  useDerived,
  useLocalStore,
  useStore,
  WidgetFrame,
} from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { InstanceIdField, booleanWithDefault } from "./shared/config";
import { ALL_INSTANCES, InstanceSelect } from "./shared/InstanceSelect";
import { InstanceTag, useInstanceColors } from "./shared/instanceColors";
import { queryState } from "./shared/query";
import { SettingsToggle } from "./shared/SettingsToggle";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const PAIR_UNIVERSE_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.whitelist",
  "instances.blacklist",
  "instances.whitelist-all",
  "instances.blacklist-all",
];

export const PairUniverseConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  showBlacklist: booleanWithDefault(true),
});

export type PairUniverseConfig = typeof PairUniverseConfigSchema.Type;

export const PAIR_UNIVERSE_DEFAULTS: PairUniverseConfig =
  Schema.decodeUnknownSync(PairUniverseConfigSchema)({});

export function PairUniverseWidget({
  config,
  panelId,
}: WidgetProps<PairUniverseConfig>) {
  const cfg = config;
  const fleet = cfg.instanceId === ALL_INSTANCES;
  const colors = useInstanceColors();
  const filterStore = useLocalStore("");
  const filter = useStore(filterStore, (s) => s);
  // Debounced: the search text is part of the stream subscription key, so
  // the server only re-queries after the user pauses typing.
  const debouncedSearch = useDebouncedValue(filter, 400);

  const search =
    debouncedSearch.trim().length > 0 ? debouncedSearch.trim() : undefined;

  const whitelistQ = useCapability(
    "instances.whitelist",
    { id: fleet ? "default" : cfg.instanceId, search },
    { enabled: !fleet },
  );

  const blacklistQ = useCapability(
    "instances.blacklist",
    { id: fleet ? "default" : cfg.instanceId, search },
    { enabled: !fleet },
  );

  const whitelistAllQ = useCapability(
    "instances.whitelist-all",
    { search },
    { enabled: fleet },
  );

  const blacklistAllQ = useCapability(
    "instances.blacklist-all",
    { search },
    { enabled: fleet },
  );

  const state = queryState(
    fleet
      ? (whitelistAllQ.error ?? blacklistAllQ.error)
      : (whitelistQ.error ?? blacklistQ.error),
    fleet
      ? whitelistAllQ.isLoading || blacklistAllQ.isLoading
      : whitelistQ.isLoading || blacklistQ.isLoading,
  );

  const showSettings = useWidgetSettingsOpen(panelId);

  const patch = (p: Partial<PairUniverseConfig>) =>
    applyWidgetSettings(panelId, "pair-universe", cfg, p);

  // Server already filtered; `length` fields stay unfiltered totals from
  // freqtrade, so the counts below describe the whole universe.
  // Stable identities through the derived stores: `?? []` would mint a
  // fresh (never-equal) array on every query refetch/render and defeat
  // downstream derivations.
  const whitelist = useDerived(
    [fleet, whitelistAllQ.data, whitelistQ.data] as const,
    ([fleet, all, one]) => (fleet ? (all?.pairs ?? []) : (one?.pairs ?? [])),
    { inputs: shallow },
  );

  const blacklist = useDerived(
    [fleet, blacklistAllQ.data, blacklistQ.data] as const,
    ([fleet, all, one]) => (fleet ? (all?.pairs ?? []) : (one?.pairs ?? [])),
    { inputs: shallow },
  );

  const whitelistInstances = useDerived(
    whitelistAllQ.data,
    (data) => data?.instances ?? [],
  );

  const whitelistTotal = fleet
    ? whitelistInstances.reduce((sum, row) => sum + (row.length ?? 0), 0)
    : (whitelistQ.data?.length ?? whitelist.length);

  const blacklistCount = fleet
    ? (blacklistAllQ.data?.length ?? blacklist.length)
    : (blacklistQ.data?.length ?? blacklist.length);

  const hasData = fleet
    ? whitelistAllQ.data !== undefined || blacklistAllQ.data !== undefined
    : whitelistQ.data !== undefined || blacklistQ.data !== undefined;

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Pair universe settings"
        widgetType="pair-universe"
      >
        <InstanceSelect
          id={`universe-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <SettingsToggle
          id={`universe-blacklist-${panelId}`}
          label="Show blacklist"
          toggled={cfg.showBlacklist}
          onToggle={(v) => patch({ showBlacklist: v })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
        title="Pair Universe"
        isLoading={state.isLoading}
        error={state.error}
      >
        {hasData ? (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
          >
            <div className="nfi-stat-grid">
              <Stat
                label="Whitelist"
                value={String(whitelist.length)}
                sub={
                  fleet
                    ? `union across ${whitelistInstances.length} bots`
                    : "analyzed pairs"
                }
              />
              {cfg.showBlacklist ? (
                <Stat
                  label="Blacklist"
                  value={String(blacklistCount)}
                  sub="blocked pairs"
                />
              ) : null}
              {search !== undefined ? (
                <Stat
                  label="Filter matches"
                  value={
                    fleet
                      ? `${whitelist.length} pairs`
                      : `${whitelist.length}/${whitelistTotal}`
                  }
                />
              ) : null}
            </div>
            <Search
              size="sm"
              placeholder="Filter pairs…"
              labelText="Filter pairs"
              value={filter}
              onChange={(event) =>
                filterStore.setState(() => event.target.value ?? "")
              }
            />
            <div className="nfi-chip-cloud" aria-label="Whitelisted pairs">
              {whitelist.map((pair) => (
                <Tag key={pair} size="sm" filter={false}>
                  {pair}
                </Tag>
              ))}
            </div>
            {fleet && whitelistInstances.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.25rem",
                }}
              >
                <span style={{ fontSize: "0.75rem", opacity: 0.7 }}>
                  Per-bot whitelist
                </span>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                  }}
                >
                  {whitelistInstances.map((row) => (
                    <div
                      key={row.instanceId}
                      style={{
                        display: "flex",
                        gap: "0.375rem",
                        alignItems: "center",
                        fontSize: "0.75rem",
                      }}
                    >
                      <InstanceTag
                        color={colors.colorOf(
                          row.instanceId ?? row.instanceName,
                        )}
                        name={row.instanceName}
                      />
                      <span className="nfi-mono" style={{ opacity: 0.75 }}>
                        {row.length} pairs
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {cfg.showBlacklist && blacklist.length > 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.25rem",
                }}
              >
                <span style={{ fontSize: "0.75rem", opacity: 0.7 }}>
                  Blacklist
                </span>
                <div className="nfi-chip-cloud" aria-label="Blacklisted pairs">
                  {blacklist.map((entry) => {
                    // SAFETY: the `in` check selects the fleet-tagged arm of
                    // the blacklist union, whose schema declares both tags as
                    // required strings (the untagged single-instance arm has
                    // neither key at all).
                    const botId =
                      "instanceId" in entry
                        ? (entry.instanceId as string)
                        : undefined;

                    // SAFETY: same fleet-tagged arm — `instanceName` is a
                    // required schema string there.
                    const botName =
                      "instanceName" in entry
                        ? (entry.instanceName as string)
                        : undefined;

                    return (
                      <Tag
                        key={`${botId ?? cfg.instanceId}-${entry.pair}`}
                        size="sm"
                        type="red"
                        filter={false}
                        title={
                          entry.reason !== undefined
                            ? `${entry.reason}${botName ? ` · ${botName}` : ""}`
                            : (botName ?? entry.pair)
                        }
                      >
                        {entry.pair}
                        {entry.reason !== undefined ? (
                          <span style={{ opacity: 0.65 }}>
                            {" "}
                            · {entry.reason}
                          </span>
                        ) : null}
                        {fleet && botName ? (
                          <span style={{ opacity: 0.65 }}> · {botName}</span>
                        ) : null}
                      </Tag>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState
            title="No pair data"
            hint="Whitelist loads from the selected instance."
          />
        )}
      </WidgetFrame>
    </>
  );
}

export const PairUniverseWidgetDef = defineWidget({
  type: "pair-universe",
  hasSettings: true,
  title: "Pair Universe",
  description: "Whitelisted pairs (filterable) and the blacklist with reasons.",
  configSchema: PairUniverseConfigSchema,
  defaultConfig: PAIR_UNIVERSE_DEFAULTS,
  component: PairUniverseWidget,
  capabilities: [...PAIR_UNIVERSE_CAPABILITIES],
  minWidth: 480,
  minHeight: 360,
  defaultWidth: 480,
  defaultHeight: 360,
});
