// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type {
  LayoutNode,
  PanelId,
  TabsLayoutNode,
} from "@nfi/api-contract";
import { createLayoutNodeId } from "@nfi/widget-sdk";

/**
 * Layout builders — bento (`auto`) is the only page mode.
 *
 * Grids, grid presets and density presets are gone: stepless resize (both
 * axes) covers every arrangement need, and every card keeps its exact
 * dragged size (masonry shortest-column gravity fills every gap,
 * sub-minimum widths scale down). These builders stay registry-free;
 * callers derive sizes from widget defaults or preserved drags.
 */

function tabsGroup(panels: ReadonlyArray<PanelId>): TabsLayoutNode {
  const first = panels[0];

  return {
    type: "tabs",
    id: createLayoutNodeId("tabs"),
    panels: [...panels],
    activePanelId: first ?? null,
  };
}

/**
 * Build a flow from panel ids: one tab group per card in tree order, each
 * card clamped to at least its content minimum (`getMinSize`). A single
 * panel collapses to one group (no flow wrapper); empty input is null.
 */
export function buildFlowLayout(
  panelIds: ReadonlyArray<PanelId>,
  width = 360,
  height = 280,
  getMinSize?: (panelId: PanelId) => { width: number; height: number },
): LayoutNode | null {
  if (panelIds.length === 0) return null;

  if (panelIds.length === 1) return tabsGroup(panelIds);

  return {
    type: "flow",
    id: createLayoutNodeId("flow"),
    items: panelIds.map((panelId) => {
      const min = getMinSize?.(panelId);

      return {
        type: "flow-item",
        id: createLayoutNodeId("flow-item"),
        width: Math.max(width, min?.width ?? 0),
        height: Math.max(height, min?.height ?? 0),
        child: tabsGroup([panelId]),
      };
    }),
  };
}

/**
 * Build a masonry from panel ids: one tab group per card in tree order.
 * `getHeight` supplies each card's starting height (callers clamp to the
 * content minimum — these builders stay registry-free); omitted heights
 * take `defaultHeight`. `getSpan` supplies each card's starting column
 * span (coerced to int ≥ 1; the renderer clamps to the live column count).
 * A single panel collapses to one group (no masonry wrapper); empty input
 * is null.
 */
export function buildMasonryLayout(
  panelIds: ReadonlyArray<PanelId>,
  columnWidth = 380,
  getHeight?: (panelId: PanelId) => number,
  defaultHeight = 280,
  getSpan?: (panelId: PanelId) => number,
): LayoutNode | null {
  if (panelIds.length === 0) return null;

  if (panelIds.length === 1) return tabsGroup(panelIds);

  return {
    type: "masonry",
    id: createLayoutNodeId("masonry"),
    columnWidth: columnWidth > 0 ? columnWidth : 380,
    items: panelIds.map((panelId) => {
      const requestedSpan = getSpan?.(panelId);
      const height = getHeight?.(panelId);

      return {
        type: "masonry-item",
        id: createLayoutNodeId("masonry-item"),
        height: height ?? (defaultHeight > 0 ? defaultHeight : 280),
        span:
          requestedSpan !== undefined &&
          Number.isInteger(requestedSpan) &&
          requestedSpan >= 1
            ? requestedSpan
            : 1,
        child: tabsGroup([panelId]),
      };
    }),
  };
}

/**
 * Migrate a legacy grid subtree to bento (`auto`): cells in reading order
 * (row-major) become cards preserving their column span as the starting
 * span; heights take the default (callers clamp to content minimums at
 * render). Nested grids/flows/masonries migrate recursively. Non-grid
 * nodes pass through (children still migrated).
 */
export function migrateGridToAuto(
  node: LayoutNode,
  defaultHeight = 260,
): LayoutNode {
  switch (node.type) {
    case "grid": {
      const ordered = [...node.items].sort(
        (a, b) => a.row - b.row || a.col - b.col,
      );

      return {
        type: "auto",
        id: node.id,
        columnWidth: 320,
        items: ordered.map((item) => ({
          type: "auto-item",
          id: item.id,
          height: defaultHeight,
          span: Math.max(1, item.colSpan ?? 1),
          child: migrateGridToAuto(item.child, defaultHeight),
        })),
      };
    }

    case "flow":
      return {
        ...node,
        items: node.items.map((item) => ({
          ...item,
          child: migrateGridToAuto(item.child, defaultHeight),
        })),
      };
    case "masonry":
      return {
        ...node,
        items: node.items.map((item) => ({
          ...item,
          child: migrateGridToAuto(item.child, defaultHeight),
        })),
      };
    case "auto":
      return {
        ...node,
        items: node.items.map((item) => ({
          ...item,
          child: migrateGridToAuto(item.child, defaultHeight),
        })),
      };
    case "split":
      return {
        ...node,
        first: migrateGridToAuto(node.first, defaultHeight),
        second: migrateGridToAuto(node.second, defaultHeight),
      };
    default:
      return node;
  }
}

/**
 * Build an auto from panel ids: one tab group per card in tree order.
 * `getHeight`/`getSpan` supply each card's starting size (callers derive
 * them from widget defaults or preserved drags — these builders stay
 * registry-free); omitted heights take `defaultHeight`. Unlike flow and
 * masonry, ZERO and ONE panels still build an auto node: bento is a page
 * mode that must survive any card count, because widgets are appended as
 * fresh cards — not booked into pre-allocated slots.
 */
export function buildAutoLayout(
  panelIds: ReadonlyArray<PanelId>,
  columnWidth = 320,
  getHeight?: (panelId: PanelId) => number,
  defaultHeight = 260,
  getSpan?: (panelId: PanelId) => number,
): LayoutNode {
  return {
    type: "auto",
    id: createLayoutNodeId("auto"),
    columnWidth: columnWidth > 0 ? columnWidth : 320,
    items: panelIds.map((panelId) => {
      const requestedSpan = getSpan?.(panelId);
      const height = getHeight?.(panelId);

      return {
        type: "auto-item",
        id: createLayoutNodeId("auto-item"),
        height: height ?? (defaultHeight > 0 ? defaultHeight : 260),
        span:
          requestedSpan !== undefined &&
          Number.isFinite(requestedSpan) &&
          requestedSpan >= 1
            ? requestedSpan
            : 1,
        child: tabsGroup([panelId]),
      };
    }),
  };
}
