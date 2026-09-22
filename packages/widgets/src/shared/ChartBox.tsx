// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useEffect, useRef, useState, type ReactNode } from "react"

/**
 * ChartBox — height-adaptive chart container.
 *
 * Measures itself with a ResizeObserver and renders `children(height)` so
 * Carbon charts can be given `height: ${height}px` for the space they
 * actually have: dense grid cells never clip a fixed-height chart again.
 * Grows to fill leftover panel space (`flex: 1 1 auto`) but never shrinks
 * below `min` px.
 */
export function ChartBox({
  min = 160,
  children,
}: {
  /** Minimum rendered height in px (charts below this stay min-sized). */
  min?: number
  children: (height: number) => ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(min)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.height ?? 0)
      if (next > 0) setHeight(Math.max(min, next))
    })
    observer.observe(el)
    setHeight(Math.max(min, Math.floor(el.getBoundingClientRect().height)))
    return () => observer.disconnect()
  }, [min])
  return (
    <div ref={ref} style={{ flex: "1 1 auto", minHeight: min, display: "flex" }}>
      {children(height)}
    </div>
  )
}
