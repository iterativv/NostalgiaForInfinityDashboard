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
  appendAutoItemCard,
  closePanel,
  collectPanelIds,
  createAuto,
  createFlow,
  createGrid,
  createLayoutNodeId,
  createMasonry,
  createPanelId,
  createPanelInstance,
  cycleTab,
  findAutoItemById,
  findEnclosingAuto,
  findEnclosingContainer,
  findEnclosingFlow,
  findEnclosingGrid,
  findEnclosingMasonry,
  findFirstTabs,
  findFlowItemById,
  findMasonryItemById,
  findNodeById,
  findTabsById,
  findTabsWithPanel,
  integrityErrors,
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  moveAutoItem,
  movePanelToTabs,
  normalizeAutoLayout,
  normalizeFlowLayout,
  normalizeGridLayout,
  normalizeMasonryLayout,
  openWidget,
  prunePanelsFromLayout,
  replaceTabsSubtree,
  replaceWorkspaceLayout,
  resizeSplit,
  setAutoItemSize,
  setFlowItemSize,
  setGridTracks,
  setMasonryItemSize,
  setPanelConfig,
  setPanelTitle,
  splitGridCell,
  splitPanel,
  type AppendAutoItemOptions,
  type AutoCellSpec,
  type FlowCellSpec,
  type GridCellSpec,
  type MasonryCellSpec,
  type OpenWidgetOptions,
  type PanelPlacementResult,
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
  AUTO_GAP_PX,
  AUTO_ITEM_CHROME_PX,
  autoSpanForWidth,
  clampFlowItemSize,
  clampTrackFractions,
  chooseSplitDirection,
  clampRatioForMinWidths,
  COMPACT_STACK_BREAKPOINT,
  DEFAULT_AUTO_COLUMN_WIDTH,
  DEFAULT_FLOW_ITEM_HEIGHT,
  DEFAULT_FLOW_ITEM_WIDTH,
  DEFAULT_MASONRY_COLUMN_WIDTH,
  DEFAULT_MIN_WIDGET_HEIGHT,
  DEFAULT_MIN_WIDGET_WIDTH,
  DIVIDER_PX,
  effectiveSplitDirection,
  FLOW_GAP_PX,
  getAutoItemMinHeight,
  getFlowItemMinSize,
  getLayoutMinHeight,
  getWidgetMinHeight,
  gridColumnMinWidths,
  gridRowMinHeights,
  getGridStackedMinWidth,
  getLayoutMinWidth,
  getMasonryItemMinHeight,
  getWidgetMinWidth,
  GRID_GUTTER_PX,
  MAX_AUTO_COLUMNS,
  MAX_FLOW_ITEM_HEIGHT,
  MAX_FLOW_ITEM_WIDTH,
  MAX_MASONRY_COLUMNS,
  MIN_AUTO_ITEM_HEIGHT,
  MIN_FLOW_ITEM_HEIGHT,
  MIN_FLOW_ITEM_WIDTH,
  MASONRY_ITEM_CHROME_PX,
  MIN_MASONRY_ITEM_HEIGHT,
  MIN_SPLIT_PIXELS_FLOOR,
  MIN_TRACK_FRACTION,
  minAutoSpan,
  MASONRY_GAP_PX,
  packAuto,
  packMasonry,
  type AutoPacking,
  type AutoPackedPosition,
  type FlowItemSize,
  type MasonryPacking,
  type MasonryPackedPosition,
  type PackAutoOptions,
  type TrackFractionPair,
  shouldStackGrid,
} from "./layout.js";
