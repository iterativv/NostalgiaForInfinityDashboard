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
import { useTimeFormat } from "./shared/timeFormat";
import { InstanceSelect } from "./shared/InstanceSelect";
import { InstanceDot, useInstanceColors } from "./shared/instanceColors";
import { ALL_INSTANCES } from "./shared/InstanceSelect";
import { useCapability } from "./live/live";
import { SettingsToggle } from "./shared/SettingsToggle";
import { WidgetSettingsModal } from "./shared/WidgetSettings";
import { ServerExportMenu } from "./shared/export";
import {
  closeWidgetSettings,
  useWidgetSettingsOpen,
} from "./shared/widgetSettingsBus";

export const TRADE_TAPE_CAPABILITIES: ReadonlyArray<Capability> = [
  "instances.trade-tape",
  "instances.trade-tape-all",
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

/**
 * One rendered tape row: the contract event plus the presentation labels
 * (detail string, formatted date) composed from the SQL-selected fields.
 */
interface TapeRow {
  readonly key: string;
  readonly dateLabel: string;
  readonly kind: "open" | "close";
  readonly pair: string;
  readonly bot: string | undefined;
  /** Owning instance id — drives the per-instance color dot (fleet view). */
  readonly botId: string | undefined;
  readonly detail: string;
  readonly profit: number | undefined;
}

export function TradeTapeWidget({
  config,
  panelId,
}: WidgetProps<TradeTapeConfig>) {
  const cfg = config;
  useTimeFormat();
  const limit = clampInt(cfg.limit, 30, 5, 100);
  const access = useWidgetAccess(TRADE_TAPE_CAPABILITIES);

  // Both halves (kind filter, newest-N selection) are SQL clauses on the
  // mirror; the feed arrives merged and newest-first.
  const fleetTape = cfg.instanceId === ALL_INSTANCES;

  const perInstanceTape = useCapability(
    "instances.trade-tape",
    {
      id: fleetTape ? "default" : cfg.instanceId,
      limit: String(limit),
      opens: cfg.showOpens ? undefined : "false",
      closes: cfg.showCloses ? undefined : "false",
    },
    { enabled: access.allowed && !fleetTape },
  );

  const fleetView = useCapability(
    "instances.trade-tape-all",
    {
      limit: String(limit),
      opens: cfg.showOpens ? undefined : "false",
      closes: cfg.showCloses ? undefined : "false",
    },
    { enabled: access.allowed && fleetTape },
  );

  const tapeQ = fleetTape ? fleetView : perInstanceTape;

  const state = queryState(tapeQ.error, tapeQ.isLoading);

  const accessError = access.allowed
    ? null
    : `Not authorized — needs ${access.missing.join(", ")}`;

  const showSettings = useWidgetSettingsOpen(panelId);
  // Row dates read the global time-format store; this read re-renders the
  // tape when the configured format changes.
  useTimeFormat();

  const patch = (p: Partial<TradeTapeConfig>) =>
    applyWidgetSettings(panelId, "trade-tape", cfg, p);

  // Derived through a store: event-list build + sort reruns only when the
  // sources/config change — recomputing on every re-render stalled
  // scrolling/resizing on busy instances.
  const visible: TapeRow[] = (tapeQ.data?.events ?? []).map((event) => ({
    key: `${event.kind}-${event.instanceId ?? cfg.instanceId}-${event.tradeId}`,
    dateLabel: fmtDate(event.at),
    kind: event.kind,
    pair: event.pair,
    bot: event.instanceName,
    botId: event.instanceId,
    detail:
      event.kind === "open"
        ? `${event.isShort ? "SHORT" : "LONG"} @ ${fmt(event.openRate, 4)}${event.enterTag?.trim() ? ` · ${event.enterTag.trim()}` : ""}`
        : `closed${event.exitReason?.trim() ? ` · ${event.exitReason.trim()}` : ""}`,
    profit: event.profitAbs,
  }));

  const showBot = cfg.instanceId === "all";
  const colors = useInstanceColors();

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
        actions={
          <ServerExportMenu
            filenameBase={`trade-tape-${cfg.instanceId}`}
            dataset="trade-tape"
            params={{
              instanceId:
                cfg.instanceId === ALL_INSTANCES ? undefined : cfg.instanceId,
            }}
            disabled={visible.length === 0}
          />
        }
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
            {visible.map((event) => {
              const botColor = showBot
                ? colors.colorOf(event.botId ?? event.bot)
                : null;

              return (
                <div
                  key={event.key}
                  className="nfi-tape-row"
                  data-kind={event.kind}
                >
                  <Tag
                    type={event.kind === "open" ? "green" : "gray"}
                    size="sm"
                  >
                    {event.kind === "open" ? "OPEN" : "CLOSE"}
                  </Tag>
                  <strong className="nfi-mono">{event.pair}</strong>
                  {showBot && event.bot ? (
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.25rem",
                        fontSize: "0.6875rem",
                        opacity: 0.75,
                      }}
                    >
                      {botColor ? (
                        <InstanceDot color={botColor} title={event.bot} />
                      ) : null}
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
              );
            })}
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
  minWidth: 560,
  minHeight: 278,
  defaultWidth: 560,
  defaultHeight: 400,
});
