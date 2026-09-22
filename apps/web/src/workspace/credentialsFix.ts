// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { canEnableWidget } from "@nfi/widget-sdk";
import { credentialsFixStore } from "@nfi/widgets/live";
import { capabilitiesStore } from "../auth/capabilities";
import { widgetRegistry } from "./registry";
import {
  activateWorkspacePanel,
  addPresetPage,
  openWidgetPanel,
  switchActivePage,
  workspaceStore,
} from "./store";

/**
 * One destination for "edit freqtrade instance connections": the System
 * control room with the Freqtrade Instances widget in view. Shared by the
 * aside menu ("Freqtrade connections") and the "Freqtrade rejected the
 * credentials" widget CTA (`WidgetCtaContext.fixCredentials`).
 *
 * Presets are opt-in, so the System page is added first when it is not on
 * the pages bar yet. The failing instance id rides separately through
 * `credentialsFixStore` (recorded by the live layer) — the widget consumes
 * it on arrival and pre-opens that row's edit form.
 */

const SYSTEM_PAGE_ID = "page-system";

/** Focus the instances widget on the ACTIVE page; re-add when missing (grants permitting). */
function focusInstancesWidget(): void {
  // Synchronous store read: callers switch pages before this runs.
  const workspace = workspaceStore.state.workspace;
  const panelId = Object.keys(workspace.panels).find(
    (id) => workspace.panels[id]?.widgetType === "instances",
  );
  if (panelId) {
    activateWorkspacePanel(panelId);
    return;
  }
  // Widget was removed from the System page — re-add it (subject to grants).
  const definition = widgetRegistry.getWidget("instances");
  if (!definition) return;
  if (!canEnableWidget(definition, capabilitiesStore.state.granted)) return;
  openWidgetPanel(
    definition.type,
    structuredClone(definition.defaultConfig),
    {},
    definition.capabilities,
  );
}

/** Land on the instance-connections editor (see module doc). */
export async function openInstanceConnections(): Promise<void> {
  if (workspaceStore.state.pages.some((p) => p.id === SYSTEM_PAGE_ID)) {
    switchActivePage(SYSTEM_PAGE_ID);
  } else {
    // System preset not added yet — add the control room first. When the
    // add is refused (offline), focusing falls through to the current
    // page so the action still lands somewhere useful.
    await addPresetPage(SYSTEM_PAGE_ID);
  }
  focusInstancesWidget();
}

/**
 * CTA target for the "Freqtrade rejected the credentials" widget state
 * (`WidgetCtaContext.fixCredentials`) — the same destination as the aside
 * menu entry.
 */
export function openCredentialsFixer(): void {
  void openInstanceConnections();
}
