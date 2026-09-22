// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  type GridLayoutNode,
  type GridItemLayoutNode,
  type LayoutNode,
  type LayoutNodeId,
  type PanelId,
  type PanelInstance,
  type SplitDirection,
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
 * Layout model: `grid` containers (track fractions + positioned items) host
 * `tabs` groups (or nested grids); `panel` leaves may appear bare. Splitting
 * a cell wraps its content in a fresh 2-track grid — closing panels prunes
 * empty cells and `normalizeGridLayout` compacts tracks and unwraps
 * single-item grids, so the tree stays minimal without explicit rebalancing.
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
  return `${prefix}-${uniqueSuffix()}` as PanelId;
}

export function createLayoutNodeId(prefix = "node"): LayoutNodeId {
  return `${prefix}-${uniqueSuffix()}` as LayoutNodeId;
}

export function createPanelInstance(
  widgetType: string,
  config: unknown,
  id?: string,
): PanelInstance {
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

// --- Grid construction helpers ------------------------------------------------

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

/**
 * Normalize a grid after edits:
 * - drop items with no child (caller already pruned them),
 * - unwrap grids with a single item (a lone cell is not a grid),
 * - remove unused tracks and compact 1-based coordinates/spans.
 * Returns `null` when nothing remains.
 */
export function normalizeGridLayout(grid: GridLayoutNode): LayoutNode | null {
  if (grid.items.length === 0) return null;
  // Recurse first so nested grids settle before this level unwraps.
  const items: GridItemLayoutNode[] = grid.items.map((item) =>
    item.child.type === "grid"
      ? { ...item, child: normalizeGridLayout(item.child) ?? item.child }
      : item,
  );
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
      return layout.panels.includes(panelId as PanelId) ? layout : undefined;
    case "grid":
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
    case "split":
      return (
        findTabsById(layout.first, tabsId) ??
        findTabsById(layout.second, tabsId)
      );
  }
}

/** Find any node (grid or tabs) by its layout id. */
export function findNodeById(
  layout: LayoutNode,
  nodeId: string,
): GridLayoutNode | TabsLayoutNode | undefined {
  if (layout.type === "tabs") return layout.id === nodeId ? layout : undefined;
  if (layout.type === "grid") {
    if (layout.id === nodeId) return layout;
    for (const item of layout.items) {
      const found = findNodeById(item.child, nodeId);
      if (found) return found;
    }
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
  return (
    layout.id === nodeId ||
    containsNode(layout.first, nodeId) ||
    containsNode(layout.second, nodeId)
  );
};

/**
 * Innermost grid whose subtree contains `nodeId` — the grid a tab strip's
 * "arrange" action should rebuild. Post-order so nested grids win over
 * their ancestors.
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
  for (const item of layout.items) {
    const found = findEnclosingGrid(item.child, nodeId);
    if (found) return found;
  }
  if (layout.id !== nodeId && containsNode(layout, nodeId)) return layout;
  return undefined;
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
    case "split":
      return findFirstTabs(layout.first) ?? findFirstTabs(layout.second);
  }
}

function replaceLayoutNode(
  layout: LayoutNode,
  predicate: (node: LayoutNode) => boolean,
  replacement: (node: LayoutNode) => LayoutNode,
): LayoutNode {
  if (predicate(layout)) return replacement(layout);
  if (layout.type === "split") {
    return {
      ...layout,
      first: replaceLayoutNode(layout.first, predicate, replacement),
      second: replaceLayoutNode(layout.second, predicate, replacement),
    };
  }
  if (layout.type === "grid") {
    let changed = false;
    const items = layout.items.map((item) => {
      const child = replaceLayoutNode(item.child, predicate, replacement);
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
    (node) => node.type === "tabs" && node.id === tabsId,
    (node) => update(node as TabsLayoutNode),
  );
}

/**
 * Remove every reference to `remove` panel ids; collapse splits whose side
 * vanished; drop emptied tab groups; compact grids (empty cells vanish,
 * single-item grids unwrap, unused tracks close). Returns null when nothing
 * remains.
 */
/**
 * Remove every reference to `remove` panel ids. Empty cells are NEVER
 * deleted: a group that loses its last panel stays as an empty group (the
 * "open widget here" placeholder keeps the cell and the grid geometry
 * stable), and a bare-panel cell that empties becomes an empty group too.
 * Only a fully-empty ROOT grid collapses to a single empty root group.
 * Returns null only for a pruned bare panel leaf outside any grid.
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
        // Keep the empty group: its cell (and the grid tracks around it)
        // survives so closing or moving the last tab never reshapes the
        // page underneath the user.
        return { ...layout, panels: [], activePanelId: null };
      }
      const last = panels[panels.length - 1] as PanelId;
      const activePanelId =
        layout.activePanelId !== null && !remove.has(layout.activePanelId)
          ? layout.activePanelId
          : last;
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
      const closedIndex = group.panels.indexOf(closedPanelId as PanelId);
      const next = remaining[
        Math.min(Math.max(closedIndex, 0), remaining.length - 1)
      ] as PanelId;
      return next;
    }
  }
  const ids = collectPanelIds(layout).filter((id) => id in surviving);
  return (ids[ids.length - 1] as PanelId | undefined) ?? null;
}

export interface OpenWidgetOptions {
  readonly panelId?: string;
  readonly nodeId?: string;
  /** Open into the tab group containing this panel (defaults to active panel's group). */
  readonly targetPanelId?: string;
  /** Open into this tab group directly (wins over `targetPanelId`; supports empty groups). */
  readonly targetTabsId?: string;
}

