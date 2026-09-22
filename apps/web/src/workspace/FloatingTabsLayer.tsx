// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useEffect, useRef, useState } from "react"
import { Button } from "@carbon/react"
import { Close, Pin, Settings } from "@carbon/icons-react"
import { PanelVisibleContext } from "../capabilities/live"
import { useStore } from "@tanstack/react-store"
import type { WidgetRegistry } from "@nfi/widget-sdk"
import {
  FLOATING_MIN_HEIGHT,
  FLOATING_MIN_WIDTH,
  floatWindowSize,
  floatingStore,
  updateFloatingTab,
  type FloatingTab,
} from "./floating"
import { Panel } from "./Panel"
import { requestWidgetSettings } from "@nfi/widgets"

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
function clampPosition(tab: FloatingTab): { x: number; y: number } {
  const maxX = Math.max(0, window.innerWidth - 80)
  const maxY = Math.max(0, window.innerHeight - 40)
  return {
    x: Math.min(Math.max(tab.x, -(tab.width - 80)), maxX),
    y: Math.min(Math.max(tab.y, 0), maxY),
  }
}

/**
 * Z source for the layer: every window mounts above everything workspace-
 * related (menus/dialogs live at 9000+) and focusing mints a fresh, higher
 * z. A module counter keeps focus order stable across remounts.
 */
const FLOAT_Z_BASE = 7000
let nextFloatZ = FLOAT_Z_BASE
function mintFloatZ(): number {
  nextFloatZ += 1
  return nextFloatZ
}

function FloatingWindow({
  pageId,
  tab,
  registry,
  onDock,
  onClose,
}: {
  pageId: string
  tab: FloatingTab
  registry: WidgetRegistry
  onDock: (floatId: string) => void
  onClose: (floatId: string) => void
}) {
  const [z, setZ] = useState(mintFloatZ)
  const [dragging, setDragging] = useState(false)
  const windowRef = useRef<HTMLElement>(null)

  const bringToFront = () => {
    // Mint lazily so unfocused windows keep their relative order.
    if (z < nextFloatZ) setZ(mintFloatZ())
  }

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    // Only the header itself drags — not its buttons.
    if (event.target !== event.currentTarget) {
      const target = event.target as HTMLElement
      if (target.closest("button")) return
    }
    event.preventDefault()
    const handle = event.currentTarget
    handle.setPointerCapture(event.pointerId)
    setDragging(true)
    const startX = event.clientX
    const startY = event.clientY
    const originX = tab.x
    const originY = tab.y
    const move = (moveEvent: PointerEvent) => {
      const next = clampPosition({
        ...tab,
        x: originX + (moveEvent.clientX - startX),
        y: originY + (moveEvent.clientY - startY),
      })
      updateFloatingTab(pageId, tab.id, next)
    }
    const up = () => {
      handle.removeEventListener("pointermove", move as EventListener)
      setDragging(false)
    }
    handle.addEventListener("pointermove", move as EventListener)
    handle.addEventListener("pointerup", up, { once: true })
    handle.addEventListener("pointercancel", up, { once: true })
  }

  // Free resize through the CSS handle; persist the settled size. The
  // observer measures the WINDOW element's own border box — exactly what
  // the inline width/height set — so a write-back is idempotent. (Measuring
  // the body's content box instead loses the header/border chrome on every
  // persist and made windows shrink toward the minimums after opening.)
  useEffect(() => {
    const el = windowRef.current;
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

  const definition = registry.getWidget(tab.widgetType)
  const title = definition?.title ?? tab.widgetType
  // +2: the window's 1px borders are outside the content box the widget
  // measures, so the enforced minimum must cover them too.
  const minWidth =
    Math.max(FLOATING_MIN_WIDTH, definition?.minWidth ?? 0) + 2
  const minHeight =
    Math.max(FLOATING_MIN_HEIGHT, definition?.minHeight ?? 0) + 2
  const position = clampPosition(tab)

  return (
    <section
      ref={windowRef}
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
            onActivate={() => {}}
            onClose={() => onClose(tab.id)}
            showHeader={false}
          />
        </PanelVisibleContext.Provider>
      </div>
    </section>
  )
}

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
  pageId: string
  registry: WidgetRegistry
  onDock: (floatId: string) => void
  onClose: (floatId: string) => void
}) {
  const tabs = useStore(floatingStore, (state) => state[pageId]) ?? []
  if (tabs.length === 0) return null
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
  )
}
