// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  decodeWorkspace,
  type PanelId,
  type Workspace,
} from "@nfi/api-contract";
import { collectPanelIds, openWidget } from "@nfi/widget-sdk";
import { buildGridFromShape, type GridShape } from "./layouts";
import { buildDefaultWorkspace } from "./defaultWorkspace";

/**
 * Preset pages — curated, read-only dashboards covering common use cases.
 *
 * Presets are OPT-IN: the app ships with Home only, and every preset is
 * offered in the Add-page dialog ("+" in the pages bar). Adding one stores
 * its built workspace in the backend (stable `page-*` id, `origin: "user"`)
 * where it persists until deleted; deleting just removes the stored copy —
 * the preset stays available in the dialog to re-add later.
 *
 * Every preset is a DENSE terminal grid in the Bloomberg sense: 10-12
 * panels visible at once, one widget per cell, mixed spans (hero charts,
 * full-width strips), nothing hidden behind tabs. Users who want a
 * different arrangement create their own custom pages (fully editable,
 * same grid presets in the Layouts dialog) with an optional pages-bar
 * icon.
 *
 * Screen-ratio adaptation — aspect-banded curation: a single fixed shape
 * cannot fit every monitor, but preset pages are locked by design. Each
 * preset may therefore declare `variants` — alternate curated shapes for
 * `wide` (aspect ≥ 2, ultrawide) and `compact` (aspect ≤ 1.4, 4:3/splits)
 * viewports. Every variant has exactly as many cells as the page has
 * widgets, so the same widget sequence deals one-per-cell in the same
 * reading order: roles and hierarchy stay identical, only geometry
 * adapts. The viewport's band selects the shape through the SAME curation
 * pipeline (`build(band)` / `refreshPresetWorkspace(…, band)`) — the
 * persisted preset layout IS the banded curated grid, so interactions
 * never see a second tree.
 *
 * Every panel uses default widget config; schemas fill in decoding
 * defaults. Preset page ids are stable (`page-*`) so they double as the
 * durable backend workspace ids.
 */

