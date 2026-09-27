// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Either, Schema } from "effect";
import { Store } from "@tanstack/store";
import {
  ACCENT_COLORS,
  CARBON_THEMES,
  type AccentColor,
  type CarbonTheme,
} from "./carbonTheme";

/**
 * Client-side TanStack Store for web-shell preferences (backend URL, live
 * pause, appearance). Ephemeral UI state lives here or in component state —
 * never in SQLite. Workspace state lives in `workspace/store.ts`; the time
 * format preference lives with the widgets package
 * (`@nfi/widgets` → `shared/timeFormat`) so every widget reads it directly.
 */

const PREFS_STORAGE_KEY = "nfi-desk.prefs.v1";

const LEGACY_API_BASE_URL_KEY = "nfi-desk.api-base-url";

export interface PrefsState {
  /** Backend base URL. Empty = same-origin (Vite `/api` proxy in dev). */
  readonly apiBaseUrl: string;
  readonly livePaused: boolean;
  /** Carbon base theme (the four official gray themes). */
  readonly colorTheme: CarbonTheme;
  /** Accent color family layered over the base theme ("blue" = default). */
  readonly accentColor: AccentColor;
  /**
   * Render widgets below their declared minimum readable size: resize
   * handles stop enforcing the floors and the "needs more room" wall is
   * replaced by the raw widget at any size.
   */
  readonly disableWidgetMinSize: boolean;
}

const defaultPrefs = (): PrefsState => ({
  apiBaseUrl: String(import.meta.env["VITE_API_URL"] ?? "").trim(),
  livePaused: false,
  colorTheme: "g100",
  accentColor: "blue",
  disableWidgetMinSize: false,
});

/** Shape actually persisted by the subscriber below (both fields optional). */
const PersistedPrefsSchema = Schema.Struct({
  apiBaseUrl: Schema.optional(Schema.String),
  livePaused: Schema.optional(Schema.Boolean),
  colorTheme: Schema.optional(Schema.Literal(...CARBON_THEMES)),
  accentColor: Schema.optional(Schema.Literal(...ACCENT_COLORS)),
  disableWidgetMinSize: Schema.optional(Schema.Boolean),
});

const loadPrefs = (): PrefsState => {
  const fallback = defaultPrefs();

  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);

    if (raw) {
      const decoded = Schema.decodeUnknownEither(PersistedPrefsSchema)(
        JSON.parse(raw),
      );

      if (Either.isRight(decoded)) {
        const prefs = decoded.right;

        return {
          apiBaseUrl: prefs.apiBaseUrl ?? fallback.apiBaseUrl,
          livePaused: prefs.livePaused === true,
          colorTheme: prefs.colorTheme ?? fallback.colorTheme,
          accentColor: prefs.accentColor ?? fallback.accentColor,
          disableWidgetMinSize: prefs.disableWidgetMinSize === true,
        };
      }
    }

    // Migrate the legacy standalone key on first run.
    const legacy = localStorage.getItem(LEGACY_API_BASE_URL_KEY);

    if (legacy) {
      localStorage.removeItem(LEGACY_API_BASE_URL_KEY);

      return { ...fallback, apiBaseUrl: legacy };
    }
  } catch {
    // Storage unavailable — fall through to defaults.
  }

  return fallback;
};

export const prefsStore = new Store<PrefsState>(loadPrefs());

prefsStore.subscribe((state) => {
  try {
    localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({
        apiBaseUrl: state.apiBaseUrl,
        livePaused: state.livePaused,
        colorTheme: state.colorTheme,
        accentColor: state.accentColor,
        disableWidgetMinSize: state.disableWidgetMinSize,
      }),
    );
  } catch {
    // Persistence is best-effort (private mode, quota).
  }
});

export function setApiBaseUrl(apiBaseUrl: string): void {
  prefsStore.setState((state) => ({ ...state, apiBaseUrl }));
}

export function setLivePaused(livePaused: boolean): void {
  prefsStore.setState((state) => ({ ...state, livePaused }));
}

export function setColorTheme(colorTheme: CarbonTheme): void {
  prefsStore.setState((state) => ({ ...state, colorTheme }));
}

export function setAccentColor(accentColor: AccentColor): void {
  prefsStore.setState((state) => ({ ...state, accentColor }));
}

export function setDisableWidgetMinSize(disableWidgetMinSize: boolean): void {
  prefsStore.setState((state) => ({ ...state, disableWidgetMinSize }));
}
