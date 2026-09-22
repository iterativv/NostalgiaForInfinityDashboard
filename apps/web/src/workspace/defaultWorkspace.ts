// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  decodeWorkspace,
  type PanelId,
  type Workspace,
  type WorkspaceId,
} from "@nfi/api-contract";

/**
 * Canonical default workspace: a Freqtrade-UI-style fleet dashboard.
 *
 * This is a layout *template* — it seeds the Home page and new custom
 * pages, and restores custom pages on reset. It is never shown as its own
 * page (the legacy standalone "Default workspace" page was retired in
 * favor of Home).
 *
 * ```text
 * Grid (columns [1.7 1] · rows [1 1 1]) — 6 panels
 * ├── Left column: Bot Comparison · Open Positions · Closed Positions
 * └── Right column: Daily Profit (monthly) · Cumulative Profit · Wallet History
 * ```
 *
 * Tables subscribe to the fleet (`instanceId: "all"`) so one screen mirrors
 * freqtrade's multi-bot comparison; single-bot users simply see one row.
 * Home is fully editable — everything here can be re-arranged, re-tabbed or
 * replaced (the candle chart, ticker tape etc. stay in the widget picker).
 *
 * Every panel config pins only what the freq-UI look needs; widget schemas
 * fill in the rest via decoding defaults. Demo widgets (`development.*`)
 * are intentionally absent here; they stay reachable through the command
 * palette.
 */

export const DEFAULT_WORKSPACE_ID = "default" as WorkspaceId;

const DEFAULT_WORKSPACE_JSON = {
  id: DEFAULT_WORKSPACE_ID,
  name: "Default workspace",
  schemaVersion: 1,
  version: 0,
  layout: {
    type: "grid",
    id: "grid-root",
    columns: [1.7, 1],
    rows: [1, 1, 1],
    items: [
      {
        type: "item",
        id: "cell-fleet",
        col: 1,
        row: 1,
        colSpan: 1,
        rowSpan: 1,
        child: {
          type: "tabs",
          id: "tabs-fleet",
          panels: ["panel-fleet"],
          activePanelId: "panel-fleet",
        },
      },
      {
        type: "item",
        id: "cell-daily",
        col: 2,
        row: 1,
        colSpan: 1,
        rowSpan: 1,
        child: {
          type: "tabs",
          id: "tabs-daily",
          panels: ["panel-daily"],
          activePanelId: "panel-daily",
        },
      },
      {
        type: "item",
        id: "cell-open",
        col: 1,
        row: 2,
        colSpan: 1,
        rowSpan: 1,
        child: {
          type: "tabs",
          id: "tabs-open",
          panels: ["panel-open"],
          activePanelId: "panel-open",
        },
      },
      {
        type: "item",
        id: "cell-cumulative",
        col: 2,
        row: 2,
        colSpan: 1,
        rowSpan: 1,
        child: {
          type: "tabs",
          id: "tabs-cumulative",
          panels: ["panel-cumulative"],
          activePanelId: "panel-cumulative",
        },
      },
      {
        type: "item",
        id: "cell-closed",
        col: 1,
        row: 3,
        colSpan: 1,
        rowSpan: 1,
        child: {
          type: "tabs",
          id: "tabs-closed",
          panels: ["panel-closed"],
          activePanelId: "panel-closed",
        },
      },
      {
        type: "item",
        id: "cell-wallet",
        col: 2,
        row: 3,
        colSpan: 1,
        rowSpan: 1,
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
    },
    "panel-daily": {
      id: "panel-daily",
      widgetType: "daily-profit",
      widgetConfig: { instanceId: "all", bucket: "monthly", days: 12 },
    },
    "panel-cumulative": {
      id: "panel-cumulative",
      widgetType: "cumulative-profit",
      widgetConfig: { instanceId: "all" },
    },
    "panel-wallet": {
      id: "panel-wallet",
      widgetType: "wallet-history",
      widgetConfig: { instanceId: "all" },
    },
  },
  activePanelId: "panel-fleet" as PanelId,
} as const;

/** Fresh validated copy — callers may freely mutate the result. */
export function buildDefaultWorkspace(): Workspace {
  return decodeWorkspace(structuredClone(DEFAULT_WORKSPACE_JSON));
}
