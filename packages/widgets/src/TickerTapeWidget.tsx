// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Ticker tape — Bloomberg-style strip of live positions.
 *
 * One chip per open position (pair, price, PnL%) for quick glances. Falls
 * back to recent closed trades when flat so the tape is never empty on a
 * connected instance.
 */

import { NumberInput, Tag } from "@carbon/react";
import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { EmptyState, WidgetFrame } from "@nfi/ui";
import { applyWidgetSettings } from "./shared/panelConfig";
import {
  InstanceIdField,
  booleanWithDefault,
  numberWithDefault,
} from "./shared/config";
import { clampInt, fmt } from "./shared/format";
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

export const TICKER_TAPE_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.open-positions",
  "instances.closed-positions",
  "instances.positions-all",
  "instances.closed-all",
];

export const TickerTapeConfigSchema = Schema.Struct({
  /** An instance id, or `all` for every position in the fleet. */
  instanceId: InstanceIdField,
  maxItems: numberWithDefault(20),
  showProfit: booleanWithDefault(true),
  showPrice: booleanWithDefault(true),
});
export type TickerTapeConfig = typeof TickerTapeConfigSchema.Type;

export const TICKER_TAPE_DEFAULTS: TickerTapeConfig = Schema.decodeUnknownSync(
  TickerTapeConfigSchema,
)({});

export function TickerTapeWidget({
  config,
  panelId,
}: WidgetProps<TickerTapeConfig>) {
  const cfg = config;
  const maxItems = clampInt(cfg.maxItems, 20, 1, 50);
  const access = useWidgetAccess(TICKER_TAPE_CAPABILITIES);
  const openQ = useOpenPositionsSource(cfg.instanceId, {
    enabled: access.allowed,
  });
  const closedQ = useClosedPositionsSource(cfg.instanceId, maxItems, {
    enabled: access.allowed,
  });
  const state = queryState(openQ.error, openQ.isLoading);
  const accessError = access.allowed
    ? null
    : `Not authorized — needs ${access.missing.join(", ")}`;
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<TickerTapeConfig>) =>
    applyWidgetSettings(panelId, "ticker-tape", cfg, p);

  const live = (openQ.data ?? []).slice(0, maxItems).map((p) => ({
    key: `open-${p.instanceId ?? cfg.instanceId}-${p.tradeId}`,
    pair: p.pair,
    bot: p.instanceName,
    price: p.currentRate ?? p.openRate,
    pct: p.profitPct,
    live: true as const,
  }));
  const fallback =
    live.length === 0
      ? (closedQ.data ?? []).slice(0, maxItems).map((p) => ({
          key: `closed-${p.instanceId ?? cfg.instanceId}-${p.tradeId}`,
          pair: p.pair,
          bot: p.instanceName,
          price: p.closeRate ?? p.openRate,
          pct: p.closeProfitPct ?? p.profitPct,
          live: false as const,
        }))
      : [];
  const items = live.length > 0 ? live : fallback;
  const showBot = cfg.instanceId === "all";

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Ticker tape settings"
        widgetType="ticker-tape"
      >
        <InstanceSelect
          id={`tape-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <NumberInput
          id={`tape-max-${panelId}`}
          label="Max symbols"
          value={maxItems}
          min={1}
          max={50}
          step={1}
          onChange={(_e, { value }) =>
            patch({ maxItems: clampInt(value, 20, 1, 50) })
          }
          size="sm"
        />
        <SettingsToggle
          id={`tape-profit-${panelId}`}
          label="Show PnL %"
          toggled={cfg.showProfit}
          onToggle={(v) => patch({ showProfit: v })}
        />
        <SettingsToggle
          id={`tape-price-${panelId}`}
          label="Show price"
          toggled={cfg.showPrice}
          onToggle={(v) => patch({ showPrice: v })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
      title="Ticker Tape"
      isLoading={state.isLoading}
      error={accessError ?? state.error}
    >
      {items.length > 0 ? (
        <div
          className="nfi-ticker-tape"
          role="marquee"
          aria-label="Live position tape"
        >
          {items.map((item) => (
            <span
              key={item.key}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
              }}
            >
              <strong className="nfi-mono" style={{ fontSize: "0.8125rem" }}>
                {item.pair}
              </strong>
              {showBot && item.bot ? (
                <span style={{ fontSize: "0.6875rem", opacity: 0.6 }}>
                  {item.bot}
                </span>
              ) : null}
              {cfg.showPrice ? (
                <span className="nfi-mono" style={{ opacity: 0.75 }}>
                  {fmt(item.price, 4)}
                </span>
              ) : null}
              {cfg.showProfit ? (
                <Tag type={(item.pct ?? 0) >= 0 ? "green" : "red"} size="sm">
                  {fmt(item.pct, 2)}%
                </Tag>
              ) : null}
              {!item.live ? (
                <span style={{ fontSize: "0.6875rem", opacity: 0.5 }}>
                  closed
                </span>
              ) : null}
            </span>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No symbols"
          hint="Open a position or pick an instance with history in ⚙ settings."
        />
      )}
    </WidgetFrame>
    </>
  );
}

export const TickerTapeWidgetDef = defineWidget({
  type: "ticker-tape",
  hasSettings: true,
  title: "Ticker Tape",
  description:
    "Scrolling strip of live positions (pair, price, PnL) — one instance or the fleet.",
  configSchema: TickerTapeConfigSchema,
  defaultConfig: TICKER_TAPE_DEFAULTS,
  component: TickerTapeWidget,
  capabilities: [...TICKER_TAPE_CAPABILITIES],
  minWidth: 280,
  minHeight: 48,
});
