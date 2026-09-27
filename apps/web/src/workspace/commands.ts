// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  canEnableWidget,
  createCommandRegistry,
  type WidgetRegistry,
} from "@nfi/widget-sdk";
import { effectiveGranted } from "../auth/viewAs";
import { openInstanceConnections } from "./credentialsFix";
import {
  closeActivePanel,
  cycleWorkspaceTab,
  openWidgetPanel,
  resetWorkspaceLayout,
} from "./store";
import { requestConfirm } from "@nfi/widgets";

/**
 * The single command implementation behind palette actions and keyboard
 * shortcuts. Widget entries are derived from the registry, so registering
 * a widget automatically adds palette surface. Bento needs no arrange or
 * split commands — cards resize steplessly and reorder by drag.
 */

export function buildCommands(registry: WidgetRegistry) {
  const commands = createCommandRegistry();

  for (const definition of registry.listWidgets()) {
    const { type, title, defaultConfig } = definition;
    commands.registerCommand({
      id: `widget.open.${type}`,
      title: `Open ${title}`,
      category: "Widgets",
      run: () => {
        // Capability guard: unauthorized widgets cannot be enabled. The Panel
        // renders the same check as a placeholder for persisted instances.
        // View-as preview gates on the mocked grant (backend enforces real).
        if (!canEnableWidget(definition, effectiveGranted())) return;
        openWidgetPanel(
          type,
          structuredClone(defaultConfig),
          {},
          definition.capabilities,
        );
      },
    });
  }

  commands.registerCommand({
    id: "workspace.closeActivePanel",
    title: "Close Active Panel",
    category: "Workspace",
    run: () => {
      closeActivePanel();
    },
  });
  commands.registerCommand({
    id: "app.open.instances",
    title: "Manage Freqtrade Instances",
    category: "Workspace",
    run: () => {
      openInstanceConnections();
    },
  });
  commands.registerCommand({
    id: "workspace.nextTab",
    title: "Next Tab in Group",
    category: "Workspace",
    run: () => {
      cycleWorkspaceTab(1);
    },
  });
  commands.registerCommand({
    id: "workspace.previousTab",
    title: "Previous Tab in Group",
    category: "Workspace",
    run: () => {
      cycleWorkspaceTab(-1);
    },
  });
  commands.registerCommand({
    id: "workspace.resetLayout",
    title: "Reset Workspace to Default…",
    category: "Workspace",
    run: () => {
      void requestConfirm({
        title: "Reset workspace?",
        message: "Your current layout will be discarded.",
        confirmLabel: "Reset",
        danger: true,
      }).then((confirmed) => {
        if (confirmed) resetWorkspaceLayout();
      });
    },
  });

  return commands;
}

export type WorkspaceCommandRegistry = ReturnType<typeof buildCommands>;
