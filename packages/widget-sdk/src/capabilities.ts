// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { Capability } from "@nfi/api-contract"
import type { AnyWidgetDefinition } from "./widgets.js"

/**
 * Capability gating — the frontend half of the widget <-> backend auth contract.
 *
 * Widgets declare `capabilities` (backend capability ids they need — the same
 * hard-coded ids from `@nfi/api-contract`, one function per id); the shell
 * holds the caller's granted set (from `Auth.capabilities`, open mode = all).
 * Everything — registry listing, command palette, sidebar, `openWidget` guard
 * and the Panel placeholder — funnels through these pure helpers, so adding
 * login later is a data change (granted set shrinks) rather than a UI rewrite.
 *
 * Capability ids are typed (`Capability`), not strings: declaring an unknown
 * id in a widget definition is a compile error.
 */

export type GrantedCapabilities = ReadonlySet<Capability> | ReadonlyArray<Capability>

const asSet = (granted: GrantedCapabilities): ReadonlySet<string> =>
  new Set<string>(Array.from(granted as Iterable<string>))

/** Capabilities in `required` that are absent from `granted`. */
export function missingCapabilities(
  required: ReadonlyArray<Capability>,
  granted: GrantedCapabilities,
): Capability[] {
  const have = asSet(granted)
  return required.filter((cap) => !have.has(cap))
}

/** Whether a widget definition may be enabled with the granted set. */
export function canEnableWidget(
  definition: Pick<AnyWidgetDefinition, "capabilities">,
  granted: GrantedCapabilities,
): boolean {
  return missingCapabilities(definition.capabilities, granted).length === 0
}

/** Registry-level filter: only widgets the caller is authorized to enable. */
export function filterAvailableWidgets<T extends Pick<AnyWidgetDefinition, "capabilities">>(
  definitions: ReadonlyArray<T>,
  granted: GrantedCapabilities,
): T[] {
  return definitions.filter((definition) => canEnableWidget(definition, granted))
}

/** Human-readable reason used by the Panel unauthorized placeholder. */
export function unauthorizedReason(
  definition: Pick<AnyWidgetDefinition, "title" | "capabilities">,
  granted: GrantedCapabilities,
): string {
  const missing = missingCapabilities(definition.capabilities, granted)
  if (missing.length === 0) return ""
  return `"${definition.title}" needs ${missing.join(", ")} — ask an admin to grant it.`
}

export type { Capability }
