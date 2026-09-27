// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Live-layer bridges — the two app-owned inputs `useCapability` needs.
 *
 * This package owns the SSE pool and the capability store, but NOT the HTTP
 * transport (the app derives it from its API base-url preferences) nor the
 * auth bootstrap (the app hydrates its session store). Both are injected:
 * the app registers the transport at boot and mirrors its granted-
 * capabilities state into `capabilitiesGrantStore` whenever it changes.
 */

import { Store } from "@tanstack/store";
import { ALL_CAPABILITIES, type Capability } from "@nfi/api-contract";
import type {
  CapabilityName,
  CapabilityOptions,
  CapabilityResult,
} from "@nfi/capabilities";

export type CapabilityTransport = <N extends CapabilityName>(
  name: N,
  options: CapabilityOptions<N>,
) => Promise<CapabilityResult<N>>;

let transport: CapabilityTransport | null = null;

/** Register the app's unary capability caller (idempotent, last call wins). */
export function setCapabilityTransport(fn: CapabilityTransport): void {
  transport = fn;
}

let streamBaseUrl = "";

/**
 * Register the backend base URL for the SSE stream (`GET /api/stream`).
 * Same contract as the unary transport: empty = same-origin (Vite `/api`
 * proxy in dev), otherwise an http(s) origin. The live pool builds its
 * `EventSource` URL from this so custom-base deployments stream from the
 * same backend the REST calls hit — previously the stream was hardcoded to
 * same-origin and broke on custom base URLs while unary calls worked.
 */
export function setStreamBaseUrl(baseUrl: string): void {
  streamBaseUrl = baseUrl.trim().replace(/\/$/, "");
}

/** Absolute-or-relative stream URL for one SSE connection attempt. */
export function resolveStreamUrl(pathAndQuery: string): string {
  if (streamBaseUrl === "") return pathAndQuery;
  const path = pathAndQuery.startsWith("/") ? pathAndQuery : `/${pathAndQuery}`;

  return `${streamBaseUrl}${path}`;
}

/**
 * One-shot capability call through the injected transport. Rejects with a
 * descriptive error when no transport is registered (package used before
 * app boot — every real surface registers in `main.tsx`).
 */
export function callCapability<N extends CapabilityName>(
  name: N,
  options: CapabilityOptions<N>,
): Promise<CapabilityResult<N>> {
  if (!transport) {
    return Promise.reject(
      new Error(
        "Capability transport not registered — call setCapabilityTransport at app boot.",
      ),
    );
  }

  return transport(name, options);
}

export interface CapabilitiesGrantState {
  /** Granted capability ids (lenient offline default: everything). */
  readonly granted: ReadonlyArray<Capability>;
  /** Whether the caller is signed in (drives the sign-in error hint). */
  readonly authenticated: boolean;
}

/**
 * Mirrored grant state — the app writes through on every auth change. Same
 * offline-lenient seeding as the app store: full grant until hydrate says
 * otherwise, so the terminal stays usable; enforcement is server-side.
 */
export const capabilitiesGrantStore = new Store<CapabilitiesGrantState>({
  granted: [...ALL_CAPABILITIES],
  authenticated: false,
});

/** Write-through from the app's auth bootstrap. */
export function setCapabilitiesGrant(
  granted: ReadonlyArray<Capability>,
  authenticated: boolean,
): void {
  capabilitiesGrantStore.setState(() => ({
    granted: [...granted],
    authenticated,
  }));
}
