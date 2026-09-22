// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Store } from "@tanstack/store";
import {
  decodePersistedWorkspace,
  migrateWorkspace,
  type Capability,
  type LayoutNode,
  type PanelId,
  type SplitDirection,
  type Workspace,
} from "@nfi/api-contract";
import {
  activatePanel as activatePanelOp,
  activateTab as activateTabOp,
  closePanel as closePanelOp,
  collectPanelIds,
  createLayoutNodeId,
  cycleTab as cycleTabOp,
  findEnclosingGrid,
  findFirstTabs,
  findTabsById,
  findTabsWithPanel,
  movePanelToTabs as movePanelToTabsOp,
  openWidget as openWidgetOp,
  replaceTabsSubtree as replaceTabsSubtreeOp,
  replaceWorkspaceLayout as replaceWorkspaceLayoutOp,
  resizeSplit as resizeSplitOp,
  setGridTracks as setGridTracksOp,
  setPanelConfig as setPanelConfigOp,
  setPanelTitle as setPanelTitleOp,
  splitGridCell as splitGridCellOp,
  type OpenWidgetOptions,
} from "@nfi/widget-sdk";
import { chooseSplitDirection, missingCapabilities } from "@nfi/widget-sdk";
import { formatQueryError, runApi } from "../api";
import { capabilitiesStore } from "../auth/capabilities";
import {
  DEFAULT_WORKSPACE_ID,
  buildDefaultWorkspace,
} from "./defaultWorkspace";
import {
  addFloatingTab,
  cascadePosition,
  clearFloatingTabsForPage,
  FLOATING_MIN_HEIGHT,
  FLOATING_MIN_WIDTH,
  floatingTabsForPage,
  removeFloatingTab,
  setFloatingWidgetConfig,
} from "./floating";
import { buildEmptyGridLayout, buildGridLayout } from "./layouts";
import {
  HOME_PAGE_ID,
  HOME_SEED_STORAGE_KEY,
  HOME_SEED_VERSION,
  HOME_STORAGE_KEY,
  PRESET_PAGES,
  buildHomePage,
  getPresetPage,
  isPageIconKey,
  maybeUpgradeStoredHome,
  normalizePageIcon,
  presetAspectBand,
  refreshPresetWorkspace,
  isHomePageId,
  isPresetBuiltInPanel,
  isPresetPageId,
  type PageIconKey,
  type PresetAspectBand,
} from "./pages";

/**
 * Frontend workspace store — the single owner of interactive workspace state.
 *
 * Multi-page model: the header shows Home (landing page, fully editable,
 * persisted locally in `localStorage`) plus the pages the user added —
 * preset pages (opt-in curated dashboards, read-only grids) and custom
 * pages (fully editable). Each added page is one durable backend
 * `Workspace` document stamped `origin: "user"`; preset ids are stable
 * (`page-*`), custom ids are `page-custom-*`. Home (`page-home`) never
 * touches the backend. Older builds auto-seeded every preset into the
 * backend; hydration deletes those unmarked copies (best-effort) so every
 * deployment lands on the Home-only default.
 *
 * Added preset pages ship a fixed preset layout with pinned built-in
 * tabs: layout rearrangement (arrange/split/resize) and closing/moving
 * built-ins are no-ops while a preset page is active. Users may still add
 * tabs via the picker (dedupe is per tab group, so the same widget may sit
 * in several cells) — those user-added tabs are editable like normal
 * (close/move/configure/pin to floating) and persist with the page. Tab
 * activation and per-widget config work everywhere so live data keeps
 * functioning. Deleting an added preset page removes its stored copy; the
 * preset returns to the Add-page dialog for later re-adding.
 *
 * Interaction contract: every mutation applies a pure transformation
 * synchronously (immediate React render), then persistence is scheduled —
 * debounced and coalesced — through Effect RPC into SQLite. Ordinary
 * interactions NEVER block on the server round trip.
 *
 * ```text
 * User action → pure op → local state → immediate render
 *                                        → debounce 600ms → Effect RPC → SQLite
 * ```
 */

export type PersistenceStatus =
  "loading" | "ready" | "saving" | "saved" | "error" | "offline";

export interface PageSummary {
  readonly id: string;
  readonly name: string;
  readonly preset: boolean;
  /** The Home page: editable like a custom page, persisted in localStorage. */
  readonly home: boolean;
  /** Pages-bar icon key (custom pages; presets derive theirs from code). */
  readonly icon?: PageIconKey;
}

export interface WorkspaceStoreState {
  /** Active page workspace (kept for backward compat with renderer/picker). */
  readonly workspace: Workspace;
  readonly pages: ReadonlyArray<PageSummary>;
  readonly activePageId: string;
  readonly status: PersistenceStatus;
  /** Human detail for error/offline states; null otherwise. */
  readonly detail: string | null;
  readonly lastSavedAt: string | null;
  readonly backendAvailable: boolean;
}

