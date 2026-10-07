// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
import { Store } from "@tanstack/store";
import type { LayoutDocument } from "@danfessler/trellis-react";
import {
  decodePersistedWorkspace,
  migrateWorkspace,
  type Capability,
  type PanelId,
  type PanelInstance,
  WorkspaceId,
  type Workspace,
} from "@nfi/api-contract";
import {
  activatePanel as activatePanelOp,
  activateTab as activateTabOp,
  appendAutoItemCard,
  AUTO_ITEM_CHROME_PX,
  autoSpanForWidth,
  clampFlowItemSize,
  closePanel as closePanelOp,
  createLayoutNodeId,
  cycleTab as cycleTabOp,
  findEnclosingAuto,
  findEnclosingMasonry,
  findFirstTabs,
  findFlowItemById,
  findNodeById,
  findTabsById,
  findTabsWithPanel,
  getAutoItemMinHeight,
  getFlowItemMinSize,
  getMasonryItemMinHeight,
  moveAutoItem as moveAutoItemOp,
  movePanelToTabs as movePanelToTabsOp,
  openWidget as openWidgetOp,
  setAutoItemSize as setAutoItemSizeOp,
  setFlowItemSize as setFlowItemSizeOp,
  setMasonryItemSize as setMasonryItemSizeOp,
  setPanelConfig as setPanelConfigOp,
  setPanelTitle as setPanelTitleOp,
  type OpenWidgetOptions,
} from "@nfi/widget-sdk";
import { missingCapabilities } from "@nfi/widget-sdk";
import { formatQueryError, runApi } from "../api";
import { prefsStore } from "../store";
import { capabilitiesStore } from "../auth/capabilities";
import { effectiveGranted, isViewAsActive, viewAsStore } from "../auth/viewAs";
import {
  pageDefaultsStore,
  resolveDefaultTab,
  resolveLandingPage,
} from "./pageDefaults";
import { widgetRegistry } from "./registry";
import { buildDefaultWorkspace } from "./defaultWorkspace";
import { migrateGridToAuto } from "./layouts";
import { TETRIS_COLUMNS } from "./tetris";
import {
  addFloatingTab,
  cascadePosition,
  clearFloatingTabsForPage,
  FLOATING_MIN_HEIGHT,
  FLOATING_MIN_WIDTH,
  floatingTabsForPage,
  removeFloatingTab,
  setFloatingWidgetConfig,
  isWidgetConfig,
} from "./floating";
import {
  HOME_PAGE_ID,
  HOME_SEED_STORAGE_KEY,
  HOME_SEED_VERSION,
  HOME_STORAGE_KEY,
  buildHomePage,
  getPresetPage,
  isHomePageId,
  isPresetPageId,
  maybeUpgradeStoredHome,
  normalizePageIcon,
  refreshPresetWorkspace,
  type PageIconKey,
} from "./pages";
import { clearPendingSlotLayout } from "./pendingSlot";

/**
 * Frontend workspace store — the single owner of interactive workspace state.
 *
 * Multi-page model: the header shows Home (landing page, fully editable,
 * shared across browsers) plus the pages the user added — preset pages
 * (opt-in curated dashboards for pro trader/investor workflows) and custom
 * pages (blank, fully editable). Every page is fully editable: preset
 * pages seed their canonical layout and Reset restores it. Each added page
 * is one durable backend `Workspace` document stamped `origin: "user"`;
 * preset ids are stable (`page-preset-*`), custom ids are `page-custom-*`.
 * Home (`page-home`) is also a backend document, but public-readable: the
 * backend exempts its load so signed-out/incognito visitors resolve the
 * same shared layout the admin saved, with localStorage as the instant
 * cache/offline fallback.
 *
 * Deleting an added preset page removes its stored copy; the preset
 * returns to the Add-page dialog for later re-adding.
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
  /** The Home page: editable like a custom page, shared via the backend (local cache). */
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

const ACTIVE_PAGE_KEY = "nfi-active-page";

const PERSIST_RETRY_BASE_MS = 10_000;

const PERSIST_RETRY_MAX_MS = 60_000;

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

/** Consecutive persist failures — drives the retry backoff (reset on success). */
let persistFailures = 0;

let persistInFlight = false;

let persistAfterFlight = false;

function clearRetry(): void {
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  persistFailures = 0;
}

/**
 * Exponential backoff for background persist retries: a persistence failure
 * that will not clear on its own (server rejection, offline) must not keep
 * hammering the backend — and churning store subscribers — every 10 s
 * forever. The first retry comes quickly (10 s), then doubles up to the 60 s
 * cap; any successful save resets the ladder.
 */
function scheduleRetry(): void {
  if (retryTimer !== null) return;

  persistFailures += 1;

  const delay = Math.min(
    PERSIST_RETRY_MAX_MS,
    PERSIST_RETRY_BASE_MS * 2 ** (persistFailures - 1),
  );

  retryTimer = setTimeout(() => {
    retryTimer = null;
    void persistWorkspaceNow();
  }, delay);
}

export function schedulePersist(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistWorkspaceNow();
  }, PERSIST_DEBOUNCE_MS);
}

/**
 * Persist the current snapshot now (explicit actions like Reset use this).
 * While previewing another identity the write is staged, not automatic:
 * pass `force` only from the banner's Save — every other caller (debounced
 * autosave, Reset, renames) stays local so mock edits never leak to the
 * shared pages unasked.
 */
