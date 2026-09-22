// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * @nfi/widget-sdk
 *
 * Canonical workspace/widget contracts shared by every shell:
 *
 * - `widgets.ts` — widget definitions + the frontend widget registry
 * - `operations.ts` — pure, testable workspace transformations
 * - `commands.ts` — command + sidebar-contribution contracts
 *
 * Framework surface is deliberately narrow: only `widgets.ts` references
 * React (component types), and nothing here touches Carbon, the DOM, or
 * Node APIs. The backend never imports this package — it speaks the same
 * workspace model through `@nfi/api-contract` schemas.
 */

export {
  createWidgetRegistry,
  defineWidget,
  type AnyWidgetDefinition,
  type WidgetDefinition,
  type WidgetProps,
  type WidgetRegistry,
} from "./widgets.js";
export {
  activatePanel,
  activateTab,
  closePanel,
  collectPanelIds,
  createGrid,
  createLayoutNodeId,
  createPanelId,
  createPanelInstance,
  cycleTab,
  findEnclosingGrid,
  findFirstTabs,
  findNodeById,
  findTabsById,
  findTabsWithPanel,
  integrityErrors,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  movePanelToTabs,
  normalizeGridLayout,
  openWidget,
  prunePanelsFromLayout,
  replaceTabsSubtree,
  replaceWorkspaceLayout,
  resizeSplit,
  setGridTracks,
  setPanelConfig,
  setPanelTitle,
  splitGridCell,
  splitPanel,
  type GridCellSpec,
  type OpenWidgetOptions,
  type SplitPanelOptions,
} from "./operations.js";
export {
  createCommandRegistry,
  type Command,
  type CommandRegistry,
  type SidebarContribution,
} from "./commands.js";
export {
  canEnableWidget,
  filterAvailableWidgets,
  missingCapabilities,
  unauthorizedReason,
  type GrantedCapabilities,
} from "./capabilities.js";
export {
  clampTrackFractions,
  chooseSplitDirection,
  clampRatioForMinWidths,
  COMPACT_STACK_BREAKPOINT,
  DEFAULT_MIN_WIDGET_WIDTH,
  DIVIDER_PX,
  effectiveSplitDirection,
  gridColumnMinWidths,
  getGridStackedMinWidth,
  getLayoutMinWidth,
  getWidgetMinWidth,
  GRID_GUTTER_PX,
  MIN_SPLIT_PIXELS_FLOOR,
  MIN_TRACK_FRACTION,
  shouldStackGrid,
} from "./layout.js";
