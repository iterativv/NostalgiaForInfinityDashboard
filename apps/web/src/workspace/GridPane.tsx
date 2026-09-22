// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { GridLayoutNode, LayoutNode } from "@nfi/api-contract";
import {
  GRID_GUTTER_PX,
  clampTrackFractions,
  gridColumnMinWidths,
  shouldStackGrid,
} from "@nfi/widget-sdk";

/**
 * GridPane — workspace infrastructure (NOT a widget).
 *
 * Renders one `grid` layout node with CSS grid: content tracks are
 * fractions (`1fr 2fr …`) and gutters are fixed tracks interleaved between
 * them, so every interior track boundary hosts a real draggable divider
 * placed by the same template (no measuring of item rects). Items address
 * content track `col`/`row` (1-based, spans allowed) and map to template
 * positions `2*(c-1)+1`, spanning the interior gutters they cover.
 *
 * Dragging a divider moves fraction between the two adjacent tracks only
 * (their total is conserved) and clamps to the tracks' content minimums —
 * derived from the widgets inside (see `gridColumnMinWidths`). Row gutters
 * clamp to a minimum fraction (widgets declare no min heights).
 *
 * Responsive: when the container cannot fit all column minimums side by
 * side, items stack vertically in reading order (render-only; the persisted
 * tracks are untouched, so widening the window restores the grid).
 */