export function openWidget(
  workspace: Workspace,
  widgetType: string,
  config: unknown,
  options: OpenWidgetOptions = {},
): { workspace: Workspace; panelId: PanelId } {
  const panel = createPanelInstance(widgetType, config, options.panelId);
  const panels: Record<string, PanelInstance> = {
    ...workspace.panels,
    [panel.id]: panel,
  };

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
  const panels: Record<string, PanelInstance> = { ...workspace.panels };
  delete panels[panelId];

  const focus = focusAfterClose(workspace.layout, panelId, panels);
  const pruned = prunePanelsFromLayout(workspace.layout, new Set([panelId]));
  const layout: LayoutNode = pruned ?? emptyRootTabs();
  const activePanelId =
    focus ??
    (collectPanelIds(layout).filter((id) => id in panels)[0] as
      PanelId | undefined) ??
    null;
  return withVersion({ ...workspace, panels, layout, activePanelId });
}

export function activatePanel(
  workspace: Workspace,
  panelId: string,
): Workspace {
  if (!(panelId in workspace.panels)) return workspace;
  const group = findTabsWithPanel(workspace.layout, panelId);
  const layout = group
    ? updateTabsNode(workspace.layout, group.id, (tabs) => ({
        ...tabs,
        activePanelId: panelId as PanelId,
      }))
    : workspace.layout;
  if (
    workspace.activePanelId === (panelId as PanelId) &&
    layout === workspace.layout
  )
    return workspace;
  return withVersion({
    ...workspace,
    layout,
    activePanelId: panelId as PanelId,
  });
}

