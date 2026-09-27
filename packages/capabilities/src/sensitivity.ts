// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  DEFAULT_SENSITIVE_INFO_KINDS,
  type Capability,
  type InfoKind,
} from "@nfi/api-contract";
import { CAPABILITY_REGISTRY, type CapabilityName } from "./registry.js";

/**
 * Adjustable sensitivity criteria (pure derivation, no server state).
 *
 * Capabilities declare what they expose (`exposes`); the root user decides
 * which kinds count as sensitive (persisted server-side, served by
 * `System.sensitivity`). Everything below is that rule as functions, so
 * the web shell, the registry tests and the server agree by construction.
 */

/** Kinds of information the capability can expose (its declaration). */
export const capabilityExposes = (name: Capability): ReadonlyArray<InfoKind> => {
  // SAFETY: the registry literal is `satisfies Record<Capability, ...>` and
  // registry.ts carries the compile-time proof that every `Capability` id is
  // a registry key, so the index is always in range; unknown ids expose
  // nothing (the `?? []` arm is unreachable for contract ids).
  return CAPABILITY_REGISTRY[name as CapabilityName]?.exposes ?? [];
};

/**
 * A capability is sensitive iff it exposes at least one kind in the
 * configured sensitive set. Unknown ids expose nothing (they cannot occur:
 * widget capability arrays are compile-checked against the contract).
 */
export const isCapabilitySensitive = (
  name: Capability,
  sensitiveKinds: ReadonlyArray<InfoKind>,
): boolean => {
  const sensitive = new Set(sensitiveKinds);

  return capabilityExposes(name).some((kind) => sensitive.has(kind));
};

/**
 * A widget is non-sensitive iff every capability it uses is (a widget with
 * no backend capabilities is non-sensitive by construction).
 */
export const isNonSensitiveCapabilities = (
  capabilities: ReadonlyArray<Capability>,
  sensitiveKinds: ReadonlyArray<InfoKind>,
): boolean =>
  capabilities.every(
    (capability) => !isCapabilitySensitive(capability, sensitiveKinds),
  );

/** Classification under the built-in default criteria. */
export const isCapabilitySensitiveByDefault = (name: Capability): boolean =>
  isCapabilitySensitive(name, DEFAULT_SENSITIVE_INFO_KINDS);

/** Capability ids that are non-sensitive under the default criteria. */
export const nonSensitiveCapabilityNames = (): ReadonlyArray<Capability> =>
  (
    // SAFETY: `Object.keys` returns the registry's literal keys, and the
    // compile-time vocabulary proof in registry.ts guarantees those keys are
    // exactly the `Capability` union.
    Object.keys(CAPABILITY_REGISTRY) as ReadonlyArray<CapabilityName>
  ).filter((name) => !isCapabilitySensitiveByDefault(name));
