// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { Button } from "@carbon/react"
import {
  Close,
  Edit,
  EditOff,
  InformationSquare,
  Maximize,
  OverflowMenuVertical,
  PinFilled,
  Restart,
  Settings,
} from "@carbon/icons-react"
import type { AnyWidgetDefinition } from "@nfi/widget-sdk"
import { requestWidgetSettings, requestPrompt } from "@nfi/widgets"
import { reloadOwnerCapabilities } from "../capabilities/live"
import { renameWorkspacePanelTitle } from "./store"
import { WidgetInfoDialog } from "./WidgetInfoDialog"

/**
 * TabActionsMenu — the single "⋯" trigger per tab (or bare panel header)
 * replacing the separate close × and settings gear buttons.
 *
 * The menu opens on HOVER of the owning tab (`hoverOpen`, with a short
 * intent delay handled by the caller) and stays while the pointer is over
 * the menu; clicking "⋯" pins it open the classic way (outside pointer
 * down / Escape close). The menu portals to `#root` so it escapes the tab
 * strip's scroll clipping. Every widget offers Reload (re-fetches exactly
 * that widget's live data), Rename (a custom tab title — tooltips keep
 * the widget name) and Information (definition, capabilities, config);
 * Full screen and Pin appear when wired; Settings and Close depend on the
 * flags.
 */

const MENU_WIDTH_PX = 12 * 16
/** Hover-intent delay before the menu opens (ms) — avoids sweep flashes. */
const HOVER_OPEN_DELAY_MS = 150
/**
 * Close grace (ms): the menu stays mounted this long after the pointer
 * leaves the tab, so crossing the (small but real) gap between the tab
 * and the menu never kills it mid-flight.
 */
const HOVER_CLOSE_GRACE_MS = 300

