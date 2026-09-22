// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Store } from "@tanstack/store"

/**
 * Floating tabs — a localStorage-backed layer of pinned tabs that live
 * OUTSIDE the workspace document.
 *
 * Rationale: workspace integrity requires every panel instance to sit in
 * the layout tree, and widgets write config through the store's
 * `updatePanelConfig` sink — so instead of bending the schema, a pinned
 * tab is captured (widget type + config + its panel id) into an entry
 * here and removed from the grid. The floating window's Panel then works
 * with every existing subsystem (live context, settings bus, config
 * updates) because `updatePanelConfig` is floating-aware and routes
 * updates for floating panel ids back into the entry.
 *
 * State is keyed by page id: each page owns its own floating tabs, and
 * only the ACTIVE page's windows render. Everything persists to a single
 * localStorage key on every mutation (positions included — the whole
 * point of floating tabs is that they stay put), with guards for
 * non-browser environments so tests can import freely.
 */

export interface FloatingTab {
  /** Stable id of the floating window (never reused). */
  readonly id: string
  /**
   * The captured panel id — kept identical to the grid tab it replaced so
   * panel-scoped subsystems (settings bus, config sink) keep addressing it.
   */
  readonly panelId: string
  readonly widgetType: string
  readonly widgetConfig: Record<string, unknown>
  /** Viewport-relative position of the window (px, top-left). */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export const FLOATING_STORAGE_KEY = "nfi-floating-tabs-v1"

/** Hard floors — a floating window never gets smaller than this. */
export const FLOATING_MIN_WIDTH = 260
export const FLOATING_MIN_HEIGHT = 160

type FloatingState = Record<string, FloatingTab[]>

export const floatingStore = new Store<FloatingState>(hydrateFloatingState())

function readStoredState(): FloatingState {
  if (typeof localStorage === "undefined") return {}
  try {
    const raw = localStorage.getItem(FLOATING_STORAGE_KEY)
    if (!raw) return {}
    return sanitizeFloatingState(JSON.parse(raw))
  } catch {
    return {}
  }
}

function hydrateFloatingState(): FloatingState {
  return readStoredState()
}

function persistFloatingState(): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(
      FLOATING_STORAGE_KEY,
      JSON.stringify(floatingStore.state),
    )
  } catch {
    // Storage full/blocked — floating tabs stay session-only.
  }
}

/** Coerce unknown parsed JSON into a valid FloatingState (drop junk entries). */
export function sanitizeFloatingState(input: unknown): FloatingState {
  if (typeof input !== "object" || input === null) return {}
  const out: FloatingState = {}
  for (const [pageId, entries] of Object.entries(
    input as Record<string, unknown>,
  )) {
    if (!Array.isArray(entries)) continue
    const clean: FloatingTab[] = []
    for (const entry of entries) {
      const tab = sanitizeFloatingTab(entry)
      if (tab) clean.push(tab)
    }
    if (clean.length > 0) out[pageId] = clean
  }
  return out
}

function sanitizeFloatingTab(input: unknown): FloatingTab | null {
  if (typeof input !== "object" || input === null) return null
  const raw = input as Record<string, unknown>
  if (
    typeof raw.id !== "string" ||
    typeof raw.panelId !== "string" ||
    typeof raw.widgetType !== "string"
  ) {
    return null
  }
  const width = clampSize(
    FLOATING_MIN_WIDTH,
    typeof raw.width === "number" ? raw.width : 420,
  )
  const height = clampSize(
    FLOATING_MIN_HEIGHT,
    typeof raw.height === "number" ? raw.height : 300,
  )
  return {
    id: raw.id,
    panelId: raw.panelId,
    widgetType: raw.widgetType,
    widgetConfig:
      typeof raw.widgetConfig === "object" && raw.widgetConfig !== null
        ? (raw.widgetConfig as Record<string, unknown>)
        : {},
    x: typeof raw.x === "number" ? raw.x : 48,
    y: typeof raw.y === "number" ? raw.y : 48,
    width,
    height,
  }
}

