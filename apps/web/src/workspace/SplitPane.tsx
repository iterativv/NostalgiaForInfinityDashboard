// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import type { SplitDirection } from "@nfi/api-contract"
import {
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  clampRatioForMinWidths,
  effectiveSplitDirection,
} from "@nfi/widget-sdk"

/**
 * SplitPane — workspace infrastructure (NOT a widget).
 *
 * Renders one `split` layout node: two children with a draggable divider.
 * `direction: "horizontal"` places children side-by-side (row);
 * `"vertical"` stacks them (column). Ratios update the store live during
 * drag; persistence is debounced downstream, so no per-pixel writes occur.
 *
 * Responsive behavior (smart layouting):
 * - Each side declares its minimum readable width (`minFirst`/`minSecond`,
 *   derived from the widgets it contains). Drag clamps respect those
 *   minimums so a table pane cannot be squeezed into illegibility.
 * - When the container cannot fit both minimums side-by-side, a persisted
 *   `horizontal` split automatically stacks vertically (render-only — the
 *   persisted `direction` and `ratio` are untouched, so widening the window
 *   restores side-by-side). `vertical` splits never stack-switch.
 */

export function SplitPane({
  splitId,
  direction,
  ratio,
  onRatioChange,
  first,
  second,
  minFirst = 280,
  minSecond = 280,
  locked = false,
}: {
  splitId: string
  direction: SplitDirection
  ratio: number
  onRatioChange: (splitId: string, ratio: number) => void
  first: ReactNode
  second: ReactNode
  /** Minimum readable width (px) of the first/second subtree. */
  minFirst?: number
  minSecond?: number
  /** True on non-editable (preset) pages: divider is fixed, no drag/resize. */
  locked?: boolean
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setContainerWidth(width)
    })
    observer.observe(el)
    setContainerWidth(el.getBoundingClientRect().width)
    return () => observer.disconnect()
  }, [])

  const effective = effectiveSplitDirection(direction, containerWidth, minFirst, minSecond)
  const horizontal = effective === "horizontal"
  const stacked = direction === "horizontal" && effective === "vertical"

  const ratioFromClient = useCallback(
    (clientX: number, clientY: number): number | null => {
      const el = containerRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const size = horizontal ? rect.width : rect.height
      if (size <= 0) return null
      const pos = horizontal ? clientX - rect.left : clientY - rect.top
      const raw = pos / size
      if (horizontal) {
        const width = rect.width
        return clampRatioForMinWidths(raw, width, minFirst, minSecond, MIN_SPLIT_RATIO, MAX_SPLIT_RATIO)
      }
      // Vertical drags keep the global ratio bounds (heights vary freely).
      return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, raw))
    },
    [horizontal, minFirst, minSecond],
  )

  const beginDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (locked) return
      event.preventDefault()
      const divider = event.currentTarget
      divider.setPointerCapture(event.pointerId)
      const move = (moveEvent: PointerEvent) => {
        const next = ratioFromClient(moveEvent.clientX, moveEvent.clientY)
        if (next !== null) onRatioChange(splitId, next)
      }
      const up = () => {
        divider.removeEventListener("pointermove", move as EventListener)
      }
      divider.addEventListener("pointermove", move as EventListener)
      divider.addEventListener("pointerup", up, { once: true })
      divider.addEventListener("pointercancel", up, { once: true })
    },
    [onRatioChange, ratioFromClient, splitId, locked],
  )

  const clamped = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio))

  return (
    <div
      ref={containerRef}
      className={
        horizontal
          ? "nfi-split nfi-split-horizontal"
          : `nfi-split nfi-split-vertical${stacked ? " nfi-split-stacked" : ""}`
      }
      data-stacked={stacked ? "true" : "false"}
    >
      <div
        className="nfi-split-child"
        style={
          stacked
            ? { flexBasis: "auto" }
            : { flexGrow: clamped, flexBasis: 0, minWidth: horizontal ? Math.min(minFirst, 280) : undefined }
        }
      >
        {first}
      </div>
      <div
        role="separator"
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-label={
          locked
            ? "Split (fixed on this page)"
            : stacked
              ? "Resize split (stacked for narrow width)"
              : "Resize split"
        }
        aria-valuenow={Math.round(clamped * 100)}
        aria-valuemin={10}
        aria-valuemax={90}
        aria-disabled={locked ? true : undefined}
        tabIndex={locked ? -1 : 0}
        className={locked ? "nfi-split-divider nfi-split-divider-locked" : "nfi-split-divider"}
        onPointerDown={locked ? undefined : beginDrag}
        onKeyDown={(event) => {
          if (locked) return
          if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault()
            onRatioChange(splitId, clamped - 0.05)
          } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault()
            onRatioChange(splitId, clamped + 0.05)
          }
        }}
      />
      <div
        className="nfi-split-child"
        style={
          stacked
            ? { flexBasis: "auto" }
            : { flexGrow: 1 - clamped, flexBasis: 0, minWidth: horizontal ? Math.min(minSecond, 280) : undefined }
        }
      >
        {second}
      </div>
    </div>
  )
}
