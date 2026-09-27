// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  type AutoItemLayoutNode,
  type AutoLayoutNode,
  type FlowItemLayoutNode,
  type FlowLayoutNode,
  type GridLayoutNode,
  type GridItemLayoutNode,
  type MasonryItemLayoutNode,
  type MasonryLayoutNode,
  type LayoutNode,
  type LayoutNodeId,
  type PanelId,
  type PanelInstance,
  type PanelLayoutNode,
  type SplitDirection,
  type SplitLayoutNode,
  type TabsLayoutNode,
  type Workspace,
} from "@nfi/api-contract";

/**
 * Pure workspace transformations — the workspace engine.
 *
 * Every function takes a `Workspace` and returns a new `Workspace`; React
 * components dispatch intent (open/split/close/activate/…) and never touch
 * nested layout structures directly. All functions are deterministic given
 * explicit ids, which makes them trivially testable.
 *
 * Layout model: `grid` containers (track fractions + positioned items),
 * `flow` containers (ordered resizable cards with flex-wrap) and `masonry`
 * containers (column-packing cards with flexible heights) host `tabs`
 * groups (or nested grids/flows/masonries); `panel` leaves may appear bare.
 * Splitting a cell wraps its content in a fresh 2-track grid — closing
 * panels prunes empty cells and the `normalize*Layout` helpers compact and
 * unwrap single-item containers, so the tree stays minimal without explicit
 * rebalancing.
 *
 * Conventions:
 * - `version` is bumped on every state-changing op (persistence hook).
 * - Unknown ids are no-ops returning the input unchanged (renderer degrades
 *   instead of crashing; integrity helpers report the problem).
 * - Tab groups are split as a whole: splitting a tabbed panel keeps the
 *   group intact on one side and places the new panel on the other.
 */

export const MIN_SPLIT_RATIO = 0.1;

export const MAX_SPLIT_RATIO = 0.9;

let idCounter = 0;

const uniqueSuffix = (): string => {
  idCounter += 1;

  return `${Date.now().toString(36)}-${idCounter.toString(36)}`;
};

export function createPanelId(prefix = "panel"): PanelId {
  // SAFETY: the interpolated unique suffix is never empty, so the result is
  // always a non-empty string — exactly what the PanelId brand certifies.
  return `${prefix}-${uniqueSuffix()}` as PanelId;
}

export function createLayoutNodeId(prefix = "node"): LayoutNodeId {
  // SAFETY: the interpolated unique suffix is never empty, so the result is
  // always a non-empty string — exactly what the LayoutNodeId brand certifies.
  return `${prefix}-${uniqueSuffix()}` as LayoutNodeId;
}

export function createPanelInstance(
  widgetType: string,
  config: PanelInstance["widgetConfig"],
  id?: string,
): PanelInstance {
  // SAFETY: `id` and `widgetType` come from the calling shell — ids it read
  // from a decoded workspace and registry keys like "development.inspector".
  // Both brands certify only a non-empty string, which those inputs always
  // are; an empty caller value would simply create an unaddressable panel.
  return {
    id: (id ??
      createPanelId(widgetType.replace(/[^a-zA-Z0-9]+/g, "-"))) as PanelId,
    widgetType: widgetType as PanelInstance["widgetType"],
    widgetConfig: config,
  };
}

const withVersion = (workspace: Workspace): Workspace => ({
  ...workspace,
  version: workspace.version + 1,
});

// --- Grid + flow construction helpers -------------------------------------------

export interface GridCellSpec {
  readonly col: number;
  readonly row: number;
  readonly colSpan?: number;
  readonly rowSpan?: number;
  readonly child: LayoutNode;
}

/** Build a grid node placing `cells` over the given track fractions. */
export function createGrid(
  columns: ReadonlyArray<number>,
  rows: ReadonlyArray<number>,
  cells: ReadonlyArray<GridCellSpec>,
): GridLayoutNode {
  return {
    type: "grid",
    id: createLayoutNodeId("grid"),
    columns: [...columns],
    rows: [...rows],
    items: cells.map((cell) => ({
      type: "item",
      id: createLayoutNodeId("cell"),
      col: cell.col,
      row: cell.row,
      colSpan: cell.colSpan ?? 1,
      rowSpan: cell.rowSpan ?? 1,
      child: cell.child,
    })),
  };
}

export interface FlowCellSpec {
  readonly width: number;
  readonly height: number;
  readonly child: LayoutNode;
}

/** Build a flow node from explicit card sizes (width/height clamped positive). */
export function createFlow(cells: ReadonlyArray<FlowCellSpec>): FlowLayoutNode {
  return {
    type: "flow",
    id: createLayoutNodeId("flow"),
    items: cells.map((cell) => ({
      type: "flow-item",
      id: createLayoutNodeId("flow-item"),
      width: cell.width > 0 && Number.isFinite(cell.width) ? cell.width : 360,
      height:
        cell.height > 0 && Number.isFinite(cell.height) ? cell.height : 280,
      child: cell.child,
    })),
  };
}

export interface MasonryCellSpec {
  readonly height: number;
  /** Column span (finite ≥ 1, fractions welcome; invalid values coerce to 1). */
  readonly span?: number;
  readonly child: LayoutNode;
}

/** Build a masonry node from explicit card heights (clamped positive). */
export function createMasonry(
  columnWidth: number,
  cells: ReadonlyArray<MasonryCellSpec>,
): MasonryLayoutNode {
  return {
    type: "masonry",
    id: createLayoutNodeId("masonry"),
    columnWidth:
      columnWidth > 0 && Number.isFinite(columnWidth) ? columnWidth : 320,
    items: cells.map((cell) => ({
      type: "masonry-item",
      id: createLayoutNodeId("masonry-item"),
      height:
        cell.height > 0 && Number.isFinite(cell.height) ? cell.height : 280,
      span:
        Number.isFinite(cell.span) && (cell.span ?? 0) >= 1 ? cell.span! : 1,
      child: cell.child,
    })),
  };
}

export interface AutoCellSpec {
  readonly height: number;
  /** Column span (finite ≥ 1, fractions welcome; invalid values coerce to 1). */
  readonly span?: number;
  readonly child: LayoutNode;
}

/** Build an auto node from explicit card sizes (clamped positive). */
export function createAuto(
  columnWidth: number,
  cells: ReadonlyArray<AutoCellSpec>,
): AutoLayoutNode {
  return {
    type: "auto",
    id: createLayoutNodeId("auto"),
    columnWidth:
      columnWidth > 0 && Number.isFinite(columnWidth) ? columnWidth : 320,
    items: cells.map((cell) => ({
      type: "auto-item",
      id: createLayoutNodeId("auto-item"),
      height:
        cell.height > 0 && Number.isFinite(cell.height) ? cell.height : 280,
      span:
        Number.isFinite(cell.span) && (cell.span ?? 0) >= 1 ? cell.span! : 1,
      child: cell.child,
    })),
  };
}

/**
 * Normalize a flow after edits: recurse into children, then unwrap
 * single-item flows (a lone card is not a flow). Returns `null` when empty.
 */
export function normalizeFlowLayout(flow: FlowLayoutNode): LayoutNode | null {
  if (flow.items.length === 0) return null;

  const items: FlowItemLayoutNode[] = flow.items.map((item) => {
    const child = item.child;
    let normalized: LayoutNode = child;

    if (child.type === "grid") {
      normalized = normalizeGridLayout(child) ?? child;
    } else if (child.type === "flow") {
      normalized = normalizeFlowLayout(child) ?? child;
    } else if (child.type === "masonry") {
      normalized = normalizeMasonryLayout(child) ?? child;
    } else if (child.type === "auto") {
      normalized = normalizeAutoLayout(child);
    }

    return normalized === child ? item : { ...item, child: normalized };
  });

  if (items.length === 1) return items[0]!.child;

  return { ...flow, items };
}

/**
 * Normalize a masonry after edits: recurse into children, then unwrap
 * single-item masonries (a lone card is not a masonry). Returns `null`
 * when empty.
 */
export function normalizeMasonryLayout(
  masonry: MasonryLayoutNode,
): LayoutNode | null {
  if (masonry.items.length === 0) return null;

  const items: MasonryItemLayoutNode[] = masonry.items.map((item) => {
    const child = item.child;
    let normalized: LayoutNode = child;

    if (child.type === "grid") {
      normalized = normalizeGridLayout(child) ?? child;
    } else if (child.type === "flow") {
      normalized = normalizeFlowLayout(child) ?? child;
    } else if (child.type === "masonry") {
      normalized = normalizeMasonryLayout(child) ?? child;
    } else if (child.type === "auto") {
      normalized = normalizeAutoLayout(child);
    }

    // Fractional spans persist stepless drags — coerce only the invalid
    // (same as auto).
    const span =
      Number.isFinite(item.span) && item.span >= 1 ? item.span : 1;

    return span !== item.span || normalized !== child
      ? { ...item, child: normalized, span }
      : item;
  });

  if (items.length === 1) return items[0]!.child;

  return { ...masonry, items };
}

/**
 * Normalize an auto after edits: recurse into children and coerce invalid
 * spans. Unlike flow/masonry, an auto KEEPS zero- and single-card shapes —
 * the bento mode is a page mode, not just a container: cards come and go
 * freely (adding a widget appends a card, closing one may leave the page
 * empty) and the page must stay in auto mode throughout.
 */