export const PERSIST_DEBOUNCE_MS = 600;
const PERSIST_RETRY_MS = 10_000;
const ACTIVE_PAGE_KEY = "nfi-active-page";

const initialWorkspace = buildHomePage();

export const workspaceStore = new Store<WorkspaceStoreState>({
  workspace: initialWorkspace,
  pages: [
    {
      id: initialWorkspace.id,
      name: initialWorkspace.name,
      preset: false,
      home: true,
    },
  ],
  activePageId: initialWorkspace.id,
  status: "loading",
  detail: null,
  lastSavedAt: null,
  backendAvailable: true,
});

/** In-memory cache of every hydrated page workspace, keyed by page id. */
const pageCache = new Map<string, Workspace>([
  [initialWorkspace.id, initialWorkspace],
]);

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let persistInFlight = false;
let persistAfterFlight = false;

function clearRetry(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry(): void {
  if (retryTimer !== null) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void persistWorkspaceNow();
  }, PERSIST_RETRY_MS);
}

export function schedulePersist(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistWorkspaceNow();
  }, PERSIST_DEBOUNCE_MS);
}

/** Persist the current snapshot now (explicit actions like Reset use this). */
export async function persistWorkspaceNow(): Promise<void> {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (persistInFlight) {
    persistAfterFlight = true;
    return;
  }
  persistInFlight = true;
  try {
    const snapshot = workspaceStore.state.workspace;
    pageCache.set(snapshot.id, snapshot);
    // Home never touches the backend — sections persist in localStorage.
    if (isHomePageId(snapshot.id)) {
      saveHomePageLocal(snapshot);
      workspaceStore.setState((state) => ({
        ...state,
        status: "saved",
        detail: null,
        lastSavedAt: new Date().toISOString(),
      }));
      return;
    }
    workspaceStore.setState((state) => ({
      ...state,
      status: "saving",
      detail: null,
    }));
    try {
      await runApi((client) =>
        client.Workspace.save({
          path: { id: snapshot.id },
          payload: { workspace: snapshot },
        }),
      );
      clearRetry();
      workspaceStore.setState((state) =>
        state.workspace.version === snapshot.version
          ? {
              ...state,
              status: "saved",
              detail: null,
              lastSavedAt: new Date().toISOString(),
              backendAvailable: true,
            }
          : { ...state, status: "saving", backendAvailable: true },
      );
      if (workspaceStore.state.workspace.version !== snapshot.version) {
        schedulePersist();
      }
    } catch (error) {
      workspaceStore.setState((state) => ({
        ...state,
        status: "error",
        backendAvailable: false,
        detail: formatQueryError(error) ?? "Workspace persistence failed",
      }));
      // Local state is untouched — the next mutation (or this retry) persists.
      scheduleRetry();
    }
  } finally {
    persistInFlight = false;
    if (persistAfterFlight) {
      persistAfterFlight = false;
      void persistWorkspaceNow();
    }
  }
}

/** Commit a pure transformation result; no-op transforms skip persistence. */
function commit(next: Workspace, prev: Workspace): boolean {
  if (next === prev) return false;
  pageCache.set(next.id, next);
  // Home persists locally on every commit — no backend round trip.
  if (isHomePageId(next.id)) {
    saveHomePageLocal(next);
    workspaceStore.setState((state) => ({
      ...state,
      workspace: next,
      pages: state.pages.map((p) =>
        p.id === next.id ? { ...p, name: next.name } : p,
      ),
      status: "saved",
      detail: null,
      lastSavedAt: new Date().toISOString(),
    }));
    return true;
  }
  workspaceStore.setState((state) => ({
    ...state,
    workspace: next,
    pages: state.pages.map((p) =>
      p.id === next.id ? { ...p, name: next.name } : p,
    ),
  }));
  schedulePersist();
  return true;
}

/** True while the active page is a read-only preset page. */
export function isActivePagePreset(): boolean {
  return isPresetPageId(workspaceStore.state.activePageId);
}

/** Layout rearrangement is refused on preset pages (the preset grid is fixed). */
function blockedOnPreset(): boolean {
  return isActivePagePreset();
}

/**
 * True when `panelId` is a locked built-in tab of the active preset page.
 * User-added tabs on preset pages (any other id) are editable like normal.
 */
function isActiveBuiltInPanel(panelId: string): boolean {
  return isPresetBuiltInPanel(workspaceStore.state.activePageId, panelId);
}

function readStoredActivePage(): string | null {
  try {
    return typeof localStorage === "undefined"
      ? null
      : localStorage.getItem(ACTIVE_PAGE_KEY);
  } catch {
    return null;
  }
}

