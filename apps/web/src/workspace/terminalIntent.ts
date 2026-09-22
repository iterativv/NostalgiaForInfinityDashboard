// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * One-shot terminal intents — lets off-terminal pages (settings) ask the
 * terminal to open something on arrival. The settings header mirrors the
 * terminal header, so its search button sets an intent and navigates
 * to `/`; `AppShell` consumes it once on mount. (Grid customize lives on
 * each grid's strip, so it needs no cross-route intent.)
 */

export type TerminalIntent = "palette"

let pending: TerminalIntent | null = null

export function requestTerminalIntent(intent: TerminalIntent): void {
  pending = intent
}

/** Take the pending intent, clearing it (null when none was requested). */
export function consumeTerminalIntent(): TerminalIntent | null {
  const next = pending
  pending = null
  return next
}
