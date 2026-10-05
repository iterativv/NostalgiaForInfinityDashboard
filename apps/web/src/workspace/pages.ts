// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
import {
  decodeWorkspace,
  WorkspaceId,
  type LayoutNode,
  type PanelInstance,
  type Workspace,
} from "@nfi/api-contract";
import { buildDefaultWorkspace } from "./defaultWorkspace";

/**
 * Pages — Home plus user-added pages (preset dashboards + custom pages).
 *
 * Bento (`auto`) with stepless resize is the only page mode. The app ships
 * with Home (a Freqtrade-UI-style fleet dashboard); users grow the pages
 * bar from the Add-page dialog — curated preset pages for common pro
 * trader/investor workflows, plus blank fully-editable custom pages.
 */

/**
 * Icon keys renderable in the pages bar (mapped to Carbon icons in
 * `PagesBar`). Custom pages choose one; it persists on the workspace
 * document.
 */
export type PageIconKey =
  | "dashboard"
  | "candlestick"
  | "globe"
  | "activity"
  | "warning"
  | "tools"
  | "screen"
  | "star"
  | "chart-line"
  | "money"
  | "tag"
  | "time"
  | "fire"
  | "rocket"
  | "layers"
  | "chart-bar"
  | "chart-pie"
  | "chart-donut"
  | "wallet"
  | "currency"
  | "table"
  | "notebook"
  | "shield"
  | "trophy"
  | "growth"
  | "finance"
  | "meter"
  | "report"
  | "idea"
  | "bolt"
  | "compass"
  | "flag"
  | "bookmark"
  | "calendar"
  | "portfolio"
  | "target"
  | "scales";

export const PAGE_ICON_KEYS: ReadonlyArray<PageIconKey> = [
  "dashboard",
  "candlestick",
  "globe",
  "activity",
  "warning",
  "tools",
  "screen",
  "star",
  "chart-line",
  "money",
  "tag",
  "time",
  "fire",
  "rocket",
  "layers",
  "chart-bar",
  "chart-pie",
  "chart-donut",
  "wallet",
  "currency",
  "table",
  "notebook",
  "shield",
  "trophy",
  "growth",
  "finance",
  "meter",
  "report",
  "idea",
  "bolt",
  "compass",
  "flag",
  "bookmark",
  "calendar",
  "portfolio",
  "target",
  "scales",
];

/** True when `value` is a renderable pages-bar icon key. */
export function isPageIconKey(value: string): value is PageIconKey {
  return PAGE_ICON_KEYS.some((key) => key === value);
}

/**
 * Validate a persisted icon field: unknown keys (renamed/removed icons
 * from older builds) become undefined so the page simply renders without
 * an icon instead of breaking.
 */
export function normalizePageIcon(
  value: string | undefined,
): PageIconKey | undefined {
  return value !== undefined && isPageIconKey(value) ? value : undefined;
}

// --- Preset pages ----------------------------------------------------------
// Curated bento dashboards for common pro trader/investor workflows. Each
// preset seeds a fully-editable page (users may resize, reorder, add or
// remove any card); Reset restores the preset's canonical layout via
// `refreshPresetWorkspace`.

/** Viewport aspect bands (kept for `build` signature compat). */
export type PresetAspectBand = "wide" | "standard" | "compact";

export const PRESET_ASPECT_WIDE = 2.0;

export const PRESET_ASPECT_COMPACT = 1.4;

/** Classify a width/height ratio into a band (unused by bento builds). */
export function presetAspectBand(_aspect: number): PresetAspectBand {
  return "standard";
}

export interface PresetPage {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly icon: PageIconKey;
  readonly widgets: ReadonlyArray<string>;
  readonly build: (band?: PresetAspectBand) => Workspace;
}

interface PresetCard {
  readonly panelId: string;
  readonly widgetType: string;
  /** Opaque per-widget config — the owning widget's schema decodes it. */
  readonly widgetConfig: PanelInstance["widgetConfig"];
  readonly title: string;
  readonly span: number;
  readonly height: number;
}

