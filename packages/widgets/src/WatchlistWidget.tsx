// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Watchlist — user-tracked pairs joined with live position data.
 *
 * Enter pairs as comma-separated symbols (`BTC/USDT, ETH/USDT`). Each row
 * shows the live state: OPEN with current PnL when the instance holds it,
 * otherwise the last closed result (or UNTRACKED when never traded).
 */

import { useState } from "react";
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextInput,
} from "@carbon/react";
import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, WidgetFrame } from "@nfi/ui";
import { applyWidgetSettings } from "./shared/panelConfig";
import {
  InstanceIdField,
  booleanWithDefault,
  stringWithDefault,
} from "./shared/config";
import { fmt, pnlClass } from "./shared/format";
import { queryState, useWidgetAccess } from "./shared/query";
import { InstanceSelect } from "./shared/InstanceSelect";
import {
  useClosedPositionsSource,
  useOpenPositionsSource,
} from "./shared/sources";
import { SettingsToggle } from "./shared/SettingsToggle";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const WATCHLIST_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.open-positions",
  "instances.closed-positions",
  "instances.positions-all",
  "instances.closed-all",
];

export const WatchlistConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  pairs: stringWithDefault("BTC/USDT, ETH/USDT, SOL/USDT"),
  showOnlyOpen: booleanWithDefault(false),
});
export type WatchlistConfig = typeof WatchlistConfigSchema.Type;

export const WATCHLIST_DEFAULTS: WatchlistConfig = Schema.decodeUnknownSync(
  WatchlistConfigSchema,
)({});

const normalizePair = (pair: string): string => pair.trim().toUpperCase();

export function WatchlistWidget({
  config,
  panelId,
}: WidgetProps<WatchlistConfig>) {
  const cfg = config;
  const access = useWidgetAccess(WATCHLIST_CAPABILITIES);
  const openQ = useOpenPositionsSource(cfg.instanceId, {
    enabled: access.allowed,
  });
  const closedQ = useClosedPositionsSource(cfg.instanceId, 200, {
    enabled: access.allowed,
  });
  const state = queryState(openQ.error, openQ.isLoading);
  const accessError = access.allowed
    ? null
    : `Not authorized — needs ${access.missing.join(", ")}`;
  const showSettings = useWidgetSettingsOpen(panelId);
  const [draft, setDraft] = useState(cfg.pairs);
  const patch = (p: Partial<WatchlistConfig>) =>
    applyWidgetSettings(panelId, "watchlist", cfg, p);

  const showBot = cfg.instanceId === "all";
  const wanted = cfg.pairs
    .split(",")
    .map(normalizePair)
    .filter((p) => p.length > 0)
    .slice(0, 30);
  const openByPair = new Map(
    (openQ.data ?? []).map((p) => [normalizePair(p.pair), p]),
  );
  const lastClosedByPair = new Map<
    string,
    { pct: number | undefined; profit: number | undefined }
  >();
  for (const p of closedQ.data ?? []) {
    const key = normalizePair(p.pair);
    if (!lastClosedByPair.has(key)) {
      lastClosedByPair.set(key, {
        pct: p.closeProfitPct ?? p.profitPct,
        profit: p.closeProfitAbs ?? p.profitAbs,
      });
    }
  }
  const rows = wanted
    .map((pair) => {
      const open = openByPair.get(pair);
      const last = lastClosedByPair.get(pair);
      return { pair, open, last };
    })
    .filter((row) => (cfg.showOnlyOpen ? row.open !== undefined : true));

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Watchlist settings"
        widgetType="watchlist"
      >
        <InstanceSelect
          id={`watch-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <TextInput
          id={`watch-pairs-${panelId}`}
          labelText="Pairs (comma-separated)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => patch({ pairs: draft })}
          size="sm"
        />
        <Button
          size="sm"
          kind="secondary"
          onClick={() => patch({ pairs: draft })}
        >
          Apply pairs
        </Button>
        <SettingsToggle
          id={`watch-open-${panelId}`}
          label="Only open positions"
          toggled={cfg.showOnlyOpen}
          onToggle={(v) => patch({ showOnlyOpen: v })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
      title="Watchlist"
      isLoading={state.isLoading}
      error={accessError ?? state.error}
    >
      {rows.length > 0 ? (
        <div className="nfi-table-scroll">
          <Table size="sm" useZebraStyles={false}>
            <TableHead>
              <TableRow>
                <TableHeader>Pair</TableHeader>
                <TableHeader>State</TableHeader>
                <TableHeader>Price</TableHeader>
                <TableHeader>PnL %</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.pair}>
                  <TableCell className="nfi-mono">
                    {row.pair}
                    {showBot && row.open?.instanceName ? (
                      <span style={{ opacity: 0.6 }}>
                        {" "}
                        · {row.open.instanceName}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {row.open ? (
                      <Tag type="green" size="sm">
                        OPEN{row.open.isShort ? " SHORT" : ""}
                      </Tag>
                    ) : row.last ? (
                      <Tag type="gray" size="sm">
                        FLAT
                      </Tag>
                    ) : (
                      <Tag type="cool-gray" size="sm">
                        UNTRACKED
                      </Tag>
                    )}
                  </TableCell>
                  <TableCell className="nfi-mono">
                    {row.open
                      ? fmt(row.open.currentRate ?? row.open.openRate, 4)
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {row.open ? (
                      <Tag
                        type={(row.open.profitPct ?? 0) >= 0 ? "green" : "red"}
                        size="sm"
                      >
                        {fmt(row.open.profitPct, 2)}%
                      </Tag>
                    ) : row.last?.pct !== undefined ? (
                      <span
                        className={`nfi-mono ${pnlClass(row.last.pct)}`}
                        style={{ opacity: 0.9 }}
                      >
                        {fmt(row.last.pct, 2)}% last
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          title="Empty watchlist"
          hint="Add pairs in ⚙ settings (comma-separated)."
        />
      )}
    </WidgetFrame>
    </>
  );
}

export const WatchlistWidgetDef = defineWidget({
  type: "watchlist",
  hasSettings: true,
  title: "Watchlist",
  description: "Tracked pairs with live open state and last closed result.",
  configSchema: WatchlistConfigSchema,
  defaultConfig: WATCHLIST_DEFAULTS,
  component: WatchlistWidget,
  capabilities: [...WATCHLIST_CAPABILITIES],
  minWidth: 320,
  minHeight: 140,
});
