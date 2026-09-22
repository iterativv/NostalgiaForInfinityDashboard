// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Store } from "@tanstack/store";
import type { CapabilityName } from "@nfi/capabilities";
import { isFreqtradeAuthError } from "@nfi/ui";

/**
 * "Fix credentials" hand-off between failing widgets and the instance
 * manager. When an `instances.*` capability fails because freqtrade
 * rejected the saved credentials (401), the live layer records WHICH
 * instance failed; the Freqtrade Instances widget consumes the request to
 * pre-open that row's edit form. The shell's CTA (WidgetCtaContext) only
 * navigates to the widget — the id travels through this store.
 */

export interface CredentialsFixState {
  /** Failing instance id, null when unknown (e.g. fleet/default widgets). */
  readonly instanceId: string | null;
  /** Bumps on every new request so consumers can react to re-failures. */
  readonly seq: number;
}

export const credentialsFixStore = new Store<CredentialsFixState>({
  instanceId: null,
  seq: 0,
});

/**
 * Record an auth failure for `options.id` (instances.* capabilities only —
 * bot.* widgets target the implicit default instance, whose row the user
 * can identify from the widget's status tag instead).
 */
export function noteInstanceAuthFailure(
  name: CapabilityName,
  options: unknown,
  formattedError: string | null,
): void {
  if (formattedError === null || !isFreqtradeAuthError(formattedError)) return;
  if (!name.startsWith("instances.")) return;
  const id = (options as { id?: unknown }).id;
  if (typeof id !== "string") return;
  credentialsFixStore.setState((state) => ({
    instanceId: id,
    seq: state.seq + 1,
  }));
}

/**
 * A later success for `id` invalidates a pending fix request (credentials
 * work again / failure was transient). Called from the live layer's
 * success path so the editor never opens for a stale failure.
 */
export function clearInstanceAuthFailure(
  name: CapabilityName,
  options: unknown,
): void {
  if (!name.startsWith("instances.")) return;
  const id = (options as { id?: unknown }).id;
  if (typeof id !== "string") return;
  const state = credentialsFixStore.state;
  if (state.instanceId !== id) return;
  credentialsFixStore.setState(() => ({ instanceId: null, seq: state.seq }));
}