function storeActivePage(id: string): void {
  try {
    if (typeof localStorage !== "undefined")
      localStorage.setItem(ACTIVE_PAGE_KEY, id);
  } catch {
    // Private mode — active page simply won't survive reloads.
  }
}

/** Record which shipped default produced the local Home (best effort). */
function writeHomeSeed(): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(HOME_SEED_STORAGE_KEY, String(HOME_SEED_VERSION));
    }
  } catch {
    // Quota / private mode — upgrade recognition still works via fingerprint.
  }
}

/** Load the Home workspace from localStorage; falls back to a fresh build. */
function loadHomePageLocal(): Workspace {
  try {
    if (typeof localStorage === "undefined") return buildHomePage();
    const raw = localStorage.getItem(HOME_STORAGE_KEY);
    if (!raw) {
      writeHomeSeed();
      return buildHomePage();
    }
    const stored = decodePersistedWorkspace(JSON.parse(raw));
    // Untouched homes from an older default silently move to the new one;
    // customized homes are kept (Reset gives the new layout on demand).
    const upgraded = maybeUpgradeStoredHome(stored);
    if (upgraded) {
      saveHomePageLocal(upgraded);
      writeHomeSeed();
      return upgraded;
    }
    writeHomeSeed();
    return stored;
  } catch {
    return buildHomePage();
  }
}

/** Persist the Home workspace to localStorage (all sections, local only). */
function saveHomePageLocal(workspace: Workspace): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(HOME_STORAGE_KEY, JSON.stringify(workspace));
    }
  } catch {
    // Quota / private mode — the in-memory cache still holds the edit.
  }
}

function buildEmptyCustomPage(
  id: string,
  name: string,
  icon?: PageIconKey,
): Workspace {
  return {
    ...buildDefaultWorkspace(),
    id: id as Workspace["id"],
    name,
    version: 0,
    layout: {
      type: "tabs",
      id: createLayoutNodeId("tabs"),
      panels: [],
      activePanelId: null,
    },
    panels: {},
    activePanelId: null,
    icon,
    origin: "user",
  };
}

let hydrated = false;

/**
 * The viewport aspect band preset pages are curated for (see `pages.ts`).
 * Detected once at module load so hydration curates with the real band —
 * no double commit after mount — and updated by `setWorkspaceAspectBand`.
 */
function detectAspectBand(): PresetAspectBand {
  if (typeof window === "undefined") return "standard";
  return presetAspectBand(window.innerWidth / Math.max(1, window.innerHeight));
}

let aspectBand = detectAspectBand();

/**
 * Re-curate preset pages for a new viewport aspect band. Crossing a band
 * (window moved to a monitor with a different ratio) re-builds the ACTIVE
 * preset page's curated grid from that band's variant shape; cached
 * inactive preset pages are re-curated lazily on their next build/hydrate.
 * Custom pages and Home are untouched — users control those, and grid
 * auto-stacking already covers narrow containers.
 */
export function setWorkspaceAspectBand(band: PresetAspectBand): void {
  if (band === aspectBand) return;
  aspectBand = band;
  const state = workspaceStore.state;
  const preset = getPresetPage(state.activePageId);
  if (!preset) return;
  const prev = state.workspace;
  const recurated = refreshPresetWorkspace(prev, preset, band);
  commit(recurated, prev);
}

/** Forget the hydration result so the next `hydrateWorkspace` reloads (backend switch). */
export function resetHydration(): void {
  hydrated = false;
}

/** Reload the durable workspace, replacing local state (used after a backend switch). */
export async function rehydrateWorkspace(): Promise<void> {
  resetHydration();
  await hydrateWorkspace();
}

