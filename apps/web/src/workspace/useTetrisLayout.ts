// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useEffect } from "react";
import { useOptionalWorkspace } from "@danfessler/trellis-react";
import { useStore } from "@tanstack/react-store";
import type { WidgetRegistry } from "@nfi/widget-sdk";
import {
  DEFAULT_TETRIS_MIN_WIDTH,
  TETRIS_GAP_PX,
  packTetrisRows,
  panelWidthFractions,
  tetrisSpanAtOffset,
  tetrisSpanForMinWidth,
  tetrisSpanFromFraction,
} from "./tetris";
import {
  setWorkspacePanelSpan,
  workspaceStore,
} from "./store";

/**
 * Annotates the Trellis DOM for the Tetris wall render (`.nfi-trellis-tetris`
 * in styles.css).
 *
 * Trellis owns the panel/surface elements (flat layer, inline tiled
 * geometry); the wall re-flows them with CSS grid — this hook is the bridge:
 * it packs the docked panels with `packTetrisRows` and stamps each panel
 * element and its surfaces with `--tetris-row` / `--tetris-col` /
 * `--tetris-span` custom properties the stylesheet places cells with.
 * Block widths come from the panel's tiled width fraction in the live
 * document, floored by the SELECTED widget's readable minimum, so tab
 * switches re-shape their block (the observer catches the `inert` flips).
 *
 * RESIZE: when `canResize`, each wall surface also gets a `.nfi-tetris-
 * resize` handle (its right edge). Dragging one re-spans that block on the
 * grid — the live preview runs through the same annotate pass (a ref, so
 * pointermove never re-renders), and pointerup commits the span once via
 * `setWorkspacePanelSpan`, which persists it on the workspace record (the
 * wall is a render override, so manual widths live OUTSIDE the Trellis
 * document). Committed overrides beat the tiled fraction but never the
 * selected widget's readable minimum.
 *
 * Everything not in the wall — floating windows, hidden panes — is tagged
 * `data-tetris-float` so the stylesheet keeps Trellis's own absolute
 * geometry for them instead of pulling them into the grid.
 *
 * Runs only while the wall mode is on; annotations are idempotent and
 * coalesced to one pass per frame (the mutation observer fires on its own
 * writes too — writes are skipped when the value is unchanged, so the loop
 * dies on the first no-op pass).
 */
