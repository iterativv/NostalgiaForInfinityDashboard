// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Pair Universe — what the strategy may and may not trade.
 *
 * Backed by `instances.whitelist` + `instances.blacklist`: the analyzed
 * whitelist (with a quick filter) beside the blacklist with per-entry
 * reasons, plus counts up top. The classic freqtrade pairs view.
 */

import { Search, Tag } from "@carbon/react";
import { useMemo, useState } from "react";
import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, Stat, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { applyWidgetSettings } from "./shared/panelConfig";
import { InstanceIdField, booleanWithDefault } from "./shared/config";
import { InstanceSelect } from "./shared/InstanceSelect";
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
  const whitelistQ = useCapability("instances.whitelist", {
    id: cfg.instanceId,
  });
  const blacklistQ = useCapability("instances.blacklist", {
    id: cfg.instanceId,
  });
  const state = queryState(
    whitelistQ.error ?? blacklistQ.error,
    whitelistQ.isLoading || blacklistQ.isLoading,
  );
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<PairUniverseConfig>) =>
    applyWidgetSettings(panelId, "pair-universe", cfg, p);
  const [filter, setFilter] = useState("");

  // Stable identities: `?? []` would mint a fresh (never-equal) array on
  // every query refetch/render and defeat the `filtered` memo below.
  const whitelist = useMemo(() => whitelistQ.data?.pairs ?? [], [whitelistQ.data]);
  const blacklist = blacklistQ.data?.pairs ?? [];
  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (needle.length === 0) return whitelist;
    return whitelist.filter((pair) => pair.toLowerCase().includes(needle));
  }, [whitelist, filter]);

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
      {whitelistQ.data !== undefined || blacklistQ.data !== undefined ? (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
        >
          <div className="nfi-stat-grid">
            <Stat
              label="Whitelist"
              value={String(whitelist.length)}
              sub="analyzed pairs"
            />
            {cfg.showBlacklist ? (
              <Stat
                label="Blacklist"
                value={String(blacklistQ.data?.length ?? blacklist.length)}
                sub="blocked pairs"
              />
            ) : null}
            {filter.trim().length > 0 ? (
              <Stat
                label="Filter matches"
                value={`${filtered.length}/${whitelist.length}`}
              />
            ) : null}
          </div>
          <Search
            size="sm"
            placeholder="Filter pairs…"
            labelText="Filter pairs"
            value={filter}
            onChange={(event) => setFilter(event.target.value ?? "")}
          />
          <div className="nfi-chip-cloud" aria-label="Whitelisted pairs">
            {filtered.map((pair) => (
              <Tag key={pair} size="sm" filter={false}>
                {pair}
              </Tag>
            ))}
          </div>
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
                {blacklist.map((entry) => (
                  <Tag
                    key={entry.pair}
                    size="sm"
                    type="red"
                    filter={false}
                    title={entry.reason}
                  >
                    {entry.pair}
                    {entry.reason !== undefined ? (
                      <span style={{ opacity: 0.65 }}> · {entry.reason}</span>
                    ) : null}
                  </Tag>
                ))}
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
  minWidth: 320,
  minHeight: 180,
});