export function normalizeAutoLayout(auto: AutoLayoutNode): LayoutNode {
  const items: AutoItemLayoutNode[] = auto.items.map((item) => {
    const child = item.child;
    let normalized: LayoutNode = child;

    if (child.type === "grid") {
      normalized = normalizeGridLayout(child) ?? child;
    } else if (child.type === "flow") {
      normalized = normalizeFlowLayout(child) ?? child;
    } else if (child.type === "masonry") {
      normalized = normalizeMasonryLayout(child) ?? child;
    } else if (child.type === "auto") {
      normalized = normalizeAutoLayout(child);
    }

    // Fractional spans persist stepless drags — coerce only the invalid.
    const span =
      Number.isFinite(item.span) && item.span >= 1 ? item.span : 1;

    return span !== item.span || normalized !== child
      ? { ...item, child: normalized, span }
      : item;
  });

  return { ...auto, items };
}

/**
 * Normalize a grid after edits:
 * - drop items with no child (caller already pruned them),
 * - unwrap grids with a single item (a lone cell is not a grid),
 * - remove unused tracks and compact 1-based coordinates/spans.
 * Returns `null` when nothing remains.
 */
export function normalizeGridLayout(grid: GridLayoutNode): LayoutNode | null {
  if (grid.items.length === 0) return null;

  // Recurse first so nested containers settle before this level unwraps.
  const items: GridItemLayoutNode[] = grid.items.map((item) => {
    if (item.child.type === "grid")
      return { ...item, child: normalizeGridLayout(item.child) ?? item.child };

    if (item.child.type === "flow")
      return { ...item, child: normalizeFlowLayout(item.child) ?? item.child };

    if (item.child.type === "masonry")
      return {
        ...item,
        child: normalizeMasonryLayout(item.child) ?? item.child,
      };

    if (item.child.type === "auto")
      return {
        ...item,
        child: normalizeAutoLayout(item.child),
      };

    return item;
  });

  if (items.length === 1) return items[0]!.child;
  const usedCols = new Set<number>();
  const usedRows = new Set<number>();
  let maxCol = 0;
  let maxRow = 0;

  for (const item of items) {
    for (let c = item.col; c < item.col + Math.max(1, item.colSpan); c++) {
      usedCols.add(c);
      maxCol = Math.max(maxCol, c);
    }

    for (let r = item.row; r < item.row + Math.max(1, item.rowSpan); r++) {
      usedRows.add(r);
      maxRow = Math.max(maxRow, r);
    }
  }

  const colIndex = new Map<number, number>();
  let nextCol = 0;

  for (let c = 1; c <= maxCol; c++) {
    if (usedCols.has(c)) colIndex.set(c, ++nextCol);
  }

  const rowIndex = new Map<number, number>();
  let nextRow = 0;

  for (let r = 1; r <= maxRow; r++) {
    if (usedRows.has(r)) rowIndex.set(r, ++nextRow);
  }

  const columns: number[] = [];

  for (let c = 1; c <= maxCol; c++) {
    if (usedCols.has(c)) columns.push(grid.columns[c - 1] ?? 1);
  }

  const rows: number[] = [];

  for (let r = 1; r <= maxRow; r++) {
    if (usedRows.has(r)) rows.push(grid.rows[r - 1] ?? 1);
  }

  const compacted: GridItemLayoutNode[] = items.map((item) => ({
    ...item,
    col: colIndex.get(item.col) ?? 1,
    row: rowIndex.get(item.row) ?? 1,
    colSpan: Math.min(
      Math.max(1, item.colSpan),
      nextCol - (colIndex.get(item.col) ?? 1) + 1,
    ),
    rowSpan: Math.min(
      Math.max(1, item.rowSpan),
      nextRow - (rowIndex.get(item.row) ?? 1) + 1,
    ),
  }));

  return { ...grid, columns, rows, items: compacted };
}

// --- Tree traversal -----------------------------------------------------------

/** Panel ids in tree order (tab references first, then bare leaves). */
export function collectPanelIds(layout: LayoutNode): PanelId[] {
  switch (layout.type) {
    case "panel":
      return [layout.panelId];
    case "tabs":
      return [...layout.panels];
    case "grid":
      return layout.items.flatMap((item) => collectPanelIds(item.child));
    case "flow":
      return layout.items.flatMap((item) => collectPanelIds(item.child));
    case "masonry":
      return layout.items.flatMap((item) => collectPanelIds(item.child));
    case "auto":
      return layout.items.flatMap((item) => collectPanelIds(item.child));
    case "split":
      return [
        ...collectPanelIds(layout.first),
        ...collectPanelIds(layout.second),
      ];
  }
}

export function findTabsWithPanel(
  layout: LayoutNode,
  panelId: string,
): TabsLayoutNode | undefined {
  switch (layout.type) {
    case "panel":
      return undefined;
    case "tabs":
      return layout.panels.some((panel) => panel === panelId)
        ? layout
        : undefined;
    case "grid":
      for (const item of layout.items) {
        const found = findTabsWithPanel(item.child, panelId);

        if (found) return found;
      }

      return undefined;
    case "flow":
      for (const item of layout.items) {
        const found = findTabsWithPanel(item.child, panelId);

        if (found) return found;
      }

      return undefined;
    case "masonry":
      for (const item of layout.items) {
        const found = findTabsWithPanel(item.child, panelId);

        if (found) return found;
      }

      return undefined;
    case "auto":
      for (const item of layout.items) {
        const found = findTabsWithPanel(item.child, panelId);

        if (found) return found;
      }

      return undefined;
    case "split":
      return (
        findTabsWithPanel(layout.first, panelId) ??
        findTabsWithPanel(layout.second, panelId)
      );
  }
}

export function findTabsById(
  layout: LayoutNode,
  tabsId: string,
): TabsLayoutNode | undefined {
  switch (layout.type) {
    case "panel":
      return undefined;
    case "tabs":
      return layout.id === tabsId ? layout : undefined;
    case "grid":
      for (const item of layout.items) {
        const found = findTabsById(item.child, tabsId);

        if (found) return found;
      }

      return undefined;
    case "flow":
      for (const item of layout.items) {
        const found = findTabsById(item.child, tabsId);

        if (found) return found;
      }

      return undefined;
    case "masonry":
      for (const item of layout.items) {
        const found = findTabsById(item.child, tabsId);

        if (found) return found;
      }

      return undefined;
    case "auto":
      for (const item of layout.items) {
        const found = findTabsById(item.child, tabsId);

        if (found) return found;
      }

      return undefined;
    case "split":
      return (
        findTabsById(layout.first, tabsId) ??
        findTabsById(layout.second, tabsId)
      );
  }
}

/** Find any node (grid, flow, masonry, auto or tabs) by its layout id. */
export function findNodeById(
  layout: LayoutNode,
  nodeId: string,
):
  | GridLayoutNode
  | FlowLayoutNode
  | MasonryLayoutNode
  | AutoLayoutNode
  | TabsLayoutNode
  | undefined {
  if (layout.type === "tabs") return layout.id === nodeId ? layout : undefined;

  if (layout.type === "grid") {
    if (layout.id === nodeId) return layout;

    for (const item of layout.items) {
      const found = findNodeById(item.child, nodeId);

      if (found) return found;
    }
  }

  if (
    layout.type === "flow" ||
    layout.type === "masonry" ||
    layout.type === "auto"
  ) {
    if (layout.id === nodeId) return layout;

    for (const item of layout.items) {
      const found = findNodeById(item.child, nodeId);

      if (found) return found;
    }
  }

  return undefined;
}

/** Find a flow item wrapper by its item id (sizes live on the wrapper). */
export function findFlowItemById(
  layout: LayoutNode,
  itemId: string,
): FlowItemLayoutNode | undefined {
  if (layout.type === "grid") {
    for (const item of layout.items) {
      const found = findFlowItemById(item.child, itemId);

      if (found) return found;
    }

    return undefined;
  }

  if (layout.type === "flow") {
    for (const item of layout.items) {
      if (item.id === itemId) return item;
      const found = findFlowItemById(item.child, itemId);

      if (found) return found;
    }

    return undefined;
  }

  if (layout.type === "masonry") {
    for (const item of layout.items) {
      const found = findFlowItemById(item.child, itemId);

      if (found) return found;
    }

    return undefined;
  }

  if (layout.type === "auto") {
    for (const item of layout.items) {
      const found = findFlowItemById(item.child, itemId);

      if (found) return found;
    }

    return undefined;
  }

  if (layout.type === "split") {
    return (
      findFlowItemById(layout.first, itemId) ??
      findFlowItemById(layout.second, itemId)
    );
  }

  return undefined;
}

/** Find a masonry item wrapper by its item id (heights live on the wrapper). */
export function findMasonryItemById(
  layout: LayoutNode,
  itemId: string,
): MasonryItemLayoutNode | undefined {
  if (layout.type === "grid") {
    for (const item of layout.items) {
      const found = findMasonryItemById(item.child, itemId);

      if (found) return found;
    }

    return undefined;
  }

  if (layout.type === "flow") {
    for (const item of layout.items) {
      const found = findMasonryItemById(item.child, itemId);

      if (found) return found;
    }

    return undefined;
  }

  if (layout.type === "masonry") {
    for (const item of layout.items) {
      if (item.id === itemId) return item;
      const found = findMasonryItemById(item.child, itemId);

      if (found) return found;
    }

    return undefined;
  }

  if (layout.type === "auto") {
    for (const item of layout.items) {
      const found = findMasonryItemById(item.child, itemId);

      if (found) return found;
    }

    return undefined;
  }

  if (layout.type === "split") {
    return (
      findMasonryItemById(layout.first, itemId) ??
      findMasonryItemById(layout.second, itemId)
    );
  }

  return undefined;
}

