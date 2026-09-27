// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { CSSProperties, ReactNode } from "react";
import type { FlowLayoutNode, LayoutNode } from "@nfi/api-contract";
import {
  FLOW_GAP_PX,
  clampFlowItemSize,
  getFlowItemMinSize,
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

/** Keyboard resize steps by arrow key (grid cells; shift multiplies). */
interface ArrowKeyDeltas {
  [key: string]: [number, number];
}

/**
 * FlowPane — workspace infrastructure (NOT a widget).
 *
 * Renders one `flow` layout node with flex-wrap: every card keeps its
 * persisted pixel box (`width` × `height`) and cards that do not fit the
 * current row automatically wrap onto the next one (render-only row breaks;
 * persisted sizes never change). The SE-corner handle resizes a card to any
 * size the user wants while clamping to the card's content minimums —
 * derived from the widgets inside (see `getFlowItemMinSize`).
 *
 * Frozen resize: while a card drags, siblings are pinned in place
 * (absolute-positioned at their measured boxes) so no section auto-moves
 * or wraps to another row mid-gesture — the dragged card previews its box
 * on top with a lifted shadow, glowing yellow at the content-minimum
 * limit. One store commit lands on release and settles the wrap once.
 */
export function FlowPane({
  flow,
  panels,
  lookup,
  locked = false,
  onItemResize,
  renderChild,
}: {
  flow: FlowLayoutNode;
  /** Workspace panels map (widget type lookup for min-size hints). */
  panels: Record<string, { widgetType: string } | undefined>;
  lookup: (
    type: string,
  ) => { minWidth: number; minHeight?: number } | undefined;
  /** True on non-editable pages: handles are hidden, no drag. */
  locked?: boolean;
  onItemResize: (
    flowId: string,
    itemId: string,
    width: number,
    height: number,
  ) => void;
  /** Render one child subtree (tabs / nested grid / flow / bare panel). */
  renderChild: (node: LayoutNode) => ReactNode;
}) {
  const { store: containerEl, setElement: setContainerEl } =
    useElementStore<HTMLDivElement>();

  const widthStore = useLocalStore(0);
  const containerWidth = useStore(widthStore, (s) => s);
  // Live card elements by flow-item id (wrap-freeze pinning reads them).
  // Ref-style store: mutated in place, nothing subscribes to the Map.
  const itemEls = useLocalStore(new Map<string, HTMLElement>());

  // Progressive mounting bounds this page's widget storm to short idle
  // chunks (placeholders hold each card's exact flex slot meanwhile).
  const mountedIds = useProgressiveMount(
    useDerived(
      [flow.items] as const,
      ([items]) => items.map((item) => item.id),
      { inputs: shallow },
    ),
  );

  const setItemEl =
    (itemId: string) =>
    (node: HTMLDivElement | null): void => {
      if (node) itemEls.state.set(itemId, node);
      else itemEls.state.delete(itemId);
    };

  useStoreEffect(() => {
    const el = containerEl.state;

    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const width = Math.floor(entries[0]?.contentRect.width ?? 0);
      widthStore.setState((prev) => (prev === width ? prev : width));
    });

    observer.observe(el);
    widthStore.setState((prev) => {
      const width = Math.floor(el.getBoundingClientRect().width);

      return prev === width ? prev : width;
    });

    return () => observer.disconnect();
  }, []);

  const beginResize = (
    event: React.PointerEvent<HTMLDivElement>,
    itemId: string,
    startWidth: number,
    startHeight: number,
    minWidth: number,
    minHeight: number,
  ) => {
    if (locked) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const itemEl = handle.closest<HTMLElement>(".nfi-flow-item");

    if (!itemEl) return;
    handle.setPointerCapture(event.pointerId);
    const el = containerEl.state;

    const startX = event.clientX;
    const startY = event.clientY;

    // Freeze the wrap: pin every card at its measured box (absolute) so
    // siblings never reflow or jump rows mid-gesture; the dragged card
    // previews on top. The container keeps its height so scroll stays.
    const pinned: HTMLElement[] = [];

    if (el) {
      el.classList.add("nfi-flow-pinned");
      el.style.height = `${el.offsetHeight}px`;

      for (const node of itemEls.state.values()) {
        const top = node.offsetTop;
        const left = node.offsetLeft;
        node.style.position = "absolute";
        node.style.top = `${top}px`;
        node.style.left = `${left}px`;
        node.style.width = `${node.offsetWidth}px`;
        node.style.height = `${node.offsetHeight}px`;
        node.style.margin = "0";
        pinned.push(node);
      }
    }

    itemEl.classList.add("nfi-flow-item-resizing");

    const unpin = (keepDraggedBox: { width: number; height: number } | null) => {
      for (const node of pinned) {
        node.style.position = "";
        node.style.top = "";
        node.style.left = "";
        node.style.margin = "";

        if (node !== itemEl || keepDraggedBox === null) {
          node.style.width = "";
          node.style.height = "";
        }
      }

      if (keepDraggedBox !== null) {
        itemEl.style.width = `${keepDraggedBox.width}px`;
        itemEl.style.height = `${keepDraggedBox.height}px`;
      }

      itemEl.classList.remove("nfi-flow-item-resizing");
      delete itemEl.dataset.atmin;

      if (el) {
        el.classList.remove("nfi-flow-pinned");
        el.style.height = "";
      }
    };

    // Zero-commit resize: live width/height go straight to the card
    // element (rAF-coalesced). One store commit lands on release;
    // pointercancel reverts. Per-frame onItemResize calls are workspace
    // commits (full workspace-tree re-render at pointer frequency).
    let raf = 0;
    let pending: { width: number; height: number } | null = null;
    let applied: { width: number; height: number } | null = null;

    const applySize = (size: { width: number; height: number }): void => {
      applied = size;
      itemEl.style.width = `${size.width}px`;
      itemEl.style.height = `${size.height}px`;

      // Minimum-limit alert: yellow glow while the preview sits at the
      // content-minimum floor on either axis.
      if (size.width <= minWidth + 0.5 || size.height <= minHeight + 0.5) {
        itemEl.dataset.atmin = "true";
      } else {
        delete itemEl.dataset.atmin;
      }
    };

    const flush = () => {
      raf = 0;

      if (pending) {
        applySize(pending);
        pending = null;
      }
    };

    const move = (moveEvent: PointerEvent) => {
      const rawW = startWidth + (moveEvent.clientX - startX);
      const rawH = startHeight + (moveEvent.clientY - startY);

      const clamped = clampFlowItemSize(
        Math.round(rawW),
        Math.round(rawH),
        minWidth,
        minHeight,
        containerWidth > 0 ? containerWidth : undefined,
      );

      pending = clamped;

      if (raf === 0) raf = window.requestAnimationFrame(flush);
    };

    const finish = (commit: boolean) => {
      if (raf !== 0) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }

      // Freshest size wins: pending (not yet painted) beats applied.
      const finalSize = pending ?? applied;
      pending = null;
      applied = null;

      // Unpin first (siblings return to flex around the dragged box),
      // then persist once — the re-render lands on the same wrap.
      unpin(commit ? (finalSize ?? null) : null);

      if (commit && finalSize) {
        onItemResize(flow.id, itemId, finalSize.width, finalSize.height);
      }

      // SAFETY: `move` was registered below with the same event-agnostic
      // `EventListener` widening — removal must pass the identical widened
      // reference to detach it.
      handle.removeEventListener("pointermove", move as EventListener);
    };

    const up = () => finish(true);

    const cancel = () => finish(false);

    // SAFETY: the listener only fires for "pointermove", whose DOM events
    // are PointerEvents, so widening the handler's narrower parameter to the
    // event-agnostic `EventListener` signature is sound.
    handle.addEventListener("pointermove", move as EventListener);
    handle.addEventListener("pointerup", up, { once: true });
    handle.addEventListener("pointercancel", cancel, { once: true });
  };

  const nudgeSize = (
    itemId: string,
    width: number,
    height: number,
    dx: number,
    dy: number,
  ) => {
    const step = 20;

    const clamped = clampFlowItemSize(
      Math.round(width + dx * step),
      Math.round(height + dy * step),
      0,
      0,
      containerWidth > 0 ? containerWidth : undefined,
    );

    onItemResize(flow.id, itemId, clamped.width, clamped.height);
  };

  return (
    <div
      ref={setContainerEl}
      className="nfi-flow"
      style={{ gap: FLOW_GAP_PX }}
    >
      {flow.items.map((item) => {
        const min = getFlowItemMinSize(item.child, panels, lookup);
        const width = Math.max(item.width, min.width);
        const height = Math.max(item.height, min.height);

        const cappedWidth =
          containerWidth > 0
            ? Math.min(width, Math.max(min.width, containerWidth))
            : width;

        const style: CSSProperties = {
          width: cappedWidth,
          height,
          flex: "0 0 auto",
          minWidth: min.width,
          minHeight: min.height,
          maxWidth: "100%",
        };

        // Progressive mounting (see progressiveMount.ts): not-yet-mounted
        // cards hold their exact slot as inert placeholders — a page of N
        // widgets mounts in short idle chunks, never one blocking commit.
        if (!mountedIds.has(item.id)) {
          return (
            <div
              key={item.id}
              className="nfi-flow-item nfi-flow-item-pending"
              aria-busy="true"
              style={{ ...style, pointerEvents: "none" }}
            />
          );
        }

        return (
          <div
            key={item.id}
            ref={setItemEl(item.id)}
            className="nfi-flow-item"
            style={style}
          >
            <div className="nfi-flow-body">{renderChild(item.child)}</div>
            {locked ? null : (
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label={`Resize card (min ${min.width}×${min.height}px)`}
                title={`Drag to resize — min ${min.width}×${min.height}px`}
                tabIndex={0}
                className="nfi-flow-handle"
                onPointerDown={(event) =>
                  beginResize(
                    event,
                    item.id,
                    cappedWidth,
                    height,
                    min.width,
                    min.height,
                  )
                }
                onKeyDown={(event) => {
                  const deltas: ArrowKeyDeltas = {
                    ArrowLeft: [-1, 0],
                    ArrowRight: [1, 0],
                    ArrowUp: [0, 1],
                    ArrowDown: [0, 1],
                  };

                  const delta = deltas[event.key];

                  if (!delta) return;
                  event.preventDefault();
                  const scale = event.shiftKey ? 5 : 1;

                  nudgeSize(
                    item.id,
                    cappedWidth,
                    height,
                    delta[0] * scale,
                    delta[1] * scale,
                  );
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