function buildPresetWorkspace(
  id: string,
  name: string,
  icon: PageIconKey,
  cards: ReadonlyArray<PresetCard>,
): Workspace {
  // Smart-fit: 360px columns with spans 3 (tables/charts) and 2 (compact
  // widgets) keep every card at or above its widget minimum on a normal
  // desktop; every height clears minHeight + tab-strip chrome + margin.
  return decodeWorkspace({
    id,
    name,
    schemaVersion: 1,
    version: 0,
    layout: {
      type: "auto",
      id: "auto-root",
      columnWidth: 360,
      items: cards.map((card) => ({
        type: "auto-item",
        id: `card-${card.panelId}`,
        height: card.height,
        span: card.span,
        child: {
          type: "tabs",
          id: `tabs-${card.panelId}`,
          panels: [card.panelId],
          activePanelId: card.panelId,
        },
      })),
    },
    panels: Object.fromEntries(
      cards.map((card) => [
        card.panelId,
        {
          id: card.panelId,
          widgetType: card.widgetType,
          widgetConfig: card.widgetConfig,
          title: card.title,
        },
      ]),
    ),
    activePanelId: cards[0]?.panelId ?? null,
    icon,
    origin: "user",
  });
}

const ALL = { instanceId: "all" } as const;

/**
 * Panel ids are workspace-scoped since the scoped panel-table migration, but
 * they stay namespaced per preset anyway (`panel-<preset>-<widget>`): every
 * deployment updating from an older build replays the DB migration on boot,
 * yet a preset that carried a bare id like `panel-open` would still collide
 * with a Home dashboard seeded by an even older default the moment BOTH
 * documents save against a database the migration has not touched yet.
 */

