// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { Search, Checkmark } from "@carbon/icons-react"
import { TextInput } from "@carbon/react"
import { canEnableWidget, type AnyWidgetDefinition, type WidgetRegistry } from "@nfi/widget-sdk"
import { capabilitiesStore } from "../auth/capabilities"

/**
 * Widget picker — opened from a tab group's "+" (or its empty state).
 * Searchable, grouped, and grid-aware: widgets already open in the target
 * grid are marked and focus instead of duplicating (see `openWidgetPanel`).
 * Widgets the caller is not permitted to enable stay VISIBLE but dimmed
 * with a "not permitted" badge — discoverability beats a shorter list, and
 * the badge tells the user what exists and why it is unavailable.
 */

const WIDGET_GROUPS: ReadonlyArray<{ title: string; types: ReadonlyArray<string> }> = [
  { title: "Overview", types: ["bot-status", "connection", "bot-config", "session-clock", "fleet-overview"] },
  {
    title: "Profit & Balance",
    types: [
      "profit",
      "profit-relative",
      "balance",
      "balance-relative",
      "equity",
      "equity-relative",
      "pnl-chart",
      "cumulative-profit",
      "daily-profit",
      "wallet-history",
    ],
  },
  {
    title: "Percent (shareable)",
    types: [
      "positions-open-relative",
      "closed-positions-relative",
      "tag-performance-relative",
    ],
  },
  {
    title: "Positions & Trades",
    types: ["open-positions", "closed-positions", "open-trades", "trade-tape", "tag-performance"],
  },
  { title: "Charts", types: ["candle-chart"] },
  {
    title: "Analysis",
    types: ["performance-stats", "strategy-breakdown", "exposure", "risk-monitor", "market-movers"],
  },
  { title: "Watch", types: ["watchlist", "ticker-tape"] },
  { title: "Instances", types: ["instances", "instances-table"] },
]

function groupOf(type: string): string {
  if (type.startsWith("development.")) return "Development"
  return WIDGET_GROUPS.find((group) => group.types.includes(type))?.title ?? "More widgets"
}

export function WidgetPicker({
  registry,
  openWidgetTypes,
  anchor,
  onPick,
  onClose,
}: {
  registry: WidgetRegistry
  /** Widget types already open in the target grid (marked, focus on click). */
  openWidgetTypes: ReadonlySet<string>
  /** Screen rect of the "+" button; the popover anchors below it. */
  anchor: DOMRect | null
  onPick: (widgetType: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const granted = capabilitiesStore.state.granted
  const flat = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const defs = registry
      .listWidgets()
      .filter(
        (definition) =>
          needle.length === 0 ||
          definition.title.toLowerCase().includes(needle) ||
          definition.description.toLowerCase().includes(needle) ||
          definition.type.toLowerCase().includes(needle),
      )
    const order = new Map<string, number>()
    WIDGET_GROUPS.forEach((group, groupIndex) => {
      group.types.forEach((type, typeIndex) => {
        order.set(type, groupIndex * 100 + typeIndex)
      })
    })
    return [...defs].sort((a, b) => {
      const groupA = groupOf(a.type)
      const groupB = groupOf(b.type)
      if (groupA !== groupB) return groupA.localeCompare(groupB)
      return (order.get(a.type) ?? 1000) - (order.get(b.type) ?? 1000) || a.title.localeCompare(b.title)
    })
  }, [registry, query])

  const grouped = useMemo(() => {
    const out: Array<{ title: string; items: AnyWidgetDefinition[] }> = []
    for (const definition of flat) {
      const title = groupOf(definition.type)
      const group = out.find((entry) => entry.title === title)
      if (group) group.items.push(definition)
      else out.push({ title, items: [definition] })
    }
    return out
  }, [flat])

  useEffect(() => {
    setHighlight(0)
  }, [flat.length])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    const onPointer = (event: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose()
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("pointerdown", onPointer)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("pointerdown", onPointer)
    }
  }, [onClose])

  const choose = (definition: AnyWidgetDefinition | undefined) => {
    // Not-permitted entries render dimmed; picking one is a no-op (the
    // shell re-checks the same grant before opening).
    if (!definition || !canEnableWidget(definition, granted)) return
    onPick(definition.type)
    onClose()
  }

  // Anchor below the "+" button, clamped into the viewport.
  // Wide enough (32rem) that widget titles + descriptions fit on one line
  // without wrapping — see `.nfi-palette-item` nowrap rules in styles.css.
  const style: CSSProperties = (() => {
    const width = 32 * 16
    if (!anchor) return { top: "20vh", left: "50%", transform: "translateX(-50%)", width }
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, anchor.left))
    return { top: Math.min(window.innerHeight - 320, anchor.bottom + 4), left, width }
  })()

  let cursor = -1

  return (
    <div className="nfi-picker-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Add widget" className="nfi-picker" style={style}>
        <TextInput
          ref={inputRef}
          id="nfi-widget-search"
          labelText="Search widgets"
          hideLabel
          placeholder="Search widgets…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              choose(flat[highlight])
            } else if (event.key === "ArrowDown") {
              event.preventDefault()
              setHighlight((h) => Math.min(flat.length - 1, h + 1))
            } else if (event.key === "ArrowUp") {
              event.preventDefault()
              setHighlight((h) => Math.max(0, h - 1))
            }
          }}
          size="sm"
        />
        <div role="listbox" aria-label="Widgets" className="nfi-picker-list">
          {flat.length === 0 ? (
            <div className="nfi-palette-empty">No matching widgets.</div>
          ) : (
            grouped.map((group) => (
              <div key={group.title}>
                <div className="nfi-picker-group">{group.title}</div>
                {group.items.map((definition) => {
                  cursor += 1
                  const index = cursor
                  const open = openWidgetTypes.has(definition.type)
                  const permitted = canEnableWidget(definition, granted)
                  const className = [
                    "nfi-palette-item",
                    index === highlight ? "nfi-palette-item-active" : "",
                    permitted ? "" : "nfi-palette-item-disabled",
                  ]
                    .filter(Boolean)
                    .join(" ")
                  return (
                    <div
                      key={definition.type}
                      role="option"
                      aria-selected={index === highlight}
                      aria-disabled={!permitted}
                      className={className}
                      title={
                        permitted
                          ? definition.description
                          : `${definition.description} — your user is missing this widget's capabilities`
                      }
                      onMouseEnter={() => setHighlight(index)}
                      onMouseDown={(event) => {
                        event.preventDefault()
                        choose(definition)
                      }}
                    >
                      <span className="nfi-palette-title">
                        {definition.title}
                      </span>
                      {!permitted ? (
                        <span className="nfi-picker-badge">not permitted</span>
                      ) : open ? (
                        <span className="nfi-picker-open" title="Already open in this grid — focuses it">
                          <Checkmark size={14} /> open
                        </span>
                      ) : (
                        <span className="nfi-palette-category">{definition.description}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>
        <div className="nfi-picker-hint">
          <Search size={12} /> Already-open widgets in this cell focus instead
          of duplicating — open them from another cell for a second instance.
          Dimmed entries need capabilities your user does not hold.
        </div>
      </div>
    </div>
  )
}