/** Find an auto item wrapper by its item id (sizes live on the wrapper). */
export function findAutoItemById(
  layout: LayoutNode,
  itemId: string,
): AutoItemLayoutNode | undefined {
  if (layout.type === "grid") {
    for (const item of layout.items) {
      const found = findAutoItemById(item.child, itemId);

      if (found) return found;
    }

    return undefined;
  }

  if (layout.type === "flow") {
    for (const item of layout.items) {
      const found = findAutoItemById(item.child, itemId);

      if (found) return found;
    }

    return undefined;
  }

  if (layout.type === "masonry") {
    for (const item of layout.items) {
      const found = findAutoItemById(item.child, itemId);

      if (found) return found;
    }

    return undefined;
  }

  if (layout.type === "auto") {
    for (const item of layout.items) {
      if (item.id === itemId) return item;
      const found = findAutoItemById(item.child, itemId);

      if (found) return found;
    }

    return undefined;
  }

  if (layout.type === "split") {
    return (
      findAutoItemById(layout.first, itemId) ??
      findAutoItemById(layout.second, itemId)
    );
  }

  return undefined;
}

const containsNode = (layout: LayoutNode, nodeId: string): boolean => {
  if (layout.type === "tabs" || layout.type === "panel")
    return "id" in layout && layout.id === nodeId;

  if (layout.type === "grid") {
    if (layout.id === nodeId) return true;

    return layout.items.some((item) => containsNode(item.child, nodeId));
  }

  if (
    layout.type === "flow" ||
    layout.type === "masonry" ||
    layout.type === "auto"
  ) {
    if (layout.id === nodeId) return true;

    return layout.items.some(
      (item) => item.id === nodeId || containsNode(item.child, nodeId),
    );
  }

  return (
    layout.id === nodeId ||
    containsNode(layout.first, nodeId) ||
    containsNode(layout.second, nodeId)
  );
};

/**
 * Innermost grid whose subtree contains `nodeId` — the grid a tab strip's
 * "arrange" action should rebuild. Post-order so nested grids win over
 * their ancestors. Traverses flow containers transparently so grids nested
 * inside flow cards are still found.
 */
export function findEnclosingGrid(
  layout: LayoutNode,
  nodeId: string,
): GridLayoutNode | undefined {
  if (layout.type === "tabs" || layout.type === "panel") return undefined;

  if (layout.type === "split") {
    return (
      findEnclosingGrid(layout.first, nodeId) ??
      findEnclosingGrid(layout.second, nodeId)
    );
  }

  if (
    layout.type === "flow" ||
    layout.type === "masonry" ||
    layout.type === "auto"
  ) {
    for (const item of layout.items) {
      const found = findEnclosingGrid(item.child, nodeId);

      if (found) return found;
    }

    return undefined;
  }

  for (const item of layout.items) {
    const found = findEnclosingGrid(item.child, nodeId);

    if (found) return found;
  }

  if (layout.id !== nodeId && containsNode(layout, nodeId)) return layout;

  return undefined;
}

/**
 * Innermost flow whose subtree contains `nodeId` — the flow a tab strip's
 * "arrange" action should rebuild when the strip lives in a flow card.
 * Post-order so nested flows win; traverses grids transparently.
 */
export function findEnclosingFlow(
  layout: LayoutNode,
  nodeId: string,
): FlowLayoutNode | undefined {
  if (layout.type === "tabs" || layout.type === "panel") return undefined;

  if (layout.type === "split") {
    return (
      findEnclosingFlow(layout.first, nodeId) ??
      findEnclosingFlow(layout.second, nodeId)
    );
  }

  if (layout.type === "grid" || layout.type === "masonry" || layout.type === "auto") {
    // Grids, masonries and autos are traversed transparently — a
    // grid/masonry/auto node itself is never a "flow".
    for (const item of layout.items) {
      const found = findEnclosingFlow(item.child, nodeId);

      if (found) return found;
    }

    return undefined;
  }

  for (const item of layout.items) {
    const found = findEnclosingFlow(item.child, nodeId);

    if (found) return found;
  }

  if (layout.id !== nodeId && containsNode(layout, nodeId)) return layout;

  return undefined;
}

/**
 * Innermost masonry whose subtree contains `nodeId` — the masonry a tab
 * strip's "arrange" action should rebuild when the strip lives in a masonry
 * card. Post-order so nested masonries win; traverses grids and flows
 * transparently.
 */
export function findEnclosingMasonry(
  layout: LayoutNode,
  nodeId: string,
): MasonryLayoutNode | undefined {
  if (layout.type === "tabs" || layout.type === "panel") return undefined;

  if (layout.type === "split") {
    return (
      findEnclosingMasonry(layout.first, nodeId) ??
      findEnclosingMasonry(layout.second, nodeId)
    );
  }

  if (layout.type === "grid") {
    for (const item of layout.items) {
      const found = findEnclosingMasonry(item.child, nodeId);

      if (found) return found;
    }

    return undefined;
  }

  if (layout.type === "flow" || layout.type === "auto") {
    for (const item of layout.items) {
      const found = findEnclosingMasonry(item.child, nodeId);

      if (found) return found;
    }

    return undefined;
  }

  for (const item of layout.items) {
    const found = findEnclosingMasonry(item.child, nodeId);

    if (found) return found;
  }

  if (layout.id !== nodeId && containsNode(layout, nodeId)) return layout;

  return undefined;
}

/**
 * Innermost auto whose subtree contains `nodeId` — the auto a tab strip's
 * "arrange" action should rebuild when the strip lives in an auto card.
 * Post-order so nested autos win; traverses grids, flows and masonries
 * transparently.
 */
export function findEnclosingAuto(
  layout: LayoutNode,
  nodeId: string,
): AutoLayoutNode | undefined {
  if (layout.type === "tabs" || layout.type === "panel") return undefined;

  if (layout.type === "split") {
    return (
      findEnclosingAuto(layout.first, nodeId) ??
      findEnclosingAuto(layout.second, nodeId)
    );
  }

  if (layout.type === "grid" || layout.type === "flow" || layout.type === "masonry") {
    for (const item of layout.items) {
      const found = findEnclosingAuto(item.child, nodeId);

      if (found) return found;
    }

    return undefined;
  }

  for (const item of layout.items) {
    const found = findEnclosingAuto(item.child, nodeId);

    if (found) return found;
  }

  if (layout.id !== nodeId && containsNode(layout, nodeId)) return layout;

  return undefined;
}

/**
 * Innermost grid, flow, masonry OR auto containing `nodeId` (whichever is
 * deeper).
 */
export function findEnclosingContainer(
  layout: LayoutNode,
  nodeId: string,
):
  | GridLayoutNode
  | FlowLayoutNode
  | MasonryLayoutNode
  | AutoLayoutNode
  | undefined {
  let innermost:
    | GridLayoutNode
    | FlowLayoutNode
    | MasonryLayoutNode
    | AutoLayoutNode
    | undefined = findEnclosingGrid(layout, nodeId);

  for (const candidate of [
    findEnclosingFlow(layout, nodeId),
    findEnclosingMasonry(layout, nodeId),
    findEnclosingAuto(layout, nodeId),
  ]) {
    if (!candidate) continue;

    // Deeper container wins: the one containing the other is its ancestor.
    if (!innermost || containsNode(innermost, candidate.id))
      innermost = candidate;
  }

  return innermost;
}

export function findFirstTabs(layout: LayoutNode): TabsLayoutNode | undefined {
  switch (layout.type) {
    case "panel":
      return undefined;
    case "tabs":
      return layout;
    case "grid":
      for (const item of layout.items) {
        const found = findFirstTabs(item.child);

        if (found) return found;
      }

      return undefined;
    case "flow":
      for (const item of layout.items) {
        const found = findFirstTabs(item.child);

        if (found) return found;
      }

      return undefined;
    case "masonry":
      for (const item of layout.items) {
        const found = findFirstTabs(item.child);

        if (found) return found;
      }

      return undefined;
    case "auto":
      for (const item of layout.items) {
        const found = findFirstTabs(item.child);

        if (found) return found;
      }

      return undefined;
    case "split":
      return findFirstTabs(layout.first) ?? findFirstTabs(layout.second);
  }
}