/**
 * Icon keys renderable in the pages bar (mapped to Carbon icons in
 * `PagesBar`). The first seven are used by preset pages; the rest exist
 * for custom pages, whose chosen key persists on the workspace document.
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
  | "layers";

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
];

/** True when `value` is a renderable pages-bar icon key. */
export function isPageIconKey(value: string): value is PageIconKey {
  return (PAGE_ICON_KEYS as ReadonlyArray<string>).includes(value);
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

/** Viewport aspect bands a preset page can curate for. */
export type PresetAspectBand = "wide" | "standard" | "compact";

/** Aspect at/above which the `wide` variant is used (21:9 ≈ 2.33). */
export const PRESET_ASPECT_WIDE = 2.0;
/** Aspect at/below which the `compact` variant is used (4:3 ≈ 1.33). */
export const PRESET_ASPECT_COMPACT = 1.4;

/** Classify a width/height ratio into a preset aspect band. */
export function presetAspectBand(aspect: number): PresetAspectBand {
  if (aspect >= PRESET_ASPECT_WIDE) return "wide";
  if (aspect <= PRESET_ASPECT_COMPACT) return "compact";
  return "standard";
}

export interface PresetPage {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  /** Header icon key (mapped to a Carbon icon in `PagesBar`). */
  readonly icon: PageIconKey;
  /** One widget per cell, in cell order (must match `shape.cells`). */
  readonly widgets: ReadonlyArray<
    string | { type: string; config: Record<string, unknown> }
  >;
  /** The canonical shape (the `standard` band, tuned for ~16:9). */
  readonly shape: GridShape;
  /**
   * Alternate curated shapes per aspect band. Each variant must keep
   * `cells.length === widgets.length` (one widget per cell, same reading
   * order); a missing variant falls back to `shape`.
   */
  readonly variants?: Partial<Record<"wide" | "compact", GridShape>>;
  readonly build: (band?: PresetAspectBand) => Workspace;
}

function buildPageWorkspace(
  pageId: string,
  name: string,
  widgets: PresetPage["widgets"],
  shape: GridShape,
): Workspace {
  const panelIds: PanelId[] = [];
  const panels: Record<
    string,
    { id: string; widgetType: string; widgetConfig: Record<string, unknown> }
  > = {};
  widgets.forEach((entry, index) => {
    const [widgetType, widgetConfig] =
      typeof entry === "string" ? [entry, {}] : [entry.type, entry.config];
    const id = `${pageId}-panel-${index}`;
    panels[id] = { id, widgetType, widgetConfig };
    panelIds.push(id as PanelId);
  });
  // One widget per cell: chunks align with cells 1:1 when counts match, and
  // degrade gracefully (fewer widgets than cells fills fewer cells).
  const layout = buildGridFromShape(panelIds, shape) ?? {
    type: "tabs",
    id: `tabs-${pageId}`,
    panels: panelIds,
    activePanelId: panelIds[0] ?? null,
  };
  return decodeWorkspace({
    id: pageId,
    name,
    schemaVersion: 1,
    version: 0,
    layout,
    panels,
    activePanelId: panelIds[0] ?? null,
    // Preset documents are only ever stored because the user added the
    // page — the marker distinguishes them from legacy auto-seeded copies
    // (which hydration deletes).
    origin: "user",
  });
}

const page = (def: Omit<PresetPage, "build">): PresetPage => ({
  ...def,
  build: (band: PresetAspectBand = "standard") => {
    // `standard` is the canonical `shape`; variants only cover the extremes.
    const variant = band === "standard" ? undefined : def.variants?.[band];
    return buildPageWorkspace(
      def.id,
      def.title,
      def.widgets,
      variant ?? def.shape,
    );
  },
});

export const PRESET_PAGES: ReadonlyArray<PresetPage> = [
  // Landing glance: the whole fleet in one hero table, headline profit and
  // wallet beside it, the live books and the tape below. Fleet-wide configs.
  page({
    id: "page-overview",
    title: "Overview",
    description:
      "Fleet glance — every bot's health, headline profit, wallet, live positions and the tape.",
    icon: "dashboard",
    widgets: [
      "fleet-overview",
      { type: "profit", config: { instanceId: "all" } },
      { type: "balance", config: { instanceId: "all" } },
      { type: "open-positions", config: { instanceId: "all" } },
      { type: "exposure", config: { instanceId: "all" } },
      { type: "ticker-tape", config: { instanceId: "all" } },
    ],
    shape: {
      columns: [1.4, 1, 1],
      rows: [1.2, 1.2, 0.4],
      cells: [
        { col: 1, row: 1, rowSpan: 2 },
        { col: 2, row: 1 },
        { col: 3, row: 1 },
        { col: 2, row: 2 },
        { col: 3, row: 2 },
        { col: 1, row: 3, colSpan: 3 },
      ],
    },
    // Ultrawide: drop the hero's vertical span so all six cells read in two
    // full rows; compact: two columns by three rows.
    variants: {
      wide: {
        columns: [1.4, 1, 1],
        rows: [1, 1],
        cells: [
          { col: 1, row: 1 },
          { col: 2, row: 1 },
          { col: 3, row: 1 },
          { col: 1, row: 2 },
          { col: 2, row: 2 },
          { col: 3, row: 2 },
        ],
      },
      compact: {
        columns: [1, 1],
        rows: [1, 1, 1],
        cells: [
          { col: 1, row: 1 },
          { col: 2, row: 1 },
          { col: 1, row: 2 },
          { col: 2, row: 2 },
          { col: 1, row: 3 },
          { col: 2, row: 3 },
        ],
      },
    },
  }),
  // The public wall: percent-only widgets — performance index hero over
  // relative headline stats, both percent books, entry stats strip. Nothing
  // here can leak a balance or an absolute profit. 6 panels.
  page({
    id: "page-public",
    title: "Public",
    description:
      "Share-safe wall — percent-only widgets; no balances, stakes or absolute PnL.",
    icon: "screen",
    widgets: [
      "equity-relative",
      "profit-relative",
      "balance-relative",
      "positions-open-relative",
      "closed-positions-relative",
      "tag-performance-relative",
    ],
    shape: {
      columns: [1.3, 1, 1],
      rows: [0.7, 1.3, 1.3],
      cells: [
        { col: 1, row: 1, rowSpan: 2 },
        { col: 2, row: 1 },
        { col: 3, row: 1 },
        { col: 2, row: 2 },
        { col: 3, row: 2 },
        { col: 1, row: 3, colSpan: 3 },
      ],
    },
    variants: {
      wide: {
        columns: [1.3, 1, 1],
        rows: [1, 1],
        cells: [
          { col: 1, row: 1 },
          { col: 2, row: 1 },
          { col: 3, row: 1 },
          { col: 1, row: 2 },
          { col: 2, row: 2 },
          { col: 3, row: 2 },
        ],
      },
      compact: {
        columns: [1, 1],
        rows: [1, 1, 1],
        cells: [
          { col: 1, row: 1 },
          { col: 2, row: 1 },
          { col: 1, row: 2 },
          { col: 2, row: 2 },
          { col: 1, row: 3 },
          { col: 2, row: 3 },
        ],
      },
    },
  }),
  // The trading wall: headline stats on top, candle hero between the two
  // position books, live tape below. 7 panels.
  page({
    id: "page-trading",
    title: "Trading",
    description:
      "The full terminal: status, profit, candles, both position books, live tape.",
    icon: "candlestick",
    widgets: [
      "bot-status",
      "profit",
      "balance",
      "open-positions",
      "candle-chart",
      "closed-positions",
      "ticker-tape",
    ],
    shape: {
      columns: [1, 1.6, 1.2],
      rows: [0.85, 1.5, 1.5, 0.55],
      cells: [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
        { col: 3, row: 1 },
        { col: 1, row: 2, rowSpan: 2 },
        { col: 2, row: 2, rowSpan: 2 },
        { col: 3, row: 2, rowSpan: 2 },
        { col: 1, row: 4, colSpan: 3 },
      ],
    },
    variants: {
      wide: {
        columns: [1, 1, 1, 1],
        rows: [1, 1],
        cells: [
          { col: 1, row: 1 },
          { col: 2, row: 1 },
          { col: 3, row: 1 },
          { col: 4, row: 1 },
          { col: 1, row: 2, colSpan: 2 },
          { col: 3, row: 2 },
          { col: 4, row: 2 },
        ],
      },
      compact: {
        columns: [1, 1],
        rows: [1, 1, 1, 0.55],
        cells: [
          { col: 1, row: 1 },
          { col: 2, row: 1 },
          { col: 1, row: 2 },
          { col: 2, row: 2 },
          { col: 1, row: 3 },
          { col: 2, row: 3 },
          { col: 1, row: 4, colSpan: 2 },
        ],
      },
    },
  }),
  // Markets desk: one dominant chart, watch/movers beside it, tapes below.
  // 5 panels, nothing cramped.
  page({
    id: "page-markets",
    title: "Markets",
    description: "Hero candles, watchlist, movers and the trade tape.",
    icon: "globe",
    widgets: [
      "candle-chart",
      "watchlist",
      "market-movers",
      "trade-tape",
      "ticker-tape",
    ],
    shape: {
      columns: [1.8, 1],
      rows: [1.7, 1, 0.55],
      cells: [
        { col: 1, row: 1, rowSpan: 2 },
        { col: 2, row: 1 },
        { col: 2, row: 2 },
        { col: 1, row: 3 },
        { col: 2, row: 3 },
      ],
    },
    variants: {
      wide: {
        columns: [1.4, 1, 1],
        rows: [1, 1],
        cells: [
          { col: 1, row: 1 },
          { col: 2, row: 1 },
          { col: 3, row: 1 },
          { col: 1, row: 2 },
          { col: 2, row: 2, colSpan: 2 },
        ],
      },
      compact: {
        columns: [1],
        rows: [1.4, 1, 1, 1, 1],
        cells: [
          { col: 1, row: 1 },
          { col: 1, row: 2 },
          { col: 1, row: 3 },
          { col: 1, row: 4 },
          { col: 1, row: 5 },
        ],
      },
    },
  }),
  // Attribution desk: equity hero over profit buckets; tag/strategy/pair
  // attribution with room to read. 8 panels, no filler.
  page({
    id: "page-performance",
    title: "Performance",
    description:
      "Attribution: equity hero, profit buckets, tag/strategy/pair stats.",
    icon: "activity",
    widgets: [
      "equity",
      "daily-profit",
      "cumulative-profit",
      "tag-performance",
      "strategy-breakdown",
      "drawdown",
      "pair-summary",
      "performance-stats",
    ],
    shape: {
      columns: [1.2, 1, 1],
      rows: [1.25, 1.25, 1.25],
      cells: [
        { col: 1, row: 1, rowSpan: 2 },
        { col: 2, row: 1 },
        { col: 3, row: 1 },
        { col: 2, row: 2 },
        { col: 3, row: 2 },
        { col: 1, row: 3 },
        { col: 2, row: 3 },
        { col: 3, row: 3 },
      ],
    },
    variants: {
      wide: {
        columns: [1, 1, 1, 1],
        rows: [1, 1],
        cells: [
          { col: 1, row: 1 },
          { col: 2, row: 1 },
          { col: 3, row: 1 },
          { col: 4, row: 1 },
          { col: 1, row: 2 },
          { col: 2, row: 2 },
          { col: 3, row: 2 },
          { col: 4, row: 2 },
        ],
      },
      compact: {
        columns: [1, 1],
        rows: [1, 1, 1, 1],
        cells: [
          { col: 1, row: 1 },
          { col: 2, row: 1 },
          { col: 1, row: 2 },
          { col: 2, row: 2 },
          { col: 1, row: 3 },
          { col: 2, row: 3 },
          { col: 1, row: 4 },
          { col: 2, row: 4 },
        ],
      },
    },
  }),
  // Risk desk: guardrails across the top, tall open book on the left,
  // locks/universe and the closed book around it. 8 panels.
  page({
    id: "page-risk",
    title: "Risk",
    description:
      "Exposure, guardrails, drawdown, locks and the position books.",
    icon: "warning",
    widgets: [
      "risk-monitor",
      "exposure",
      "drawdown",
      "open-positions",
      "pair-locks",
      "pair-universe",
      "closed-positions",
      "balance",
    ],
    shape: {
      columns: [1, 1.2, 1.2],
      rows: [1.1, 1.35, 1.35],
      cells: [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
        { col: 3, row: 1 },
        { col: 1, row: 2, rowSpan: 2 },
        { col: 2, row: 2 },
        { col: 3, row: 2 },
        { col: 2, row: 3 },
        { col: 3, row: 3 },
      ],
    },
    variants: {
      wide: {
        columns: [1, 1, 1, 1],
        rows: [1, 1],
        cells: [
          { col: 1, row: 1 },
          { col: 2, row: 1 },
          { col: 3, row: 1 },
          { col: 4, row: 1 },
          { col: 1, row: 2 },
          { col: 2, row: 2 },
          { col: 3, row: 2 },
          { col: 4, row: 2 },
        ],
      },
      compact: {
        columns: [1, 1],
        rows: [1, 1, 1, 1],
        cells: [
          { col: 1, row: 1 },
          { col: 2, row: 1 },
          { col: 1, row: 2 },
          { col: 2, row: 2 },
          { col: 1, row: 3 },
          { col: 2, row: 3 },
          { col: 1, row: 4 },
          { col: 2, row: 4 },
        ],
      },
    },
  }),
  // Control room: fleet table, instance manager, connection health and the
  // connections table. 5 panels, everything readable.
  page({
    id: "page-system",
    title: "System",
    description:
      "Fleet overview, instance management and connections — the control room.",
    icon: "tools",
    widgets: [
      "fleet-overview",
      "connection",
      "instances",
      "bot-config",
      "instances-table",
    ],
    shape: {
      columns: [1.2, 1],
      rows: [1.1, 1.1, 1],
      cells: [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
        { col: 1, row: 2 },
        { col: 2, row: 2 },
        { col: 1, row: 3, colSpan: 2 },
      ],
    },
    variants: {
      wide: {
        columns: [1.2, 1, 1],
        rows: [1, 1],
        cells: [
          { col: 1, row: 1 },
          { col: 2, row: 1 },
          { col: 3, row: 1 },
          { col: 1, row: 2 },
          { col: 2, row: 2, colSpan: 2 },
        ],
      },
      compact: {
        columns: [1],
        rows: [1, 1, 1, 1, 1],
        cells: [
          { col: 1, row: 1 },
          { col: 1, row: 2 },
          { col: 1, row: 3 },
          { col: 1, row: 4 },
          { col: 1, row: 5 },
        ],
      },
    },
  }),
];

export const PRESET_PAGE_IDS: ReadonlyArray<string> = PRESET_PAGES.map(
  (p) => p.id,
);

export function isPresetPageId(id: string): boolean {
  return PRESET_PAGE_IDS.includes(id);
}

export function getPresetPage(id: string): PresetPage | undefined {
  return PRESET_PAGES.find((p) => p.id === id);
}

/**
 * Re-curate a stored preset page against the current code-defined shape.
 *
 * Preset layouts are read-only, so the curated grid always wins: built-in
 * cells come from `preset.build(band)` (so shipping a denser preset — or
 * the viewport crossing an aspect band — updates every existing backend),
 * while each built-in panel keeps its STORED config (per-widget ⚙ settings
 * persist) and any user-added tabs are re-attached in their stored order.
 * Returns the input unchanged when the stored page already matches (no
 * churn, no version bump).
 */
export function refreshPresetWorkspace(
  stored: Workspace,
  preset: PresetPage,
  band: PresetAspectBand = "standard",
): Workspace {
  const curated = preset.build(band);
  const prefix = `${preset.id}-panel-`;
  const panels: Record<string, Workspace["panels"][string]> = {
    ...curated.panels,
  };
  const userIds: PanelId[] = [];
  for (const [id, instance] of Object.entries(stored.panels)) {
    if (id.startsWith(prefix)) {
      // Built-in: curated placement, stored config.
      panels[id] = instance;
    } else {
      userIds.push(id as PanelId);
    }
  }
  let refreshed: Workspace = {
    ...curated,
    panels,
    activePanelId: curated.activePanelId,
    // Re-curation rebuilds from the code-defined document; the stored
    // page's own metadata (icon, origin) survives the rebuild.
    icon: stored.icon,
    origin: stored.origin,
  };
  for (const pid of userIds) {
    const instance = stored.panels[pid];
    if (!instance) continue;
    refreshed = openWidget(
      refreshed,
      instance.widgetType,
      instance.widgetConfig,
      { panelId: pid },
    ).workspace;
  }
  const sameLayout =
    JSON.stringify(refreshed.layout, skipNodeIds) ===
    JSON.stringify(stored.layout, skipNodeIds);
  const samePanels =
    JSON.stringify(refreshed.panels) === JSON.stringify(stored.panels);
  if (sameLayout && samePanels) return stored;
  return { ...refreshed, version: stored.version + 1 };
}

/**
 * JSON replacer that skips layout node ids: they are freshly generated on
 * every build, so geometry equality (tracks, spans, placement, panel
 * order) must be compared without them.
 */
const skipNodeIds = (_key: string, value: unknown): unknown =>
  _key === "id" ? undefined : value;

/**
 * True for panels shipped with a preset page (built-in tabs). Preset builds
 * name their panels `${pageId}-panel-N`, while user-added tabs get random
 * ids — so the prefix cleanly separates locked preset tabs from editable
 * user tabs without any schema change.
 */
export function isPresetBuiltInPanel(pageId: string, panelId: string): boolean {
  return isPresetPageId(pageId) && panelId.startsWith(`${pageId}-panel-`);
}

/**
 * Home page — the landing page. Unlike preset pages every tab is editable,
 * and unlike custom pages the whole workspace persists locally in
 * `localStorage` (key `HOME_STORAGE_KEY`) instead of the backend SQLite.
 * Sections = layout + panels + tabs, all local.
 */
export const HOME_PAGE_ID = "page-home";
export const HOME_STORAGE_KEY = "nfi-home-page";
/**
 * Which shipped default the local Home was seeded from. Bumped when the
 * default layout changes; stored next to the home in
 * `HOME_SEED_STORAGE_KEY` so untouched homes can be recognized and
 * upgraded while customized ones are left alone.
 */
export const HOME_SEED_VERSION = 2;
export const HOME_SEED_STORAGE_KEY = "nfi-home-seed";

export function isHomePageId(id: string): boolean {
  return id === HOME_PAGE_ID;
}

/** Fresh default Home workspace (full terminal, editable). Callers may mutate. */
export function buildHomePage(): Workspace {
  const base = buildDefaultWorkspace();
  return { ...base, id: HOME_PAGE_ID as Workspace["id"], name: "Home" };
}

/**
 * Structural fingerprint (grid shape + widget-type multiset) of a home
 * workspace. It identifies the untouched v1 default without keeping a full
 * copy of the old layout: any user edit — added tab, moved panel, changed
 * widget — changes the multiset or the shape and blocks the auto-upgrade.
 */
export function homeFingerprint(workspace: Workspace): string {
  const types = Object.values(workspace.panels)
    .map((panel) => panel.widgetType)
    .sort()
    .join(",");
  const layout = workspace.layout;
  const shape =
    layout.type === "grid"
      ? `grid:${layout.columns.length}x${layout.rows.length}`
      : layout.type;
  return `${shape}:${types}`;
}

const V1_HOME_FINGERPRINT =
  "grid:3x4:balance,bot-status,candle-chart,closed-positions,open-positions,profit,ticker-tape";

/**
 * Returns the fresh default home when `stored` still looks exactly like the
 * untouched v1 default, else `null` (the user customized their home — keep
 * it and let them reach the new default via Reset).
 */
export function maybeUpgradeStoredHome(workspace: Workspace): Workspace | null {
  if (homeFingerprint(workspace) !== V1_HOME_FINGERPRINT) return null;
  return buildHomePage();
}