function toSummaries(
  workspaces: ReadonlyArray<Workspace>,
  home: Workspace,
): PageSummary[] {
  const homeEntry: PageSummary = {
    id: home.id,
    name: home.name,
    preset: false,
    home: true,
  };
  // Added presets (backend copies exist) in code order, then customs
  // alphabetically — both only ever land here through the Add-page picker.
  const presets = PRESET_PAGES.filter((p) =>
    workspaces.some((w) => w.id === p.id),
  ).map((p) => ({
    id: p.id,
    name: workspaces.find((w) => w.id === p.id)?.name ?? p.title,
    preset: true as const,
    home: false as const,
  }));
  const customs = workspaces
    .filter((w) => !isPresetPageId(w.id) && !isHomePageId(w.id))
    .map((w) => ({
      id: w.id,
      name: w.name,
      preset: false as const,
      home: false as const,
      icon: normalizePageIcon(w.icon),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [homeEntry, ...presets, ...customs];
}

/**
 * Load all pages. Home is local; every other page is a backend document the
 * user added through the Add-page picker. Preset documents WITHOUT the
 * `origin: "user"` marker were auto-seeded by older builds — they are
 * best-effort deleted so every deployment lands on the Home-only default
 * (the presets stay available in the Add-page dialog). Offline falls back
 * to Home only.
 */
export async function hydrateWorkspace(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  workspaceStore.setState((state) => ({
    ...state,
    status: "loading",
    detail: null,
  }));
  // Home is always local — load it first so the landing page never waits
  // on the backend.
  const home = loadHomePageLocal();
  try {
    const listed = await runApi((client) => client.Workspace.list({}));
    const ids = listed.workspaces
      .map((w) => w.id)
      .filter((id) => !isHomePageId(id));
    const loaded: Workspace[] = [];
    for (const id of ids) {
      try {
        const res = await runApi((client) =>
          client.Workspace.load({ path: { id } }),
        );
        // Legacy split-tree documents migrate to grids on the way in; the
        // next save persists the migrated layout.
        let workspace = migrateWorkspace(res.workspace);
        const preset = getPresetPage(id);
        if (preset) {
          if (workspace.origin !== "user") {
            // Auto-seeded by an older build — retire it. Best-effort
            // delete: a failed remove retries on the next hydrate; the
            // page is hidden either way and stays offerable in the
            // Add-page dialog.
            void runApi((client) =>
              client.Workspace.remove({ path: { id } }),
            ).catch(() => undefined);
            continue;
          }
          // Added presets re-curate against the code-defined shape for the
          // current aspect band (shipping a denser preset, or moving the
          // window across bands, updates existing backends) while keeping
          // stored widget configs and re-attaching user-added tabs.
          // Persist when the stored copy is stale.
          const recurated = refreshPresetWorkspace(workspace, preset, aspectBand);
          if (recurated !== workspace) {
            workspace = recurated;
            void runApi((client) =>
              client.Workspace.save({
                path: { id: workspace.id },
                payload: { workspace },
              }),
            ).catch(() => undefined);
          }
        }
        loaded.push(workspace);
      } catch {
        // Backend copy missing or corrupt. Presets are deterministic, so
        // an added preset rebuilds locally (and re-persists on next save);
        // customs have no fallback and simply stay absent this session.
        const preset = getPresetPage(id);
        if (preset) loaded.push(preset.build(aspectBand));
      }
    }
    // The legacy "Default workspace" page is retired — Home is the editable
    // landing page now. Drop it from older backends so it never surfaces as
    // a page (best-effort delete; a failed remove just hides it locally).
    const legacyIndex = loaded.findIndex((w) => w.id === DEFAULT_WORKSPACE_ID);
    if (legacyIndex >= 0) {
      loaded.splice(legacyIndex, 1);
      void runApi((client) =>
        client.Workspace.remove({ path: { id: DEFAULT_WORKSPACE_ID } }),
      ).catch(() => undefined);
    }
    pageCache.clear();
    pageCache.set(home.id, home);
    for (const w of loaded) pageCache.set(w.id, w);
    const pages = toSummaries(loaded, home);
    const stored = readStoredActivePage();
    const storedActive = stored ? pageCache.get(stored) : undefined;
    // Home is the landing page unless the user last visited another page.
    const active: Workspace = storedActive ?? home;
    storeActivePage(active.id);
    workspaceStore.setState(() => ({
      workspace: active,
      pages,
      activePageId: active.id,
      status: "saved",
      detail: null,
      lastSavedAt: new Date().toISOString(),
      backendAvailable: true,
    }));
  } catch (error) {
    // Offline: no page list, so only Home (local) is shown. Added pages
    // return on the next successful hydrate.
    pageCache.clear();
    pageCache.set(home.id, home);
    const pages = toSummaries([], home);
    storeActivePage(home.id);
    workspaceStore.setState(() => ({
      workspace: home,
      pages,
      activePageId: home.id,
      status: "offline",
      backendAvailable: false,
      detail: `Backend unavailable (${formatQueryError(error) ?? "connection failed"}) — changes stay local until reconnect.`,
      lastSavedAt: null,
    }));
  }
}

// --- Page management (header pages) ----------------------------------------

/** Switch the active page. False for unknown ids. */
export function switchActivePage(pageId: string): boolean {
  const state = workspaceStore.state;
  if (state.activePageId === pageId) return true;
  const target = pageCache.get(pageId);
  if (!target) return false;
  // Keep the outgoing page in cache (it is already the cached snapshot —
  // every commit writes through, so no flush is needed).
  pageCache.set(state.workspace.id, state.workspace);
  storeActivePage(pageId);
  workspaceStore.setState((s) => ({
    ...s,
    workspace: target,
    activePageId: pageId,
    status: s.backendAvailable ? "saved" : s.status,
    detail: s.backendAvailable ? null : s.detail,
  }));
  return true;
}

/**
 * Add a preset page (curated dashboard) and switch to it. False for unknown
 * presets or ones already on the pages bar.
 */
export async function addPresetPage(presetId: string): Promise<boolean> {
  const preset = getPresetPage(presetId);
  if (!preset) return false;
  if (workspaceStore.state.pages.some((p) => p.id === preset.id)) return false;
  // `build` stamps `origin: "user"` — the marker that keeps this document
  // alive across hydrations (legacy auto-seeded presets get cleaned up).
  const built = preset.build(aspectBand);
  pageCache.set(preset.id, built);
  workspaceStore.setState((state) => ({
    ...state,
    workspace: built,
    pages: [
      ...state.pages,
      { id: preset.id, name: built.name, preset: true, home: false },
    ],
    activePageId: preset.id,
    status: "saving",
    detail: null,
  }));
  storeActivePage(preset.id);
  try {
    const created = await runApi((client) =>
      client.Workspace.create({
        payload: { name: built.name, workspace: built },
      }),
    );
    pageCache.set(created.workspace.id, created.workspace);
    workspaceStore.setState((state) => ({
      ...state,
      workspace:
        state.activePageId === preset.id ? created.workspace : state.workspace,
      pages: state.pages.map((p) =>
        p.id === preset.id ? { ...p, name: created.workspace.name } : p,
      ),
      status: "saved",
      lastSavedAt: new Date().toISOString(),
      backendAvailable: true,
    }));
  } catch {
    // Offline add — stays local until the next persist.
    schedulePersist();
  }
  return true;
}

/** Create a custom (fully editable) page and switch to it. */
export async function createCustomPage(
  name: string,
  icon?: PageIconKey,
): Promise<string> {
  const trimmed = name.trim().length > 0 ? name.trim() : "Untitled page";
  const id = `page-custom-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`;
  const page = buildEmptyCustomPage(id, trimmed, icon);
  pageCache.set(id, page);
  workspaceStore.setState((state) => ({
    ...state,
    workspace: page,
    pages: [...state.pages, { id, name: trimmed, preset: false, home: false, icon }],
    activePageId: id,
    status: "saving",
    detail: null,
  }));
  storeActivePage(id);
  try {
    const created = await runApi((client) =>
      client.Workspace.create({ payload: { name: trimmed, workspace: page } }),
    );
    pageCache.set(created.workspace.id, created.workspace);
    workspaceStore.setState((state) => ({
      ...state,
      workspace:
        state.activePageId === id ? created.workspace : state.workspace,
      pages: state.pages.map((p) =>
        p.id === id
          ? {
              ...p,
              name: created.workspace.name,
              icon: normalizePageIcon(created.workspace.icon),
            }
          : p,
      ),
      status: "saved",
      lastSavedAt: new Date().toISOString(),
      backendAvailable: true,
    }));
  } catch {
    // Offline create — stays local until the next persist.
    schedulePersist();
  }
  return id;
}

/**
 * Delete an added page (custom or preset). Home cannot be deleted; a deleted
 * preset returns to the Add-page dialog. False when refused.
 */
export async function deletePage(pageId: string): Promise<boolean> {
  if (isHomePageId(pageId)) return false;
  const state = workspaceStore.state;
  if (!pageCache.has(pageId)) return false;
  // The page is gone — its floating windows have nothing to return to.
  clearFloatingTabsForPage(pageId);
  const remaining = state.pages.filter((p) => p.id !== pageId);
  // Home always exists — fall back to it when the active page is deleted.
  const fallbackId = HOME_PAGE_ID;
  const nextActiveId =
    state.activePageId === pageId ? fallbackId : state.activePageId;
  const nextActive = pageCache.get(nextActiveId);
  if (!nextActive) return false;
  pageCache.delete(pageId);
  storeActivePage(nextActiveId);
  workspaceStore.setState((s) => ({
    ...s,
    workspace: nextActive,
    pages: remaining,
    activePageId: nextActiveId,
  }));
  try {
    await runApi((client) => client.Workspace.remove({ path: { id: pageId } }));
  } catch {
    // Backend delete failed (offline) — local removal stands; a later
    // hydrate will reconcile.
  }
  return true;
}

/** Rename a custom or Home page. Preset pages keep their curated titles. */
export function renameCustomPage(pageId: string, name: string): boolean {
  if (isPresetPageId(pageId)) return false;
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  const cached = pageCache.get(pageId);
  if (!cached) return false;
  const next: Workspace = {
    ...cached,
    name: trimmed,
    version: cached.version + 1,
  };
  pageCache.set(pageId, next);
  const persistLocal = isHomePageId(pageId);
  if (persistLocal) saveHomePageLocal(next);
  workspaceStore.setState((state) => ({
    ...state,
    workspace: state.activePageId === pageId ? next : state.workspace,
    pages: state.pages.map((p) =>
      p.id === pageId ? { ...p, name: trimmed } : p,
    ),
    ...(persistLocal && state.activePageId === pageId
      ? {
          status: "saved" as const,
          detail: null,
          lastSavedAt: new Date().toISOString(),
        }
      : null),
  }));
  if (persistLocal) return true;
  if (workspaceStore.state.activePageId === pageId) schedulePersist();
  else {
    // Persist the renamed inactive page directly (active page untouched).
    void runApi((client) =>
      client.Workspace.save({
        path: { id: next.id },
        payload: { workspace: next },
      }),
    ).catch(() => undefined);
  }
  return true;
}

// --- High-level operations (commands, picker, palette, renderer all use these) ---

/**
 * Resolve the tab group an open would land in (explicit target, else the
 * active panel's group, else the first group). Shared by open dedupe.
 */
function resolveOpenTargetGroup(
  workspace: Workspace,
  options: OpenWidgetOptions,
) {
  const explicit =
    options.targetTabsId !== undefined
      ? findTabsById(workspace.layout, options.targetTabsId)
      : undefined;
  if (explicit) return explicit;
  const anchor = options.targetPanelId ?? workspace.activePanelId;
  return (
    (anchor !== null
      ? findTabsWithPanel(workspace.layout, anchor)
      : undefined) ?? findFirstTabs(workspace.layout)
  );
}

/**
 * Capability-guarded open (cycle-free): callers pass the widget definition's
 * `capabilities` (they already hold the definition); the store refuses the
 * open when the granted set lacks any entry. Returns null when blocked so
 * callers can surface feedback instead of silently opening an unauthorized
 * placeholder. Omitting `requiredCapabilities` keeps legacy call sites
 * working (treated as public).
 *
 * Dedupe is GROUP-scoped on every page: a widget type already open in the
 * target tab group is focused instead of duplicated, while the same type in
 * a different group still opens a fresh instance — one widget per grid
 * cell, as many cells as wanted. Split a panel or open from another group
 * to intentionally duplicate a widget.
 */
export function openWidgetPanel(
  widgetType: string,
  config: unknown,
  options: OpenWidgetOptions = {},
  requiredCapabilities: ReadonlyArray<Capability> = [],
): PanelId | null {
  if (
    missingCapabilities(requiredCapabilities, capabilitiesStore.state.granted)
      .length > 0
  ) {
    return null;
  }
  const prev = workspaceStore.state.workspace;
  const group = resolveOpenTargetGroup(prev, options);
  const existing = group?.panels.find(
    (id) => prev.panels[id]?.widgetType === widgetType,
  );
  if (existing && group) {
    if (
      group.activePanelId === existing &&
      prev.activePanelId === (existing as PanelId)
    ) {
      return existing as PanelId;
    }
    commit(activateTabOp(prev, group.id, existing), prev);
    return existing as PanelId;
  }
  const { workspace, panelId } = openWidgetOp(
    prev,
    widgetType,
    config,
    options,
  );
  commit(workspace, prev);
  return panelId;
}

/**
 * Move a panel into another tab group (tab drag-and-drop). Returns false
 * when the move is a no-op (unknown ids). Built-in preset tabs are pinned;
 * user-added tabs move freely.
 */
export function moveWorkspacePanel(
  panelId: string,
  targetTabsId: string,
  targetIndex?: number,
): boolean {
  if (isActiveBuiltInPanel(panelId)) return false;
  const prev = workspaceStore.state.workspace;
  return commit(
    movePanelToTabsOp(prev, panelId, targetTabsId, targetIndex),
    prev,
  );
}

/**
 * Rearrange the open panels into a grid preset layout. No-op when there is
 * nothing to arrange, the preset is unknown (null layout), or the active
 * page is a preset (its layout is fixed).
 */
export function applyGridLayout(layout: LayoutNode | null): boolean {
  if (blockedOnPreset()) return false;
  if (!layout) return false;
  const prev = workspaceStore.state.workspace;
  if (collectPanelIds(prev.layout).length === 0) return false;
  return commit(replaceWorkspaceLayoutOp(prev, layout), prev);
}

export function closeWorkspacePanel(panelId: string): boolean {
  // Built-in preset tabs cannot be closed; user-added tabs close normally.
  if (isActiveBuiltInPanel(panelId)) return false;
  const prev = workspaceStore.state.workspace;
  return commit(closePanelOp(prev, panelId), prev);
}

export function closeActivePanel(): boolean {
  const active = workspaceStore.state.workspace.activePanelId;
  if (active === null) return false;
  return closeWorkspacePanel(active);
}

export function activateWorkspacePanel(panelId: string): boolean {
  const prev = workspaceStore.state.workspace;
  return commit(activatePanelOp(prev, panelId), prev);
}

export function activateWorkspaceTab(tabsId: string, panelId: string): boolean {
  const prev = workspaceStore.state.workspace;
  return commit(activateTabOp(prev, tabsId, panelId), prev);
}

export function cycleWorkspaceTab(direction: 1 | -1): boolean {
  const prev = workspaceStore.state.workspace;
  return commit(cycleTabOp(prev, direction), prev);
}

/**
 * Split the active panel's cell, duplicating its widget into the new cell.
 * Smart layouting: on narrow viewports a requested horizontal split becomes
 * vertical so both cells stay readable (persisted as the chosen direction).
 * No-op on preset pages.
 */
export function splitActivePanel(direction: SplitDirection): PanelId | null {
  if (blockedOnPreset()) return null;
  const prev = workspaceStore.state.workspace;
  const active = prev.activePanelId;
  if (active === null) return null;
  const instance = prev.panels[active];
  if (!instance) return null;
  const viewportWidth =
    typeof window === "undefined" ? 0 : (window.innerWidth ?? 0);
  const smart = chooseSplitDirection(direction, viewportWidth);
  const { workspace, panelId } = splitGridCellOp(prev, active, smart, {
    widgetType: instance.widgetType,
    config: instance.widgetConfig,
  });
  commit(workspace, prev);
  return panelId;
}

/** Resize one grid's tracks (dragged gutters). Values validated by the op. */
export function resizeWorkspaceGridTracks(
  gridId: string,
  axis: "columns" | "rows",
  tracks: number[],
): boolean {
  if (blockedOnPreset()) return false;
  const prev = workspaceStore.state.workspace;
  return commit(setGridTracksOp(prev, gridId, axis, tracks), prev);
}

/** Legacy split resize (pre-grid documents that slipped through migration). */
export function resizeWorkspaceSplit(splitId: string, ratio: number): boolean {
  if (blockedOnPreset()) return false;
  const prev = workspaceStore.state.workspace;
  return commit(resizeSplitOp(prev, splitId, ratio), prev);
}

/**
 * Rename a panel's tab. The custom title shows in tab strips and bare
 * panel headers; tooltips keep the widget's registry name. An empty/null
 * title clears the rename.
 */
export function renameWorkspacePanelTitle(
  panelId: string,
  title: string | null,
): boolean {
  const prev = workspaceStore.state.workspace;
  return commit(setPanelTitleOp(prev, panelId, title), prev);
}

export function updatePanelConfig(panelId: string, config: unknown): boolean {
  // Floating tabs keep their captured panel id, so config writes for them
  // (widget settings forms, invalid-config resets) land in the floating
  // entry instead of the workspace document.
  const activePageId = workspaceStore.state.activePageId;
  if (
    floatingTabsForPage(activePageId).some((tab) => tab.panelId === panelId)
  ) {
    return setFloatingWidgetConfig(
      activePageId,
      panelId,
      typeof config === "object" && config !== null
        ? (config as Record<string, unknown>)
        : {},
    );
  }
  const prev = workspaceStore.state.workspace;
  return commit(setPanelConfigOp(prev, panelId, config), prev);
}

/**
 * Pin a grid tab into the floating layer. The tab is REMOVED from the grid
 * (normal close op recomputes focus); its widget type, config and panel id
 * are captured into a floating entry so the floating Panel is the same
 * widget to every subsystem. Locked preset built-ins refuse (the curated
 * grid always wins); user-added tabs everywhere can float. Geometry
 * defaults to a cascade position and a sane starting size — the widget's
 * minimums are enforced by the floating window itself.
 */
export function pinTabToFloating(panelId: string): string | null {
  if (isActiveBuiltInPanel(panelId)) return null;
  const prev = workspaceStore.state.workspace;
  const instance = prev.panels[panelId];
  if (!instance) return null;
  const pageId = workspaceStore.state.activePageId;
  const index = floatingTabsForPage(pageId).length;
  const id = `float-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffff).toString(36)}`;
  const { x, y } = cascadePosition(index);
  // Capture first, then remove from the grid (close recomputes focus).
  addFloatingTab(pageId, {
    id,
    panelId,
    widgetType: instance.widgetType,
    widgetConfig:
      typeof instance.widgetConfig === "object" && instance.widgetConfig !== null
        ? (structuredClone(instance.widgetConfig) as Record<string, unknown>)
        : {},
    x,
    y,
    width: Math.max(FLOATING_MIN_WIDTH, 440),
    height: Math.max(FLOATING_MIN_HEIGHT, 320),
  });
  commit(closePanelOp(prev, panelId), prev);
  return id;
}

/**
 * Dock a floating tab back into the grid: re-opens the captured widget +
 * config through the normal open op (fresh panel id, active panel's group,
 * degrading to the first group) and drops the floating window.
 */
export function dockFloatingTab(floatId: string): boolean {
  const pageId = workspaceStore.state.activePageId;
  const entry = floatingTabsForPage(pageId).find((tab) => tab.id === floatId);
  if (!entry) return false;
  const prev = workspaceStore.state.workspace;
  const { workspace } = openWidgetOp(
    prev,
    entry.widgetType,
    structuredClone(entry.widgetConfig),
    {},
  );
  commit(workspace, prev);
  removeFloatingTab(pageId, floatId);
  return true;
}

/** Discard a floating tab entirely (its grid tab was already removed). */
export function closeFloatingTab(floatId: string): boolean {
  const pageId = workspaceStore.state.activePageId;
  return (
    floatingTabsForPage(pageId).some((tab) => tab.id === floatId) &&
    (removeFloatingTab(pageId, floatId), true)
  );
}

/** Rearrange the open panels into a grid preset. False when nothing changes. */
export function arrangeWorkspace(presetId: string): boolean {
  if (blockedOnPreset()) return false;
  const prev = workspaceStore.state.workspace;
  return applyGridLayout(
    buildGridLayout(presetId, collectPanelIds(prev.layout)),
  );
}

/**
 * Rearrange one grid's panels into a grid preset (per-grid customize).
 * `anchorNodeId` is the tab-strip id of any group inside the grid; the
 * innermost enclosing grid is rebuilt so every cell on that grid fans out
 * while the rest of the page stays untouched. A bare root group (no
 * enclosing grid) arranges itself. Empty targets build an empty skeleton of
 * the same shape so blank pages/grids can pre-structure before opening
 * widgets. No-op for unknown nodes, unknown presets, single-panel targets
 * collapsing to themselves, or on preset pages (their grids are fixed).
 */
export function arrangeGridPanels(
  anchorNodeId: string,
  presetId: string,
): boolean {
  if (blockedOnPreset()) return false;
  const prev = workspaceStore.state.workspace;
  const enclosing = findEnclosingGrid(prev.layout, anchorNodeId);
  const targetId = enclosing?.id ?? anchorNodeId;
  const target = enclosing ?? findTabsById(prev.layout, targetId);
  if (!target) return false;
  const panelIds = collectPanelIds(target);
  if (panelIds.length === 0) {
    const skeleton = buildEmptyGridLayout(presetId);
    if (!skeleton) return false;
    // A lone empty group rebuilt as a lone empty group is a no-op: the
    // only change would be a fresh node id, so skip the churn.
    if (skeleton.type === "tabs" && skeleton.panels.length === 0) return false;
    return commit(replaceTabsSubtreeOp(prev, targetId, skeleton), prev);
  }
  const layout = buildGridLayout(presetId, panelIds);
  if (!layout) return false;
  // A single panel degrades to one group for every preset — committing
  // would only swap the node id with zero visual change, so report no-op
  // and keep the dialog open with its "add more widgets" hint.
  if (layout.type === "tabs" && panelIds.length <= 1) return false;
  return commit(replaceTabsSubtreeOp(prev, targetId, layout), prev);
}

/**
 * Restore a page to its canonical layout and persist immediately.
 * Preset pages restore their curated preset; Home restores the default
 * Home layout locally; custom pages restore the default trading terminal
 * (id, icon and provenance preserved so backend history continues).
 */
export function resetWorkspaceLayout(): void {
  const prev = workspaceStore.state.workspace;
  // Reset is a clean slate: floating windows of this page are discarded.
  clearFloatingTabsForPage(prev.id);
  const preset = getPresetPage(prev.id);
  const fresh: Workspace =
    preset !== undefined
      ? {
          ...preset.build(aspectBand),
          icon: prev.icon,
          origin: prev.origin,
          version: prev.version + 1,
        }
      : isHomePageId(prev.id)
        ? { ...buildHomePage(), name: prev.name, version: prev.version + 1 }
        : {
            ...buildDefaultWorkspace(),
            id: prev.id,
            name: prev.name,
            icon: prev.icon,
            origin: prev.origin,
            version: prev.version + 1,
          };
  pageCache.set(fresh.id, fresh);
  if (isHomePageId(fresh.id)) {
    saveHomePageLocal(fresh);
    writeHomeSeed();
  }
  workspaceStore.setState((state) => ({ ...state, workspace: fresh }));
  void persistWorkspaceNow();
}