export function useTetrisLayout(
  enabled: boolean,
  registry: WidgetRegistry,
  canResize: boolean,
): void {
  const ws = useOptionalWorkspace();
  const panels = useStore(workspaceStore, (state) => state.workspace.panels);

  const manualSpans = useStore(
    workspaceStore,
    (state) => state.workspace.tetrisSpans,
  );

  const activePageId = useStore(workspaceStore, (state) => state.activePageId);

  useEffect(() => {
    if (!enabled || !ws) return;

    // `ws.element` is the trellis ROOT (`.trellis`) itself; the flat
    // panel/surface layer is its direct child.
    const root = ws.element;
    const layer = root.querySelector<HTMLElement>(":scope > .trellis-layer");

    if (!layer) return;

    // Live resize drag: plain effect-scope state (not a ref/React state) —
    // pointermove mutates and schedules the coalesced annotate pass; the
    // workspace-store commit happens once on pointerup.
    let drag: { panelId: string; span: number; startSpan: number } | null = null;

    // Annotate-produced lookups the drag handlers read between passes.
    const minSpans = new Map<string, number>();
    const surfaceByPanel = new Map<string, HTMLElement>();

    const annotate = () => {
      const stageWidth = root.clientWidth;

      if (!(stageWidth > 0)) return;

      const doc = ws.getDocument();
      const fractions = panelWidthFractions(doc.root);
      const snapshot = ws.getSnapshot();

      // Selected widget per docked panel (tree order via the fractions map,
      // so placement follows the document, not DOM append order).
      const minWidths = new Map<string, number>();

      for (const view of snapshot.views) {
        if (!view.selected) continue;

        if (view.placement === "floating" || view.placement === "hidden")
          continue;

        if (minWidths.has(view.panelId)) continue;

        const instance = panels[view.panelId];

        const definition = instance
          ? registry.getWidget(instance.widgetType)
          : undefined;

        minWidths.set(
          view.panelId,
          definition?.minWidth ?? DEFAULT_TETRIS_MIN_WIDTH,
        );
      }

      // Effective span per panel: without a manual override it's the pane's
      // tiled fraction floored by the widget's readable minimum; WITH one,
      // the fraction steps aside — the user's span wins, floored only by
      // readability (otherwise blocks could never narrow below their
      // document-derived width, and full-width ones could never change at
      // all). The readable floor is remembered for the drag clamp.
      const spans = [...fractions.keys()].map((panelId) => {
        const readableSpan = tetrisSpanForMinWidth(
          minWidths.get(panelId) ?? DEFAULT_TETRIS_MIN_WIDTH,
          stageWidth,
        );

        minSpans.set(panelId, readableSpan);

        const override =
          drag?.panelId === panelId ? drag.span : manualSpans?.[panelId];

        return override !== undefined
          ? Math.max(readableSpan, override)
          : Math.max(
              tetrisSpanFromFraction(fractions.get(panelId) ?? 0),
              readableSpan,
            );
      });

      const placements = packTetrisRows(spans);
      const placementByPanel = new Map<string, TetrisCellProps>();

      [...fractions.keys()].forEach((panelId, index) => {
        const placement = placements[index];

        if (placement)
          placementByPanel.set(panelId, {
            row: placement.row,
            column: placement.column,
            span: placement.span,
          });
      });

      const viewPanel = new Map(
        snapshot.views.map((view) => [view.id, view] as const),
      );

      const writeCell = (
        el: HTMLElement,
        cell: TetrisCellProps | undefined,
      ): void => {
        if (cell) {
          el.style.setProperty("--tetris-row", String(cell.row));
          el.style.setProperty("--tetris-col", String(cell.column));
          el.style.setProperty("--tetris-span", String(cell.span));
        } else {
          el.style.removeProperty("--tetris-row");
          el.style.removeProperty("--tetris-col");
          el.style.removeProperty("--tetris-span");
        }
      };

      const setFlag = (el: HTMLElement, on: boolean): void => {
        if (on && el.getAttribute("data-tetris-float") === null)
          el.setAttribute("data-tetris-float", "");
        else if (!on && el.getAttribute("data-tetris-float") !== null)
          el.removeAttribute("data-tetris-float");
      };

      // Resize handle on the wall block's right edge (see the stylesheet's
      // `.nfi-tetris-resize`): reused across passes, dropped when the panel
      // leaves the wall or resizing is not allowed.
      const syncHandle = (
        surface: HTMLElement,
        panelId: string | null,
      ): void => {
        const existing = surface.querySelector<HTMLElement>(
          ":scope > .nfi-tetris-resize",
        );

        if (panelId === null || !canResize) {
          existing?.remove();

          return;
        }

        const handle = existing ?? document.createElement("div");

        if (!existing) {
          handle.className = "nfi-tetris-resize";
          surface.appendChild(handle);
        }

        handle.dataset.panel = panelId;
      };

      for (const el of layer.querySelectorAll<HTMLElement>(
        '[data-trellis-part="panel"][data-panel]',
      )) {
        const panelId = el.getAttribute("data-panel");
        const cell = panelId ? placementByPanel.get(panelId) : undefined;

        writeCell(el, cell);
        // Panels outside the wall (floating) keep their tiled geometry.
        setFlag(el, cell === undefined);
      }

      surfaceByPanel.clear();

      for (const el of layer.querySelectorAll<HTMLElement>(
        '[data-trellis-part="surface"][data-view]',
      )) {
        const view = viewPanel.get(el.getAttribute("data-view") ?? "");

        const inWall =
          view !== undefined &&
          view.placement !== "floating" &&
          view.placement !== "hidden";

        const cell = inWall ? placementByPanel.get(view.panelId) : undefined;

        writeCell(el, cell);
        setFlag(el, !inWall);

        if (view && cell) {
          // Prefer the VISIBLE surface of a tab group (inert ones are
          // display:none — useless for the drag's rect lookups).
          if (!el.hasAttribute("inert") || !surfaceByPanel.has(view.panelId))
            surfaceByPanel.set(view.panelId, el);

          syncHandle(el, view.panelId);
        } else {
          syncHandle(el, null);
        }
      }
    };

    // --- Resize drag (delegated on the layer) -----------------------------

    let frame = 0;

    const schedule = () => {
      if (frame) return;

      frame = requestAnimationFrame(() => {
        frame = 0;
        annotate();
      });
    };

    const gridMetrics = () => {
      const style = getComputedStyle(layer);
      const gap = Number.parseFloat(style.columnGap) || TETRIS_GAP_PX;

      const padding =
        (Number.parseFloat(style.paddingLeft) || 0) +
        (Number.parseFloat(style.paddingRight) || 0);

      return { width: Math.max(0, layer.clientWidth - padding), gap };
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (!canResize || event.button !== 0) return;

      const handle =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>(".nfi-tetris-resize")
          : null;

      const panelId = handle?.dataset.panel;

      if (!panelId) return;

      const surface = surfaceByPanel.get(panelId);

      if (!surface) return;

      event.preventDefault();
      event.stopPropagation();

      try {
        layer.setPointerCapture(event.pointerId);
      } catch {
        // No live pointer (synthetic event) — the move/up listeners below
        // simply never fire for it.
      }

      // The stamped span IS the current effective width — dragging back to
      // it commits nothing.
      const startSpan =
        Number.parseInt(surface.style.getPropertyValue("--tetris-span"), 10) ||
        1;

      drag = { panelId, span: startSpan, startSpan };
      handle.setAttribute("data-dragging", "");
      root.classList.add("nfi-tetris-resizing");
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (!drag) return;

      const surface = surfaceByPanel.get(drag.panelId);

      if (!surface) return;

      // Rects re-read per move: the live preview re-packs on every span
      // change, so the dragged block itself may change rows mid-drag.
      const { width, gap } = gridMetrics();

      const span = Math.max(
        minSpans.get(drag.panelId) ?? 1,
        tetrisSpanAtOffset(
          event.clientX - surface.getBoundingClientRect().left,
          width,
          gap,
        ),
      );

      if (span !== drag.span) {
        drag.span = span;
        schedule();
      }
    };

    const endDrag = (event: PointerEvent, commit: boolean): void => {
      if (!drag) return;

      const { panelId, span, startSpan } = drag;

      drag = null;
      root.classList.remove("nfi-tetris-resizing");
      layer
        .querySelectorAll<HTMLElement>(".nfi-tetris-resize[data-dragging]")
        .forEach((handle) => handle.removeAttribute("data-dragging"));

      try {
        layer.releasePointerCapture(event.pointerId);
      } catch {
        // Capture already lost (pointercancel) — nothing to undo.
      }

      if (commit && span !== startSpan)
        setWorkspacePanelSpan(activePageId, panelId, span);

      schedule();
    };

    const onPointerUp = (event: PointerEvent): void => endDrag(event, true);

    const onPointerCancel = (event: PointerEvent): void =>
      endDrag(event, false);

    layer.addEventListener("pointerdown", onPointerDown);
    layer.addEventListener("pointermove", onPointerMove);
    layer.addEventListener("pointerup", onPointerUp);
    layer.addEventListener("pointercancel", onPointerCancel);

    schedule();

    const observer = new MutationObserver(schedule);

    observer.observe(layer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["inert", "data-floating", "data-panel", "data-view"],
    });

    // The stage size feeds the min-width spans (and the first pass may run
    // before the root has any layout at all — width 0 bails silently), so
    // re-pack whenever the root's box settles or changes.
    const resizeObserver = new ResizeObserver(schedule);

    resizeObserver.observe(root);

    const release = ws.subscribe(schedule);

    return () => {
      layer.removeEventListener("pointerdown", onPointerDown);
      layer.removeEventListener("pointermove", onPointerMove);
      layer.removeEventListener("pointerup", onPointerUp);
      layer.removeEventListener("pointercancel", onPointerCancel);
      observer.disconnect();
      resizeObserver.disconnect();
      release();

      if (frame) cancelAnimationFrame(frame);

      root.classList.remove("nfi-tetris-resizing");
      // Annotations stay on the elements when the effect re-runs (panel
      // edits): identical values re-stamp without a flash of unplaced
      // cells. When the MODE turns off the root class goes with it, so
      // nothing reads these properties anymore.
    };
  }, [enabled, ws, panels, registry, canResize, manualSpans, activePageId]);
}

/** Cell placement stamped onto a panel + its surfaces (grid lines, 1-based). */
interface TetrisCellProps {
  row: number;
  column: number;
  span: number;
}