export async function persistWorkspaceNow(
  options: { force?: boolean } = {},
): Promise<void> {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }

  if (isViewAsActive() && !options.force) return;

  if (persistInFlight) {
    persistAfterFlight = true;

    return;
  }

  persistInFlight = true;

  try {
    const snapshot = workspaceStore.state.workspace;
    pageCache.set(snapshot.id, snapshot);

    // Home is the shared landing dashboard: it persists to localStorage
    // instantly (offline cache) AND to the backend `page-home` document
    // (public-readable, so signed-out/incognito visitors see the same layout
    // the admin saved). Callers without `workspace.save` (e.g. real
    // anonymous visitors) keep local-only edits — they never overwrite the
    // shared copy (the backend 403s, which we swallow by design).
    if (isHomePageId(snapshot.id)) {
      saveHomePageLocal(snapshot);

      const canShare =
        capabilitiesStore.state.granted.includes("workspace.save");

      if (!canShare) {
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
        // Keep the local copy as truth for status (the edit is safe in this
        // browser), but surface the share failure so the admin knows
        // incognito visitors won't see it yet. Retry in the background.
        workspaceStore.setState((state) => ({
          ...state,
          status: "error",
          backendAvailable: false,
          detail:
            formatQueryError(error) ??
            "Home saved locally — backend share failed",
        }));
        scheduleRetry();
      }

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

/**
 * View-as edit buffer: while previewing another identity, commits apply to
 * the live canvas only — nothing durable (backend docs, Home localStorage)
 * moves until the banner's Save stages the active page explicitly. The
 * first pre-edit workspace per page id is kept so Discard restores exactly
 * what the preview started from.
 */
const previewBase = new Map<string, Workspace>();

/** True while a view-as preview holds unstaged page edits. */
export function hasPreviewEdits(): boolean {
  return previewBase.size > 0;
}

/** Ids of pages with unstaged preview edits (banner count + save-all). */
export function previewEditedPageIds(): ReadonlyArray<string> {
  return [...previewBase.keys()];
}

/** Keep the first pre-edit snapshot of a page touched during preview. */
function snapshotPreviewBase(prev: Workspace): void {
  if (isViewAsActive() && !previewBase.has(prev.id)) {
    previewBase.set(prev.id, prev);
  }
}

// Leaving the preview drops the staging buffer (the canvas keeps its
// edits as ordinary local work and normal autosave resumes) so a later
// preview's Discard can never restore across sessions.
viewAsStore.subscribe((state) => {
  if (state.targetUserId === null) previewBase.clear();
});

/**
 * Persist staged preview edits (banner Save). Saves EVERY touched page, not
 * just the active one: an admin arranging the public dashboard often
 * touches Home, switches to another page to compare, then hits Save — only
 * persisting the active page would silently leave Home unsaved, so the
 * other user (e.g. anonymous in incognito) keeps seeing the old layout and
 * the save looks broken. Inactive pages save via direct writes; the active
 * page goes through the forced persist path so status/lastSaved stays
 * consistent. Returns true only when every staged page saved (failed pages
 * stay staged for retry).
 */
export async function savePreviewEdits(): Promise<boolean> {
  if (!hasPreviewEdits()) return false;
  const activeId = workspaceStore.state.activePageId;
  const stagedIds = [...previewBase.keys()];
  const inactiveIds = stagedIds.filter((id) => id !== activeId);
  let inactiveOk = true;

  for (const id of inactiveIds) {
    const current = pageCache.get(id);

    if (!current) {
      previewBase.delete(id);
      continue;
    }

    if (isHomePageId(id)) saveHomePageLocal(current);

    if (!capabilitiesStore.state.granted.includes("workspace.save")) {
      // No share grant (e.g. real anonymous previewing Home): local-only
      // edits never overwrite the shared copy — consider them saved.
      if (isHomePageId(id)) previewBase.delete(id);
      else inactiveOk = false;

      continue;
    }

    try {
      await runApi((client) =>
        client.Workspace.save({
          path: { id: current.id },
          payload: { workspace: current },
        }),
      );
      previewBase.delete(id);
    } catch {
      inactiveOk = false;
    }
  }

  // Active page untouched: nothing more to do — report the inactive result.
  if (!previewBase.has(activeId)) {
    if (inactiveOk && !hasPreviewEdits()) {
      workspaceStore.setState((state) => ({
        ...state,
        status: "saved",
        detail: null,
        lastSavedAt: new Date().toISOString(),
      }));
    }

    return inactiveOk && !hasPreviewEdits();
  }

  await persistWorkspaceNow({ force: true });

  if (workspaceStore.state.status === "saved") {
    previewBase.delete(activeId);

    return inactiveOk && !hasPreviewEdits();
  }

  return false;
}

/**
 * Drop ALL staged preview edits, restoring every touched page to its
 * pre-preview snapshot (durable state was never written, so this is purely
 * in-memory + cache).
 */
export function discardPreviewEdits(): boolean {
  if (previewBase.size === 0) return false;
  const activeSnap = previewBase.get(workspaceStore.state.activePageId);

  for (const [id, snap] of previewBase) pageCache.set(id, snap);
  previewBase.clear();

  if (activeSnap) {
    workspaceStore.setState((state) => ({ ...state, workspace: activeSnap }));
  } else {
    // Active page untouched: still poke state (new identity notifies the
    // banner, whose dirty flag derives from the buffer + version).
    workspaceStore.setState((state) => ({ ...state }));
  }

  return true;
}

/** Commit a pure transformation result; no-op transforms skip persistence. */
function commit(next: Workspace, prev: Workspace): boolean {
  if (next === prev) return false;
  snapshotPreviewBase(prev);
  const previewing = isViewAsActive();
  pageCache.set(next.id, next);

  // Home persists locally on every commit for instant render, then mirrors
  // to the shared backend copy (debounced) when the caller may share
  // (holders of `workspace.save`) — unless previewing: staged edits touch
  // neither localStorage nor the backend until Save.
  if (isHomePageId(next.id)) {
    if (!previewing) saveHomePageLocal(next);
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

    if (
      !previewing &&
      capabilitiesStore.state.granted.includes("workspace.save")
    ) {
      schedulePersist();
    }

    return true;
  }

  workspaceStore.setState((state) => ({
    ...state,
    workspace: next,
    pages: state.pages.map((p) =>
      p.id === next.id ? { ...p, name: next.name } : p,
    ),
  }));

  if (!previewing) schedulePersist();

  return true;
}

/**
 * Record a Trellis arrangement change (divider drag, split/dock, preset
 * apply, tab move, view open/close) against a page.
 *
 * Trellis owns its layout after mount — the NFI `layout` tree only seeds the
 * first render. Without capturing the Trellis document here, arranging the
 * dashboard and hitting "Save layout for anonymous" persists panels/configs
 * but NOT the arrangement, so incognito keeps seeing the old layout and the
 * save looks broken. The Trellis document (opaque JSON from `getDocument()`)
 * is stored on the workspace as `trellis`, making the backend the single
 * source of truth every visitor renders.
 *
 * Like `commit`, preview edits stage (no autosave, no Home localStorage)
 * until the banner's Save; normal edits persist Home locally instantly and
 * mirror to the backend debounced. Deep-equal docs are no-ops so the
 * Trellis `onDocumentChange` echo after a `setDocument` never churns the
 * version. Returns false when nothing changed or the page is unknown.
 */
export function updateTrellisDocument(
  pageId: string,
  doc: LayoutDocument,
): boolean {

  const current =
    workspaceStore.state.activePageId === pageId
      ? workspaceStore.state.workspace
      : pageCache.get(pageId);

  if (!current) return false;

  let same: boolean;

  try {
    same =
      JSON.stringify(current.trellis ?? null) === JSON.stringify(doc);
  } catch {
    same = false;
  }

  if (same) return false;

  let cloned: unknown;

  try {
    cloned = structuredClone(doc);
  } catch {
    return false;
  }

  const next: Workspace = {
    ...current,
    // Workspace["trellis"] is opaque (Schema.Unknown) by design: trellis
    // re-validates the document at mount and corrupt docs reset silently.
    trellis: cloned,
    version: current.version + 1,
  };

  snapshotPreviewBase(current);
  const previewing = isViewAsActive();
  pageCache.set(next.id, next);

  if (workspaceStore.state.activePageId === pageId) {
    if (isHomePageId(next.id)) {
      if (!previewing) saveHomePageLocal(next);
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

      if (
        !previewing &&
        capabilitiesStore.state.granted.includes("workspace.save")
      ) {
        schedulePersist();
      }

      return true;
    }

    workspaceStore.setState((state) => ({
      ...state,
      workspace: next,
    }));

    if (!previewing) schedulePersist();

    return true;
  }

  // Inactive page (should not happen for Trellis, which only mounts the
  // active page): cache holds it; the next save of that page carries it.
  return true;
}

/** No preset pages ship — every page is editable. */
export function isActivePagePreset(): boolean {
  return false;
}

/**
 * True when `panelId` is a locked built-in tab. No presets ship, so no
 * panel is ever locked — every tab is editable like normal.
 */
function isActiveBuiltInPanel(_panelId: string): boolean {
  return false;
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

    // Grids are gone — migrate any legacy grid root to bento, preserving
    // panels in reading order.
    if (stored.layout.type === "grid") {
      const migrated: Workspace = {
        ...stored,
        layout: migrateGridToAuto(stored.layout),
        version: stored.version + 1,
      };

      saveHomePageLocal(migrated);

      return migrated;
    }

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
    id: Schema.decodeSync(WorkspaceId)(id),
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
    icon: normalizePageIcon(home.icon),
  };

  // Preset pages in catalog order, then custom pages alphabetically — both
  // only ever land here through the Add-page picker.
  const presets: PageSummary[] = [];
  const customs: PageSummary[] = [];

  for (const w of workspaces) {
    if (isHomePageId(w.id)) continue;

    if (isPresetPageId(w.id)) {
      presets.push({
        id: w.id,
        name: w.name,
        preset: true,
        home: false,
        // A stored icon override wins; otherwise the preset's built-in icon.
        icon: normalizePageIcon(w.icon) ?? getPresetPage(w.id)?.icon,
      });
    } else {
      customs.push({
        id: w.id,
        name: w.name,
        preset: false,
        home: false,
        icon: normalizePageIcon(w.icon),
      });
    }
  }

  customs.sort((a, b) => a.name.localeCompare(b.name));

  return [homeEntry, ...presets, ...customs];
}

/**
 * Load all pages. Home is the shared landing dashboard: the backend
 * `page-home` document (public-readable, so anonymous/incognito visitors see
 * the same layout) wins when present, with the localStorage copy as the
 * instant fallback/offline cache. Every other page is a backend document
 * the user added through the Add-page picker. Preset documents WITHOUT the
 * `origin: "user"` marker were auto-seeded by older builds — they are
 * best-effort deleted so every deployment lands on the Home-only default
 * (the presets stay available in the Add-page dialog). Fully offline falls
 * back to Home only.
 *
 * How to save the anonymous layout: Manage users → Edit layout on the
 * anonymous row (or header View-as → anonymous) — arrange Home on the
 * terminal, then Save layout for anonymous in the banner, which persists
 * every staged page to the shared backend copy, so an incognito window
 * lands on the same layout after reload. Point the `anonymous` role's
 * landing page at Home on the Manage users page and keep its widgets to
 * the `.relative` set for a leak-free public share.
 */
export async function hydrateWorkspace(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  workspaceStore.setState((state) => ({
    ...state,
    status: "loading",
    detail: null,
  }));
  // Home loads instantly from the local cache so the landing page never
  // waits on the backend; the shared backend copy (when present) replaces
  // it below — including for anonymous callers, whose `workspace.list`
  // stays 403 by design but whose `page-home` load is public.
  const localHome = loadHomePageLocal();
  let home = localHome;
  let sharedHomeOk = false;

  try {
    const shared = await runApi((client) =>
      client.Workspace.load({ path: { id: HOME_PAGE_ID } }),
    );

    const sharedMigrated = migrateWorkspace(shared.workspace);
    home =
      sharedMigrated.layout.type === "grid"
        ? {
            ...sharedMigrated,
            layout: migrateGridToAuto(sharedMigrated.layout),
            version: sharedMigrated.version + 1,
          }
        : sharedMigrated;
    sharedHomeOk = true;
    // The shared copy is now the local cache too, so offline reloads keep
    // showing what anonymous visitors see.
    saveHomePageLocal(home);
    writeHomeSeed();
  } catch {
    // No shared Home yet (fresh deployment, 404) or backend down — the
    // local copy stands in and the first shared save creates it.
  }

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

        // Legacy documents (splits, grids) migrate to bento on the way in;
        // the next save persists the migrated layout.
        const migrated = migrateWorkspace(res.workspace);

        loaded.push(
          migrated.layout.type === "grid"
            ? {
                ...migrated,
                layout: migrateGridToAuto(migrated.layout),
                version: migrated.version + 1,
              }
            : migrated,
        );
      } catch {
        // Backend copy missing or corrupt — customs have no fallback and
        // simply stay absent this session.
      }
    }

    pageCache.clear();
    pageCache.set(home.id, home);

    for (const w of loaded) pageCache.set(w.id, w);
    const pages = toSummaries(loaded, home);
    const stored = readStoredActivePage();
    const storedActive = stored ? pageCache.get(stored) : undefined;
    // Landing page: the last-visited page wins when it still exists (stored
    // ids survive reloads); otherwise the configured default for this
    // identity (own default, else the global — either may point past Home),
    // else Home. The default tab for the landing page activates in-memory
    // (a landing hint, not an enforced lock — later tab switches persist as
    // usual).
    const defaultsState = pageDefaultsStore.state;
    const landingId = resolveLandingPage(defaultsState);
    const configuredLanding = landingId ? pageCache.get(landingId) : undefined;
    const landed: Workspace = storedActive ?? configuredLanding ?? home;
    const defaultTab = resolveDefaultTab(defaultsState.defaults, landed.id);

    const active: Workspace =
      defaultTab !== null && landed.panels[defaultTab] !== undefined
        ? activatePanelOp(landed, defaultTab)
        : landed;

    if (active !== landed) pageCache.set(active.id, active);
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
    // `workspace.list` fails for callers without the grant (anonymous by
    // design: 403) as well as when the backend is down. When the shared
    // Home loaded above, the backend IS reachable — show Home-only as a
    // healthy shared state (anonymous visitors land here). Only when both
    // fail do we report offline.
    if (sharedHomeOk) {
      pageCache.clear();
      pageCache.set(home.id, home);
      const pages = toSummaries([], home);
      storeActivePage(home.id);
      workspaceStore.setState(() => ({
        workspace: home,
        pages,
        activePageId: home.id,
        status: "saved",
        detail: null,
        lastSavedAt: new Date().toISOString(),
        backendAvailable: true,
      }));

      return;
    }

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

