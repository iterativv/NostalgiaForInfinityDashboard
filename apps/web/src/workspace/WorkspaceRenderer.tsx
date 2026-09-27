// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { LayoutNode, Workspace } from "@nfi/api-contract";
import { getLayoutMinWidth, type WidgetRegistry } from "@nfi/widget-sdk";
import { AutoPane } from "./AutoPane";
import { FlowPane } from "./FlowPane";
import { MasonryPane } from "./MasonryPane";
import { Panel } from "./Panel";
import { SplitPane } from "./SplitPane";
import { TabGroup } from "./TabGroup";

/**
 * WorkspaceRenderer — converts the declarative workspace model into React.
 *
 * ```text
 * Workspace → LayoutNode → Auto | Flow | Masonry | TabGroup | Panel → WidgetRegistry → Widget
 * ```
 *
 * Bento (`auto`) is the only page mode: exact-size masonry columns,
 * shortest-column gravity, stepless resize. Legacy `flow`/`masonry`/`split` documents still
 * decode (migrated to `auto` on load) and render through their panes when
 * encountered. Corrupt subtrees degrade to placeholders instead of crashing
 * the shell. `locked` renders everything read-only (signed out).
 */

export function WorkspaceRenderer({
  workspace,
  registry,
  onActivatePanel,
  onActivateTab,
  onClosePanel,
  onFlowItemResize,
  onMasonryItemResize,
  onAutoItemResize,
  onAutoItemMove,
  onOpenInto,
  onOpenCanvas,
  onMovePanel,
  onPinPanel,
  isPanelLocked,
  isSplitLocked = false,
  locked = false,
}: {
  workspace: Workspace;
  registry: WidgetRegistry;
  onActivatePanel: (panelId: string) => void;
  onActivateTab: (tabsId: string, panelId: string) => void;
  onClosePanel: (panelId: string) => void;
  /** Flow card resize (SE-corner drag, clamped to content minimums). */
  onFlowItemResize?: (
    flowId: string,
    itemId: string,
    width: number,
    height: number,
  ) => void;
  /** Masonry card height resize (SE-corner drag, clamped to content minimums). */
  onMasonryItemResize?: (
    masonryId: string,
    itemId: string,
    height: number,
    span?: number,
  ) => void;
  /** Auto card resize (SE-corner drag, clamped to content minimums). */
  onAutoItemResize?: (
    autoId: string,
    itemId: string,
    height: number,
    span?: number,
  ) => void;
  /** Auto card drag-reorder commit. */
  onAutoItemMove?: (autoId: string, itemId: string, targetIndex: number) => void;
  onOpenInto: (tabsId: string, anchor: DOMRect | null) => void;
  /**
   * Auto pane canvas-level "add widget": opens the picker with no tab
   * target so the pick appends as a fresh bento card (no slot booking).
   */
  onOpenCanvas?: (anchor: DOMRect | null) => void;
  onMovePanel: (
    panelId: string,
    targetTabsId: string,
    targetIndex?: number,
  ) => void;
  /** Detach a tab into the floating layer (removes it from its group). */
  onPinPanel?: (panelId: string) => void;
  /** True for locked tabs: no drag, no close, no float. */
  isPanelLocked?: (panelId: string) => boolean;
  /** True on non-editable pages: card grips and handles hide. */
  isSplitLocked?: boolean;
  /** True on read-only surfaces (signed out): tab add buttons and gears hide. */
  locked?: boolean;
}) {
  return (
    <LayoutNodeView
      node={workspace.layout}
      workspace={workspace}
      registry={registry}
      onActivatePanel={onActivatePanel}
      onActivateTab={onActivateTab}
      onClosePanel={onClosePanel}
      onFlowItemResize={onFlowItemResize}
      onMasonryItemResize={onMasonryItemResize}
      onAutoItemResize={onAutoItemResize}
      onAutoItemMove={onAutoItemMove}
      onOpenInto={onOpenInto}
      onOpenCanvas={onOpenCanvas}
      onMovePanel={onMovePanel}
      onPinPanel={onPinPanel}
      isPanelLocked={isPanelLocked}
      isSplitLocked={isSplitLocked}
      locked={locked}
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
  onFlowItemResize?: (
    flowId: string,
    itemId: string,
    width: number,
    height: number,
  ) => void;
  onMasonryItemResize?: (
    masonryId: string,
    itemId: string,
    height: number,
    span?: number,
  ) => void;
  onAutoItemResize?: (
    autoId: string,
    itemId: string,
    height: number,
    span?: number,
  ) => void;
  onAutoItemMove?: (autoId: string, itemId: string, targetIndex: number) => void;
  onOpenInto: (tabsId: string, anchor: DOMRect | null) => void;
  onOpenCanvas?: (anchor: DOMRect | null) => void;
  onMovePanel: (
    panelId: string,
    targetTabsId: string,
    targetIndex?: number,
  ) => void;
  onPinPanel?: (panelId: string) => void;
  isPanelLocked?: (panelId: string) => boolean;
  isSplitLocked?: boolean;
  /** True on read-only surfaces (signed out): tab add buttons and gears hide. */
  locked?: boolean;
}) {
  const {
    node,
    workspace,
    registry,
    onActivatePanel,
    onActivateTab,
    onClosePanel,
    onFlowItemResize,
    onMasonryItemResize,
    onAutoItemResize,
    onAutoItemMove,
    onOpenInto,
    onOpenCanvas,
    onMovePanel,
    onPinPanel,
  } = props;

  const isPanelLocked = props.isPanelLocked;
  const isSplitLocked = props.isSplitLocked ?? false;
  const locked = props.locked ?? false;

  switch (node.type) {
    case "grid":
      // Legacy grids migrate to `auto` on load — a grid reaching the
      // renderer is a stale in-memory tree; render nothing rather than a
      // resurrected grid UI.
      return null;
    case "flow":
      return (
        <FlowPane
          flow={node}
          panels={workspace.panels}
          lookup={(type) => registry.getWidget(type)}
          locked={isSplitLocked}
          onItemResize={onFlowItemResize ?? (() => undefined)}
          renderChild={(child) => <LayoutNodeView {...props} node={child} />}
        />
      );
    case "masonry":
      return (
        <MasonryPane
          masonry={node}
          panels={workspace.panels}
          lookup={(type) => registry.getWidget(type)}
          locked={isSplitLocked}
          onItemResize={onMasonryItemResize ?? (() => undefined)}
          renderChild={(child) => <LayoutNodeView {...props} node={child} />}
        />
      );
    case "auto":
      return (
        <AutoPane
          auto={node}
          panels={workspace.panels}
          lookup={(type) => registry.getWidget(type)}
          locked={isSplitLocked}
          onItemResize={onAutoItemResize ?? (() => undefined)}
          onItemMove={onAutoItemMove ?? (() => undefined)}
          onOpenCanvas={onOpenCanvas}
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
          onRatioChange={() => undefined}
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
          locked={locked}
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
