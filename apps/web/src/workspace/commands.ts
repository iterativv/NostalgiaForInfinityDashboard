// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  canEnableWidget,
  createCommandRegistry,
  type WidgetRegistry,
} from "@nfi/widget-sdk";
import { capabilitiesStore } from "../auth/capabilities";
import {
  closeActivePanel,
  cycleWorkspaceTab,
  openWidgetPanel,
  resetWorkspaceLayout,
  splitActivePanel,
} from "./store";
import { requestConfirm } from "@nfi/widgets";

/**
 * The single command implementation behind palette actions and keyboard
 * shortcuts. Widget entries are derived from the registry, so registering
 * a widget automatically adds palette surface. Grid arrangement is global:
 * the `Layout` command below opens the dialog for the active grid — the
 * same dialog the header layout button opens.
 */

export function buildCommands(
  registry: WidgetRegistry,
  options: { onArrange?: () => void } = {},
) {
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
        if (!canEnableWidget(definition, capabilitiesStore.state.granted))
          return;
        openWidgetPanel(
          type,
          structuredClone(defaultConfig),
          {},
          definition.capabilities,
        );
      },
    });
  }

  if (options.onArrange) {
    const onArrange = options.onArrange;
    commands.registerCommand({
      id: "workspace.arrange.dialog",
      title: "Arrange current grid…",
      category: "Layout",
      run: () => {
        onArrange();
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
    id: "workspace.splitHorizontal",
    title: "Split Active Cell Right",
    category: "Workspace",
    run: () => {
      splitActivePanel("horizontal");
    },
  });
  commands.registerCommand({
    id: "workspace.splitVertical",
    title: "Split Active Cell Down",
    category: "Workspace",
    run: () => {
      splitActivePanel("vertical");
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
