// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Store } from "@tanstack/store"

/**
 * Global widget settings — per-widget-TYPE overrides applied on top of every
 * instance of that widget, across all pages, grids and floating windows.
 *
 * Two settings scopes exist (see `widgetSettingsBus`):
 * - "tab" writes the panel's own config (the classic per-tab settings);
 * - "global" patches a `Record<key, value>` layer for the widget TYPE here.
 *
 * The global layer MERGES at render time in the hosting `Panel`: effective
 * config = decoded panel config, then every key present in the type's
 * global entry overrides it. Clearing the layer instantly restores each
 * tab's own values — no workspace mutation, nothing to undo.
 *
 * Persistence mirrors the floating-tab layer: one localStorage key,
 * write-through on every mutation, guards for non-browser environments.
 */

export const WIDGET_GLOBALS_STORAGE_KEY = "nfi-widget-globals-v1"

/** widgetType -> overrides (a plain JSON object of config-key -> value). */
export type WidgetGlobalsState = Record<
  string,
  Readonly<Record<string, unknown>>
>

export const widgetGlobalsStore = new Store<WidgetGlobalsState>(
  hydrateWidgetGlobals(),
)

function readStoredGlobals(): WidgetGlobalsState {
  if (typeof localStorage === "undefined") return {}
  try {
    const raw = localStorage.getItem(WIDGET_GLOBALS_STORAGE_KEY)
    if (!raw) return {}
    return sanitizeWidgetGlobals(JSON.parse(raw))
  } catch {
    return {}
  }
}

function hydrateWidgetGlobals(): WidgetGlobalsState {
  return readStoredGlobals()
}

function persistWidgetGlobals(): void {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(
      WIDGET_GLOBALS_STORAGE_KEY,
      JSON.stringify(widgetGlobalsStore.state),
    )
  } catch {
    // Storage full/blocked — global settings stay session-only.
  }
}

/** Coerce unknown parsed JSON into a valid globals state (drop junk). */
export function sanitizeWidgetGlobals(input: unknown): WidgetGlobalsState {
  if (typeof input !== "object" || input === null) return {}
  const out: WidgetGlobalsState = {}
  for (const [widgetType, overrides] of Object.entries(
    input as Record<string, unknown>,
  )) {
    if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
      continue
    }
    const clean: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(
      overrides as Record<string, unknown>,
    )) {
      // Only JSON-primitive overrides survive: settings forms write
      // strings/numbers/booleans, anything else is stale junk.
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        value === null
      ) {
        clean[key] = value
      }
    }
    if (Object.keys(clean).length > 0) out[widgetType] = clean
  }
  return out
}

/** The type's global overrides (empty object when none are set). */
export function widgetGlobalOverrides(
  widgetType: string,
): Readonly<Record<string, unknown>> {
  return widgetGlobalsStore.state[widgetType] ?? {}
}

/**
 * Effective config: `base` with every globally-overridden key replaced.
 * Pure — the hosting Panel runs it on every render.
 */
export function mergeWidgetSettings<T extends object>(
  base: T,
  globals: Readonly<Record<string, unknown>> | undefined,
): T {
  if (!globals || Object.keys(globals).length === 0) return base
  return { ...base, ...globals }
}

/**
 * Patch the type's global overrides. Only the CHANGED keys are recorded —
 * untouched values stay per-tab instead of being frozen into the global
 * layer. A `undefined` value deletes that key; an empty result removes the
 * entry entirely.
 */
export function setWidgetGlobalSettings(
  widgetType: string,
  patch: Readonly<Record<string, unknown>>,
): void {
  const current = { ...widgetGlobalOverrides(widgetType) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete current[key]
    else current[key] = value
  }
  widgetGlobalsStore.setState((state) => {
    const next = { ...state }
    if (Object.keys(current).length === 0) delete next[widgetType]
    else next[widgetType] = current
    return next
  })
  persistWidgetGlobals()
}

/** Drop the type's global overrides — every instance falls back to its own config. */
export function clearWidgetGlobalSettings(widgetType: string): void {
  if (!widgetGlobalsStore.state[widgetType]) return
  widgetGlobalsStore.setState((state) => {
    const { [widgetType]: _removed, ...rest } = state
    return rest
  })
  persistWidgetGlobals()
}
