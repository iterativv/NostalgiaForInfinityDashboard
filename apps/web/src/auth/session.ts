// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { formatQueryError, runApi } from "../api"
import { hydrateCapabilities, resetCapabilitiesHydration } from "./capabilities"
import {
  hydrateSensitivity,
  resetSensitivityHydration,
} from "../capabilities/sensitivity"
import { rehydrateWorkspace } from "../workspace/store"
import { liveStore } from "../capabilities/live"

/**
 * Session actions — the frontend half of login/logout.
 *
 * Both exchanges go through the backend (`Auth.login` / `Auth.logout`, which
 * manage the HttpOnly session cookie). Afterwards the whole auth-sensitive
 * UI state is re-derived from the backend: the granted capability set
 * (`Auth.capabilities`), the workspace (which the caller may or may not
 * persist) and any cached live snapshots. The backend enforces everything;
 * this only makes the UI converge on the caller's new identity.
 */

/** Re-read identity + grant + workspace after any session change. */
export async function refreshSessionState(): Promise<void> {
  resetCapabilitiesHydration()
  resetSensitivityHydration()
  // Drop cached live snapshots: they may belong to the previous identity's
  // grants (e.g. absolute values seen before switching to anonymous).
  liveStore.setState(() => ({}))
  await Promise.allSettled([
    hydrateCapabilities(),
    hydrateSensitivity(),
    rehydrateWorkspace(),
  ])
}

export async function login(username: string, password: string): Promise<void> {
  await runApi((client) => client.Auth.login({ payload: { username, password } }))
  await refreshSessionState()
}

export async function logout(): Promise<void> {
  try {
    await runApi((client) => client.Auth.logout())
  } catch (error) {
    // Logging out is best-effort client-side; the cookie clear matters most.
    void formatQueryError(error)
  }
  await refreshSessionState()
}
