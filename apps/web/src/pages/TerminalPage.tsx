// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { AppShell } from "../workspace/AppShell"
import { useWorkspaceUrlSync } from "../workspace/useWorkspaceUrlSync"

/**
 * Primary application destination: the persistent terminal/workspace.
 * Widgets are NOT routes — the workspace model owns layout, tabs and
 * panels; the router only knows application-level destinations.
 *
 * Search params are the shareable position (`?page=` + `?panel=`, plus
 * one-shot `?widget=` + `?config=` from a tab's share link) — the sync
 * hook keeps the URL and the workspace store in both directions.
 */
export function TerminalPage() {
  useWorkspaceUrlSync();

  return <AppShell />
}
