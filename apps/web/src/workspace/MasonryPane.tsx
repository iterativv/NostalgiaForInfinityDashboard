// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import type {
  LayoutNode,
  MasonryItemLayoutNode,
  MasonryLayoutNode,
} from "@nfi/api-contract";
import {
  MASONRY_GAP_PX,
  getMasonryItemMinHeight,
  packMasonry,
} from "@nfi/widget-sdk";
import {
  useDerived,
  useElementStore,
  useLocalStore,
  useStore,
  useStoreEffect,
  shallow,
} from "@nfi/ui";
import { useProgressiveMount } from "./progressiveMount";

/**
 * MasonryPane — workspace infrastructure (NOT a widget).
 *
 * Renders one `masonry` layout node as gap-free column packing: the column
 * count derives from the pane width and the node's target `columnWidth`
 * (the density knob — NOT from widget minimum widths, which would collapse
 * a wall of mixed widgets into one full-width fluid column), is capped at
 * MAX_MASONRY_COLUMNS so wide monitors never build sliver columns, columns
 * stretch to fill the row, and every card lands in the currently shortest
 * column run. Card heights stay flexible — persisted px clamped to the
 * content minimum — and widths span whole columns (persisted per-card
 * `span`, clamped to the live column count). The SE-corner handle resizes
 * both axes: dy drags the height, dx drags the column span (snapped to
 * whole columns).
 *
 * The packing is a pure function of the container width over KNOWN heights
 * (persisted px clamped through the same minimums the cards render with),
 * so it needs no measurement, observers or frame scheduling: one React
 * commit lays the whole wall out, and the pane never depends on
 * requestAnimationFrame (a stalled/throttled frame clock used to wedge the
 * whole masonic update cycle). The pane is its own scroll container (like
 * `.nfi-flow`).
 */
interface MasonryPaneContextValue {
  panels: Record<string, { widgetType: string } | undefined>;
  lookup: (
    type: string,
  ) => { minWidth: number; minHeight?: number } | undefined;
  /** True on non-editable pages: handles are hidden, no drag. */
  locked: boolean;
  onItemResize: (
    masonryId: string,
    itemId: string,
    height: number,
    span?: number,
  ) => void;
  masonryId: string;
  /** Render one child subtree (tabs / nested grid / flow / bare panel). */
  renderChild: (node: LayoutNode) => ReactNode;
}

const MasonryPaneContext = createContext<MasonryPaneContextValue | null>(null);

/**
 * One masonry card: absolute-packed at its column position, explicit
 * min-clamped height and column-span width, content body and the SE-corner
 * resize handle (height + span).
 */
