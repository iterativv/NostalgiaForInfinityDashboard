// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { memo } from "react";
import { Button } from "@carbon/react";
import { Close, Pin, Settings } from "@carbon/icons-react";
import { PanelVisibleContext } from "../capabilities/live";
import { useStore } from "@tanstack/react-store";
import {
  useDerived,
  useElementStore,
  useLocalStore,
  useStoreEffect,
  shallow,
} from "@nfi/ui";
import type { WidgetRegistry } from "@nfi/widget-sdk";
import {
  FLOATING_MIN_HEIGHT,
  FLOATING_MIN_WIDTH,
  floatWindowSize,
  floatingStore,
  updateFloatingTab,
  type FloatingTab,
} from "./floating";
import { Panel } from "./Panel";
import { requestWidgetSettings } from "@nfi/widgets";
import { prefsStore } from "../store";

/**
 * FloatingTabsLayer — renders the active page's floating windows above the
 * workspace: draggable by the header, freely resizable from the bottom-
 * right corner (the widget's minimum readable size is enforced), focused
 * on pointer-down (which raises the window).
 *
 * The layer owns only presentation and geometry; every mutation goes
 * through the floating store (write-through to localStorage, so position
 * and size survive reloads). Dock/Close/settings act through the same
 * store ops the grid tabs use — see `store.ts` pin/dock ops.
 */

/** Hard viewport clamps: the header stays reachable, the body stays visible. */
interface WindowPosition {
  x: number;
  y: number;
}

function clampPosition(tab: FloatingTab): WindowPosition {
  const maxX = Math.max(0, window.innerWidth - 80);
  const maxY = Math.max(0, window.innerHeight - 40);

  return {
    x: Math.min(Math.max(tab.x, -(tab.width - 80)), maxX),
    y: Math.min(Math.max(tab.y, 0), maxY),
  };
}

/**
 * Z source for the layer: every window mounts above everything workspace-
 * related (menus/dialogs live at 9000+) and focusing mints a fresh, higher
 * z. A module counter keeps focus order stable across remounts.
 */
const FLOAT_Z_BASE = 7000;

let nextFloatZ = FLOAT_Z_BASE;

function mintFloatZ(): number {
  nextFloatZ += 1;

  return nextFloatZ;
}

/**
 * Stable no-op for Panel's `onActivate` (focus is this layer's z order,
 * not a workspace activation) — module scope so the identity never changes
 * and Panel's memo survives every focus raise.
 */
function activateSelfNoop(): void {}