/** Clamp a size to the floating minimums (and finite positives). */
export function clampSize(min: number, value: number): number {
  if (!Number.isFinite(value) || value <= 0) return min
  return Math.max(min, Math.round(value))
}

/**
 * Border-box size of a floating window element — the size to persist.
 *
 * The persisted `width`/`height` are applied to the window element itself,
 * so the ONLY measurement that can round-trip without drift is the
 * element's own border box (`offsetWidth`/`offsetHeight`). Measuring an
 * inner element's content box instead loses the header/border chrome on
 * every write-back and made windows shrink after opening.
 */
export function floatWindowSize(el: HTMLElement): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(FLOATING_MIN_WIDTH, Math.round(el.offsetWidth)),
    height: Math.max(FLOATING_MIN_HEIGHT, Math.round(el.offsetHeight)),
  };
}

/**
 * Cascade position for a new window so consecutive pins don't stack
 * exactly: each window offsets by a fixed step, wrapping after 8 steps to
 * stay on-screen.
 */
export function cascadePosition(index: number): { x: number; y: number } {
  const step = 32;
  const steps = 8;
  const offset = (((index % steps) + steps) % steps) * step;
  return { x: 64 + offset, y: 64 + offset };
}

/** The active page's floating tabs (empty when none). */
export function floatingTabsForPage(pageId: string): FloatingTab[] {
  return floatingStore.state[pageId] ?? []
}

export function addFloatingTab(pageId: string, tab: FloatingTab): void {
  floatingStore.setState((state) => ({
    ...state,
    [pageId]: [...(state[pageId] ?? []), tab],
  }))
  persistFloatingState()
}

/** Patch one floating window (geometry updates); no-op when unknown. */
export function updateFloatingTab(
  pageId: string,
  id: string,
  patch: Partial<Pick<FloatingTab, "x" | "y" | "width" | "height">>,
): void {
  const entries = floatingStore.state[pageId]
  if (!entries?.some((tab) => tab.id === id)) return
  floatingStore.setState((state) => ({
    ...state,
    [pageId]: (state[pageId] ?? []).map((tab) =>
      tab.id === id ? { ...tab, ...patch } : tab,
    ),
  }))
  persistFloatingState()
}

/**
 * Update the captured widget config of the floating window owning
 * `panelId` (the floating-aware branch of the store's config sink).
 * Returns false when no floating window on the page has that panel id.
 */
export function setFloatingWidgetConfig(
  pageId: string,
  panelId: string,
  widgetConfig: Record<string, unknown>,
): boolean {
  const entries = floatingStore.state[pageId];
  if (!entries?.some((tab) => tab.panelId === panelId)) return false;
  floatingStore.setState((state) => ({
    ...state,
    [pageId]: (state[pageId] ?? []).map((tab) =>
      tab.panelId === panelId ? { ...tab, widgetConfig } : tab,
    ),
  }));
  persistFloatingState();
  return true;
}

/** Remove one floating window (close or dock). No-op when unknown. */
export function removeFloatingTab(pageId: string, id: string): void {
  const entries = floatingStore.state[pageId];
  if (!entries?.some((tab) => tab.id === id)) return;
  const next = entries.filter((tab) => tab.id !== id);
  floatingStore.setState((state) => {
    const { [pageId]: _removed, ...rest } = state;
    return next.length > 0 ? { ...state, [pageId]: next } : rest;
  });
  persistFloatingState();
}

/** Forget every floating tab of a page (page deleted, Home reset). */
export function clearFloatingTabsForPage(pageId: string): void {
  if (!floatingStore.state[pageId]) return;
  floatingStore.setState((state) => {
    const { [pageId]: _cleared, ...rest } = state;
    return rest;
  });
  persistFloatingState();
}
