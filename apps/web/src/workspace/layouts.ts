// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type {
  GridLayoutNode,
  LayoutNode,
  PanelId,
  TabsLayoutNode,
} from "@nfi/api-contract";
import { createLayoutNodeId } from "@nfi/widget-sdk";

/**
 * Grid layout presets — one-click arrangements of the panels that are
 * already open. Every preset is an explicit template (`GridShape`): track
 * fractions plus fill-ordered cells, so asymmetric mosaics, spanning heroes
 * and bulletin strips are all first-class. Presets never create or destroy
 * panels — they rebuild the layout tree (applied through
 * `replaceWorkspaceLayout` / `replaceTabsSubtree`, which refuse partial
 * trees) and degrade gracefully: fewer panels than cells simply fills fewer
 * cells.
 */

/** One template cell: 1-based coordinates, optional spans. */
export interface GridCell {
  readonly col: number;
  readonly row: number;
  readonly colSpan?: number;
  readonly rowSpan?: number;
}

export interface GridShape {
  readonly columns: ReadonlyArray<number>;
  readonly rows: ReadonlyArray<number>;
  readonly cells: ReadonlyArray<GridCell>;
}

export interface GridPreset {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly shape: GridShape;
}

/**
 * The grid presets — from single grid through symmetric lattices to
 * asymmetric mosaics with spanning hero cells and full-width strips.
 */