function FloatingWindowImpl({
  pageId,
  tab,
  registry,
  onDock,
  onClose,
}: {
  pageId: string;
  tab: FloatingTab;
  registry: WidgetRegistry;
  /** Omitted on read-only surfaces (signed out): the dock button hides. */
  onDock?: (floatId: string) => void;
  onClose: (floatId: string) => void;
}) {
  // Per-window presentation state in one component store: stacking order
  // (minted lazily on focus) and the drag flag.
  const windowStore = useLocalStore(() => ({
    z: mintFloatZ(),
    dragging: false,
  }));

  const { z, dragging } = useStore(windowStore, (s) => s);

  const { store: windowEl, setElement: setWindowEl } =
    useElementStore<HTMLElement>();

  // Stable Panel callbacks: fresh closures would defeat Panel's memo on
  // every focus raise (z change) of this window — derived through a store
  // so the identity only changes when the closables themselves do.
  const closeSelf = useDerived(
    [onClose, tab.id] as const,
    ([close, id]) => () => close(id),
    { inputs: shallow },
  );

  const bringToFront = () => {
    // Mint lazily so unfocused windows keep their relative order.
    if (z < nextFloatZ) {
      windowStore.setState((prev) => ({ ...prev, z: mintFloatZ() }));
    }
  };

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    // Only the header itself drags — not its buttons.
    if (event.target !== event.currentTarget) {
      if (!(event.target instanceof HTMLElement)) return;

      if (event.target.closest("button")) return;
    }

    event.preventDefault();
    const handle = event.currentTarget;
    const el = windowEl.state;

    if (!el) return;
    handle.setPointerCapture(event.pointerId);
    windowStore.setState((prev) => ({ ...prev, dragging: true }));
    const startX = event.clientX;
    const startY = event.clientY;
    const originX = tab.x;
    const originY = tab.y;

    // Zero-commit drag: live left/top straight to the window element
    // (rAF-coalesced — pointermove fires ~60+/s), one store write on
    // release. A per-event updateFloatingTab would stringify the whole
    // floating state into localStorage per pointermove and re-render
    // every floating window on the page.
    let raf = 0;
    let pending: WindowPosition | null = null;
    let applied: WindowPosition | null = null;

    const applyPosition = (position: WindowPosition): void => {
      applied = position;
      el.style.left = `${position.x}px`;
      el.style.top = `${position.y}px`;
    };

    const flush = () => {
      raf = 0;

      if (pending) {
        applyPosition(pending);
        pending = null;
      }
    };

    const move = (moveEvent: PointerEvent) => {
      pending = clampPosition({
        ...tab,
        x: originX + (moveEvent.clientX - startX),
        y: originY + (moveEvent.clientY - startY),
      });

      if (raf === 0) raf = window.requestAnimationFrame(flush);
    };

    const finish = (commit: boolean) => {
      if (raf !== 0) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }

      // Freshest position wins: pending (not yet painted) beats applied.
      const finalPosition = pending ?? applied;
      pending = null;
      applied = null;

      if (finalPosition) {
        if (commit) {
          // Land exactly at the release point, then persist once.
          applyPosition(finalPosition);
          updateFloatingTab(pageId, tab.id, finalPosition);
        } else {
          applyPosition(clampPosition(tab));
        }
      }

      // SAFETY: `move` handles PointerEvent; the Element/Window listener
      // signature union collapses handlers to EventListener.
      handle.removeEventListener("pointermove", move as EventListener);
      windowStore.setState((prev) => ({ ...prev, dragging: false }));
    };

    const up = () => finish(true);

    const cancel = () => finish(false);

    // SAFETY: `move` handles PointerEvent; the Element/Window listener
    // signature union collapses handlers to EventListener.
    handle.addEventListener("pointermove", move as EventListener);
    handle.addEventListener("pointerup", up, { once: true });
    handle.addEventListener("pointercancel", cancel, { once: true });
  };

  // Free resize through the CSS handle; persist the settled size. The
  // observer measures the WINDOW element's own border box — exactly what
  // the inline width/height set — so a write-back is idempotent. (Measuring
  // the body's content box instead loses the header/border chrome on every
  // persist and made windows shrink toward the minimums after opening.)
  useStoreEffect(() => {
    const el = windowEl.state;

    if (!el || typeof ResizeObserver === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const observer = new ResizeObserver(() => {
      // Settle first — resize streams fire per frame.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const size = floatWindowSize(el);
        updateFloatingTab(pageId, tab.id, size);
      }, 200);
    });

    observer.observe(el);

    return () => {
      observer.disconnect();

      if (timer) clearTimeout(timer);
    };
  }, [pageId, tab.id]);

  const definition = registry.getWidget(tab.widgetType);
  const title = definition?.title ?? tab.widgetType;

  // The "disable widget minimum dimensions" preference drops the widget's
  // own readability minimums; the floating hard floors stay — they keep a
  // window grabbable/recoverable, which is window-manager territory, not a
  // widget minimum. +2: the window's 1px borders are outside the content
  // box the widget measures, so the enforced minimum must cover them too.
  const minSizesDisabled = useStore(
    prefsStore,
    (state) => state.disableWidgetMinSize,
  );

  const minWidth =
    Math.max(
      FLOATING_MIN_WIDTH,
      minSizesDisabled ? 0 : (definition?.minWidth ?? 0),
    ) + 2;

  const minHeight =
    Math.max(
      FLOATING_MIN_HEIGHT,
      minSizesDisabled ? 0 : (definition?.minHeight ?? 0),
    ) + 2;

  const position = clampPosition(tab);

  return (
    <section
      ref={setWindowEl}
      className={dragging ? "nfi-float nfi-float-dragging" : "nfi-float"}
      style={{
        left: position.x,
        top: position.y,
        // Self-heal stored sizes from before the border compensation.
        width: Math.max(tab.width, minWidth),
        height: Math.max(tab.height, minHeight),
        minWidth,
        minHeight,
        zIndex: z,
      }}
      onPointerDown={bringToFront}
      aria-label={`${title} floating window`}
    >
      <div
        className="nfi-float-head"
        onPointerDown={beginDrag}
        onDoubleClick={onDock ? () => onDock(tab.id) : undefined}
      >
        <span className="nfi-float-title">{title}</span>
        <span className="nfi-float-actions">
          {definition?.hasSettings ? (
            <Button
              size="sm"
              kind="ghost"
              hasIconOnly
              iconDescription={`${title} settings`}
              renderIcon={Settings}
              onClick={() => requestWidgetSettings(tab.panelId)}
            />
          ) : null}
          {onDock ? (
            <Button
              size="sm"
              kind="ghost"
              hasIconOnly
              iconDescription="Dock back into the grid"
              renderIcon={Pin}
              onClick={() => onDock(tab.id)}
            />
          ) : null}
          <Button
            size="sm"
            kind="ghost"
            hasIconOnly
            iconDescription={`Close ${title}`}
            renderIcon={Close}
            onClick={() => onClose(tab.id)}
          />
        </span>
      </div>
      <div className="nfi-float-body">
        <PanelVisibleContext.Provider value={true}>
          <Panel
            panelId={tab.panelId}
            widgetType={tab.widgetType}
            widgetConfig={tab.widgetConfig}
            title={undefined}
            focused
            registry={registry}
            onActivate={activateSelfNoop}
            onClose={closeSelf}
            showHeader={false}
          />
        </PanelVisibleContext.Provider>
      </div>
    </section>
  );
}

/**
 * Memoized: a geometry patch replaces one tab object and keeps its
 * siblings' identity, so a drag/settle on one window must not re-render
 * (or re-measure) the others.
 */
const FloatingWindow = memo(FloatingWindowImpl);

/**
 * Floating windows of the active page. Rendered as `position: fixed`
 * siblings so nothing in the workspace can clip them.
 */
export function FloatingTabsLayer({
  pageId,
  registry,
  onDock,
  onClose,
}: {
  pageId: string;
  registry: WidgetRegistry;
  /** Omitted on read-only surfaces (signed out): the dock button hides. */
  onDock?: (floatId: string) => void;
  onClose: (floatId: string) => void;
}) {
  const tabs = useStore(floatingStore, (state) => state[pageId]) ?? [];

  if (tabs.length === 0) return null;

  return (
    <>
      {tabs.map((tab) => (
        <FloatingWindow
          key={tab.id}
          pageId={pageId}
          tab={tab}
          registry={registry}
          onDock={onDock}
          onClose={onClose}
        />
      ))}
    </>
  );
}