export function GridPane({
  grid,
  panels,
  lookup,
  locked = false,
  onTracksChange,
  renderChild,
}: {
  grid: GridLayoutNode;
  /** Workspace panels map (widget type lookup for min-width hints). */
  panels: Record<string, { widgetType: string } | undefined>;
  lookup: (type: string) => { minWidth: number } | undefined;
  /** True on non-editable (preset) pages: gutters are fixed, no drag. */
  locked?: boolean;
  onTracksChange: (
    gridId: string,
    axis: "columns" | "rows",
    tracks: number[],
  ) => void;
  /** Render one child subtree (tabs / nested grid / bare panel). */
  renderChild: (node: LayoutNode) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setContainerWidth(width);
    });
    observer.observe(el);
    setContainerWidth(el.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const stacked = shouldStackGrid(containerWidth, grid, panels, lookup);
  const columnMins = useMemo(
    () => gridColumnMinWidths(grid, panels, lookup),
    // panels identity changes only on workspace edits; grid covers structure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [grid, panels],
  );

  const itemStyle = (
    col: number,
    row: number,
    colSpan: number,
    rowSpan: number,
  ): CSSProperties => ({
    gridColumn: `${2 * (col - 1) + 1} / span ${2 * colSpan - 1}`,
    gridRow: `${2 * (row - 1) + 1} / span ${2 * rowSpan - 1}`,
  });

  const templateOf = (fractions: ReadonlyArray<number>): string =>
    fractions.map((f) => `${f}fr`).join(` ${GRID_GUTTER_PX}px `);

  // --- Divider dragging ------------------------------------------------------

  const beginTrackDrag = useCallback(
    (
      event: React.PointerEvent<HTMLDivElement>,
      axis: "columns" | "rows",
      boundary: number,
    ) => {
      if (locked) return;
      event.preventDefault();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const tracks = axis === "columns" ? grid.columns : grid.rows;
      const totalPx =
        (axis === "columns" ? rect.width : rect.height) -
        GRID_GUTTER_PX * (tracks.length - 1);
      const frTotal = tracks.reduce((s, f) => s + f, 0);
      const pxPerFr = totalPx > 0 && frTotal > 0 ? totalPx / frTotal : 0;
      const startLeft = tracks[boundary]!;
      const startRight = tracks[boundary + 1]!;
      const startPx = axis === "columns" ? event.clientX : event.clientY;
      const minLeftPx = axis === "columns" ? (columnMins[boundary] ?? 0) : 0;
      const minRightPx =
        axis === "columns" ? (columnMins[boundary + 1] ?? 0) : 0;

      const move = (moveEvent: PointerEvent) => {
        if (pxPerFr <= 0) return;
        const currentPx =
          axis === "columns" ? moveEvent.clientX : moveEvent.clientY;
        const clamped = clampTrackFractions(
          startLeft + (currentPx - startPx) / pxPerFr,
          startRight,
          totalPx,
          minLeftPx,
          minRightPx,
        );
        onTracksChange(grid.id, axis, [
          ...tracks.slice(0, boundary),
          clamped.left,
          clamped.right,
          ...tracks.slice(boundary + 2),
        ]);
      };
      const up = () => {
        handle.removeEventListener("pointermove", move as EventListener);
      };
      handle.addEventListener("pointermove", move as EventListener);
      handle.addEventListener("pointerup", up, { once: true });
      handle.addEventListener("pointercancel", up, { once: true });
    },
    [columnMins, grid, locked, onTracksChange],
  );

  const nudgeTrack = useCallback(
    (axis: "columns" | "rows", boundary: number, delta: number) => {
      const tracks = axis === "columns" ? grid.columns : grid.rows;
      const left = tracks[boundary]!;
      const right = tracks[boundary + 1]!;
      const step = 0.05 * (left + right) * delta;
      const clamped = clampTrackFractions(
        left + step,
        right,
        Number.POSITIVE_INFINITY,
        0,
        0,
      );
      onTracksChange(grid.id, axis, [
        ...tracks.slice(0, boundary),
        clamped.left,
        clamped.right,
        ...tracks.slice(boundary + 2),
      ]);
    },
    [grid, onTracksChange],
  );

  if (stacked) {
    const ordered = [...grid.items].sort(
      (a, b) => a.row - b.row || a.col - b.col,
    );
    return (
      <div
        ref={containerRef}
        className="nfi-grid nfi-grid-stacked"
        data-stacked="true"
      >
        {ordered.map((item) => (
          <div key={item.id} className="nfi-grid-cell">
            {renderChild(item.child)}
          </div>
        ))}
      </div>
    );
  }

  const gutterClass = locked
    ? "nfi-grid-gutter nfi-grid-gutter-locked"
    : "nfi-grid-gutter";

  // --- Segmented gutters ---------------------------------------------------
  // A divider may only run where the boundary is real: a column divider
  // between c and c+1 exists on row r only when DIFFERENT items occupy
  // (c, r) and (c+1, r) — spanning cells (e.g. a full-width strip) must not
  // be crossed. Active rows are merged into runs; one handle per run.

  interface Segment {
    readonly start: number;
    readonly end: number;
  }

  const covers = (
    item: { col: number; row: number; colSpan: number; rowSpan: number },
    col: number,
    row: number,
  ): boolean =>
    item.col <= col &&
    col < item.col + Math.max(1, item.colSpan) &&
    item.row <= row &&
    row < item.row + Math.max(1, item.rowSpan);

  const runsOf = (
    isBoundaryActive: (index: number) => boolean,
    count: number,
  ): Segment[] => {
    const runs: Segment[] = [];
    let current: Segment | null = null;
    for (let i = 1; i <= count; i++) {
      if (isBoundaryActive(i)) {
        current =
          current === null
            ? { start: i, end: i }
            : { start: current.start, end: i };
      } else if (current !== null) {
        runs.push(current);
        current = null;
      }
    }
    if (current !== null) runs.push(current);
    return runs;
  };

  const rowCount = grid.rows.length;
  const columnCount = grid.columns.length;
  const columnSegments: Array<{ boundary: number; run: Segment }> = [];
  for (let b = 1; b < columnCount; b++) {
    for (const run of runsOf((r) => {
      const left = grid.items.find((item) => covers(item, b, r));
      const right = grid.items.find((item) => covers(item, b + 1, r));
      return left !== undefined && right !== undefined && left !== right;
    }, rowCount)) {
      columnSegments.push({ boundary: b, run });
    }
  }
  const rowSegments: Array<{ boundary: number; run: Segment }> = [];
  for (let b = 1; b < rowCount; b++) {
    for (const run of runsOf((c) => {
      const above = grid.items.find((item) => covers(item, c, b));
      const below = grid.items.find((item) => covers(item, c, b + 1));
      return above !== undefined && below !== undefined && above !== below;
    }, columnCount)) {
      rowSegments.push({ boundary: b, run });
    }
  }

  const columnHandles = columnSegments.map(({ boundary, run }, index) => (
    <div
      key={`col-${boundary}-${run.start}-${index}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={
        locked ? "Grid divider (fixed on this page)" : "Resize grid columns"
      }
      aria-disabled={locked ? true : undefined}
      tabIndex={locked ? -1 : 0}
      className={gutterClass}
      style={{
        gridColumn: `${2 * (boundary - 1) + 2} / span 1`,
        gridRow: `${2 * (run.start - 1) + 1} / span ${2 * (run.end - run.start) + 1}`,
      }}
      onPointerDown={
        locked
          ? undefined
          : (event) => beginTrackDrag(event, "columns", boundary - 1)
      }
      onKeyDown={
        locked
          ? undefined
          : (event) => {
              if (event.key === "ArrowLeft") {
                event.preventDefault();
                nudgeTrack("columns", boundary - 1, -1);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                nudgeTrack("columns", boundary - 1, 1);
              }
            }
      }
    />
  ));

  const rowHandles = rowSegments.map(({ boundary, run }, index) => (
    <div
      key={`row-${boundary}-${run.start}-${index}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label={
        locked ? "Grid divider (fixed on this page)" : "Resize grid rows"
      }
      aria-disabled={locked ? true : undefined}
      tabIndex={locked ? -1 : 0}
      className={`${gutterClass} nfi-grid-gutter-row`}
      style={{
        gridRow: `${2 * (boundary - 1) + 2} / span 1`,
        gridColumn: `${2 * (run.start - 1) + 1} / span ${2 * (run.end - run.start) + 1}`,
      }}
      onPointerDown={
        locked
          ? undefined
          : (event) => beginTrackDrag(event, "rows", boundary - 1)
      }
      onKeyDown={
        locked
          ? undefined
          : (event) => {
              if (event.key === "ArrowUp") {
                event.preventDefault();
                nudgeTrack("rows", boundary - 1, -1);
              } else if (event.key === "ArrowDown") {
                event.preventDefault();
                nudgeTrack("rows", boundary - 1, 1);
              }
            }
      }
    />
  ));

  return (
    <div
      ref={containerRef}
      className="nfi-grid"
      style={{
        gridTemplateColumns: templateOf(grid.columns),
        gridTemplateRows: templateOf(grid.rows),
      }}
    >
      {grid.items.map((item) => (
        <div
          key={item.id}
          className="nfi-grid-cell"
          style={itemStyle(item.col, item.row, item.colSpan, item.rowSpan)}
        >
          {renderChild(item.child)}
        </div>
      ))}
      {columnHandles}
      {rowHandles}
    </div>
  );
}
