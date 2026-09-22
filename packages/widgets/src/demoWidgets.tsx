// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useState } from "react"
import { Button, TextInput, Tile } from "@carbon/react"
import { Schema } from "effect"
import { defineWidget, type WidgetProps } from "@nfi/widget-sdk"
import { updatePanelConfig } from "./shared/panelConfig"

/**
 * Development/demo widgets — architecture fixtures, not production features.
 * They prove: registry lookup, multiple instances, widget configuration,
 * and the ephemeral-vs-persisted state split (Log entries are local-only).
 */

export const WELCOME_WIDGET_TYPE = "development.welcome"
export const INSPECTOR_WIDGET_TYPE = "development.inspector"
export const LOG_WIDGET_TYPE = "development.log"

const WelcomeConfig = Schema.Struct({})
type WelcomeConfig = typeof WelcomeConfig.Type

function WelcomeView({ focused }: WidgetProps<WelcomeConfig>) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        fontSize: "0.8125rem",
      }}
    >
      <p>
        <strong>Workspace terminal.</strong> This panel is a <em>widget</em> hosted by a <em>panel</em> inside a{" "}
        <em>tab group / split</em> layout. The layout is a declarative AST persisted in SQLite — not React code.
      </p>
      <ul
        style={{
          margin: 0,
          paddingLeft: "1.1rem",
          display: "flex",
          flexDirection: "column",
          gap: "0.25rem",
        }}
      >
        <li>Press Ctrl/⌘+K for the command launcher.</li>
        <li>Open multiple Inspectors — each instance has its own config.</li>
        <li>Split, retab, resize, reload: the layout is restored.</li>
      </ul>
      <p style={{ opacity: 0.6 }}>{focused ? "This panel holds workspace focus." : "Click to focus this panel."}</p>
    </div>
  )
}

export const WelcomeWidget = defineWidget({
  type: WELCOME_WIDGET_TYPE,
  title: "Welcome",
  description: "Workspace architecture overview.",
  configSchema: WelcomeConfig,
  defaultConfig: {},
  component: WelcomeView,
  capabilities: [],
  minWidth: 280,
  minHeight: 160,
})

const InspectorConfig = Schema.Struct({
  title: Schema.String,
  value: Schema.String,
})
type InspectorConfig = typeof InspectorConfig.Type

function InspectorView({ panelId, config }: WidgetProps<InspectorConfig>) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <Tile style={{ padding: "0.75rem" }}>
        <div
          style={{
            fontSize: "0.6875rem",
            opacity: 0.6,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Watched value
        </div>
        <div
          style={{
            fontSize: "1.25rem",
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {config.value || "—"}
        </div>
        <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>{config.title || "untitled"}</div>
      </Tile>
      <TextInput
        id={`inspector-title-${panelId}`}
        labelText="Title (persisted widget config)"
        value={config.title}
        onChange={(event) => updatePanelConfig(panelId, { ...config, title: event.target.value })}
        size="sm"
      />
      <TextInput
        id={`inspector-value-${panelId}`}
        labelText="Value (persisted widget config)"
        value={config.value}
        onChange={(event) => updatePanelConfig(panelId, { ...config, value: event.target.value })}
        size="sm"
      />
    </div>
  )
}

export const InspectorWidget = defineWidget({
  type: INSPECTOR_WIDGET_TYPE,
  title: "Inspector",
  description: "Key/value inspector with persisted per-instance config.",
  configSchema: InspectorConfig,
  defaultConfig: { title: "BTCUSDT", value: "Demo" },
  component: InspectorView,
  capabilities: [],
  minWidth: 240,
  minHeight: 160,
})

const LogConfig = Schema.Struct({
  source: Schema.String,
})
type LogConfig = typeof LogConfig.Type

interface LogEntry {
  readonly at: string
  readonly text: string
}

function LogView({ config }: WidgetProps<LogConfig>) {
  // Ephemeral UI state on purpose: entries live only in React state and are
  // never persisted — workspace state holds the `source` config, domain
  // state would come from the backend. This split is the point.
  const [entries, setEntries] = useState<ReadonlyArray<LogEntry>>([
    {
      at: new Date().toLocaleTimeString([], { hour12: false }),
      text: `attached to ${config.source || "workspace"}`,
    },
  ])
  const [counter, setCounter] = useState(1)

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        minHeight: 160,
      }}
    >
      <div
        role="log"
        aria-label="Development log"
        style={{
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "0.75rem",
          background: "var(--cds-background)",
          border: "1px solid var(--cds-border-subtle)",
          padding: "0.5rem",
          height: "9rem",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "0.125rem",
        }}
      >
        {entries.map((entry, index) => (
          <div key={index}>
            <span style={{ opacity: 0.5 }}>{entry.at}</span> {entry.text}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <Button
          size="sm"
          kind="secondary"
          onClick={() => {
            const next = counter + 1
            setCounter(next)
            setEntries((prev) => [
              ...prev.slice(-49),
              {
                at: new Date().toLocaleTimeString([], { hour12: false }),
                text: `entry #${next} (${config.source || "workspace"})`,
              },
            ])
          }}
        >
          Append entry
        </Button>
        <Button size="sm" kind="ghost" onClick={() => setEntries([])}>
          Clear
        </Button>
      </div>
    </div>
  )
}

export const LogWidget = defineWidget({
  type: LOG_WIDGET_TYPE,
  title: "Log",
  description: "Ephemeral development log (entries are local-only).",
  configSchema: LogConfig,
  defaultConfig: { source: "workspace" },
  component: LogView,
  capabilities: [],
  minWidth: 280,
  minHeight: 160,
})

export const DEMO_WIDGETS = [WelcomeWidget, InspectorWidget, LogWidget] as const
