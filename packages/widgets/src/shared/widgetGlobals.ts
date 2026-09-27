// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Store } from "@tanstack/store";
import { Schema } from "effect";

/** Parsed JSON — exactly what `JSON.parse` can return. */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

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

export const WIDGET_GLOBALS_STORAGE_KEY = "nfi-widget-globals-v1";

/**
 * A single globally-overridden config value. Settings forms write JSON
 * primitives only — anything else cannot round-trip localStorage.
 */
export type WidgetGlobalValue = string | number | boolean | null;

/** One widget TYPE's overrides: config-key -> primitive value. */
export type WidgetGlobalOverrides = Readonly<
  Record<string, WidgetGlobalValue>
>;

/** widgetType -> overrides. */
export type WidgetGlobalsState = Readonly<
  Record<string, WidgetGlobalOverrides>
>;

const GlobalValueSchema = Schema.Union(
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
);

/** A single override value — the JSON primitives settings forms can write. */
const isGlobalValue = Schema.is(GlobalValueSchema);

/** A whole override layer: keyed object of JSON primitives (arrays rejected). */
const isOverrideLayer = Schema.is(
  Schema.Record({ key: Schema.String, value: GlobalValueSchema }),
);

/** Any parsed JSON object (maps, arrays and null all fail). */
const isJsonObject = Schema.is(
  Schema.Record({ key: Schema.String, value: Schema.Unknown }),
);

export const widgetGlobalsStore = new Store<WidgetGlobalsState>(
  hydrateWidgetGlobals(),
);

function readStoredGlobals(): WidgetGlobalsState {
  if (typeof localStorage === "undefined") return {};

  try {
    const raw = localStorage.getItem(WIDGET_GLOBALS_STORAGE_KEY);

    if (!raw) return {};

    return sanitizeWidgetGlobals(JSON.parse(raw));
  } catch {
    return {};
  }
}

function hydrateWidgetGlobals(): WidgetGlobalsState {
  return readStoredGlobals();
}

function persistWidgetGlobals(): void {
  if (typeof localStorage === "undefined") return;

  try {
    localStorage.setItem(
      WIDGET_GLOBALS_STORAGE_KEY,
      JSON.stringify(widgetGlobalsStore.state),
    );
  } catch {
    // Storage full/blocked — global settings stay session-only.
  }
}

/** Coerce parsed persisted JSON into a valid globals state (drop junk). */
export function sanitizeWidgetGlobals(input: JsonValue): WidgetGlobalsState {
  const entries = new Map<string, WidgetGlobalOverrides>();

  if (isJsonObject(input)) {
    for (const [widgetType, overrides] of Object.entries(input)) {
      if (isOverrideLayer(overrides) && Object.keys(overrides).length > 0) {
        entries.set(widgetType, overrides);
      }
    }
  }

  return Object.fromEntries(entries);
}

/** The type's global overrides (empty object when none are set). */
export function widgetGlobalOverrides(
  widgetType: string,
): WidgetGlobalOverrides {
  return widgetGlobalsStore.state[widgetType] ?? {};
}

/**
 * Effective config: `base` with every globally-overridden key replaced.
 * Pure — the hosting Panel runs it on every render.
 */
export function mergeWidgetSettings<T extends object>(
  base: T,
  globals: WidgetGlobalOverrides | undefined,
): T {
  if (!globals || Object.keys(globals).length === 0) return base;

  return { ...base, ...globals };
}

/**
 * Patch the type's global overrides. Only the CHANGED keys are recorded —
 * untouched values stay per-tab instead of being frozen into the global
 * layer. A `undefined` value deletes that key; an empty result removes the
 * entry entirely.
 */
export function setWidgetGlobalSettings<T extends object>(
  widgetType: string,
  patch: Partial<T>,
): void {
  // Settings forms write JSON primitives; the same Schema predicate that
  // guards the localStorage boundary keeps non-primitives out here too.
  const current = new Map<string, WidgetGlobalValue>(
    Object.entries(widgetGlobalOverrides(widgetType)),
  );

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) current.delete(key);
    else if (isGlobalValue(value)) current.set(key, value);
  }

  widgetGlobalsStore.setState((state) => {
    const next = { ...state };

    if (current.size === 0) delete next[widgetType];
    else next[widgetType] = Object.fromEntries(current);

    return next;
  });
  persistWidgetGlobals();
}

/** Drop the type's global overrides — every instance falls back to its own config. */
export function clearWidgetGlobalSettings(widgetType: string): void {
  if (!widgetGlobalsStore.state[widgetType]) return;
  widgetGlobalsStore.setState((state) => {
    const { [widgetType]: _removed, ...rest } = state;

    return rest;
  });
  persistWidgetGlobals();
}
