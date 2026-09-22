// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Store } from "@tanstack/store"
import { useStore } from "@tanstack/react-store"
import { ALL_CAPABILITIES, type Capability } from "@nfi/api-contract"
import { canEnableWidget, type AnyWidgetDefinition } from "@nfi/widget-sdk"
import { formatQueryError, runApi } from "../api"

/**
 * Capability store — frontend half of the widget <-> backend auth contract.
 *
 * Widgets declare `capabilities` (what backend access they need); this store
 * holds the caller's granted set, hydrated from `Auth.capabilities`
 * (anonymous -> the public grant, signed in -> the user's grant, root ->
 * everything). The backend remains the enforcement point on every call;
 * this store only mirrors the grant so the UI can hide or show what the
 * caller cannot use. Offline or slow backend: fall back to the full set so
 * the terminal stays usable — unpermitted widgets then render backend error
 * states instead of forbidden states.
 */

export interface CapabilitiesState {
  readonly granted: ReadonlyArray<Capability>
  readonly status: "loading" | "ready" | "offline"
  readonly detail: string | null
  readonly authenticated: boolean
  readonly userId: string | undefined
  readonly username: string | undefined
  readonly role: "root" | "user" | "anonymous" | undefined
  /**
   * Whether an always-privileged root account exists (env or first-run
   * setup). `undefined` while loading/offline — the first-run gate only
   * redirects on an explicit `false`.
   */
  readonly rootProvisioned: boolean | undefined
}

export const capabilitiesStore = new Store<CapabilitiesState>({
  granted: [...ALL_CAPABILITIES],
  status: "loading",
  detail: null,
  authenticated: false,
  userId: undefined,
  username: undefined,
  role: undefined,
  rootProvisioned: undefined,
})

let hydrated = false

export function resetCapabilitiesHydration(): void {
  hydrated = false
}

/** Fetch the granted set once (idempotent; safe to call on backend switch). */
export async function hydrateCapabilities(): Promise<void> {
  if (hydrated) return
  hydrated = true
  capabilitiesStore.setState((state) => ({ ...state, status: "loading", detail: null }))
  try {
    const response = await runApi((client) => client.Auth.capabilities())
    capabilitiesStore.setState(() => ({
      granted: [...response.capabilities],
      status: "ready",
      detail: null,
      authenticated: response.authenticated ?? false,
      userId: response.userId,
      username: response.username,
      role: response.role,
      rootProvisioned: response.rootProvisioned,
    }))
  } catch (error) {
    // Offline fallback: grant everything locally so widgets stay usable.
    // Real enforcement lives server-side.
    capabilitiesStore.setState(() => ({
      granted: [...ALL_CAPABILITIES],
      status: "offline",
      detail: formatQueryError(error) ?? "capabilities unavailable",
      authenticated: false,
      userId: undefined,
      username: undefined,
      role: undefined,
      rootProvisioned: undefined,
    }))
  }
}

export function useCapabilities(): CapabilitiesState {
  return useStore(capabilitiesStore, (state) => state)
}

export function useCanEnable(definition: Pick<AnyWidgetDefinition, "capabilities">): boolean {
  const granted = useStore(capabilitiesStore, (state) => state.granted)
  return canEnableWidget(definition, granted)
}

/** Registry-level: only definitions the caller may enable. */
export function selectAvailableWidgets(
  definitions: ReadonlyArray<AnyWidgetDefinition>,
): AnyWidgetDefinition[] {
  return definitions.filter((definition) => canEnableWidget(definition, capabilitiesStore.state.granted))
}