function replaceLayoutNode<N extends LayoutNode>(
  layout: LayoutNode,
  matches: (node: LayoutNode) => node is N,
  replacement: (node: N) => LayoutNode,
): LayoutNode {
  if (matches(layout)) return replacement(layout);

  if (layout.type === "split") {
    return {
      ...layout,
      first: replaceLayoutNode(layout.first, matches, replacement),
      second: replaceLayoutNode(layout.second, matches, replacement),
    };
  }

  if (layout.type === "grid") {
    let changed = false;

    const items = layout.items.map((item) => {
      const child = replaceLayoutNode(item.child, matches, replacement);

      if (child !== item.child) changed = true;

      return child === item.child ? item : { ...item, child };
    });

    return changed ? { ...layout, items } : layout;
  }

  if (layout.type === "flow") {
    let changed = false;

    const items = layout.items.map((item) => {
      const child = replaceLayoutNode(item.child, matches, replacement);

      if (child !== item.child) changed = true;

      return child === item.child ? item : { ...item, child };
    });

    return changed ? { ...layout, items } : layout;
  }

  if (layout.type === "masonry") {
    let changed = false;

    const items = layout.items.map((item) => {
      const child = replaceLayoutNode(item.child, matches, replacement);

      if (child !== item.child) changed = true;

      return child === item.child ? item : { ...item, child };
    });

    return changed ? { ...layout, items } : layout;
  }

  if (layout.type === "auto") {
    let changed = false;

    const items = layout.items.map((item) => {
      const child = replaceLayoutNode(item.child, matches, replacement);

      if (child !== item.child) changed = true;

      return child === item.child ? item : { ...item, child };
    });

    return changed ? { ...layout, items } : layout;
  }

  return layout;
}

function updateTabsNode(
  layout: LayoutNode,
  tabsId: string,
  update: (tabs: TabsLayoutNode) => TabsLayoutNode,
): LayoutNode {
  return replaceLayoutNode(
    layout,
    (node): node is TabsLayoutNode =>
      node.type === "tabs" && node.id === tabsId,
    update,
  );
}

/**
 * Remove every reference to `remove` panel ids. Empty cells are NEVER
 * deleted: a group that loses its last panel stays as an empty group (the
 * "open widget here" placeholder keeps the cell and the grid/flow geometry
 * stable), and a bare-panel cell that empties becomes an empty group too.
 * Only a fully-empty ROOT container collapses to a single empty root group.
 * EXCEPT autos: a bento card that loses its last panel is dropped (cards
 * are widgets, not bookable slots) and the auto container itself survives
 * even with zero cards. Returns null only for a pruned bare panel leaf
 * outside any container.
 */
export function prunePanelsFromLayout(
  layout: LayoutNode,
  remove: ReadonlySet<string>,
): LayoutNode | null {
  switch (layout.type) {
    case "panel":
      return remove.has(layout.panelId) ? null : layout;
    case "tabs": {
      const panels = layout.panels.filter((id) => !remove.has(id));

      if (panels.length === 0) {
        // Keep the empty group: its cell (and the grid tracks / flow card
        // around it) survives so closing or moving the last tab never
        // reshapes the page underneath the user.
        return { ...layout, panels: [], activePanelId: null };
      }

      const activePanelId =
        layout.activePanelId !== null && !remove.has(layout.activePanelId)
          ? layout.activePanelId
          : (panels.at(-1) ?? null);

      return { ...layout, panels, activePanelId };
    }

    case "grid": {
      const kept: GridItemLayoutNode[] = [];

      for (const item of layout.items) {
        const child = prunePanelsFromLayout(item.child, remove);

        if (child !== null) {
          kept.push({ ...item, child });
        } else {
          // Bare-panel cell emptied: keep the cell as an empty group.
          kept.push({ ...item, child: emptyTabsGroupInCell() });
        }
      }

      if (kept.length === 0) return null;

      return normalizeGridLayout({ ...ensureGridTracks(layout), items: kept });
    }

    case "flow": {
      const kept: FlowItemLayoutNode[] = [];

      for (const item of layout.items) {
        const child = prunePanelsFromLayout(item.child, remove);

        if (child !== null) {
          kept.push({ ...item, child });
        } else {
          // Bare-panel card emptied: keep the card as an empty group so the
          // user's custom sizes survive closing the last tab.
          kept.push({ ...item, child: emptyTabsGroupInCell() });
        }
      }

      if (kept.length === 0) return null;

      return normalizeFlowLayout({ ...layout, items: kept });
    }

    case "masonry": {
      const kept: MasonryItemLayoutNode[] = [];

      for (const item of layout.items) {
        const child = prunePanelsFromLayout(item.child, remove);

        if (child !== null) {
          kept.push({ ...item, child });
        } else {
          // Bare-panel card emptied: keep the card (and its height) so the
          // column packing stays stable after closing the last tab.
          kept.push({ ...item, child: emptyTabsGroupInCell() });
        }
      }

      if (kept.length === 0) return null;

      return normalizeMasonryLayout({ ...layout, items: kept });
    }

    case "auto": {
      const kept: AutoItemLayoutNode[] = [];

      for (const item of layout.items) {
        const child = prunePanelsFromLayout(item.child, remove);

        // Bento cards are widgets, not slots: a card whose last panel closed
        // or moved out is DROPPED (no empty placeholder to re-book). The auto
        // itself survives — even with zero cards the page stays in bento
        // mode, ready for the next add-widget append.
        if (child !== null && collectPanelIds(child).length > 0) {
          kept.push({ ...item, child });
        }
      }

      return normalizeAutoLayout({ ...layout, items: kept });
    }

    case "split": {
      const first = prunePanelsFromLayout(layout.first, remove);
      const second = prunePanelsFromLayout(layout.second, remove);

      if (first !== null && second !== null)
        return { ...layout, first, second };

      return first ?? second;
    }
  }
}

const emptyTabsGroupInCell = (): TabsLayoutNode => ({
  type: "tabs",
  id: createLayoutNodeId("tabs"),
  panels: [],
  activePanelId: null,
});

/** Grids whose declared tracks are shorter than their items need implicit 1s. */
const ensureGridTracks = (grid: GridLayoutNode): GridLayoutNode => {
  let maxCol = 0;
  let maxRow = 0;

  for (const item of grid.items) {
    maxCol = Math.max(maxCol, item.col + Math.max(1, item.colSpan) - 1);
    maxRow = Math.max(maxRow, item.row + Math.max(1, item.rowSpan) - 1);
  }

  const columns = [...grid.columns];

  while (columns.length < maxCol) columns.push(1);
  const rows = [...grid.rows];

  while (rows.length < maxRow) rows.push(1);

  return { ...grid, columns, rows };
};

const emptyRootTabs = (): TabsLayoutNode => ({
  type: "tabs",
  id: createLayoutNodeId("tabs"),
  panels: [],
  activePanelId: null,
});

/** Next focus candidate after removing `closedPanelId` from its group. */
function focusAfterClose(
  layout: LayoutNode,
  closedPanelId: string,
  surviving: Record<string, PanelInstance>,
): PanelId | null {
  const group = findTabsWithPanel(layout, closedPanelId);

  if (group) {
    const remaining = group.panels.filter(
      (id) => id !== closedPanelId && id in surviving,
    );

    if (remaining.length > 0) {
      const closedIndex = group.panels.findIndex((id) => id === closedPanelId);

      // The index is clamped into `remaining`, so `.at` always finds a panel.
      return (
        remaining.at(
          Math.min(Math.max(closedIndex, 0), remaining.length - 1),
        ) ?? null
      );
    }
  }

  const ids = collectPanelIds(layout).filter((id) => id in surviving);

  return ids.at(-1) ?? null;
}

export interface OpenWidgetOptions {
  readonly panelId?: string;
  readonly nodeId?: string;
  /** Open into the tab group containing this panel (defaults to active panel's group). */
  readonly targetPanelId?: string;
  /** Open into this tab group directly (wins over `targetPanelId`; supports empty groups). */
  readonly targetTabsId?: string;
}

/** Result of placing a widget: the updated workspace plus the placed panel. */
export interface PanelPlacementResult {
  readonly workspace: Workspace;
  readonly panelId: PanelId;
}

export function openWidget(
  workspace: Workspace,
  widgetType: string,
  config: PanelInstance["widgetConfig"],
  options: OpenWidgetOptions = {},
): PanelPlacementResult {
  const panel = createPanelInstance(widgetType, config, options.panelId);

  const panels = { ...workspace.panels, [panel.id]: panel };

  const anchor = options.targetPanelId ?? workspace.activePanelId;

  const explicitTarget =
    options.targetTabsId !== undefined
      ? findTabsById(workspace.layout, options.targetTabsId)
      : undefined;

  const target =
    explicitTarget ??
    (anchor !== null
      ? findTabsWithPanel(workspace.layout, anchor)
      : undefined) ??
    findFirstTabs(workspace.layout);

  let layout: LayoutNode;

  if (target) {
    layout = updateTabsNode(workspace.layout, target.id, (tabs) => ({
      ...tabs,
      panels: [...tabs.panels, panel.id],
      activePanelId: panel.id,
    }));
  } else {
    // Degenerate tree with no tab group (bare panel/grid leaves): split the
    // anchor panel's cell so the existing layout survives, or fall back to a
    // fresh root group when there is no anchor at all. The pre-created panel
    // instance is dropped — `splitGridCell` creates its own.
    const splitAnchor = anchor ?? collectPanelIds(workspace.layout)[0];

    if (splitAnchor !== undefined) {
      const { [panel.id]: _orphan, ...rest } = workspace.panels;
      const withoutOrphan: Workspace = { ...workspace, panels: rest };

      return splitGridCell(
        withoutOrphan,
        splitAnchor,
        "horizontal",
        { widgetType, config },
        options,
      );
    }

    // SAFETY: `options.nodeId` is an optional caller hint that is never
    // validated here; the TabsLayoutNode id only carries the non-empty
    // LayoutNodeId brand, and an empty hint would merely produce a node no
    // later lookup can match — never corrupted state.
    layout = {
      type: "tabs",
      id: (options.nodeId ??
        createLayoutNodeId("tabs")) as TabsLayoutNode["id"],
      panels: [panel.id],
      activePanelId: panel.id,
    };
  }

  return {
    workspace: withVersion({
      ...workspace,
      panels,
      layout,
      activePanelId: panel.id,
    }),
    panelId: panel.id,
  };
}

