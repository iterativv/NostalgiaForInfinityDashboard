// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Trade tape — chronological feed of opens and closes.
 *
 * The terminal's time-and-sales view: latest events first, opens in green,
 * closes tagged with their exit reason and signed profit.
 */

import { NumberInput } from "@carbon/react";
import { Schema } from "effect";
import type { Capability } from "@nfi/api-contract";
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk";
import { Tag } from "@carbon/react";
import { EmptyState, WidgetFrame } from "@nfi/ui";
import { applyWidgetSettings } from "./shared/panelConfig";
import {
  InstanceIdField,
  booleanWithDefault,
  numberWithDefault,
} from "./shared/config";
import { clampInt, fmtDate, fmt } from "./shared/format";
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

export const TRADE_TAPE_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.open-positions",
  "instances.closed-positions",
  "instances.positions-all",
  "instances.closed-all",
];

export const TradeTapeConfigSchema = Schema.Struct({
  instanceId: InstanceIdField,
  limit: numberWithDefault(30),
  showOpens: booleanWithDefault(true),
  showCloses: booleanWithDefault(true),
});
export type TradeTapeConfig = typeof TradeTapeConfigSchema.Type;

export const TRADE_TAPE_DEFAULTS: TradeTapeConfig = Schema.decodeUnknownSync(
  TradeTapeConfigSchema,
)({});

interface TapeEvent {
  readonly key: string;
  readonly at: number;
  readonly dateLabel: string;
  readonly kind: "open" | "close";
  readonly pair: string;
  readonly bot: string | undefined;
  readonly detail: string;
  readonly profit: number | undefined;
}

const toTime = (value: string | undefined): number | null => {
  if (!value) return null;
  const t = new Date(value.replace(" ", "T")).getTime();
  return Number.isNaN(t) ? null : t;
};

export function TradeTapeWidget({
  config,
  panelId,
}: WidgetProps<TradeTapeConfig>) {
  const cfg = config;
  const limit = clampInt(cfg.limit, 30, 5, 100);
  const access = useWidgetAccess(TRADE_TAPE_CAPABILITIES);
  const openQ = useOpenPositionsSource(cfg.instanceId, {
    enabled: access.allowed,
  });
  const closedQ = useClosedPositionsSource(cfg.instanceId, limit, {
    enabled: access.allowed,
  });
  const state = queryState(
    openQ.error ?? closedQ.error,
    openQ.isLoading || closedQ.isLoading,
  );
  const accessError = access.allowed
    ? null
    : `Not authorized — needs ${access.missing.join(", ")}`;
  const showSettings = useWidgetSettingsOpen(panelId);
  const patch = (p: Partial<TradeTapeConfig>) =>
    applyWidgetSettings(panelId, "trade-tape", cfg, p);

  const events: TapeEvent[] = [];
  if (cfg.showOpens) {
    for (const p of openQ.data ?? []) {
      const at = toTime(p.openDate) ?? 0;
      events.push({
        key: `open-${p.instanceId ?? cfg.instanceId}-${p.tradeId}`,
        at,
        dateLabel: fmtDate(p.openDate),
        kind: "open",
        pair: p.pair,
        bot: p.instanceName,
        detail: `${p.isShort ? "SHORT" : "LONG"} @ ${fmt(p.openRate, 4)}${p.enterTag?.trim() ? ` · ${p.enterTag.trim()}` : ""}`,
        profit: undefined,
      });
    }
  }
  if (cfg.showCloses) {
    for (const p of closedQ.data ?? []) {
      const at = toTime(p.closeDate) ?? toTime(p.openDate) ?? 0;
      const profit = p.closeProfitAbs ?? p.profitAbs;
      events.push({
        key: `close-${p.instanceId ?? cfg.instanceId}-${p.tradeId}`,
        at,
        dateLabel: fmtDate(p.closeDate ?? p.openDate),
        kind: "close",
        pair: p.pair,
        bot: p.instanceName,
        detail: `closed${p.exitReason?.trim() ? ` · ${p.exitReason.trim()}` : ""}`,
        profit,
      });
    }
  }
  events.sort((a, b) => b.at - a.at);
  const visible = events.slice(0, limit);
  const showBot = cfg.instanceId === "all";

  return (
    <>
      <WidgetSettingsModal
        open={showSettings}
        onClose={closeWidgetSettings}
        title="Trade tape settings"
        widgetType="trade-tape"
      >
        <InstanceSelect
          id={`tape2-inst-${panelId}`}
          value={cfg.instanceId}
          onChange={(instanceId) => patch({ instanceId })}
          allowAll
        />
        <NumberInput
          id={`tape2-limit-${panelId}`}
          label="Events shown"
          value={limit}
          min={5}
          max={100}
          step={5}
          onChange={(_e, { value }) =>
            patch({ limit: clampInt(value, 30, 5, 100) })
          }
          size="sm"
        />
        <SettingsToggle
          id={`tape2-opens-${panelId}`}
          label="Opens"
          toggled={cfg.showOpens}
          onToggle={(v) => patch({ showOpens: v })}
        />
        <SettingsToggle
          id={`tape2-closes-${panelId}`}
          label="Closes"
          toggled={cfg.showCloses}
          onToggle={(v) => patch({ showCloses: v })}
        />
      </WidgetSettingsModal>
      <WidgetFrame
      title="Trade Tape"
      isLoading={state.isLoading}
      error={accessError ?? state.error}
    >
      {visible.length > 0 ? (
        <div
          role="log"
          aria-label="Trade tape"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.125rem",
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
          }}
        >
          {visible.map((event) => (
            <div
              key={event.key}
              className="nfi-tape-row"
              data-kind={event.kind}
            >
              <Tag type={event.kind === "open" ? "green" : "gray"} size="sm">
                {event.kind === "open" ? "OPEN" : "CLOSE"}
              </Tag>
              <strong className="nfi-mono">{event.pair}</strong>
              {showBot && event.bot ? (
                <span style={{ fontSize: "0.6875rem", opacity: 0.6 }}>
                  {event.bot}
                </span>
              ) : null}
              <span className="nfi-tape-detail">{event.detail}</span>
              {event.profit !== undefined ? (
                <span
                  className={`nfi-mono ${event.profit >= 0 ? "nfi-pnl-positive" : "nfi-pnl-negative"}`}
                  style={{ fontWeight: 600 }}
                >
                  {event.profit >= 0 ? "+" : ""}
                  {event.profit.toFixed(2)}
                </span>
              ) : null}
              <span
                style={{
                  opacity: 0.55,
                  fontSize: "0.75rem",
                }}
              >
                {event.dateLabel}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No tape events"
          hint="Enable opens/closes in ⚙ settings."
        />
      )}
    </WidgetFrame>
    </>
  );
}

export const TradeTapeWidgetDef = defineWidget({
  type: "trade-tape",
  hasSettings: true,
  title: "Trade Tape",
  description: "Chronological feed of position opens and closes.",
  configSchema: TradeTapeConfigSchema,
  defaultConfig: TRADE_TAPE_DEFAULTS,
  component: TradeTapeWidget,
  capabilities: [...TRADE_TAPE_CAPABILITIES],
  minWidth: 320,
  minHeight: 80,
});