export function TabActionsMenu({
  title,
  panelId,
  canClose,
  canConfigure,
  canPin = false,
  canFullScreen = false,
  hoverOpen = false,
  widgetDefinition,
  widgetConfig,
  renamed = false,
  onClosePanel,
  onPinPanel,
  onFullScreen,
  triggerClassName = "nfi-tab-menu",
}: {
  title: string
  panelId: string
  /** False for pinned preset tabs: close is withheld, settings still open. */
  canClose: boolean
  /** True when the widget owns a settings form on the shared bus. */
  canConfigure: boolean
  /** True when the tab may detach into the floating layer (non-locked). */
  canPin?: boolean
  /** True when a full-screen view is wired for this tab. */
  canFullScreen?: boolean
  /** Hover state from the owning tab: open without a click. */
  hoverOpen?: boolean
  /** Present for every hosted widget: enables the Information action. */
  widgetDefinition?: AnyWidgetDefinition
  /** Decoded config shown by the Information dialog. */
  widgetConfig?: unknown
  /** True while a custom tab title exists: shows the "Reset name" action. */
  renamed?: boolean
  onClosePanel: (panelId: string) => void
  /** Pin the tab into the floating layer (removes it from the grid). */
  onPinPanel?: (panelId: string) => void
  /** Blow the tab up into the full-screen dialog. */
  onFullScreen?: (panelId: string) => void
  triggerClassName?: string
}) {
  const [pinnedOpen, setPinnedOpen] = useState(false)
  const [hoverReady, setHoverReady] = useState(false)
  const [menuHover, setMenuHover] = useState(false)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstItemRef = useRef<HTMLButtonElement>(null)

  const canInfo = widgetDefinition !== undefined

  // Hover-open with a small intent delay; the menu also stays open while
  // the pointer is over it (menuHover), so moving into the menu is safe.
  useEffect(() => {
    if (!hoverOpen) {
      setHoverReady(false)
      return
    }
    const timer = setTimeout(() => setHoverReady(true), HOVER_OPEN_DELAY_MS)
    return () => clearTimeout(timer)
  }, [hoverOpen])

  const open = pinnedOpen || (hoverOpen && hoverReady) || menuHover

  // Keep the menu MOUNTED through the close grace: when the pointer leaves
  // the tab toward the menu, it crosses dead space where neither the tab
  // nor the menu reports hover — unmounting instantly there made the menu
  // vanish before it could be reached.
  const [menuMounted, setMenuMounted] = useState(false)
  useEffect(() => {
    if (open) {
      setMenuMounted(true)
      return
    }
    const timer = setTimeout(() => setMenuMounted(false), HOVER_CLOSE_GRACE_MS)
    return () => clearTimeout(timer)
  }, [open])

  // Full dismiss: every `open` contribution is cleared (a pinned click, the
  // pointer still hovering the menu, …) and the portal unmounts at once —
  // an activated item must never leave the menu looking stuck on screen.
  const close = useCallback(() => {
    setPinnedOpen(false)
    setMenuHover(false)
    setMenuMounted(false)
  }, [])
  const toggle = () => setPinnedOpen((value) => !value)

  // Keep the anchor fresh whenever the menu opens (hover moves it around).
  useEffect(() => {
    if (open) setAnchor(triggerRef.current?.getBoundingClientRect() ?? null)
  }, [open])

  // Focus the first item for keyboard users; return focus on close.
  useEffect(() => {
    if (open) firstItemRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        close()
        triggerRef.current?.focus()
      }
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && !document.querySelector(".nfi-tabmenu")?.contains(target)) {
        close()
      }
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("pointerdown", onPointer)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("pointerdown", onPointer)
    }
  }, [open, close])

  // Anchor below the trigger, right-aligned, flipped above near the
  // viewport bottom and clamped horizontally. A transparent BRIDGE covers
  // the few pixels between the trigger and the menu so the hover region is
  // physically contiguous — the cursor never crosses dead space.
  const GAP_PX = 4
  const { menuStyle, bridgeStyle } = (() => {
    const items =
      2 + // Reload + Rename — always offered
      (renamed ? 1 : 0) + // Reset name (only while a rename exists)
      (canInfo ? 1 : 0) +
      (canConfigure ? 1 : 0) +
      (canFullScreen ? 1 : 0) +
      (canPin ? 1 : 0) +
      (canClose ? 1 : 0)
    const height = items * 37 + 12
    if (!anchor) {
      return {
        menuStyle: { top: 0, left: 0, width: MENU_WIDTH_PX } as CSSProperties,
        bridgeStyle: null,
      }
    }
    const left = Math.max(
      8,
      Math.min(
        window.innerWidth - MENU_WIDTH_PX - 8,
        anchor.right - MENU_WIDTH_PX,
      ),
    )
    const flip = anchor.bottom + GAP_PX + height > window.innerHeight
    const menuStyle: CSSProperties = flip
      ? {
          top: Math.max(8, anchor.top - height - GAP_PX),
          left,
          width: MENU_WIDTH_PX,
        }
      : { top: anchor.bottom + GAP_PX, left, width: MENU_WIDTH_PX }
    // The bridge overlaps each edge by a pixel to guarantee continuity.
    const bridgeStyle: CSSProperties | null = flip
      ? { top: anchor.top - GAP_PX - 1, left, width: MENU_WIDTH_PX, height: GAP_PX + 2 }
      : { top: anchor.bottom - 1, left, width: MENU_WIDTH_PX, height: GAP_PX + 2 }
    return { menuStyle, bridgeStyle }
  })()

  const hoverProps = {
    onMouseEnter: () => setMenuHover(true),
    onMouseLeave: () => setMenuHover(false),
  }

  return (
    <>
      <Button
        ref={triggerRef}
        size="sm"
        kind="ghost"
        hasIconOnly
        iconDescription={`${title} actions`}
        renderIcon={OverflowMenuVertical}
        className={triggerClassName}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
      />
      {menuMounted
        ? createPortal(
            <div
              className={
                pinnedOpen
                  ? "nfi-tabmenu-overlay"
                  : // Hover-opened menus must not swallow outside clicks —
                    // the overlay stays transparent to pointers entirely.
                    "nfi-tabmenu-overlay nfi-tabmenu-overlay-passthrough"
              }
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) close()
              }}
            >
              {bridgeStyle ? (
                <div
                  aria-hidden="true"
                  className="nfi-tabmenu-bridge"
                  style={bridgeStyle}
                  {...hoverProps}
                />
              ) : null}
              <div
                role="menu"
                aria-label={`${title} actions`}
                className="nfi-tabmenu"
                style={menuStyle}
                {...hoverProps}
              >
                {canInfo ? (
                  <button
                    ref={firstItemRef}
                    type="button"
                    role="menuitem"
                    className="nfi-tabmenu-item"
                    onClick={() => {
                      setInfoOpen(true)
                      close()
                    }}
                  >
                    <InformationSquare size={16} />
                    Information
                  </button>
                ) : null}
                <button
                  ref={canInfo ? undefined : firstItemRef}
                  type="button"
                  role="menuitem"
                  className="nfi-tabmenu-item"
                  title="Re-fetch this widget's live data now"
                  onClick={() => {
                    void reloadOwnerCapabilities(panelId)
                    close()
                  }}
                >
                  <Restart size={16} />
                  Reload
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="nfi-tabmenu-item"
                  title="Custom tab title — tooltips keep the widget name"
                  onClick={() => {
                    close()
                    void requestPrompt({
                      title: "Rename tab",
                      label: "Tab name",
                      initialValue: title,
                      confirmLabel: "Rename",
                    }).then((name) => {
                      // null = cancelled (the prompt refuses empty submits)
                      if (name !== null)
                        renameWorkspacePanelTitle(panelId, name)
                    })
                  }}
                >
                  <Edit size={16} />
                  Rename
                </button>
                {renamed ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="nfi-tabmenu-item"
                    title="Back to the widget's own name"
                    onClick={() => {
                      renameWorkspacePanelTitle(panelId, null)
                      close()
                    }}
                  >
                    <EditOff size={16} />
                    Reset name
                  </button>
                ) : null}
                {canConfigure ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="nfi-tabmenu-item"
                    onClick={() => {
                      requestWidgetSettings(panelId)
                      close()
                    }}
                  >
                    <Settings size={16} />
                    Settings
                  </button>
                ) : null}
                {canFullScreen && onFullScreen ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="nfi-tabmenu-item"
                    onClick={() => {
                      onFullScreen(panelId)
                      close()
                    }}
                  >
                    <Maximize size={16} />
                    Full screen
                  </button>
                ) : null}
                {canPin && onPinPanel ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="nfi-tabmenu-item"
                    title="Detach into a draggable floating window"
                    onClick={() => {
                      onPinPanel(panelId)
                      close()
                    }}
                  >
                    <PinFilled size={16} />
                    Pin to floating
                  </button>
                ) : null}
                {canClose ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="nfi-tabmenu-item"
                    onClick={() => {
                      onClosePanel(panelId)
                      close()
                    }}
                  >
                    <Close size={16} />
                    Close tab
                  </button>
                ) : null}
              </div>
            </div>,
            // Inside #root (under Carbon's g100 Theme) so theme tokens
            // resolve; the menu would lose its colors on document.body.
            document.getElementById("root") ?? document.body,
          )
        : null}
      {infoOpen && widgetDefinition ? (
        <WidgetInfoDialog
          definition={widgetDefinition}
          config={widgetConfig}
          panelId={panelId}
          onClose={() => setInfoOpen(false)}
        />
      ) : null}
    </>
  )
}