export function closePanel(workspace: Workspace, panelId: string): Workspace {
  if (!(panelId in workspace.panels)) return workspace;
  const panels = { ...workspace.panels };
  delete panels[panelId];

  const focus = focusAfterClose(workspace.layout, panelId, panels);
  const pruned = prunePanelsFromLayout(workspace.layout, new Set([panelId]));
  const layout: LayoutNode = pruned ?? emptyRootTabs();

  const activePanelId =
    focus ?? collectPanelIds(layout).filter((id) => id in panels)[0] ?? null;

  return withVersion({ ...workspace, panels, layout, activePanelId });
}

export function activatePanel(
  workspace: Workspace,
  panelId: string,
): Workspace {
  const instance = workspace.panels[panelId];

  if (!instance) return workspace;
  const group = findTabsWithPanel(workspace.layout, panelId);

  const layout = group
    ? updateTabsNode(workspace.layout, group.id, (tabs) => ({
        ...tabs,
        activePanelId: instance.id,
      }))
    : workspace.layout;

  if (workspace.activePanelId === instance.id && layout === workspace.layout)
    return workspace;

  return withVersion({
    ...workspace,
    layout,
    activePanelId: instance.id,
  });
}

export function activateTab(
  workspace: Workspace,
  tabsId: string,
  panelId: string,
): Workspace {
  const group = findTabsById(workspace.layout, tabsId);
  const instance = workspace.panels[panelId];

  if (!group || !instance || !group.panels.includes(instance.id)) {
    return workspace;
  }

  return withVersion({
    ...workspace,
    layout: updateTabsNode(workspace.layout, tabsId, (tabs) => ({
      ...tabs,
      activePanelId: instance.id,
    })),
    activePanelId: instance.id,
  });
}

/** Cycle the active tab within the active (or first) tab group. */
export function cycleTab(workspace: Workspace, direction: 1 | -1): Workspace {
  const anchor = workspace.activePanelId;

  const group =
    (anchor !== null
      ? findTabsWithPanel(workspace.layout, anchor)
      : undefined) ?? findFirstTabs(workspace.layout);

  if (!group || group.panels.length < 2) return workspace;

  const current =
    group.activePanelId !== null
      ? group.panels.indexOf(group.activePanelId)
      : -1;

  const next =
    group.panels[
      (current + direction + group.panels.length) % group.panels.length
    ]!;

  return activateTab(workspace, group.id, next);
}

export interface SplitPanelOptions {
  readonly panelId?: string;
  readonly nodeId?: string;
}

// SAFETY: suffixing a valid LayoutNodeId with "-first"/"-second" keeps the
// string non-empty (the brand's only guarantee) and matches the item-id
// convention `migrateLegacyLayout` already persists in @nfi/api-contract.
const cellItemId = (
  gridId: LayoutNodeId,
  side: "first" | "second",
): LayoutNodeId => `${gridId}-${side}` as LayoutNodeId;

/**
 * Split the cell hosting `anchorPanelId`: the anchor's whole tab group (or
 * bare panel) keeps its place as the first child of a fresh 2-track grid and
 * the new widget becomes the second — a nested grid, so arbitrarily deep
 * mosaics compose naturally. Closing either side later unwraps automatically
 * (see `normalizeGridLayout`).
 */
export function splitGridCell(
  workspace: Workspace,
  anchorPanelId: string,
  direction: SplitDirection,
  widget: { widgetType: string; config: PanelInstance["widgetConfig"] },
  options: SplitPanelOptions = {},
): PanelPlacementResult {
  const instance = workspace.panels[anchorPanelId];

  if (!instance) {
    // SAFETY: the anchor matched no panel instance, so this is a no-op path —
    // the returned panelId is the caller's own input echoed back untouched
    // and never enters workspace state (the brand adds no guarantee here).
    return { workspace, panelId: anchorPanelId as PanelId };
  }

  const created = createPanelInstance(
    widget.widgetType,
    widget.config,
    options.panelId,
  );

  const panels = { ...workspace.panels, [created.id]: created };

  const horizontal = direction === "horizontal";

  // SAFETY: `options.nodeId` is an optional caller hint that is never
  // validated here; the LayoutNodeId brand certifies only a non-empty
  // string, and an empty hint would create a node no lookup can match.
  const gridId = (options.nodeId ?? createLayoutNodeId("grid")) as LayoutNodeId;
  const newLeaf: LayoutNode = { type: "panel", panelId: created.id };

  const group = findTabsWithPanel(workspace.layout, anchorPanelId);
  let layout: LayoutNode;

  if (group) {
    // Wrap the whole group: one side keeps the tabbed cell, the other is new.
    const grid: GridLayoutNode = {
      type: "grid",
      id: gridId,
      columns: horizontal ? [1, 1] : [1],
      rows: horizontal ? [1] : [1, 1],
      items: [
        {
          type: "item",
          id: cellItemId(gridId, "first"),
          col: 1,
          row: 1,
          colSpan: 1,
          rowSpan: 1,
          child: group,
        },
        {
          type: "item",
          id: cellItemId(gridId, "second"),
          col: horizontal ? 2 : 1,
          row: horizontal ? 1 : 2,
          colSpan: 1,
          rowSpan: 1,
          child: newLeaf,
        },
      ],
    };

    layout = replaceLayoutNode(
      workspace.layout,
      (node): node is TabsLayoutNode =>
        node.type === "tabs" && node.id === group.id,
      () => grid,
    );
  } else {
    // Bare panel leaf (root or inside a grid item): replace it in place.
    layout = replaceLayoutNode(
      workspace.layout,
      (node): node is PanelLayoutNode =>
        node.type === "panel" && node.panelId === anchorPanelId,
      () =>
        ({
          type: "grid",
          id: gridId,
          columns: horizontal ? [1, 1] : [1],
          rows: horizontal ? [1] : [1, 1],
          items: [
            {
              type: "item",
              id: cellItemId(gridId, "first"),
              col: 1,
              row: 1,
              colSpan: 1,
              rowSpan: 1,
              child: { type: "panel", panelId: instance.id },
            },
            {
              type: "item",
              id: cellItemId(gridId, "second"),
              col: horizontal ? 2 : 1,
              row: horizontal ? 1 : 2,
              colSpan: 1,
              rowSpan: 1,
              child: newLeaf,
            },
          ],
        }) satisfies GridLayoutNode,
    );
  }

  return {
    workspace: withVersion({
      ...workspace,
      panels,
      layout,
      activePanelId: created.id,
    }),
    panelId: created.id,
  };
}

/** Legacy alias — splitting is now cell-based (see `splitGridCell`). */
export const splitPanel = splitGridCell;

/**
 * Move a panel into another tab group (drag-and-drop between grids, or
 * reorder within the same group). `targetIndex` inserts before that
 * position; omitted appends. The moved panel takes focus. Unknown panel or
 * target ids are no-ops. The emptied source cell stays in place (see
 * `prunePanelsFromLayout`).
 */
export function movePanelToTabs(
  workspace: Workspace,
  panelId: string,
  targetTabsId: string,
  targetIndex?: number,
): Workspace {
  const instance = workspace.panels[panelId];

  if (!instance) return workspace;
  const target = findTabsById(workspace.layout, targetTabsId);

  if (!target) return workspace;
  const source = findTabsWithPanel(workspace.layout, panelId);

  // Same-group reorder: splice within one update, no pruning involved.
  if (source && source.id === targetTabsId) {
    const from = source.panels.indexOf(instance.id);

    if (from === -1) return workspace;
    const rest = source.panels.filter((id) => id !== instance.id);

    const clamped =
      targetIndex === undefined
        ? rest.length
        : Math.max(0, Math.min(targetIndex, rest.length));

    if (clamped === from) return workspace;

    const panels = [
      ...rest.slice(0, clamped),
      instance.id,
      ...rest.slice(clamped),
    ];

    const layout = updateTabsNode(workspace.layout, targetTabsId, (tabs) => ({
      ...tabs,
      panels,
      activePanelId: instance.id,
    }));

    return withVersion({
      ...workspace,
      layout,
      activePanelId: instance.id,
    });
  }

  const without = prunePanelsFromLayout(workspace.layout, new Set([panelId]));

  // Pruning to nothing means the panel was the entire workspace — keep it
  // where it is rather than destroying the layout.
  if (without === null) return workspace;
  const freshTarget = findTabsById(without, targetTabsId);

  if (!freshTarget) return workspace;

  const clamped =
    targetIndex === undefined
      ? freshTarget.panels.length
      : Math.max(0, Math.min(targetIndex, freshTarget.panels.length));

  const layout = updateTabsNode(without, targetTabsId, (tabs) => ({
    ...tabs,
    panels: [
      ...tabs.panels.slice(0, clamped),
      instance.id,
      ...tabs.panels.slice(clamped),
    ],
    activePanelId: instance.id,
  }));

  return withVersion({
    ...workspace,
    layout,
    activePanelId: instance.id,
  });
}

