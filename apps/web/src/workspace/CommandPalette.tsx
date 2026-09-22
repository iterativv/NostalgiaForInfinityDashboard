// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useEffect, useMemo, useRef, useState } from "react"
import { TextInput } from "@carbon/react"
import type { Command } from "@nfi/widget-sdk"

/**
 * Command/Search launcher — App Shell infrastructure.
 *
 * Exposes the shell `Command`s (open widgets, splits, tabs, layouts,
 * reset). Deliberately simple substring filtering: its purpose is proving
 * the command architecture, not building search infrastructure.
 *
 * An optional `isDisabled` predicate lets the shell keep widget commands the
 * caller cannot use VISIBLE but inert (dimmed + "not permitted") — same
 * discoverability rule as the widget picker.
 */

export function CommandPalette({
  commands,
  initialQuery = "",
  isDisabled,
  onRun,
  onClose,
}: {
  commands: ReadonlyArray<Command>
  initialQuery?: string
  /** Marks commands that stay visible but must not run (e.g. ungranted widgets). */
  isDisabled?: (command: Command) => boolean
  onRun: (commandId: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState(initialQuery)
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter(
      (command) =>
        command.title.toLowerCase().includes(needle) ||
        (command.category ?? "").toLowerCase().includes(needle) ||
        command.id.toLowerCase().includes(needle),
    )
  }, [commands, query])

  const disabledFor = (command: Command): boolean => isDisabled?.(command) ?? false

  useEffect(() => {
    setHighlight(0)
  }, [filtered.length])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const choose = (index: number) => {
    const command = filtered[index]
    if (command && !disabledFor(command)) {
      onRun(command.id)
      onClose()
    }
  }

  return (
    <div
      className="nfi-palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="nfi-palette" role="dialog" aria-modal="true" aria-label="Command launcher">
        <TextInput
          ref={inputRef}
          id="nfi-command-search"
          labelText="Type a command"
          hideLabel
          placeholder="Type a command — Open Inspector, Split, Reset…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault()
              onClose()
            } else if (event.key === "ArrowDown") {
              event.preventDefault()
              setHighlight((h) => Math.min(filtered.length - 1, h + 1))
            } else if (event.key === "ArrowUp") {
              event.preventDefault()
              setHighlight((h) => Math.max(0, h - 1))
            } else if (event.key === "Enter") {
              event.preventDefault()
              choose(highlight)
            }
          }}
          size="sm"
        />
        <div ref={listRef} role="listbox" aria-label="Commands" className="nfi-palette-list">
          {filtered.length === 0 ? (
            <div className="nfi-palette-empty">No matching commands.</div>
          ) : (
            filtered.map((command, index) => {
              const disabled = disabledFor(command)
              const className = [
                "nfi-palette-item",
                index === highlight ? "nfi-palette-item-active" : "",
                disabled ? "nfi-palette-item-disabled" : "",
              ]
                .filter(Boolean)
                .join(" ")
              return (
                <div
                  key={command.id}
                  role="option"
                  aria-selected={index === highlight}
                  aria-disabled={disabled}
                  className={className}
                  onMouseEnter={() => setHighlight(index)}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    choose(index)
                  }}
                >
                  <span className="nfi-palette-title">{command.title}</span>
                  {disabled ? (
                    <span className="nfi-picker-badge">not permitted</span>
                  ) : command.category ? (
                    <span className="nfi-palette-category">{command.category}</span>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