/** Cached workspace snapshot for a page (hydrated pages only). */
export function getCachedWorkspace(pageId: string): Workspace | undefined {
  return pageCache.get(pageId);
}

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
    pages: [
      ...state.pages,
      { id, name: trimmed, preset: false, home: false, icon },
    ],
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

/** Preset ids with a create already in flight (double-submit guard). */
const pendingPresetCreates = new Set<string>();

/**
 * Add a curated preset page (Trading Terminal, Portfolio, …) and switch to
 * it. Adding twice just switches — preset ids are stable. Returns the page
 * id, or null for unknown preset ids.
 */
export async function createPresetPage(
  presetId: string,
): Promise<string | null> {
  const preset = getPresetPage(presetId);

  if (!preset) return null;

  const existing = pageCache.get(presetId);

  if (existing || pendingPresetCreates.has(presetId)) {
    switchActivePage(presetId);
    storeActivePage(presetId);

    return presetId;
  }

  pendingPresetCreates.add(presetId);

  const page = preset.build();
  pageCache.set(presetId, page);
  workspaceStore.setState((state) => ({
    ...state,
    workspace: page,
    pages: [
      ...state.pages,
      {
        id: presetId,
        name: page.name,
        preset: true,
        home: false,
        icon: preset.icon,
      },
    ],
    activePageId: presetId,
    status: "saving",
    detail: null,
  }));
  storeActivePage(presetId);

  try {
    const created = await runApi((client) =>
      client.Workspace.create({
        payload: { name: page.name, workspace: page },
      }),
    );

    pageCache.set(created.workspace.id, created.workspace);
    workspaceStore.setState((state) => ({
      ...state,
      workspace:
        state.activePageId === presetId ? created.workspace : state.workspace,
      pages: state.pages.map((p) =>
        p.id === presetId ? { ...p, name: created.workspace.name } : p,
      ),
      status: "saved",
      lastSavedAt: new Date().toISOString(),
      backendAvailable: true,
    }));
  } catch {
    // Offline create — stays local until the next persist.
    schedulePersist();
  } finally {
    pendingPresetCreates.delete(presetId);
  }

  return presetId;
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
  // A page deleted mid-preview takes its staged snapshot with it (there is
  // nothing left to save or restore for it).
  previewBase.delete(pageId);
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

/** Rename a custom or Home page. */
export function renameCustomPage(pageId: string, name: string): boolean {  const trimmed = name.trim();

  if (trimmed.length === 0) return false;
  const cached = pageCache.get(pageId);

  if (!cached) return false;
  snapshotPreviewBase(cached);

  const next: Workspace = {
    ...cached,
    name: trimmed,
    version: cached.version + 1,
  };

  pageCache.set(pageId, next);
  const isHome = isHomePageId(pageId);
  const previewing = isViewAsActive();

  // Previewing stages the rename locally (durable writes below are gated).
  if (isHome && !previewing) saveHomePageLocal(next);
  workspaceStore.setState((state) => ({
    ...state,
    workspace: state.activePageId === pageId ? next : state.workspace,
    pages: state.pages.map((p) =>
      p.id === pageId ? { ...p, name: trimmed } : p,
    ),
    ...(isHome && state.activePageId === pageId
      ? {
          status: "saved" as const,
          detail: null,
          lastSavedAt: new Date().toISOString(),
        }
      : null),
  }));

  if (isHome) {
    // Renamed Home shares like any other Home edit when the caller may —
    // staged, not shared, while previewing.
    if (
      !previewing &&
      capabilitiesStore.state.granted.includes("workspace.save")
    ) {
      if (workspaceStore.state.activePageId === pageId) schedulePersist();
      else {
        void runApi((client) =>
          client.Workspace.save({
            path: { id: next.id },
            payload: { workspace: next },
          }),
        ).catch(() => undefined);
      }
    }

    return true;
  }

  if (previewing) return true;

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

/**
 * Change any page's pages-bar icon (Home, preset or custom). `undefined`
 * clears the override: custom pages render without an icon, Home renders
 * its house glyph, presets fall back to their built-in icons. Persists like
 * a rename (active page via autosave, inactive directly, Home locally +
 * shared).
 */
export function setPageIcon(pageId: string, icon: PageIconKey | undefined): boolean {
  const cached = pageCache.get(pageId);

  if (!cached) return false;
  snapshotPreviewBase(cached);

  const next: Workspace = {
    ...cached,
    icon,
    version: cached.version + 1,
  };

  pageCache.set(pageId, next);
  const isHome = isHomePageId(pageId);
  const previewing = isViewAsActive();

  if (isHome && !previewing) saveHomePageLocal(next);

  // Preset fallback for the summary when the override is cleared.
  const fallbackIcon = isPresetPageId(pageId)
    ? getPresetPage(pageId)?.icon
    : undefined;

  workspaceStore.setState((state) => ({
    ...state,
    workspace: state.activePageId === pageId ? next : state.workspace,
    pages: state.pages.map((p) =>
      p.id === pageId ? { ...p, icon: icon ?? fallbackIcon } : p,
    ),
    ...(isHome && state.activePageId === pageId
      ? {
          status: "saved" as const,
          detail: null,
          lastSavedAt: new Date().toISOString(),
        }
      : null),
  }));

  if (previewing) return true;

  if (workspaceStore.state.activePageId === pageId) {
    if (
      !isHome ||
      capabilitiesStore.state.granted.includes("workspace.save")
    ) {
      schedulePersist();
    }
  } else {
    if (
      !isHome ||
      capabilitiesStore.state.granted.includes("workspace.save")
    ) {
      void runApi((client) =>
        client.Workspace.save({
          path: { id: next.id },
          payload: { workspace: next },
        }),
      ).catch(() => undefined);
    }
  }

  return true;
}

/**
 * Toggle a page's Tetris wall mode (`Workspace.stacked`): panes render as
 * different-width blocks packed into top-aligned shelves — a scrolling wall
 * at their active tab's natural height — instead of the tiled one-screen
 * stage. Persists like a rename (active page via autosave, inactive
 * directly, Home locally + shared). A no-op that persists nothing when the
 * flag already matches — preset applies call this defensively on every
 * shape change, so false→false must not churn versions.
 */
export function setWorkspaceStacked(pageId: string, stacked: boolean): boolean {
  const cached = pageCache.get(pageId);

  if (!cached || (cached.stacked === true) === stacked) return false;
  snapshotPreviewBase(cached);

  const next: Workspace = {
    ...cached,
    stacked,
    version: cached.version + 1,
  };

  pageCache.set(pageId, next);
  const isHome = isHomePageId(pageId);
  const previewing = isViewAsActive();

  if (isHome && !previewing) saveHomePageLocal(next);

  workspaceStore.setState((state) => ({
    ...state,
    workspace: state.activePageId === pageId ? next : state.workspace,
    ...(isHome && state.activePageId === pageId
      ? {
          status: "saved" as const,
          detail: null,
          lastSavedAt: new Date().toISOString(),
        }
      : null),
  }));

  if (previewing) return true;

  if (workspaceStore.state.activePageId === pageId) {
    if (
      !isHome ||
      capabilitiesStore.state.granted.includes("workspace.save")
    ) {
      schedulePersist();
    }
  } else {
    if (
      !isHome ||
      capabilitiesStore.state.granted.includes("workspace.save")
    ) {
      void runApi((client) =>
        client.Workspace.save({
          path: { id: next.id },
          payload: { workspace: next },
        }),
      ).catch(() => undefined);
    }
  }

  return true;
}

/**
 * Record a manual Tetris wall block width (panelId → column span) after a
 * resize drag. The wall is a pure render override over the Trellis
 * document, so these widths persist OUTSIDE it — on the workspace record
 * (like `stacked`), shared to the backend for every visitor. Stale entries
 * for closed panels are harmless (the wall only reads ids it places);
 * preset applies that rebuild the shape clear the map instead.
 */
export function setWorkspacePanelSpan(
  pageId: string,
  panelId: string,
  span: number,
): boolean {
  const cached = pageCache.get(pageId);

  if (!cached) return false;

  const clamped = Math.max(
    1,
    Math.min(TETRIS_COLUMNS, Math.round(span)),
  );

  if (cached.tetrisSpans?.[panelId] === clamped) return false;

  snapshotPreviewBase(cached);

  const next: Workspace = {
    ...cached,
    tetrisSpans: { ...cached.tetrisSpans, [panelId]: clamped },
    version: cached.version + 1,
  };

  pageCache.set(pageId, next);
  const isHome = isHomePageId(pageId);
  const previewing = isViewAsActive();

  if (isHome && !previewing) saveHomePageLocal(next);

  workspaceStore.setState((state) => ({
    ...state,
    workspace: state.activePageId === pageId ? next : state.workspace,
    ...(isHome && state.activePageId === pageId
      ? {
          status: "saved" as const,
          detail: null,
          lastSavedAt: new Date().toISOString(),
        }
      : null),
  }));

  if (previewing) return true;

  if (workspaceStore.state.activePageId === pageId) {
    if (
      !isHome ||
      capabilitiesStore.state.granted.includes("workspace.save")
    ) {
      schedulePersist();
    }
  } else {
    if (
      !isHome ||
      capabilitiesStore.state.granted.includes("workspace.save")
    ) {
      void runApi((client) =>
        client.Workspace.save({
          path: { id: next.id },
          payload: { workspace: next },
        }),
      ).catch(() => undefined);
    }
  }

  return true;
}

/**
 * Drop every manual Tetris wall width for a page — grid presets that
 * REBUILD the page shape call this so a resized block can't fight the
 * fresh arrangement ("Tetris wall", the mode-only re-pack, keeps them).
 * A no-op that persists nothing when no widths are recorded.
 */
export function clearWorkspaceTetrisSpans(pageId: string): boolean {
  const cached = pageCache.get(pageId);

  if (!cached || cached.tetrisSpans === undefined) return false;

  snapshotPreviewBase(cached);

  const { tetrisSpans: _dropped, ...rest } = cached;
  const next: Workspace = { ...rest, version: cached.version + 1 };

  pageCache.set(pageId, next);
  const isHome = isHomePageId(pageId);
  const previewing = isViewAsActive();

  if (isHome && !previewing) saveHomePageLocal(next);

  workspaceStore.setState((state) => ({
    ...state,
    workspace: state.activePageId === pageId ? next : state.workspace,
    ...(isHome && state.activePageId === pageId
      ? {
          status: "saved" as const,
          detail: null,
          lastSavedAt: new Date().toISOString(),
        }
      : null),
  }));

  if (previewing) return true;

  if (workspaceStore.state.activePageId === pageId) {
    if (
      !isHome ||
      capabilitiesStore.state.granted.includes("workspace.save")
    ) {
      schedulePersist();
    }
  } else {
    if (
      !isHome ||
      capabilitiesStore.state.granted.includes("workspace.save")
    ) {
      void runApi((client) =>
        client.Workspace.save({
          path: { id: next.id },
          payload: { workspace: next },
        }),
      ).catch(() => undefined);
    }
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
 * to intentionally duplicate a widget. EXCEPTION: on a bento (root auto)
 * page a canvas-level open has no group target — it always appends a fresh
 * card (see below), duplicates included.
 */
export function openWidgetPanel(
  widgetType: string,
  config: PanelInstance["widgetConfig"],
  options: OpenWidgetOptions = {},
  requiredCapabilities: ReadonlyArray<Capability> = [],
): PanelId | null {
  // View-as preview: opening follows the mocked grant so the preview shows
  // what the target could open (the backend still enforces the real grant).
  if (
    missingCapabilities(requiredCapabilities, effectiveGranted()).length > 0
  ) {
    return null;
  }

  const prev = workspaceStore.state.workspace;

  // Bento pages grow by CARDS and never need a booked slot: a canvas-level
  // open (the auto pane's add affordance, the palette — no explicit tab
  // target) on a root auto APPENDS a fresh card at the end, sized from the
  // widget's preferred dimensions. This runs before the dedupe below on
  // purpose — appending is an explicit "give me another card", even when
  // the same widget type already sits in the active card. A tab strip's
  // own "+" keeps passing `targetTabsId` and tabs into its group as before.
  if (
    prev.layout.type === "auto" &&
    options.targetTabsId === undefined &&
    options.targetPanelId === undefined
  ) {
    const size = autoCardSizeForWidgetType(widgetType, prev.layout.columnWidth);

    const { workspace, panelId } = appendAutoItemCard(
      prev,
      widgetType,
      config,
      {
        panelId: options.panelId,
        height: size.height,
        span: size.span,
      },
    );

    commit(workspace, prev);

    return panelId;
  }

  const group = resolveOpenTargetGroup(prev, options);

  const existing = group?.panels.find(
    (id) => prev.panels[id]?.widgetType === widgetType,
  );

  if (existing && group) {
    if (group.activePanelId === existing && prev.activePanelId === existing) {
      return existing;
    }

    commit(activateTabOp(prev, group.id, existing), prev);

    return existing;
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

export function closeWorkspacePanel(panelId: string): boolean {
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
 * Resize one flow card (SE-corner drag). The requested size is clamped to
 * the card's content minimums (widgets stay readable) before the op runs,
 * so every persisted size already complies.
 */
export function resizeWorkspaceFlowItem(
  flowId: string,
  itemId: string,
  width: number,
  height: number,
): boolean {
  const prev = workspaceStore.state.workspace;

  const item = findFlowItemById(prev.layout, itemId);

  if (!item) return false;
  const lookup = (type: string) => widgetRegistry.getWidget(type);
  const min = getFlowItemMinSize(item.child, prev.panels, lookup);

  const containerWidth =
    typeof window === "undefined" ? undefined : window.innerWidth;

  const clamped = clampFlowItemSize(
    Math.round(width),
    Math.round(height),
    min.width,
    min.height,
    containerWidth,
  );

  return commit(
    setFlowItemSizeOp(prev, flowId, itemId, clamped.width, clamped.height),
    prev,
  );
}

/**
 * Resize one masonry card (SE-corner drag): height in px and the column
 * span (≥ 1, whole columns). The requested height is clamped to the card's
 * content minimum (widgets stay readable) before the op runs, so every
 * persisted height already complies; the span renders clamped to the live
 * column count. Masonry pages are legacy (the changer no longer creates
 * them) but keep editing like before.
 */
export function resizeWorkspaceMasonryItem(
  masonryId: string,
  itemId: string,
  height: number,
  span?: number,
): boolean {
  const prev = workspaceStore.state.workspace;

  const masonry =
    findNodeById(prev.layout, masonryId) ??
    findEnclosingMasonry(prev.layout, itemId);

  if (!masonry || masonry.type !== "masonry") return false;
  const child = masonry.items.find((entry) => entry.id === itemId)?.child;

  if (!child) return false;
  const lookup = (type: string) => widgetRegistry.getWidget(type);
  const minHeight = getMasonryItemMinHeight(child, prev.panels, lookup);

  const clamped = Math.round(
    Math.max(minHeight, Number.isFinite(height) ? height : minHeight),
  );

  return commit(
    setMasonryItemSizeOp(
      prev,
      masonry.id,
      itemId,
      clamped,
      span === undefined ? undefined : Math.max(1, Math.round(span)),
    ),
    prev,
  );
}

/**
 * Preferred auto-card size for one widget TYPE (fresh cards — the panel
 * does not exist yet): height from the widget's preferred height clamped
 * to its content minimum, span from its preferred width quantized to the
 * target column step BUT never below the span its content minimum needs
 * (`autoSpanForWidth` — a density preset may not crush a wide table into
 * a sliver column; the packer clamps to the live column count later).
 */
/** Preferred size for a fresh auto card: pixel height + column span. */
interface AutoCardSize {
  readonly height: number;
  readonly span: number;
}

function autoCardSizeForWidgetType(
  widgetType: string,
  columnWidth: number,
): AutoCardSize {
  const definition = widgetRegistry.getWidget(widgetType);

  const minHeight = Math.max(
    140,
    (definition?.minHeight ?? 160) + AUTO_ITEM_CHROME_PX,
  );

  const height = Math.max(minHeight, definition?.defaultHeight ?? 280);

  const span = autoSpanForWidth(
    definition?.defaultWidth ?? 360,
    definition?.minWidth ?? 0,
    columnWidth,
  );

  return { height, span };
}

/**
 * Resize one auto card (SE-corner drag): height in px and the column span
 * (finite ≥ 1, fractions welcome for stepless drags). The requested height
 * is clamped to the card's content minimum (widgets stay readable) before
 * the op runs, so every persisted height already complies — unless widget
 * minimums are disabled in Preferences, when the dragged size persists
 * verbatim. The span packs clamped to the live column count and renders
 * pixel-identical (no justification, no stretch).
 */
export function resizeWorkspaceAutoItem(
  autoId: string,
  itemId: string,
  height: number,
  span?: number,
): boolean {
  const prev = workspaceStore.state.workspace;

  const auto =
    findNodeById(prev.layout, autoId) ?? findEnclosingAuto(prev.layout, itemId);

  if (!auto || auto.type !== "auto") return false;
  const child = auto.items.find((entry) => entry.id === itemId)?.child;

  if (!child) return false;
  const lookup = (type: string) => widgetRegistry.getWidget(type);

  const minHeight = prefsStore.state.disableWidgetMinSize
    ? 1
    : getAutoItemMinHeight(child, prev.panels, lookup);

  const clamped = Math.round(
    Math.max(minHeight, Number.isFinite(height) ? height : minHeight),
  );

  // Fractional spans persist stepless drags (two decimals — no float dust,
  // and the re-render reproduces the release frame exactly, no snap).
  const spanKept =
    span === undefined || !Number.isFinite(span)
      ? undefined
      : Math.max(1, Math.round(span * 100) / 100);

  return commit(
    setAutoItemSizeOp(prev, auto.id, itemId, clamped, spanKept),
    prev,
  );
}

/**
 * Drag-reorder one auto card (the pane's pointer-drag drop commit): splice
 * `itemId` to `targetIndex` in its auto container; the deterministic re-pack
 * lands in the same commit. Unknown ids / out-of-range indexes are no-ops
 * inside the op (clamped).
 */
export function moveWorkspaceAutoItem(
  autoId: string,
  itemId: string,
  targetIndex: number,
): boolean {
  const prev = workspaceStore.state.workspace;

  return commit(moveAutoItemOp(prev, autoId, itemId, targetIndex), prev);
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
  // Signed-out visitors are read-only (the tab menu hides renames too).
  if (!capabilitiesStore.state.authenticated) return false;
  const prev = workspaceStore.state.workspace;

  return commit(setPanelTitleOp(prev, panelId, title), prev);
}

export function updatePanelConfig(
  panelId: string,
  config: PanelInstance["widgetConfig"],
): boolean {
  // Floating tabs keep their captured panel id, so config writes for them
  // (widget settings forms, invalid-config resets) land in the floating
  // entry instead of the workspace document. Floating state is per-browser
  // local — never shared — so it stays writable while signed out.
  const activePageId = workspaceStore.state.activePageId;

  if (
    floatingTabsForPage(activePageId).some((tab) => tab.panelId === panelId)
  ) {
    return setFloatingWidgetConfig(
      activePageId,
      panelId,
      isWidgetConfig(config) ? config : {},
    );
  }

  // Signed-out visitors are read-only on shared docs (settings gears hide
  // too); URL sync also funnels through here.
  if (!capabilitiesStore.state.authenticated) return false;
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
    widgetConfig: isWidgetConfig(instance.widgetConfig)
      ? structuredClone(instance.widgetConfig)
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
 * Dock a floating tab back into the page. On a bento (root auto) page the
 * widget returns as a FRESH CARD appended at the end (autoCardSize sizing,
 * same as any add — docking onto an emptied bento page must not flip the
 * page back to grid mode); every other page re-opens the captured widget +
 * config through the normal open op (fresh panel id, active panel's group,
 * degrading to the first group) and drops the floating window.
 */
export function dockFloatingTab(floatId: string): boolean {
  const pageId = workspaceStore.state.activePageId;
  const entry = floatingTabsForPage(pageId).find((tab) => tab.id === floatId);

  if (!entry) return false;
  const prev = workspaceStore.state.workspace;

  if (prev.layout.type === "auto") {
    const size = autoCardSizeForWidgetType(
      entry.widgetType,
      prev.layout.columnWidth,
    );

    const { workspace } = appendAutoItemCard(
      prev,
      entry.widgetType,
      structuredClone(entry.widgetConfig),
      { height: size.height, span: size.span },
    );

    commit(workspace, prev);
    removeFloatingTab(pageId, floatId);

    return true;
  }

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

/**
 * Rebuild the canonical layout for any page id (Home, preset or custom),
 * preserving document identity. Returns false for unknown ids.
 */
function freshLayoutForPageId(cached: Workspace): Workspace {
  if (isHomePageId(cached.id)) {
    return {
      ...buildHomePage(),
      name: cached.name,
      version: cached.version + 1,
    };
  }

  const preset = getPresetPage(cached.id);

  if (preset) {
    const rebuilt = refreshPresetWorkspace(cached, preset);

    return { ...rebuilt, version: cached.version + 1 };
  }

  return {
    ...buildDefaultWorkspace(),
    id: cached.id,
    name: cached.name,
    icon: cached.icon,
    origin: cached.origin,
    version: cached.version + 1,
  };
}

/**
 * Restore any page (active or not) to its canonical layout: Home restores
 * the default Home dashboard, preset pages restore their preset definition,
 * custom pages restore the default bento terminal (id, icon and provenance
 * preserved so backend history continues). Persists immediately when the
 * page is active; inactive pages save directly. Returns false for unknown
 * ids.
 */
export function resetPageById(pageId: string): boolean {
  const cached = pageCache.get(pageId);

  if (!cached) return false;
  snapshotPreviewBase(cached);
  // Reset is a clean slate: floating windows of this page are discarded,
  // and so is a preset picked on its empty state (else the slots would
  // resurrect right after the reset).
  clearFloatingTabsForPage(pageId);
  clearPendingSlotLayout();

  const fresh = freshLayoutForPageId(cached);
  pageCache.set(fresh.id, fresh);

  // Previewing stages the reset locally (persistWorkspaceNow below
  // no-ops without force; Discard restores the snapshot above).
  if (isHomePageId(fresh.id) && !isViewAsActive()) {
    saveHomePageLocal(fresh);
    writeHomeSeed();
  }

  const isActive = workspaceStore.state.activePageId === pageId;

  if (isActive) {
    workspaceStore.setState((state) => ({ ...state, workspace: fresh }));
    void persistWorkspaceNow();
  } else if (!isViewAsActive()) {
    void runApi((client) =>
      client.Workspace.save({
        path: { id: fresh.id },
        payload: { workspace: fresh },
      }),
    ).catch(() => undefined);
  }

  return true;
}

/**
 * Restore the ACTIVE page to its canonical layout and persist immediately.
 * Home restores the default Home layout (shared backend copy when the
 * caller may share, else local); preset pages restore their preset
 * definition; custom pages restore the default bento terminal (id, icon
 * and provenance preserved so backend history continues).
 */
export function resetWorkspaceLayout(): void {
  resetPageById(workspaceStore.state.workspace.id);
}