export const GRID_PRESETS: ReadonlyArray<GridPreset> = [
  {
    id: "single",
    title: "Single grid",
    description: "All widgets as tabs in one grid.",
    shape: { columns: [1], rows: [1], cells: [{ col: 1, row: 1 }] },
  },
  {
    id: "columns-2",
    title: "2 columns",
    description: "Two side-by-side cells.",
    shape: {
      columns: [1, 1],
      rows: [1],
      cells: [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
      ],
    },
  },
  {
    id: "columns-2-wide-left",
    title: "2 cols · wide left",
    description: "Two columns with the left one dominant.",
    shape: {
      columns: [2, 1],
      rows: [1],
      cells: [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
      ],
    },
  },
  {
    id: "columns-2-wide-right",
    title: "2 cols · wide right",
    description: "Two columns with the right one dominant.",
    shape: {
      columns: [1, 2],
      rows: [1],
      cells: [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
      ],
    },
  },
  {
    id: "columns-3",
    title: "3 columns",
    description: "Three equal side-by-side cells.",
    shape: {
      columns: [1, 1, 1],
      rows: [1],
      cells: [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
        { col: 3, row: 1 },
      ],
    },
  },
  {
    id: "columns-3-wide-center",
    title: "3 cols · wide center",
    description: "Three columns with a dominant center.",
    shape: {
      columns: [1, 2, 1],
      rows: [1],
      cells: [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
        { col: 3, row: 1 },
      ],
    },
  },
  {
    id: "columns-3-wide-right",
    title: "3 cols · wide right",
    description: "Three columns with a dominant right edge.",
    shape: {
      columns: [1, 1, 2],
      rows: [1],
      cells: [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
        { col: 3, row: 1 },
      ],
    },
  },
  {
    id: "columns-4",
    title: "4 columns",
    description: "Four equal side-by-side cells.",
    shape: {
      columns: [1, 1, 1, 1],
      rows: [1],
      cells: [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
        { col: 3, row: 1 },
        { col: 4, row: 1 },
      ],
    },
  },
  {
    id: "columns-5",
    title: "5 columns",
    description: "Five equal side-by-side cells — wall density.",
    shape: {
      columns: [1, 1, 1, 1, 1],
      rows: [1],
      cells: [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
        { col: 3, row: 1 },
        { col: 4, row: 1 },
        { col: 5, row: 1 },
      ],
    },
  },
  {
    id: "rows-2",
    title: "2 rows",
    description: "Two stacked cells.",
    shape: {
      columns: [1],
      rows: [1, 1],
      cells: [
        { col: 1, row: 1 },
        { col: 1, row: 2 },
      ],
    },
  },
  {
    id: "rows-2-tall-top",
    title: "2 rows · tall top",
    description: "Two stacked cells with the upper one dominant.",
    shape: {
      columns: [1],
      rows: [2, 1],
      cells: [
        { col: 1, row: 1 },
        { col: 1, row: 2 },
      ],
    },
  },
  {
    id: "rows-3",
    title: "3 rows",
    description: "Three stacked cells.",
    shape: {
      columns: [1],
      rows: [1, 1, 1],
      cells: [
        { col: 1, row: 1 },
        { col: 1, row: 2 },
        { col: 1, row: 3 },
      ],
    },
  },
  {
    id: "rows-4",
    title: "4 rows",
    description: "Four stacked cells.",
    shape: {
      columns: [1],
      rows: [1, 1, 1, 1],
      cells: [
        { col: 1, row: 1 },
        { col: 1, row: 2 },
        { col: 1, row: 3 },
        { col: 1, row: 4 },
      ],
    },
  },
  {
    id: "quad-2x2",
    title: "Quad 2×2",
    description: "Four cells in a square.",
    shape: {
      columns: [1, 1],
      rows: [1, 1],
      cells: [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
        { col: 1, row: 2 },
        { col: 2, row: 2 },
      ],
    },
  },
  {
    id: "quad-2x3",
    title: "Grid 2×3",
    description: "Six cells, two columns by three rows.",
    shape: {
      columns: [1, 1],
      rows: [1, 1, 1],
      cells: [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
        { col: 1, row: 2 },
        { col: 2, row: 2 },
        { col: 1, row: 3 },
        { col: 2, row: 3 },
      ],
    },
  },
  {
    id: "quad-3x2",
    title: "Grid 3×2",
    description: "Six cells, three columns by two rows.",
    shape: {
      columns: [1, 1, 1],
      rows: [1, 1],
      cells: [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
        { col: 3, row: 1 },
        { col: 1, row: 2 },
        { col: 2, row: 2 },
        { col: 3, row: 2 },
      ],
    },
  },
  {
    id: "lattice-3x3",
    title: "Lattice 3×3",
    description: "Nine equal cells — maximum wall density.",
    shape: {
      columns: [1, 1, 1],
      rows: [1, 1, 1],
      cells: [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
        { col: 3, row: 1 },
        { col: 1, row: 2 },
        { col: 2, row: 2 },
        { col: 3, row: 2 },
        { col: 1, row: 3 },
        { col: 2, row: 3 },
        { col: 3, row: 3 },
      ],
    },
  },
  {
    id: "mosaic-left-tall",
    title: "Left rail tall",
    description: "A tall left rail beside two stacked cells.",
    shape: {
      columns: [1, 1],
      rows: [1, 1],
      cells: [
        { col: 1, row: 1, rowSpan: 2 },
        { col: 2, row: 1 },
        { col: 2, row: 2 },
      ],
    },
  },
  {
    id: "mosaic-right-tall",
    title: "Right hero tall",
    description: "A tall hero cell beside two stacked cells.",
    shape: {
      columns: [1, 2],
      rows: [1, 1],
      cells: [
        { col: 1, row: 1 },
        { col: 1, row: 2 },
        { col: 2, row: 1, rowSpan: 2 },
      ],
    },
  },
  {
    id: "mosaic-top-wide",
    title: "Top hero wide",
    description: "A wide hero cell above two side-by-side cells.",
    shape: {
      columns: [1, 1],
      rows: [2, 1],
      cells: [
        { col: 1, row: 1, colSpan: 2 },
        { col: 1, row: 2 },
        { col: 2, row: 2 },
      ],
    },
  },
  {
    id: "mosaic-bottom-wide",
    title: "Bottom strip wide",
    description: "Two side-by-side cells over a full-width strip.",
    shape: {
      columns: [1, 1],
      rows: [1, 2],
      cells: [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
        { col: 1, row: 2, colSpan: 2 },
      ],
    },
  },
  {
    id: "hero-right",
    title: "Hero right + quad",
    description: "Four compact cells and a tall dominant hero on the right.",
    shape: {
      columns: [1, 1, 2],
      rows: [1, 1],
      cells: [
        { col: 1, row: 1 },
        { col: 1, row: 2 },
        { col: 2, row: 1 },
        { col: 2, row: 2 },
        { col: 3, row: 1, rowSpan: 2 },
      ],
    },
  },
  {
    id: "hero-center",
    title: "Hero center",
    description: "A tall dominant hero in the middle, four cells around it.",
    shape: {
      columns: [1, 2, 1],
      rows: [1, 1],
      cells: [
        { col: 1, row: 1 },
        { col: 1, row: 2 },
        { col: 2, row: 1, rowSpan: 2 },
        { col: 3, row: 1 },
        { col: 3, row: 2 },
      ],
    },
  },
  {
    id: "bulletin",
    title: "Bulletin strip",
    description: "Three columns over a full-width strip.",
    shape: {
      columns: [1, 1, 1],
      rows: [2, 1],
      cells: [
        { col: 1, row: 1 },
        { col: 2, row: 1 },
        { col: 3, row: 1 },
        { col: 1, row: 2, colSpan: 3 },
      ],
    },
  },
];

