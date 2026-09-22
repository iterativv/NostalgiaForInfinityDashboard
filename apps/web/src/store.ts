// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Store } from "@tanstack/store"

/**
 * Client-side TanStack Store for web-shell preferences (backend URL, live
 * pause). Ephemeral UI state lives here or in component state — never in
 * SQLite. Workspace state lives in `workspace/store.ts`.
 */

const PREFS_STORAGE_KEY = "nfi-desk.prefs.v1"
const LEGACY_API_BASE_URL_KEY = "nfi-desk.api-base-url"

export interface PrefsState {
  /** Backend base URL. Empty = same-origin (Vite `/api` proxy in dev). */
  readonly apiBaseUrl: string
  readonly livePaused: boolean
}

const defaultPrefs = (): PrefsState => ({
  apiBaseUrl: ((import.meta.env["VITE_API_URL"] as string | undefined) ?? "").trim(),
  livePaused: false,
})

const loadPrefs = (): PrefsState => {
  const fallback = defaultPrefs()
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PrefsState>
      return {
        apiBaseUrl: typeof parsed.apiBaseUrl === "string" ? parsed.apiBaseUrl : fallback.apiBaseUrl,
        livePaused: parsed.livePaused === true,
      }
    }
    // Migrate the legacy standalone key on first run.
    const legacy = localStorage.getItem(LEGACY_API_BASE_URL_KEY)
    if (legacy) {
      localStorage.removeItem(LEGACY_API_BASE_URL_KEY)
      return { ...fallback, apiBaseUrl: legacy }
    }
  } catch {
    // Storage unavailable — fall through to defaults.
  }
  return fallback
}

export const prefsStore = new Store<PrefsState>(loadPrefs())

prefsStore.subscribe((state) => {
  try {
    localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({
        apiBaseUrl: state.apiBaseUrl,
        livePaused: state.livePaused,
      }),
    )
  } catch {
    // Persistence is best-effort (private mode, quota).
  }
})

export function setApiBaseUrl(apiBaseUrl: string): void {
  prefsStore.setState((state) => ({ ...state, apiBaseUrl }))
}

export function setLivePaused(livePaused: boolean): void {
  prefsStore.setState((state) => ({ ...state, livePaused }))
}
