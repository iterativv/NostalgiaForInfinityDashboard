// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { AppShell } from "../workspace/AppShell"

/**
 * Primary application destination: the persistent terminal/workspace.
 * Widgets are NOT routes — the workspace model owns layout, tabs and
 * panels; the router only knows application-level destinations.
 */
export function TerminalPage() {
  return <AppShell />
}