/**
 * Swap the whole layout tree (grid/flow presets). No-op unless every panel
 * instance is placed exactly once and every placed id exists — the
 * renderer degrades on partial trees, so refuse to persist one. Group actives
 * fall back to each group's first panel; workspace focus to the first panel
 * in tree order.
 */
export function replaceWorkspaceLayout(
  workspace: Workspace,
  layout: LayoutNode,
): Workspace {
  const placed = collectPanelIds(layout);
  const instances = Object.keys(workspace.panels);

  if (placed.length !== instances.length) return workspace;
  const seen = new Set<string>();

  for (const id of placed) {
    if (!(id in workspace.panels) || seen.has(id)) return workspace;
    seen.add(id);
  }

  const normalized = normalizeContainerSizes(layout);
  const fixed = fixSubtreeActives(normalized ?? layout);
  const first = placed.at(0);

  return withVersion({
    ...workspace,
    layout: fixed,
    activePanelId:
      first !== undefined && first in workspace.panels
        ? first
        : workspace.activePanelId,
  });
}

/** Clamp flow/masonry card sizes to positive finite values (structural sanity). */
function normalizeContainerSizes(layout: LayoutNode): LayoutNode | null {
  if (layout.type === "flow") {
    if (layout.items.length === 0) return null;

    return {
      ...layout,
      items: layout.items.map((item) => ({
        ...item,
        width: item.width > 0 && Number.isFinite(item.width) ? item.width : 360,
        height:
          item.height > 0 && Number.isFinite(item.height) ? item.height : 280,
        child: normalizeChildContainer(item.child),
      })),
    };
  }

  if (layout.type === "masonry") {
    if (layout.items.length === 0) return null;

    return {
      ...layout,
      columnWidth:
        layout.columnWidth > 0 && Number.isFinite(layout.columnWidth)
          ? layout.columnWidth
          : 320,
      items: layout.items.map((item) => ({
        ...item,
        height:
          item.height > 0 && Number.isFinite(item.height) ? item.height : 280,
        child: normalizeChildContainer(item.child),
      })),
    };
  }

  if (layout.type === "auto") {
    // An empty auto is valid (a bento page awaiting its first add), so keep
    // going and clamp whatever fields exist (fractional spans persist
    // stepless drags — coerce only the invalid).
    return {
      ...layout,
      columnWidth:
        layout.columnWidth > 0 && Number.isFinite(layout.columnWidth)
          ? layout.columnWidth
          : 320,
      items: layout.items.map((item) => ({
        ...item,
        height:
          item.height > 0 && Number.isFinite(item.height) ? item.height : 280,
        span:
          Number.isFinite(item.span) && item.span >= 1 ? item.span : 1,
        child: normalizeChildContainer(item.child),
      })),
    };
  }

  if (layout.type === "grid") {
    return normalizeGridLayout(layout);
  }

  return layout;
}

/** Compact one card/cell child after the parent's size clamp. */
function normalizeChildContainer(child: LayoutNode): LayoutNode {
  if (child.type === "grid") return normalizeGridLayout(child) ?? child;

  if (child.type === "flow") return normalizeFlowLayout(child) ?? child;

  if (child.type === "masonry") return normalizeMasonryLayout(child) ?? child;

  if (child.type === "auto") return normalizeAutoLayout(child);

  return child;
}

const fixSubtreeActives = (node: LayoutNode): LayoutNode => {
  if (node.type === "panel") return node;

  if (node.type === "split") {
    return {
      ...node,
      first: fixSubtreeActives(node.first),
      second: fixSubtreeActives(node.second),
    };
  }

  if (node.type === "tabs") {
    const active =
      node.activePanelId !== null && node.panels.includes(node.activePanelId)
        ? node.activePanelId
        : (node.panels.at(0) ?? null);

    return { ...node, panels: [...node.panels], activePanelId: active };
  }

  if (node.type === "grid") {
    return {
      ...node,
      items: node.items.map((item) => ({
        ...item,
        child: fixSubtreeActives(item.child),
      })),
    };
  }

  if (node.type === "flow") {
    return {
      ...node,
      items: node.items.map((item) => ({
        ...item,
        child: fixSubtreeActives(item.child),
      })),
    };
  }

  if (node.type === "masonry") {
    return {
      ...node,
      items: node.items.map((item) => ({
        ...item,
        child: fixSubtreeActives(item.child),
      })),
    };
  }

  if (node.type === "auto") {
    return {
      ...node,
      items: node.items.map((item) => ({
        ...item,
        child: fixSubtreeActives(item.child),
      })),
    };
  }

  return node;
};

/**
 * Swap one subtree (a tab group, grid or flow, found by layout node id) for
 * a new subtree. No-op unless the subtree places exactly the same panels —
 * same membership, any order — and every placed id exists. The rest of the
 * tree (and workspace focus) is preserved; enclosing containers normalize.
 */
export function replaceTabsSubtree(
  workspace: Workspace,
  nodeId: string,
  layout: LayoutNode,
): Workspace {
  const target = findNodeById(workspace.layout, nodeId);

  if (!target) {
    // The id may address a flow/masonry/auto card wrapper (sizes live on
    // the wrapper, not on a LayoutNode) — resolve it through the item index.
    const item =
      findFlowItemById(workspace.layout, nodeId) ??
      findMasonryItemById(workspace.layout, nodeId) ??
      findAutoItemById(workspace.layout, nodeId);

    if (!item) return workspace;
    const before = [...collectPanelIds(item.child)].sort();
    const placed = collectPanelIds(layout);

    if (placed.length !== before.length) return workspace;
    const seen = new Set<string>();

    for (const id of placed) {
      if (!(id in workspace.panels) || seen.has(id)) return workspace;
      seen.add(id);
    }

    if ([...seen].sort().join() !== before.join()) return workspace;
    const fixed = fixSubtreeActives(layout);

    const next = replaceLayoutNode(
      workspace.layout,
      (
        node,
      ): node is FlowLayoutNode | MasonryLayoutNode | AutoLayoutNode =>
        (node.type === "flow" ||
          node.type === "masonry" ||
          node.type === "auto") &&
        node.items.some((entry) => entry.id === nodeId),
      (container) => {
        if (container.type === "flow") {
          return {
            ...container,
            items: container.items.map((entry) =>
              entry.id === nodeId ? { ...entry, child: fixed } : entry,
            ),
          };
        }

        if (container.type === "masonry") {
          return {
            ...container,
            items: container.items.map((entry) =>
              entry.id === nodeId ? { ...entry, child: fixed } : entry,
            ),
          };
        }

        return {
          ...container,
          items: container.items.map((entry) =>
            entry.id === nodeId ? { ...entry, child: fixed } : entry,
          ),
        };
      },
    );

    return withVersion({ ...workspace, layout: next });
  }

  const before = [...collectPanelIds(target)].sort();
  const placed = collectPanelIds(layout);

  if (placed.length !== before.length) return workspace;
  const seen = new Set<string>();

  for (const id of placed) {
    if (!(id in workspace.panels) || seen.has(id)) return workspace;
    seen.add(id);
  }

  if ([...seen].sort().join() !== before.join()) return workspace;
  const fixed = fixSubtreeActives(layout);

  const next = replaceLayoutNode(
    workspace.layout,
    (
      node,
    ): node is
      | TabsLayoutNode
      | GridLayoutNode
      | FlowLayoutNode
      | MasonryLayoutNode
      | AutoLayoutNode =>
      (node.type === "tabs" ||
        node.type === "grid" ||
        node.type === "flow" ||
        node.type === "masonry" ||
        node.type === "auto") &&
      node.id === nodeId,
    () => fixed,
  );

  return withVersion({ ...workspace, layout: next });
}

/** Resize one grid's tracks (dragged gutters). `tracks` must stay positive. */
export function setGridTracks(
  workspace: Workspace,
  gridId: string,
  axis: "columns" | "rows",
  tracks: ReadonlyArray<number>,
): Workspace {
  if (
    tracks.length === 0 ||
    tracks.some((t) => !(t > 0) || !Number.isFinite(t))
  )
    return workspace;
  let changed = false;

  const layout = replaceLayoutNode(
    workspace.layout,
    (node): node is GridLayoutNode =>
      node.type === "grid" && node.id === gridId,
    (grid) => {
      if (grid[axis].length !== tracks.length) return grid;
      changed = true;

      return axis === "columns"
        ? { ...grid, columns: [...tracks] }
        : { ...grid, rows: [...tracks] };
    },
  );

  if (!changed) return workspace;

  return withVersion({ ...workspace, layout });
}

/**
 * Resize one flow card (SE-corner drag). Sizes must stay positive finite;
 * content-minimum clamping happens in the renderer/store (which knows the
 * widget registry) — the op only enforces structural sanity so corrupt
 * payloads can never persist.
 */