/** Split items into `parts` contiguous chunks, as equal as possible. */
export function chunkContiguous<T>(
  items: ReadonlyArray<T>,
  parts: number,
): T[][] {
  if (parts <= 1) return items.length > 0 ? [[...items]] : [];
  const out: T[][] = [];
  const base = Math.floor(items.length / parts);
  const extra = items.length % parts;
  let offset = 0;
  for (let i = 0; i < parts; i++) {
    const size = base + (i < extra ? 1 : 0);
    if (size === 0) break;
    out.push(items.slice(offset, offset + size));
    offset += size;
  }
  return out;
}

function tabsGroup(panels: ReadonlyArray<PanelId>): TabsLayoutNode {
  const first = panels[0];
  return {
    type: "tabs",
    id: createLayoutNodeId("tabs") as TabsLayoutNode["id"],
    panels: [...panels],
    activePanelId: first ?? null,
  };
}

/** Fresh empty tab group (no panels, null active) for grid skeletons. */
function emptyTabsGroup(): TabsLayoutNode {
  return {
    type: "tabs",
    id: createLayoutNodeId("tabs") as TabsLayoutNode["id"],
    panels: [],
    activePanelId: null,
  };
}

/**
 * Build a grid from an explicit shape: panels are dealt contiguously across
 * the shape's cells in fill order (one tab group per cell). Fewer panels
 * than cells fills fewer cells; a single panel collapses to one group.
 * Returns null when there is nothing to place.
 */
export function buildGridFromShape(
  panelIds: ReadonlyArray<PanelId>,
  shape: GridShape,
): LayoutNode | null {
  if (panelIds.length === 0) return null;
  if (shape.cells.length === 0) return tabsGroup(panelIds);
  const chunks = chunkContiguous(panelIds, shape.cells.length);
  if (chunks.length === 0) return null;
  if (chunks.length === 1) return tabsGroup(chunks[0]!);
  const items: Array<GridLayoutNode["items"][number]> = [];
  for (let i = 0; i < chunks.length; i++) {
    const cell = shape.cells[i]!;
    items.push({
      type: "item",
      id: createLayoutNodeId("cell"),
      col: cell.col,
      row: cell.row,
      colSpan: cell.colSpan ?? 1,
      rowSpan: cell.rowSpan ?? 1,
      child: tabsGroup(chunks[i]!),
    });
  }
  const grid: GridLayoutNode = {
    type: "grid",
    id: createLayoutNodeId("grid"),
    columns: [...shape.columns],
    rows: [...shape.rows],
    items,
  };
  return grid;
}

/** The empty skeleton of an explicit shape (empty groups, same geometry). */
export function buildEmptyGridFromShape(shape: GridShape): LayoutNode | null {
  if (shape.cells.length === 0) return emptyTabsGroup();
  if (shape.cells.length === 1) return emptyTabsGroup();
  return {
    type: "grid",
    id: createLayoutNodeId("grid"),
    columns: [...shape.columns],
    rows: [...shape.rows],
    items: shape.cells.map((cell) => ({
      type: "item",
      id: createLayoutNodeId("cell"),
      col: cell.col,
      row: cell.row,
      colSpan: cell.colSpan ?? 1,
      rowSpan: cell.rowSpan ?? 1,
      child: emptyTabsGroup(),
    })),
  };
}

export function getGridPreset(presetId: string): GridPreset | undefined {
  return GRID_PRESETS.find((preset) => preset.id === presetId);
}

/**
 * Build an empty grid skeleton for `presetId`: the same shape
 * `buildGridLayout` would produce, but every cell is an empty tab group
 * ready to receive dropped widgets. Lets empty pages/grids pre-structure
 * before anything is opened. Returns null for unknown presets.
 *
 * Works at any tree position: the caller swaps it in with
 * `replaceTabsSubtree` (nested) or as the whole layout (root) — both accept
 * panel-free subtrees as long as membership matches (empty ↔ empty).
 */
export function buildEmptyGridLayout(presetId: string): LayoutNode | null {
  const preset = getGridPreset(presetId);
  if (!preset) return null;
  return buildEmptyGridFromShape(preset.shape);
}

/**
 * Build a layout tree for `presetId` placing every id in `panelIds`
 * (tree order is preserved). Returns null when there is nothing to arrange
 * or the preset is unknown. See `GRID_PRESETS` for the available shapes.
 */
export function buildGridLayout(
  presetId: string,
  panelIds: ReadonlyArray<PanelId>,
): LayoutNode | null {
  const preset = getGridPreset(presetId);
  if (!preset) return null;
  return buildGridFromShape(panelIds, preset.shape);
}
