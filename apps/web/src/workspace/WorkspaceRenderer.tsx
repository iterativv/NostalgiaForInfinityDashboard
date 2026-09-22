// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { LayoutNode, Workspace } from "@nfi/api-contract";
import { getLayoutMinWidth, type WidgetRegistry } from "@nfi/widget-sdk";
import { GridPane } from "./GridPane";
import { Panel } from "./Panel";
import { SplitPane } from "./SplitPane";
import { TabGroup } from "./TabGroup";

/**
 * WorkspaceRenderer — converts the declarative workspace model into React.
 *
 * ```text
 * Workspace → LayoutNode → Grid | TabGroup | Panel → WidgetRegistry → Widget
 * ```
 *
 * Coupled to no specific widget: every leaf resolves through the registry.
 * Corrupt subtrees degrade to placeholders instead of crashing the shell.
 * Grid gutters clamp drags to the content minimums of the widgets in each
 * track and auto-stack narrow grids without ever mutating the persisted
 * layout. Legacy `split` nodes (pre-grid documents) still render, but the
 * store migrates them to grids at load.
 */

export function WorkspaceRenderer({
  workspace,
  registry,
  onActivatePanel,
  onActivateTab,
  onClosePanel,
  onResizeSplit,
  onTracksChange,
  onOpenInto,
  onMovePanel,
  onPinPanel,
  isPanelLocked,
  isSplitLocked = false,
}: {
  workspace: Workspace;
  registry: WidgetRegistry;
  onActivatePanel: (panelId: string) => void;
  onActivateTab: (tabsId: string, panelId: string) => void;
  onClosePanel: (panelId: string) => void;
  /** Legacy split resize (pre-grid documents). */
  onResizeSplit: (splitId: string, ratio: number) => void;
  onTracksChange: (
    gridId: string,
    axis: "columns" | "rows",
    tracks: number[],
  ) => void;
  onOpenInto: (tabsId: string, anchor: DOMRect | null) => void;
  onMovePanel: (
    panelId: string,
    targetTabsId: string,
    targetIndex?: number,
  ) => void;
  /** Detach a tab into the floating layer (removes it from its group). */
  onPinPanel?: (panelId: string) => void;
  /** True for pinned tabs (preset built-ins): no drag, no close, no float. */
  isPanelLocked?: (panelId: string) => boolean;
  /** True on non-editable (preset) pages: gutters and dividers are fixed. */
  isSplitLocked?: boolean;
}) {
  return (
    <LayoutNodeView
      node={workspace.layout}
      workspace={workspace}
      registry={registry}
      onActivatePanel={onActivatePanel}
      onActivateTab={onActivateTab}
      onClosePanel={onClosePanel}
      onResizeSplit={onResizeSplit}
      onTracksChange={onTracksChange}
      onOpenInto={onOpenInto}
      onMovePanel={onMovePanel}
      onPinPanel={onPinPanel}
      isPanelLocked={isPanelLocked}
      isSplitLocked={isSplitLocked}
    />
  );
}

function LayoutNodeView(props: {
  node: LayoutNode;
  workspace: Workspace;
  registry: WidgetRegistry;
  onActivatePanel: (panelId: string) => void;
  onActivateTab: (tabsId: string, panelId: string) => void;
  onClosePanel: (panelId: string) => void;
  onResizeSplit: (splitId: string, ratio: number) => void;
  onTracksChange: (
    gridId: string,
    axis: "columns" | "rows",
    tracks: number[],
  ) => void;
  onOpenInto: (tabsId: string, anchor: DOMRect | null) => void;
  onMovePanel: (
    panelId: string,
    targetTabsId: string,
    targetIndex?: number,
  ) => void;
  onPinPanel?: (panelId: string) => void;
  isPanelLocked?: (panelId: string) => boolean;
  isSplitLocked?: boolean;
}) {
  const {
    node,
    workspace,
    registry,
    onActivatePanel,
    onActivateTab,
    onClosePanel,
    onResizeSplit,
    onTracksChange,
    onOpenInto,
    onMovePanel,
    onPinPanel,
  } = props;
  const isPanelLocked = props.isPanelLocked;
  const isSplitLocked = props.isSplitLocked ?? false;
  switch (node.type) {
    case "grid":
      return (
        <GridPane
          grid={node}
          panels={workspace.panels}
          lookup={(type) => registry.getWidget(type)}
          locked={isSplitLocked}
          onTracksChange={onTracksChange}
          renderChild={(child) => <LayoutNodeView {...props} node={child} />}
        />
      );
    case "split": {
      const lookup = (type: string) => registry.getWidget(type);
      const minFirst = getLayoutMinWidth(node.first, workspace.panels, lookup);
      const minSecond = getLayoutMinWidth(
        node.second,
        workspace.panels,
        lookup,
      );
      return (
        <SplitPane
          splitId={node.id}
          direction={node.direction}
          ratio={node.ratio}
          onRatioChange={onResizeSplit}
          minFirst={minFirst}
          minSecond={minSecond}
          locked={isSplitLocked}
          first={<LayoutNodeView {...props} node={node.first} />}
          second={<LayoutNodeView {...props} node={node.second} />}
        />
      );
    }
    case "tabs":
      return (
        <TabGroup
          node={node}
          workspace={workspace}
          registry={registry}
          onActivatePanel={onActivatePanel}
          onActivateTab={onActivateTab}
          onClosePanel={onClosePanel}
          onOpenInto={onOpenInto}
          onMovePanel={onMovePanel}
          onPinPanel={onPinPanel}
          isPanelLocked={isPanelLocked}
        />
      );
    case "panel": {
      const instance = workspace.panels[node.panelId];
      return (
        <Panel
          panelId={node.panelId}
          widgetType={instance?.widgetType}
          widgetConfig={instance?.widgetConfig}
          title={undefined}
          focused={workspace.activePanelId === node.panelId}
          registry={registry}
          onActivate={onActivatePanel}
          onClose={onClosePanel}
        />
      );
    }
  }
}