function MasonryCard({
  data: item,
  left,
  top,
  width,
  minHeight,
  columnWidth,
  columnCount,
}: {
  data: MasonryItemLayoutNode;
  left: number;
  top: number;
  width: number;
  minHeight: number;
  /** Stretched column width (the dx → span quantization step). */
  columnWidth: number;
  /** Live column count (span clamp during drag and nudges). */
  columnCount: number;
}) {
  const context = useContext(MasonryPaneContext);
  const { setElement: setCardEl } = useElementStore<HTMLDivElement>();

  const height = Math.max(item.height, minHeight);
  const span = Math.max(1, Math.min(columnCount, Math.round(item.span) || 1));
  const columnStep = columnWidth + MASONRY_GAP_PX;

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!context || context.locked) return;
    const { onItemResize, masonryId } = context;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const itemEl = handle.closest<HTMLElement>(".nfi-masonry-item");

    if (!itemEl) return;
    handle.setPointerCapture(event.pointerId);

    const startHeight = itemEl.offsetHeight;
    const startX = event.clientX;
    const startY = event.clientY;

    const startSpan = Math.max(
      1,
      Math.min(columnCount, Math.round(item.span) || 1),
    );

    // Zero-commit resize: live height and span-snapped width go straight
    // to the card element (rAF-coalesced); one store commit lands on
    // release and the deterministic re-pack moves everything else.
    // pointercancel reverts.
    let raf = 0;
    let pendingHeight: number | null = null;
    let pendingSpan: number | null = null;
    let appliedHeight: number | null = null;
    let appliedSpan: number | null = null;

    const applySize = (nextHeight: number, nextSpan: number): void => {
      appliedHeight = nextHeight;
      appliedSpan = nextSpan;
      itemEl.style.height = `${nextHeight}px`;
      itemEl.style.width = `${nextSpan * columnStep - MASONRY_GAP_PX}px`;
    };

    const flush = () => {
      raf = 0;

      if (pendingHeight !== null || pendingSpan !== null) {
        applySize(
          pendingHeight ?? appliedHeight ?? startHeight,
          pendingSpan ?? appliedSpan ?? startSpan,
        );
        pendingHeight = null;
        pendingSpan = null;
      }
    };

    const move = (moveEvent: PointerEvent) => {
      pendingHeight = Math.max(
        minHeight,
        Math.round(startHeight + (moveEvent.clientY - startY)),
      );
      pendingSpan = Math.max(
        1,
        Math.min(
          columnCount,
          startSpan + Math.round((moveEvent.clientX - startX) / columnStep),
        ),
      );

      if (raf === 0) raf = window.requestAnimationFrame(flush);
    };

    // SAFETY: `move` receives a native PointerEvent; addEventListener's
    // callback parameter type is the wider EventListener, so the narrow
    // handler is widened to attach it.
    const moveListener = move as EventListener;

    const finish = (commit: boolean) => {
      if (raf !== 0) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }

      // Freshest size wins: pending (not yet painted) beats applied.
      const finalHeight = pendingHeight ?? appliedHeight;
      const finalSpan = pendingSpan ?? appliedSpan;
      pendingHeight = null;
      pendingSpan = null;
      appliedHeight = null;
      appliedSpan = null;

      if (finalHeight !== null) {
        if (commit) {
          // Land exactly at the release point, then persist once (the
          // re-render reapplies the same box and re-packs the wall).
          applySize(finalHeight, finalSpan ?? startSpan);
          onItemResize(masonryId, item.id, finalHeight, finalSpan ?? startSpan);
        } else {
          applySize(Math.max(startHeight, minHeight), startSpan);
        }
      }

      handle.removeEventListener("pointermove", moveListener);
    };

    handle.addEventListener("pointermove", moveListener);
    handle.addEventListener("pointerup", () => finish(true), { once: true });
    handle.addEventListener("pointercancel", () => finish(false), {
      once: true,
    });
  };

  const nudge = (deltaHeight: number, deltaSpan = 0) => {
    if (!context) return;
    context.onItemResize(
      context.masonryId,
      item.id,
      Math.max(minHeight, height + deltaHeight),
      Math.max(1, Math.min(columnCount, span + deltaSpan)),
    );
  };

  if (!context) return null;

  const { locked, renderChild } = context;

  return (
    <div
      ref={setCardEl}
      className="nfi-masonry-item"
      role="listitem"
      style={{ position: "absolute", top, left, width, height, minHeight }}
    >
      <div className="nfi-masonry-body">{renderChild(item.child)}</div>
      {locked ? null : (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize card (min height ${minHeight}px; width snaps to whole columns)`}
          title={`Drag to resize height and width — width snaps to whole columns, min height ${minHeight}px`}
          tabIndex={0}
          className="nfi-masonry-handle"
          onPointerDown={beginResize}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 100 : 20;

            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              nudge(event.key === "ArrowUp" ? -step : step);
            } else if (
              event.key === "ArrowLeft" ||
              event.key === "ArrowRight"
            ) {
              event.preventDefault();
              nudge(0, event.key === "ArrowLeft" ? -1 : 1);
            }
          }}
        />
      )}
    </div>
  );
}

export function MasonryPane({
  masonry,
  panels,
  lookup,
  locked = false,
  onItemResize,
  renderChild,
}: {
  masonry: MasonryLayoutNode;
  /** Workspace panels map (widget type lookup for min-size hints). */
  panels: Record<string, { widgetType: string } | undefined>;
  lookup: (
    type: string,
  ) => { minWidth: number; minHeight?: number } | undefined;
  /** True on non-editable pages: handles are hidden, no drag. */
  locked?: boolean;
  onItemResize: (
    masonryId: string,
    itemId: string,
    height: number,
    span?: number,
  ) => void;
  /** Render one child subtree (tabs / nested grid / flow / bare panel). */
  renderChild: (node: LayoutNode) => ReactNode;
}) {
  const { store: scrollEl, setElement: setScrollEl } =
    useElementStore<HTMLDivElement>();

  const widthStore = useLocalStore(0);
  const containerWidth = useStore(widthStore, (s) => s);

  useStoreEffect(() => {
    const el = scrollEl.state;

    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const width = Math.floor(entries[0]?.contentRect.width ?? 0);

      widthStore.setState((prev) => (prev === width ? prev : width));
    });

    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  // Immediate measure (RO fires on observe, but this avoids one empty
  // render while waiting for that first async callback).
  useStoreEffect(() => {
    const el = scrollEl.state;

    if (!el) return;
    widthStore.setState(() => el.clientWidth);
  }, []);

  // Per-card minimum heights (content minimum + tab-strip chrome). The
  // packing clamps persisted heights through the SAME minimums the cards
  // render with, so layout math and rendered boxes never disagree.
  const minHeightByItem = useDerived(
    [masonry.items, panels, lookup] as const,
    ([items, panelsMap, sizeLookup]) =>
      new Map(
        items.map((item) => [
          item.id,
          getMasonryItemMinHeight(item.child, panelsMap, sizeLookup),
        ]),
      ),
    { inputs: shallow },
  );

  // Progressive mounting bounds the wall's first paint to short idle
  // chunks (placeholders hold the packed slots meanwhile).
  const mountedIds = useProgressiveMount(
    useDerived(
      [masonry.items] as const,
      ([items]) => items.map((item) => item.id),
      { inputs: shallow },
    ),
  );

  const packing = useDerived(
    [containerWidth, masonry.columnWidth, masonry.items, minHeightByItem] as const,
    ([width, columnWidth, items, minHeights]) =>
      packMasonry(
        width,
        columnWidth,
        MASONRY_GAP_PX,
        items.map((item) => Math.max(item.height, minHeights.get(item.id) ?? 0)),
        { spans: items.map((item) => item.span) },
      ),
    { inputs: shallow },
  );

  const context: MasonryPaneContextValue = useDerived(
    [panels, lookup, locked, onItemResize, masonry.id, renderChild] as const,
    ([panelsMap, sizeLookup, lockedValue, resize, masonryId, render]) => ({
      panels: panelsMap,
      lookup: sizeLookup,
      locked: lockedValue,
      onItemResize: resize,
      masonryId,
      renderChild: render,
    }),
    { inputs: shallow },
  );

  return (
    <div ref={setScrollEl} className="nfi-masonry">
      <MasonryPaneContext.Provider value={context}>
        <div
          className="nfi-masonry-canvas"
          role="list"
          style={{
            position: "relative",
            width: "100%",
            height: packing.height,
          }}
        >
          {masonry.items.map((item, index) => {
            const position = packing.items[index];

            if (!position) return null;

            // Progressive mounting (see progressiveMount.ts): the wall's
            // cards fill in across idle chunks; placeholders hold the
            // packed slots so the canvas never shifts.
            if (!mountedIds.has(item.id)) {
              return (
                <div
                  key={item.id}
                  role="listitem"
                  aria-busy="true"
                  className="nfi-masonry-item nfi-masonry-item-pending"
                  style={{
                    position: "absolute",
                    left: position.left,
                    top: position.top,
                    width: position.width,
                    height: minHeightByItem.get(item.id) ?? 0,
                    pointerEvents: "none",
                  }}
                />
              );
            }

            return (
              <MasonryCard
                key={item.id}
                data={item}
                left={position.left}
                top={position.top}
                width={position.width}
                minHeight={minHeightByItem.get(item.id) ?? 0}
                columnWidth={packing.columnWidth}
                columnCount={packing.columnCount}
              />
            );
          })}
        </div>
      </MasonryPaneContext.Provider>
    </div>
  );
}
