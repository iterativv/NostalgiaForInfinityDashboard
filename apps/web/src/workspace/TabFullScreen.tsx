// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useEffect } from "react"
import { createPortal } from "react-dom"
import { Button } from "@carbon/react"
import { Minimize } from "@carbon/icons-react"
import { PanelVisibleContext } from "../capabilities/live"
import type { Workspace } from "@nfi/api-contract"
import type { WidgetRegistry } from "@nfi/widget-sdk"
import { Panel } from "./Panel"

/**
 * TabFullScreen — the full-screen view of one tab, opened from the tab's
 * actions menu.
 *
 * The dialog preserves the tab's CURRENT panel-area aspect ratio and
 * scales it up to the largest box that fits the viewport (minus breathing
 * room) — the same view, bigger. While open, the dialog mounts the ONLY
 * live instance of the panel (the grid slot renders an empty placeholder),
 * so there is never a second SSE subscription. Restore puts the panel back
 * into its grid cell (a remount, exactly like tab switching).
 */

/** Breathing room around the dialog on each axis (px). */
const MARGIN_PX = 48
const HEADER_PX = 28

/** Largest box with `aspect` that fits the viewport minus margins. */
export function fitAspectRatioBox(aspect: number): {
  width: number
  height: number
} {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9
  const maxW = Math.max(320, window.innerWidth - MARGIN_PX * 2)
  const maxH = Math.max(240, window.innerHeight - MARGIN_PX * 2)
  let width = maxW;
  let height = width / safeAspect
  if (height > maxH) {
    height = maxH
    width = height * safeAspect
  }
  return { width: Math.round(width), height: Math.round(height) }
}

export function TabFullScreen({
  title,
  panelId,
  widgetType,
  widgetConfig,
  workspace,
  registry,
  aspect,
  onActivate,
  onClosePanel,
  onRestore,
}: {
  title: string
  panelId: string
  widgetType: string | undefined
  widgetConfig: unknown
  workspace: Workspace
  registry: WidgetRegistry
  /** Aspect ratio (width / height) of the tab's grid cell. */
  aspect: number
  onActivate: (panelId: string) => void
  onClosePanel: (panelId: string) => void
  onRestore: () => void
}) {
  // Escape restores, like every other dismissible surface.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onRestore()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onRestore])

  const { width, height } = fitAspectRatioBox(aspect)

  return createPortal(
    <div
      className="nfi-fullscreen-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onRestore()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title} full screen`}
        className="nfi-fullscreen"
        style={{ width, height: height + HEADER_PX }}
      >
        <div className="nfi-fullscreen-head">
          <span className="nfi-panel-title">{title}</span>
          <Button
            size="sm"
            kind="ghost"
            hasIconOnly
            iconDescription="Restore tab to its grid cell"
            renderIcon={Minimize}
            onClick={onRestore}
          />
        </div>
        <div className="nfi-fullscreen-body">
          <PanelVisibleContext.Provider value={true}>
            <Panel
              panelId={panelId}
              widgetType={widgetType}
              widgetConfig={widgetConfig}
              title={undefined}
              focused={workspace.activePanelId === panelId}
              registry={registry}
              onActivate={onActivate}
              onClose={onClosePanel}
              showHeader={false}
            />
          </PanelVisibleContext.Provider>
        </div>
      </div>
    </div>,
    document.getElementById("root") ?? document.body,
  )
}
