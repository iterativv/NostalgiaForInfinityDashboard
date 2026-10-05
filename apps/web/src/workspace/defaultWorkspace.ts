// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
import {
  decodeWorkspace,
  PanelId,
  type Workspace,
  WorkspaceId,
} from "@nfi/api-contract";

/**
 * Canonical default workspace: a Freqtrade-UI-style fleet dashboard.
 *
 * This is a layout *template* — it seeds the Home page and restores pages
 * on reset. It is never shown as its own page (the legacy standalone
 * "Default workspace" page was retired in favor of Home).
 *
 * Bento (`auto`) mode: two wide + narrow rows (3/5 + 2/5: Bot Comparison
 * + Profit Over Time, Open Trades + Cumulative Profit) followed by two
 * full-width tables (Closed Trades, Wallet History — each too wide to
 * share a row reliably). Every card keeps its exact dragged size.
 *
 * Smart-fit sizing: every card starts at or above its widget's minimum
 * readable size (width via span 3/2 on a 360px column target, height via
 * minHeight + tab-strip chrome + margin), so a fresh Home never shows a
 * "needs more room" wall on a normal desktop. Narrower viewports re-pack
 * (cards wrap to full-width rows) and only genuinely small screens fall
 * back to scaled content (see `AutoPane` / `Panel`).
 *
 * Tables subscribe to the fleet (`instanceId: "all"`) so one screen mirrors
 * freqtrade's multi-bot comparison; single-bot users simply see one row.
 * Home is fully editable — everything here can be re-sized, reordered or
 * replaced (the candle chart, ticker tape etc. stay in the widget picker).
 *
 * Every panel config pins only what the freq-UI look needs; widget schemas
 * fill in the rest via decoding defaults. Demo widgets (`development.*`)
 * are intentionally absent here; they stay reachable through the command
 * palette.
 */

export const DEFAULT_WORKSPACE_ID = Schema.decodeSync(WorkspaceId)("default");

const DEFAULT_WORKSPACE_JSON = {
  id: DEFAULT_WORKSPACE_ID,
  name: "Default workspace",
  schemaVersion: 1,
  version: 0,
  layout: {
    type: "auto",
    id: "auto-root",
    columnWidth: 360,
    items: [
      {
        type: "auto-item",
        id: "card-fleet",
        height: 320,
        span: 3,
        child: {
          type: "tabs",
          id: "tabs-fleet",
          panels: ["panel-fleet"],
          activePanelId: "panel-fleet",
        },
      },
      {
        type: "auto-item",
        id: "card-daily",
        height: 420,
        span: 2,
        child: {
          type: "tabs",
          id: "tabs-daily",
          panels: ["panel-daily"],
          activePanelId: "panel-daily",
        },
      },
      {
        type: "auto-item",
        id: "card-open",
        height: 520,
        span: 3,
        child: {
          type: "tabs",
          id: "tabs-open",
          panels: ["panel-open"],
          activePanelId: "panel-open",
        },
      },
      {
        type: "auto-item",
        id: "card-cumulative",
        height: 350,
        span: 2,
        child: {
          type: "tabs",
          id: "tabs-cumulative",
          panels: ["panel-cumulative"],
          activePanelId: "panel-cumulative",
        },
      },
      {
        type: "auto-item",
        id: "card-closed",
        height: 660,
        span: 3,
        child: {
          type: "tabs",
          id: "tabs-closed",
          panels: ["panel-closed"],
          activePanelId: "panel-closed",
        },
      },
      {
        type: "auto-item",
        id: "card-wallet",
        height: 440,
        span: 3,
        child: {
          type: "tabs",
          id: "tabs-wallet",
          panels: ["panel-wallet"],
          activePanelId: "panel-wallet",
        },
      },
    ],
  },
  panels: {
    "panel-fleet": {
      id: "panel-fleet",
      widgetType: "fleet-overview",
      widgetConfig: { showBalance: true },
      title: "Bot Comparison",
    },
    "panel-open": {
      id: "panel-open",
      widgetType: "open-positions",
      widgetConfig: {
        instanceId: "all",
        showBot: true,
        showDirection: true,
        showAmount: true,
        showStake: true,
        showOpenRate: true,
        showCurrentRate: true,
        showProfitAbs: false,
        showProfitPct: true,
        maxVisibleOrders: 0,
        showOrderHeaderRow: false,
        showHiddenCountRow: false,
      },
      title: "Open Trades",
    },
    "panel-closed": {
      id: "panel-closed",
      widgetType: "closed-positions",
      widgetConfig: {
        instanceId: "all",
        showBot: true,
        showDirection: true,
        showStake: true,
        showOpenRate: true,
        showCloseRate: true,
        showCloseProfit: false,
        showProfitPct: true,
        showExitReason: true,
        showCloseDate: true,
        maxVisibleOrders: 0,
        showOrderHeaderRow: false,
        showHiddenCountRow: false,
      },
      title: "Closed Trades",
    },
    "panel-daily": {
      id: "panel-daily",
      widgetType: "daily-profit",
      widgetConfig: { instanceId: "all", bucket: "monthly", days: 12 },
      title: "Profit Over Time Combined",
    },
    "panel-cumulative": {
      id: "panel-cumulative",
      widgetType: "cumulative-profit",
      widgetConfig: { instanceId: "all" },
      title: "Cumulative Profit",
    },
    "panel-wallet": {
      id: "panel-wallet",
      widgetType: "wallet-history",
      widgetConfig: { instanceId: "all" },
      title: "Wallet History",
    },
  },
  activePanelId: Schema.decodeSync(PanelId)("panel-fleet"),
} as const;

/** Fresh validated copy — callers may freely mutate the result. */
export function buildDefaultWorkspace(): Workspace {
  return decodeWorkspace(structuredClone(DEFAULT_WORKSPACE_JSON));
}
