// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import type { AppearanceDefaults } from "@nfi/api-contract";
import {
  hasStoredColorBlind,
  hasStoredTimeFormat,
  setColorBlindSafe,
  setTimeFormat,
  timeFormatStore,
  colorBlindStore,
  TIME_FORMAT_IDS,
} from "@nfi/widgets";
import { formatQueryError, runApi } from "../api";
import {
  hasStoredPrefs,
  prefsStore,
  setAccentColor,
  setColorTheme,
  setDisableWidgetMinSize,
  setHighContrast,
} from "../store";

/**
 * Shared appearance defaults — the frontend half.
 *
 * The "Appearance & layout" tab otherwise lives in per-browser localStorage,
 * so a fresh visitor renders hardcoded defaults while root sees their own
 * choices. Root snapshots their current appearance to the backend once; this
 * store holds that snapshot, hydrated next to capabilities so seeding lands
 * before the workspace renders.
 *
 * Seeding is default-only, never live-sync: a browser WITHOUT stored values
 * adopts the snapshot on boot (incognito matches root), while any browser
 * with its own stored values keeps them untouched. Touching a setting writes
 * localStorage through the existing setters, which is exactly what opts that
 * browser out of future default changes.
 */

export interface AppearanceDefaultsState {
  /** Root's snapshot (null = never saved: browsers use hardcoded defaults). */
  readonly defaults: AppearanceDefaults | null;
  readonly status: "loading" | "ready" | "offline";
  readonly detail: string | null;
}

export const appearanceDefaultsStore = new Store<AppearanceDefaultsState>({
  defaults: null,
  status: "loading",
  detail: null,
});

let hydrated = false;

export function resetAppearanceDefaultsHydration(): void {
  hydrated = false;
}

/** Seed local stores from the snapshot for keys this browser never set. */
function seedLocalFallbacks(defaults: AppearanceDefaults | null): void {
  if (!defaults) return;

  // Shell prefs share one file: a browser that never saved prefs adopts the
  // whole snapshot slice at once (a partial file means the user opted out).
  if (!hasStoredPrefs()) {
    if (defaults.colorTheme !== undefined) setColorTheme(defaults.colorTheme);

    if (defaults.accentColor !== undefined) setAccentColor(defaults.accentColor);

    if (defaults.highContrast !== undefined) setHighContrast(defaults.highContrast);

    if (defaults.disableWidgetMinSize !== undefined) {
      setDisableWidgetMinSize(defaults.disableWidgetMinSize);
    }
  }

  if (!hasStoredTimeFormat() && defaults.timeFormat !== undefined) {
    const known = TIME_FORMAT_IDS.find((id) => id === defaults.timeFormat);

    if (known !== undefined) setTimeFormat(known);
  }

  if (
    !hasStoredColorBlind() &&
    defaults.colorBlindSafe !== undefined
  ) {
    setColorBlindSafe(defaults.colorBlindSafe);
  }
}

/** Fetch root's snapshot once (idempotent) and seed unset local keys. */
export async function hydrateAppearanceDefaults(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  appearanceDefaultsStore.setState((state) => ({
    ...state,
    status: "loading",
    detail: null,
  }));

  try {
    const response = await runApi((client) => client.System.appearance());
    appearanceDefaultsStore.setState(() => ({
      defaults: response.defaults,
      status: "ready",
      detail: null,
    }));
    seedLocalFallbacks(response.defaults);
  } catch (error) {
    // Offline fallback: hardcoded + whatever is stored locally.
    appearanceDefaultsStore.setState(() => ({
      defaults: null,
      status: "offline",
      detail: formatQueryError(error) ?? "appearance defaults unavailable",
    }));
  }
}

/**
 * Snapshot the caller's CURRENT local appearance as the shared default
 * (root only — the backend refuses anyone else). Refreshes the store from
 * the server's canonical response.
 */
export async function saveAppearanceDefaults(): Promise<void> {
  const response = await runApi((client) =>
    client.System.appearanceUpdate({
      payload: {
        defaults: {
          colorTheme: prefsStore.state.colorTheme,
          accentColor: prefsStore.state.accentColor,
          timeFormat: timeFormatStore.state,
          colorBlindSafe: colorBlindStore.state,
          highContrast: prefsStore.state.highContrast,
          disableWidgetMinSize: prefsStore.state.disableWidgetMinSize,
        },
      },
    }),
  );

  appearanceDefaultsStore.setState(() => ({
    defaults: response.defaults,
    status: "ready",
    detail: null,
  }));
}

export function useAppearanceDefaults(): AppearanceDefaultsState {
  return useStore(appearanceDefaultsStore, (s) => s);
}
