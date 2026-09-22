// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Panel-config sink — the app-injected write path for widget settings.
 *
 * Widgets previously imported `updatePanelConfig` straight from the app's
 * workspace store; extracted into this package they cannot. The app
 * registers its store op once at boot (`setPanelConfigSink`), and widgets
 * keep calling the same-shaped function. Writes before registration (tests,
 * SSR) return false instead of throwing.
 */

import { setWidgetGlobalSettings } from "./widgetGlobals";
import { widgetSettingsStore } from "./widgetSettingsBus";

type PanelConfigSink = (panelId: string, config: unknown) => boolean;

let sink: PanelConfigSink | null = null;

/** Register the app's config write path (idempotent, last call wins). */
export function setPanelConfigSink(fn: PanelConfigSink): void {
  sink = fn;
}

/**
 * Persist `config` as the panel's widget config. Returns false when no sink
 * is registered or the app refused the write (unknown panel id).
 */
export function updatePanelConfig(
  panelId: string,
  config: unknown,
): boolean {
  return sink ? sink(panelId, config) : false;
}

/**
 * Scope-aware settings write used by every widget settings form.
 *
 * While THIS panel's settings modal is open in "global" scope, the patch
 * (only its changed keys) is recorded as the widget TYPE's global overrides
 * — every instance of that widget across pages, grids and floating windows
 * renders the patched keys. Otherwise the patch merges into the panel's own
 * config through the app sink, exactly like before.
 *
 * `current` is the panel's effective config (global overrides already
 * merged by the hosting Panel) — tab-scope writes persist the merged
 * result, so switching a value from global back to tab is seamless.
 */
export function applyWidgetSettings<T extends object>(
  panelId: string,
  widgetType: string,
  current: T,
  patch: Partial<T>,
): boolean {
  const { openPanelId, scope } = widgetSettingsStore.state;
  if (openPanelId === panelId && scope === "global") {
    setWidgetGlobalSettings(widgetType, patch as Record<string, unknown>);
    return true;
  }
  return updatePanelConfig(panelId, { ...current, ...patch });
}