export function activateTab(
  workspace: Workspace,
  tabsId: string,
  panelId: string,
): Workspace {
  const group = findTabsById(workspace.layout, tabsId);
  if (
    !group ||
    !group.panels.includes(panelId as PanelId) ||
    !(panelId in workspace.panels)
  ) {
    return workspace;
  }
  return withVersion({
    ...workspace,
    layout: updateTabsNode(workspace.layout, tabsId, (tabs) => ({
      ...tabs,
      activePanelId: panelId as PanelId,
    })),
    activePanelId: panelId as PanelId,
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
  const next = group.panels[
    (current + direction + group.panels.length) % group.panels.length
  ] as PanelId;
  return activateTab(workspace, group.id, next);
}

export interface SplitPanelOptions {
  readonly panelId?: string;
  readonly nodeId?: string;
}

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
  widget: { widgetType: string; config: unknown },
  options: SplitPanelOptions = {},
): { workspace: Workspace; panelId: PanelId } {
  const instance = workspace.panels[anchorPanelId];
  if (!instance) return { workspace, panelId: anchorPanelId as PanelId };

  const created = createPanelInstance(
    widget.widgetType,
    widget.config,
    options.panelId,
  );
  const panels: Record<string, PanelInstance> = {
    ...workspace.panels,
    [created.id]: created,
  };
  const horizontal = direction === "horizontal";
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
          id: `${gridId}-first` as LayoutNodeId,
          col: 1,
          row: 1,
          colSpan: 1,
          rowSpan: 1,
          child: group,
        },
        {
          type: "item",
          id: `${gridId}-second` as LayoutNodeId,
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
      (node) => node.type === "tabs" && node.id === group.id,
      () => grid,
    );
  } else {
    // Bare panel leaf (root or inside a grid item): replace it in place.
    layout = replaceLayoutNode(
      workspace.layout,
      (node) => node.type === "panel" && node.panelId === anchorPanelId,
      () =>
        ({
          type: "grid",
          id: gridId,
          columns: horizontal ? [1, 1] : [1],
          rows: horizontal ? [1] : [1, 1],
          items: [
            {
              type: "item",
              id: `${gridId}-first` as LayoutNodeId,
              col: 1,
              row: 1,
              colSpan: 1,
              rowSpan: 1,
              child: { type: "panel", panelId: anchorPanelId as PanelId },
            },
            {
              type: "item",
              id: `${gridId}-second` as LayoutNodeId,
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
  if (!(panelId in workspace.panels)) return workspace;
  const target = findTabsById(workspace.layout, targetTabsId);
  if (!target) return workspace;
  const source = findTabsWithPanel(workspace.layout, panelId);

  // Same-group reorder: splice within one update, no pruning involved.
  if (source && source.id === targetTabsId) {
    const from = source.panels.indexOf(panelId as PanelId);
    if (from === -1) return workspace;
    const rest = source.panels.filter((id) => id !== (panelId as PanelId));
    const clamped =
      targetIndex === undefined
        ? rest.length
        : Math.max(0, Math.min(targetIndex, rest.length));
    if (clamped === from) return workspace;
    const panels = [
      ...rest.slice(0, clamped),
      panelId as PanelId,
      ...rest.slice(clamped),
    ];
    const layout = updateTabsNode(workspace.layout, targetTabsId, (tabs) => ({
      ...tabs,
      panels,
      activePanelId: panelId as PanelId,
    }));
    return withVersion({
      ...workspace,
      layout,
      activePanelId: panelId as PanelId,
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
      panelId as PanelId,
      ...tabs.panels.slice(clamped),
    ],
    activePanelId: panelId as PanelId,
  }));
  return withVersion({
    ...workspace,
    layout,
    activePanelId: panelId as PanelId,
  });
}

/**
 * Swap the whole layout tree (grid presets). No-op unless every panel
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
  const fixed = fixSubtreeActives(layout);
  const first = placed[0] as PanelId | undefined;
  return withVersion({
    ...workspace,
    layout: fixed,
    activePanelId:
      first !== undefined && first in workspace.panels
        ? first
        : workspace.activePanelId,
  });
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
        : ((node.panels[0] as PanelId | undefined) ?? null);
    return { ...node, panels: [...node.panels], activePanelId: active };
  }
  return {
    ...node,
    items: node.items.map((item) => ({
      ...item,
      child: fixSubtreeActives(item.child),
    })),
  };
};

/**
 * Swap one subtree (a tab group or grid, found by layout node id) for a new
 * subtree. No-op unless the subtree places exactly the same panels — same
 * membership, any order — and every placed id exists. The rest of the tree
 * (and workspace focus) is preserved; enclosing grids normalize so emptied
 * tracks close.
 */
export function replaceTabsSubtree(
  workspace: Workspace,
  nodeId: string,
  layout: LayoutNode,
): Workspace {
  const target = findNodeById(workspace.layout, nodeId);
  if (!target) return workspace;
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
    (node) =>
      (node.type === "tabs" || node.type === "grid") && node.id === nodeId,
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
    (node) => node.type === "grid" && node.id === gridId,
    (node) => {
      const grid = node as GridLayoutNode;
      if (grid[axis].length !== tracks.length) return node;
      changed = true;
      return { ...grid, [axis]: [...tracks] } as GridLayoutNode;
    },
  );
  if (!changed) return workspace;
  return withVersion({ ...workspace, layout });
}

/** Legacy split resize kept for pre-grid documents; new edits use grids. */
export function resizeSplit(
  workspace: Workspace,
  splitId: string,
  ratio: number,
): Workspace {
  const clamped = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
  let changed = false;
  const layout = replaceLayoutNode(
    workspace.layout,
    (node) => node.type === "split" && node.id === splitId,
    (node) => {
      changed = true;
      return { ...node, type: "split", ratio: clamped } as LayoutNode;
    },
  );
  if (!changed) return workspace;
  return withVersion({ ...workspace, layout });
}

export function setPanelConfig(
  workspace: Workspace,
  panelId: string,
  config: unknown,
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
    } else {
      visitGrid(node);
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
