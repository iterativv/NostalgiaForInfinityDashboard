// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Shared widget plumbing: capability gating and contract-error formatting.
 *
 * Data-access contract: widgets use `useCapability(name, options)` (SSE
 * stream + TanStack Store, zero polling) for live data and `callCapability`
 * for one-shot reads and mutations. They declare the backend `capabilities`
 * they need in their `defineWidget` definition and gate on
 * `useWidgetAccess`. When auth lands and a capability is revoked, the widget
 * renders the unauthorized state instead of opening a stream.
 */

import { useStore } from "@tanstack/react-store";
import type { Capability } from "@nfi/api-contract";
import { missingCapabilities } from "@nfi/widget-sdk";
import { formatQueryError } from "@nfi/api-contract";
import { capabilitiesGrantStore } from "../live/transport";

/** Formatted query state surfaced by widget frames. */
export interface WidgetQueryState {
  readonly error: string | null;
  readonly isLoading: boolean;
}

export function queryState(
  error: string | null,
  isLoading: boolean,
): WidgetQueryState {
  return { isLoading, error: formatQueryError(error) };
}

/** Capability gate for one widget instance. */
export interface WidgetAccess {
  readonly allowed: boolean;
  readonly missing: Capability[];
}

/**
 * Capability gate for one widget instance. Returns `allowed` plus the
 * missing capability ids for the unauthorized placeholder. Live queries pass
 * `access.allowed` into the `enabled` flag of `useCapability`.
 */
export function useWidgetAccess(
  required: ReadonlyArray<Capability>,
): WidgetAccess {
  const granted = useStore(capabilitiesGrantStore, (state) => state.granted);
  const missing = missingCapabilities(required, granted);

  return { allowed: missing.length === 0, missing };
}

/** Unauthorized error surfaced as widget state (not a thrown query error). */
export function unauthorizedError(
  missing: ReadonlyArray<Capability>,
): string | null {
  if (missing.length === 0) return null;

  return `Not authorized — needs ${missing.join(", ")}`;
}