export const PRESET_PAGES: ReadonlyArray<PresetPage> = [
  {
    id: "page-preset-trading",
    title: "Trading Terminal",
    description:
      "Chart plus live and closed positions for active trade management.",
    icon: "candlestick",
    widgets: [
      "candle-chart",
      "open-positions",
      "closed-positions",
      "ticker-tape",
      "pair-locks",
      "open-trades",
    ],
    build: () =>
      buildPresetWorkspace(
        "page-preset-trading",
        "Trading Terminal",
        "candlestick",
        [
          {
            panelId: "panel-trading-chart",
            widgetType: "candle-chart",
            widgetConfig: {},
            title: "Chart",
            span: 3,
            height: 640,
          },
          {
            panelId: "panel-trading-ticker",
            widgetType: "ticker-tape",
            widgetConfig: {},
            title: "Ticker Tape",
            span: 2,
            height: 160,
          },
          {
            panelId: "panel-trading-locks",
            widgetType: "pair-locks",
            widgetConfig: { ...ALL },
            title: "Pair Locks",
            span: 2,
            height: 260,
          },
          {
            panelId: "panel-trading-trades",
            widgetType: "open-trades",
            widgetConfig: { ...ALL },
            title: "Trade Tape",
            span: 2,
            height: 300,
          },
          {
            panelId: "panel-trading-open",
            widgetType: "open-positions",
            widgetConfig: { ...ALL, showBot: true, showProfitPct: true },
            title: "Open Trades",
            span: 3,
            height: 520,
          },
          {
            panelId: "panel-trading-closed",
            widgetType: "closed-positions",
            widgetConfig: { ...ALL, showBot: true, showProfitPct: true },
            title: "Closed Trades",
            span: 3,
            height: 660,
          },
        ],
      ),
  },
  {
    id: "page-preset-portfolio",
    title: "Portfolio Overview",
    description:
      "Fleet balances, profit and wallet history — the investor's home view.",
    icon: "wallet",
    widgets: [
      "fleet-overview",
      "balance",
      "profit",
      "wallet-history",
      "exposure",
      "open-positions",
    ],
    build: () =>
      buildPresetWorkspace(
        "page-preset-portfolio",
        "Portfolio Overview",
        "wallet",
        [
          {
            panelId: "panel-portfolio-fleet",
            widgetType: "fleet-overview",
            widgetConfig: { showBalance: true },
            title: "Bot Comparison",
            span: 3,
            height: 320,
          },
          {
            panelId: "panel-portfolio-balance",
            widgetType: "balance",
            widgetConfig: { ...ALL },
            title: "Balance",
            span: 2,
            height: 340,
          },
          {
            panelId: "panel-portfolio-profit",
            widgetType: "profit",
            widgetConfig: { ...ALL },
            title: "Profit",
            span: 2,
            height: 220,
          },
          {
            panelId: "panel-portfolio-exposure",
            widgetType: "exposure",
            widgetConfig: { ...ALL },
            title: "Exposure",
            span: 2,
            height: 400,
          },
          {
            panelId: "panel-portfolio-wallet",
            widgetType: "wallet-history",
            widgetConfig: { ...ALL },
            title: "Wallet History",
            span: 3,
            height: 440,
          },
          {
            panelId: "panel-portfolio-open",
            widgetType: "open-positions",
            widgetConfig: { ...ALL, showBot: true, showProfitPct: true },
            title: "Open Positions",
            span: 3,
            height: 520,
          },
        ],
      ),
  },
  {
    id: "page-preset-performance",
    title: "Performance Analytics",
    description:
      "Profit over time, equity, drawdown and stats for strategy review.",
    icon: "chart-line",
    widgets: [
      "daily-profit",
      "cumulative-profit",
      "performance-stats",
      "drawdown",
      "equity",
      "tag-performance",
    ],
    build: () =>
      buildPresetWorkspace(
        "page-preset-performance",
        "Performance Analytics",
        "chart-line",
        [
          {
            panelId: "panel-perf-daily",
            widgetType: "daily-profit",
            widgetConfig: { ...ALL, bucket: "monthly", days: 12 },
            title: "Profit Over Time",
            span: 3,
            height: 420,
          },
          {
            panelId: "panel-perf-cumulative",
            widgetType: "cumulative-profit",
            widgetConfig: { ...ALL },
            title: "Cumulative Profit",
            span: 2,
            height: 350,
          },
          {
            panelId: "panel-perf-stats",
            widgetType: "performance-stats",
            widgetConfig: { ...ALL },
            title: "Performance Stats",
            span: 2,
            height: 340,
          },
          {
            panelId: "panel-perf-equity",
            widgetType: "equity",
            widgetConfig: { ...ALL },
            title: "Equity Curve",
            span: 3,
            height: 430,
          },
          {
            panelId: "panel-perf-drawdown",
            widgetType: "drawdown",
            widgetConfig: { ...ALL },
            title: "Drawdown",
            span: 2,
            height: 420,
          },
          {
            panelId: "panel-perf-tags",
            widgetType: "tag-performance",
            widgetConfig: { ...ALL },
            title: "Tag Performance",
            span: 3,
            height: 340,
          },
        ],
      ),
  },
  {
    id: "page-preset-risk",
    title: "Risk Management",
    description:
      "Risk monitor, exposure, drawdown and locks for position safety.",
    icon: "shield",
    widgets: [
      "risk-monitor",
      "exposure",
      "drawdown",
      "pair-locks",
      "open-positions",
      "balance",
    ],
    build: () =>
      buildPresetWorkspace("page-preset-risk", "Risk Management", "shield", [
        {
          panelId: "panel-risk-risk",
          widgetType: "risk-monitor",
          widgetConfig: { ...ALL },
          title: "Risk Monitor",
          span: 2,
          height: 280,
        },
        {
          panelId: "panel-risk-exposure",
          widgetType: "exposure",
          widgetConfig: { ...ALL },
          title: "Exposure",
          span: 2,
          height: 400,
        },
        {
          panelId: "panel-risk-open",
          widgetType: "open-positions",
          widgetConfig: { ...ALL, showBot: true, showProfitPct: true },
          title: "Open Positions",
          span: 3,
          height: 520,
        },
        {
          panelId: "panel-risk-drawdown",
          widgetType: "drawdown",
          widgetConfig: { ...ALL },
          title: "Drawdown",
          span: 2,
          height: 420,
        },
        {
          panelId: "panel-risk-locks",
          widgetType: "pair-locks",
          widgetConfig: { ...ALL },
          title: "Pair Locks",
          span: 3,
          height: 260,
        },
        {
          panelId: "panel-risk-balance",
          widgetType: "balance",
          widgetConfig: { ...ALL },
          title: "Balance",
          span: 2,
          height: 340,
        },
      ]),
  },
  {
    id: "page-preset-market",
    title: "Market Watch",
    description: "Watchlist, movers, tape and calendar for market awareness.",
    icon: "globe",
    widgets: [
      "watchlist",
      "market-movers",
      "ticker-tape",
      "session-clock",
      "candle-chart",
      "pair-universe",
    ],
    build: () =>
      buildPresetWorkspace("page-preset-market", "Market Watch", "globe", [
        {
          panelId: "panel-market-watch",
          widgetType: "watchlist",
          widgetConfig: {},
          title: "Watchlist",
          span: 2,
          height: 260,
        },
        {
          panelId: "panel-market-movers",
          widgetType: "market-movers",
          widgetConfig: {},
          title: "Market Movers",
          span: 2,
          height: 390,
        },
        {
          panelId: "panel-market-tape",
          widgetType: "ticker-tape",
          widgetConfig: {},
          title: "Ticker Tape",
          span: 2,
          height: 160,
        },
        {
          panelId: "panel-market-clock",
          widgetType: "session-clock",
          widgetConfig: {},
          title: "Session Clock",
          span: 2,
          height: 220,
        },
        {
          panelId: "panel-market-chart",
          widgetType: "candle-chart",
          widgetConfig: {},
          title: "Chart",
          span: 3,
          height: 640,
        },
        {
          panelId: "panel-market-universe",
          widgetType: "pair-universe",
          widgetConfig: { ...ALL },
          title: "Pair Universe",
          span: 3,
          height: 530,
        },
      ]),
  },
];