export function setFlowItemSize(
  workspace: Workspace,
  flowId: string,
  itemId: string,
  width: number,
  height: number,
): Workspace {
  if (
    !(width > 0) ||
    !Number.isFinite(width) ||
    !(height > 0) ||
    !Number.isFinite(height)
  )
    return workspace;
  let changed = false;

  const visit = (node: LayoutNode): LayoutNode => {
    if (node.type === "flow") {
      if (node.id === flowId) {
        let matched = false;

        const items = node.items.map((item) => {
          if (item.id !== itemId) return item;
          matched = true;

          return { ...item, width, height };
        });

        if (matched) {
          changed = true;

          return { ...node, items };
        }
      }

      let innerChanged = false;

      const items = node.items.map((item) => {
        const child = visit(item.child);

        if (child !== item.child) innerChanged = true;

        return child === item.child ? item : { ...item, child };
      });

      return innerChanged ? { ...node, items } : node;
    }

    if (node.type === "grid") {
      let innerChanged = false;

      const items = node.items.map((item) => {
        const child = visit(item.child);

        if (child !== item.child) innerChanged = true;

        return child === item.child ? item : { ...item, child };
      });

      return innerChanged ? { ...node, items } : node;
    }

    if (node.type === "split") {
      const first = visit(node.first);
      const second = visit(node.second);

      return first !== node.first || second !== node.second
        ? { ...node, first, second }
        : node;
    }

    return node;
  };

  const layout = visit(workspace.layout);

  if (!changed) return workspace;

  return withVersion({ ...workspace, layout });
}

/**
 * Resize one masonry card (SE-corner drag): `height` must stay positive
 * finite; `span` (when given) must be an integer ≥ 1 — the renderer clamps
 * it to the live column count. Content-minimum clamping happens in the
 * renderer/store (which knows the widget registry) — the op only enforces
 * structural sanity so corrupt payloads can never persist.
 */
export function setMasonryItemSize(
  workspace: Workspace,
  masonryId: string,
  itemId: string,
  height: number,
  span?: number,
): Workspace {
  if (!(height > 0) || !Number.isFinite(height)) return workspace;

  // Stepless spans (fractional drags persist fractions of a column —
  // same as auto); the packer reserves ceil(span) columns and renders the
  // exact fractional width.
  const nextSpan =
    span === undefined
      ? undefined
      : Number.isFinite(span) && span >= 1
        ? span
        : null;

  if (nextSpan === null) return workspace;
  let changed = false;

  const visit = (node: LayoutNode): LayoutNode => {
    if (node.type === "masonry") {
      if (node.id === masonryId) {
        let matched = false;

        const items = node.items.map((item) => {
          if (item.id !== itemId) return item;
          matched = true;

          return nextSpan === undefined
            ? { ...item, height }
            : { ...item, height, span: nextSpan };
        });

        if (matched) {
          changed = true;

          return { ...node, items };
        }
      }

      let innerChanged = false;

      const items = node.items.map((item) => {
        const child = visit(item.child);

        if (child !== item.child) innerChanged = true;

        return child === item.child ? item : { ...item, child };
      });

      return innerChanged ? { ...node, items } : node;
    }

    if (node.type === "grid") {
      let innerChanged = false;

      const items = node.items.map((item) => {
        const child = visit(item.child);

        if (child !== item.child) innerChanged = true;

        return child === item.child ? item : { ...item, child };
      });

      return innerChanged ? { ...node, items } : node;
    }

    if (node.type === "flow") {
      let innerChanged = false;

      const items = node.items.map((item) => {
        const child = visit(item.child);

        if (child !== item.child) innerChanged = true;

        return child === item.child ? item : { ...item, child };
      });

      return innerChanged ? { ...node, items } : node;
    }

    if (node.type === "split") {
      const first = visit(node.first);
      const second = visit(node.second);

      return first !== node.first || second !== node.second
        ? { ...node, first, second }
        : node;
    }

    return node;
  };

  const layout = visit(workspace.layout);

  if (!changed) return workspace;

  return withVersion({ ...workspace, layout });
}

/**
 * Resize one auto card (SE-corner drag): `height` must stay positive
 * finite; `span` (when given) must be finite ≥ 1 — fractional spans persist
 * stepless pointer drags, and the packer clamps to the live column count
 * before rendering exact sizes. Content-minimum clamping happens in the
 * renderer/store (which knows the widget registry) — the op only enforces
 * structural sanity so corrupt payloads can never persist.
 */
export function setAutoItemSize(
  workspace: Workspace,
  autoId: string,
  itemId: string,
  height: number,
  span?: number,
): Workspace {
  if (!(height > 0) || !Number.isFinite(height)) return workspace;

  const nextSpan =
    span === undefined
      ? undefined
      : Number.isFinite(span) && span >= 1
        ? span
        : null;

  if (nextSpan === null) return workspace;
  let changed = false;

  const visit = (node: LayoutNode): LayoutNode => {
    if (node.type === "auto") {
      if (node.id === autoId) {
        let matched = false;

        const items = node.items.map((item) => {
          if (item.id !== itemId) return item;
          matched = true;

          return nextSpan === undefined
            ? { ...item, height }
            : { ...item, height, span: nextSpan };
        });

        if (matched) {
          changed = true;

          return { ...node, items };
        }
      }

      let innerChanged = false;

      const items = node.items.map((item) => {
        const child = visit(item.child);

        if (child !== item.child) innerChanged = true;

        return child === item.child ? item : { ...item, child };
      });

      return innerChanged ? { ...node, items } : node;
    }

    if (node.type === "grid") {
      let innerChanged = false;

      const items = node.items.map((item) => {
        const child = visit(item.child);

        if (child !== item.child) innerChanged = true;

        return child === item.child ? item : { ...item, child };
      });

      return innerChanged ? { ...node, items } : node;
    }

    if (node.type === "flow") {
      let innerChanged = false;

      const items = node.items.map((item) => {
        const child = visit(item.child);

        if (child !== item.child) innerChanged = true;

        return child === item.child ? item : { ...item, child };
      });

      return innerChanged ? { ...node, items } : node;
    }

    if (node.type === "masonry") {
      let innerChanged = false;

      const items = node.items.map((item) => {
        const child = visit(item.child);

        if (child !== item.child) innerChanged = true;

        return child === item.child ? item : { ...item, child };
      });

      return innerChanged ? { ...node, items } : node;
    }

    if (node.type === "split") {
      const first = visit(node.first);
      const second = visit(node.second);

      return first !== node.first || second !== node.second
        ? { ...node, first, second }
        : node;
    }

    return node;
  };

  const layout = visit(workspace.layout);

  if (!changed) return workspace;

  return withVersion({ ...workspace, layout });
}

/**
 * Reorder one auto card (drag-to-reorder): splice `itemId` to
 * `targetIndex` within its auto container. Card order IS layout order, so
 * this is the only spatial control the auto mode needs. No-op for unknown
 * ids or a no-move target; the moved card's active panel takes focus.
 */
export function moveAutoItem(
  workspace: Workspace,
  autoId: string,
  itemId: string,
  targetIndex: number,
): Workspace {
  const auto = findNodeById(workspace.layout, autoId);

  if (!auto || auto.type !== "auto") return workspace;
  const from = auto.items.findIndex((item) => item.id === itemId);

  if (from === -1) return workspace;

  if (!Number.isFinite(targetIndex)) return workspace;

  const items = [...auto.items];
  const [moved] = items.splice(from, 1);

  if (!moved) return workspace;

  const to = Math.max(0, Math.min(Math.trunc(targetIndex), items.length));

  items.splice(to, 0, moved);

  if (to === from && auto.items.every((item, i) => item === items[i]))
    return workspace;

  const layout = replaceLayoutNode(
    workspace.layout,
    (node): node is AutoLayoutNode => node.type === "auto" && node.id === autoId,
    () => ({ ...auto, items }),
  );

  // Focus what moved (same convention as movePanelToTabs).
  const focus =
    collectPanelIds(moved.child).find(
      (id) => id in workspace.panels,
    ) ?? null;

  return withVersion({
    ...workspace,
    layout,
    activePanelId: focus ?? workspace.activePanelId,
  });
}

/** Options for `appendAutoItemCard` (the auto-mode "+ widget"). */
export interface AppendAutoItemOptions {
  readonly panelId?: string;
  /** Starting card height in px (the store derives it from widget defaults). */
  readonly height?: number;
  /** Starting column span ≥ 1 (the store derives it from widget defaults). */
  readonly span?: number;
}

/**
 * Open a widget as a NEW CARD at the end of the root auto (the auto-mode
 * answer to `openWidget`: the canvas-level "+" grows the card list instead
 * of tabbing into the first group — no empty slot needs to exist first, an
 * empty auto simply gains its first card). Falls back to `openWidget`
 * whenever the root is not an auto, so callers never need to branch. A tab
 * strip's own "+" keeps using `openWidget` with `targetTabsId`.
 */
export function appendAutoItemCard(
  workspace: Workspace,
  widgetType: string,
  config: PanelInstance["widgetConfig"],
  options: AppendAutoItemOptions = {},
): PanelPlacementResult {
  if (workspace.layout.type !== "auto") {
    return openWidget(workspace, widgetType, config, options);
  }

  const panel = createPanelInstance(widgetType, config, options.panelId);

  const height =
    options.height !== undefined &&
    options.height > 0 &&
    Number.isFinite(options.height)
      ? options.height
      : 280;

  const span =
    Number.isInteger(options.span) && (options.span ?? 0) >= 1
      ? options.span!
      : 1;

  const item: AutoItemLayoutNode = {
    type: "auto-item",
    id: createLayoutNodeId("auto-item"),
    height,
    span,
    child: {
      type: "tabs",
      id: createLayoutNodeId("tabs"),
      panels: [panel.id],
      activePanelId: panel.id,
    },
  };

  return {
    workspace: withVersion({
      ...workspace,
      panels: { ...workspace.panels, [panel.id]: panel },
      layout: { ...workspace.layout, items: [...workspace.layout.items, item] },
      activePanelId: panel.id,
    }),
    panelId: panel.id,
  };
}

