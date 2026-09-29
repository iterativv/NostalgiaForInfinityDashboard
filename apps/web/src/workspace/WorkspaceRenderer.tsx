// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { Workspace } from "@nfi/api-contract";
import type { WidgetRegistry } from "@nfi/widget-sdk";
import { TrellisWorkspace } from "./TrellisWorkspace";

/**
 * WorkspaceRenderer — converts the declarative workspace model into React.
 *
 * Layouting migrated to Trellis
 * (https://trellisui.com/docs/quick-start-react):
 *
 * ```text
 * Workspace → TrellisWorkspace → Workspace/ViewType/Split/Stage/Panel/View → Panel → WidgetRegistry → Widget
 * ```
 *
 * The NFI `Workspace` document (panels record + layout tree) is compiled
 * once per page to Trellis `<Split>/<Stage>/<Panel>/<View>` initial layout;
 * after mount Trellis owns docking, splitting, tabbing, floating, hiding
 * and zoom — every view stays mounted so iframes keep sessions and React
 * keeps state. Layout persists per page via Trellis `storageKey`.
 *
 * Legacy bento/flow/masonry/split resize + move callbacks are Trellis-owned
 * now (divider/tab drags): they stay on the prop interface as no-ops so
 * callers migrate incrementally. `onOpenInto` (per-group "+") maps to the
 * canvas add path — Trellis places new views via its default placement.
 * `locked` renders everything read-only (signed out).
 */

export function WorkspaceRenderer({
  workspace,
  registry,
  activePageId,
  onActivatePanel,
  onActivateTab,
  onClosePanel,
  onFlowItemResize: _onFlowItemResize,
  onMasonryItemResize: _onMasonryItemResize,
  onAutoItemResize: _onAutoItemResize,
  onAutoItemMove: _onAutoItemMove,
  onOpenInto,
  onOpenCanvas,
  onMovePanel: _onMovePanel,
  onPinPanel: _onPinPanel,
  isPanelLocked: _isPanelLocked,
  isSplitLocked = false,
  locked = false,
}: {
  workspace: Workspace;
  registry: WidgetRegistry;
  /** Scopes Trellis persistence per page; defaults to the workspace id. */
  activePageId?: string;
  onActivatePanel: (panelId: string) => void;
  onActivateTab: (tabsId: string, panelId: string) => void;
  onClosePanel: (panelId: string) => void;
  /** Legacy flow card resize — Trellis-owned via divider drags (no-op). */
  onFlowItemResize?: (
    flowId: string,
    itemId: string,
    width: number,
    height: number,
  ) => void;
  /** Legacy masonry card height resize — Trellis-owned (no-op). */
  onMasonryItemResize?: (
    masonryId: string,
    itemId: string,
    height: number,
    span?: number,
  ) => void;
  /** Legacy auto card resize — Trellis-owned (no-op). */
  onAutoItemResize?: (
    autoId: string,
    itemId: string,
    height: number,
    span?: number,
  ) => void;
  /** Legacy auto card drag-reorder — Trellis-owned (no-op). */
  onAutoItemMove?: (autoId: string, itemId: string, targetIndex: number) => void;
  onOpenInto: (tabsId: string, anchor: DOMRect | null) => void;
  /**
   * Auto pane canvas-level "add widget": opens the picker with no tab
   * target so the pick appends as a fresh Trellis view.
   */
  onOpenCanvas?: (anchor: DOMRect | null) => void;
  onMovePanel: (
    panelId: string,
    targetTabsId: string,
    targetIndex?: number,
  ) => void;
  /** Legacy detach-to-floating — Trellis float via panel menu (no-op). */
  onPinPanel?: (panelId: string) => void;
  /** Legacy per-tab lock — read-only surfaces use `locked` (no-op). */
  isPanelLocked?: (panelId: string) => boolean;
  /** True on non-editable pages: Trellis dividers stay user-owned. */
  isSplitLocked?: boolean;
  /** True on read-only surfaces (signed out): menus and adds hide. */
  locked?: boolean;
}) {
  return (
    <TrellisWorkspace
      workspace={workspace}
      registry={registry}
      activePageId={activePageId ?? workspace.id}
      onActivatePanel={onActivatePanel}
      onActivateTab={onActivateTab}
      onClosePanel={onClosePanel}
      onOpenCanvas={(anchor) => {
        if (onOpenCanvas) {
          onOpenCanvas(anchor);
        } else {
          onOpenInto("canvas", anchor);
        }
      }}
      isSplitLocked={isSplitLocked}
      locked={locked}
    />
  );
}