export const PRESET_PAGE_IDS: ReadonlyArray<string> = PRESET_PAGES.map(
  (page) => page.id,
);

export function isPresetPageId(id: string): boolean {
  return PRESET_PAGE_IDS.some((presetId) => presetId === id);
}

export function getPresetPage(id: string): PresetPage | undefined {
  return PRESET_PAGES.find((page) => page.id === id);
}

/**
 * Rebuild a stored preset page from its canonical preset definition,
 * preserving document identity (id, version chain, user rename).
 */
export function refreshPresetWorkspace(
  stored: Workspace,
  preset: PresetPage,
  _band: PresetAspectBand = "standard",
): Workspace {
  const fresh = preset.build();

  return {
    ...fresh,
    id: stored.id,
    name: stored.name,
    version: stored.version,
  };
}

/**
 * True for panels shipped with a preset page. Preset pages are fully
 * editable seeds — no panel is ever locked, every tab stays editable.
 */
export function isPresetBuiltInPanel(
  _pageId: string,
  _panelId: string,
): boolean {
  return false;
}

/**
 * Home page — the landing page. Unlike custom pages it is public-readable:
 * the layout persists to the backend `page-home` document (shared with
 * signed-out/incognito visitors) with `localStorage` (key
 * `HOME_STORAGE_KEY`) as the instant cache and offline fallback.
 */
export const HOME_PAGE_ID = "page-home";

export const HOME_STORAGE_KEY = "nfi-home-page";

/**
 * Which shipped default the local Home was seeded from. Bumped when the
 * default layout changes; stored next to the home in
 * `HOME_SEED_STORAGE_KEY` so untouched homes can be recognized and
 * upgraded while customized ones are left alone.
 */
export const HOME_SEED_VERSION = 5;

export const HOME_SEED_STORAGE_KEY = "nfi-home-seed";

export function isHomePageId(id: string): boolean {
  return id === HOME_PAGE_ID;
}

/** Fresh default Home workspace (full terminal, editable). Callers may mutate. */
export function buildHomePage(): Workspace {
  const base = buildDefaultWorkspace();

  return {
    ...base,
    id: Schema.decodeSync(WorkspaceId)(HOME_PAGE_ID),
    name: "Home",
  };
}

/**
 * Structural fingerprint (layout kind + widget-type multiset) of a home
 * workspace. It identifies untouched defaults without keeping a full copy
 * of the old layout: any user edit changes the multiset and blocks the
 * auto-upgrade.
 */
export function homeFingerprint(workspace: Workspace): string {
  const types = Object.values(workspace.panels)
    .map((panel) => panel.widgetType)
    .sort()
    .join(",");

  const layout = workspace.layout;

  let template: string;

  switch (layout.type) {
    case "auto":
      template = `auto:${layout.items.length}`;
      break;

    case "flow":
      template = `flow:${layout.items.length}`;
      break;

    case "masonry":
      template = `masonry:${layout.items.length}`;
      break;

    case "grid":
      template = `grid:${layout.columns.length}x${layout.rows.length}`;
      break;

    default:
      template = layout.type;
  }

  return `${template}:${types}`;
}

const V1_HOME_FINGERPRINT =
  "grid:3x4:balance,bot-status,candle-chart,closed-positions,open-positions,profit,ticker-tape";

const V2_HOME_FINGERPRINT =
  "grid:2x3:closed-positions,cumulative-profit,daily-profit,fleet-overview,open-positions,wallet-history";

const V3_HOME_FINGERPRINT =
  "auto:6:closed-positions,cumulative-profit,daily-profit,fleet-overview,open-positions,wallet-history";

/**
 * Returns the fresh default home when `stored` still looks like an
 * untouched shipped default, else `null` (the user customized their home —
 * keep it and let them reach the new default via Reset).
 */
export function maybeUpgradeStoredHome(workspace: Workspace): Workspace | null {
  const fingerprint = homeFingerprint(workspace);

  if (
    fingerprint !== V1_HOME_FINGERPRINT &&
    fingerprint !== V2_HOME_FINGERPRINT &&
    fingerprint !== V3_HOME_FINGERPRINT
  )
    return null;

  return buildHomePage();
}

export type { LayoutNode };