/** Legacy split resize kept for pre-grid documents; new edits use grids. */
export function resizeSplit(  workspace: Workspace,
  splitId: string,
  ratio: number,
): Workspace {
  const clamped = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
  let changed = false;

  const layout = replaceLayoutNode(
    workspace.layout,
    (node): node is SplitLayoutNode =>
      node.type === "split" && node.id === splitId,
    (node) => {
      changed = true;

      return { ...node, ratio: clamped };
    },
  );

  if (!changed) return workspace;

  return withVersion({ ...workspace, layout });
}

export function setPanelConfig(
  workspace: Workspace,
  panelId: string,
  config: PanelInstance["widgetConfig"],
): Workspace {
  const instance = workspace.panels[panelId];

  if (!instance) return workspace;

  return withVersion({
    ...workspace,
    panels: {
      ...workspace.panels,
      [panelId]: { ...instance, widgetConfig: config },
    },
  });
}

/**
 * Set a panel's user tab title (shown in tab strips and bare panel
 * headers). An empty/null title clears the rename, falling back to the
 * widget's registry title. The same value semantics as the widget-config
 * op: pure transform, version bump, persistence left to the caller.
 */
export function setPanelTitle(
  workspace: Workspace,
  panelId: string,
  title: string | null,
): Workspace {
  const instance = workspace.panels[panelId];

  if (!instance) return workspace;
  const trimmed = title?.trim() ?? "";

  if (trimmed.length === 0) {
    // Clear: strip the key entirely (absent = the widget's registry title).
    const { title: removed, ...rest } = instance;
    void removed;

    return withVersion({
      ...workspace,
      panels: { ...workspace.panels, [panelId]: rest },
    });
  }

  return withVersion({
    ...workspace,
    panels: { ...workspace.panels, [panelId]: { ...instance, title: trimmed } },
  });
}

/** Structural problems in a workspace (dangling refs, duplicates, bad actives). */
export function integrityErrors(workspace: Workspace): string[] {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  const nodeIds = new Set<string>();

  const visit = (node: LayoutNode): void => {
    if (node.type === "panel") {
      seen.set(node.panelId, (seen.get(node.panelId) ?? 0) + 1);

      if (!(node.panelId in workspace.panels))
        errors.push(`panel leaf references missing instance: ${node.panelId}`);
    } else if (node.type === "tabs") {
      if (nodeIds.has(node.id))
        errors.push(`duplicate layout node id: ${node.id}`);
      nodeIds.add(node.id);

      for (const id of node.panels) {
        seen.set(id, (seen.get(id) ?? 0) + 1);

        if (!(id in workspace.panels))
          errors.push(
            `tab group ${node.id} references missing instance: ${id}`,
          );
      }

      if (node.panels.length === 0) {
        if (node.activePanelId !== null)
          errors.push(`empty tab group ${node.id} has a non-null active panel`);
      } else if (
        node.activePanelId === null ||
        !node.panels.includes(node.activePanelId)
      ) {
        errors.push(
          `tab group ${node.id} has an active panel outside its panels`,
        );
      }
    } else if (node.type === "split") {
      if (!(node.ratio > 0 && node.ratio < 1))
        errors.push(`split ${node.id} has an out-of-range ratio`);
      visit(node.first);
      visit(node.second);
    } else if (node.type === "flow") {
      visitFlow(node);
    } else if (node.type === "masonry") {
      visitMasonry(node);
    } else if (node.type === "auto") {
      visitAuto(node);
    } else {
      visitGrid(node);
    }
  };

  const visitFlow = (flow: FlowLayoutNode): void => {
    if (nodeIds.has(flow.id))
      errors.push(`duplicate layout node id: ${flow.id}`);
    nodeIds.add(flow.id);

    if (flow.items.length === 0) {
      errors.push(`flow ${flow.id} has no items`);

      return;
    }

    if (flow.items.length === 1)
      errors.push(`flow ${flow.id} has a single item (should be unwrapped)`);

    for (const item of flow.items) {
      if (nodeIds.has(item.id))
        errors.push(`duplicate layout node id: ${item.id}`);
      nodeIds.add(item.id);

      if (
        !(item.width > 0) ||
        !Number.isFinite(item.width) ||
        !(item.height > 0) ||
        !Number.isFinite(item.height)
      ) {
        errors.push(`flow ${flow.id} item ${item.id} has a non-positive size`);
      }

      visit(item.child);
    }
  };

  const visitMasonry = (masonry: MasonryLayoutNode): void => {
    if (nodeIds.has(masonry.id))
      errors.push(`duplicate layout node id: ${masonry.id}`);
    nodeIds.add(masonry.id);

    if (!(masonry.columnWidth > 0) || !Number.isFinite(masonry.columnWidth)) {
      errors.push(`masonry ${masonry.id} has a non-positive column width`);
    }

    if (masonry.items.length === 0) {
      errors.push(`masonry ${masonry.id} has no items`);

      return;
    }

    if (masonry.items.length === 1)
      errors.push(
        `masonry ${masonry.id} has a single item (should be unwrapped)`,
      );

    for (const item of masonry.items) {
      if (nodeIds.has(item.id))
        errors.push(`duplicate layout node id: ${item.id}`);
      nodeIds.add(item.id);

      if (!(item.height > 0) || !Number.isFinite(item.height)) {
        errors.push(
          `masonry ${masonry.id} item ${item.id} has a non-positive height`,
        );
      }

      if (!Number.isFinite(item.span) || item.span < 1) {
        errors.push(
          `masonry ${masonry.id} item ${item.id} has an invalid span`,
        );
      }

      visit(item.child);
    }
  };

  const visitAuto = (auto: AutoLayoutNode): void => {
    if (nodeIds.has(auto.id))
      errors.push(`duplicate layout node id: ${auto.id}`);
    nodeIds.add(auto.id);

    if (!(auto.columnWidth > 0) || !Number.isFinite(auto.columnWidth)) {
      errors.push(`auto ${auto.id} has a non-positive column width`);
    }

    if (auto.items.length === 0) {
      // Valid: an emptied bento page stays in auto mode awaiting adds.
      return;
    }

    for (const item of auto.items) {
      if (nodeIds.has(item.id))
        errors.push(`duplicate layout node id: ${item.id}`);
      nodeIds.add(item.id);

      if (!(item.height > 0) || !Number.isFinite(item.height)) {
        errors.push(`auto ${auto.id} item ${item.id} has a non-positive height`);
      }

      if (!Number.isFinite(item.span) || item.span < 1) {
        errors.push(`auto ${auto.id} item ${item.id} has an invalid span`);
      }

      visit(item.child);
    }
  };

  const visitGrid = (grid: GridLayoutNode): void => {
    if (nodeIds.has(grid.id))
      errors.push(`duplicate layout node id: ${grid.id}`);
    nodeIds.add(grid.id);

    if (grid.columns.length === 0 || grid.rows.length === 0) {
      errors.push(`grid ${grid.id} has no tracks`);
    }

    if (grid.columns.some((f) => !(f > 0)) || grid.rows.some((f) => !(f > 0))) {
      errors.push(`grid ${grid.id} has a non-positive track fraction`);
    }

    if (grid.items.length === 0) {
      errors.push(`grid ${grid.id} has no items`);

      return;
    }

    if (grid.items.length === 1)
      errors.push(`grid ${grid.id} has a single item (should be unwrapped)`);

    const occupancy: boolean[][] = grid.rows.map(() =>
      grid.columns.map(() => false),
    );

    for (const item of grid.items) {
      if (nodeIds.has(item.id))
        errors.push(`duplicate layout node id: ${item.id}`);
      nodeIds.add(item.id);
      const colEnd = item.col + Math.max(1, item.colSpan) - 1;
      const rowEnd = item.row + Math.max(1, item.rowSpan) - 1;

      if (
        item.col < 1 ||
        item.row < 1 ||
        colEnd > grid.columns.length ||
        rowEnd > grid.rows.length
      ) {
        errors.push(`grid ${grid.id} item ${item.id} is out of bounds`);
        continue;
      }

      let overlap = false;

      for (let r = item.row; r <= Math.min(rowEnd, grid.rows.length); r++) {
        for (
          let c = item.col;
          c <= Math.min(colEnd, grid.columns.length);
          c++
        ) {
          if (occupancy[r - 1]?.[c - 1]) overlap = true;
          occupancy[r - 1]![c - 1] = true;
        }
      }

      if (overlap)
        errors.push(
          `grid ${grid.id} items overlap at (${item.col},${item.row})`,
        );
      visit(item.child);
    }
  };

  visit(workspace.layout);

  for (const [id, count] of seen) {
    if (count > 1)
      errors.push(`panel ${id} appears ${count} times in the layout`);
  }

  for (const id of Object.keys(workspace.panels)) {
    if (!seen.has(id))
      errors.push(`instance ${id} is not placed in the layout`);
  }

  if (
    workspace.activePanelId !== null &&
    !(workspace.activePanelId in workspace.panels)
  ) {
    errors.push(
      `workspace active panel is missing: ${workspace.activePanelId}`,
    );
  }

  return errors;
}
