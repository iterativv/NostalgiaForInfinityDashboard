// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Store } from "@tanstack/store"
import { useStore } from "@tanstack/react-store"

/**
 * Widget settings bus — connects the tab strip / panel header gear to the
 * settings modal that lives inside each configurable widget.
 *
 * Widgets own their settings form (a `WidgetSettingsModal` portal) but must
 * not render their own trigger: the shell shows one gear per tab (right
 * after the close button) and one in each bare panel header. Both dispatch
 * here; the owning widget opens its modal in response.
 *
 * Single-modal policy: opening one panel's settings closes any other.
 *
 * Scope: every open modal carries the write scope — "tab" (the panel's own
 * config, the classic behavior) or "global" (overrides applied to every
 * instance of the widget type across pages/grids/floating windows; see
 * `widgetGlobals`). Opening resets to "tab"; the modal's scope control
 * switches it while open.
 */

/** Where settings-form writes land for the currently open modal. */
export type WidgetSettingsScope = "tab" | "global"

export const widgetSettingsStore = new Store<{
  openPanelId: string | null
  scope: WidgetSettingsScope
}>({ openPanelId: null, scope: "tab" })

/** Open the settings modal for `panelId` (closes any other; scope resets). */
export function requestWidgetSettings(panelId: string): void {
  widgetSettingsStore.setState(() => ({ openPanelId: panelId, scope: "tab" }))
}

/** Close whichever settings modal is open, if any. */
export function closeWidgetSettings(): void {
  widgetSettingsStore.setState((state) =>
    state.openPanelId === null ? state : { openPanelId: null, scope: "tab" },
  )
}

/** Switch the open modal's write scope (no-op when nothing is open). */
export function setWidgetSettingsScope(scope: WidgetSettingsScope): void {
  widgetSettingsStore.setState((state) =>
    state.openPanelId === null ? state : { ...state, scope },
  )
}

/** True while this panel's settings modal should be open (subscribed). */
export function useWidgetSettingsOpen(panelId: string): boolean {
  return useStore(widgetSettingsStore, (state) => state.openPanelId === panelId)
}

/** The open modal's write scope (subscribed). */
export function useWidgetSettingsScope(): WidgetSettingsScope {
  return useStore(widgetSettingsStore, (state) => state.scope)
}
