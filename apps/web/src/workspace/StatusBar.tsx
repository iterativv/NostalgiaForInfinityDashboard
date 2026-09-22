// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Tag } from "@carbon/react"
import type { PersistenceStatus } from "./store"

/**
 * StatusBar — App Shell infrastructure, NOT a widget.
 * Compact development/workspace readout: name, focus, counts, persistence.
 */

const STATUS_LABEL: Record<PersistenceStatus, string> = {
  loading: "Loading…",
  ready: "Ready",
  saving: "Saving…",
  saved: "Saved",
  error: "Persistence error",
  offline: "Offline (local only)",
}

const STATUS_TAG: Record<PersistenceStatus, "green" | "gray" | "blue" | "red" | "purple"> = {
  loading: "gray",
  ready: "gray",
  saving: "blue",
  saved: "green",
  error: "red",
  offline: "purple",
}

export function StatusBar({
  workspaceName,
  workspaceVersion,
  activePanel,
  panelCount,
  status,
  detail,
  backendAvailable,
}: {
  workspaceName: string
  workspaceVersion: number
  activePanel: string | null
  panelCount: number
  status: PersistenceStatus
  detail: string | null
  backendAvailable: boolean
}) {
  return (
    <footer className="nfi-statusbar" aria-label="Workspace status">
      <span className="nfi-statusbar-item" title="Workspace name">
        {workspaceName}
        <span className="nfi-statusbar-dim"> v{workspaceVersion}</span>
      </span>
      <span className="nfi-statusbar-separator" aria-hidden="true" />
      <span className="nfi-statusbar-item" title="Focused panel">
        active: <span className="nfi-mono">{activePanel ?? "—"}</span>
      </span>
      <span className="nfi-statusbar-item" title="Panel count">
        panels: <span className="nfi-mono">{panelCount}</span>
      </span>
      <span className="nfi-statusbar-spacer" />
      {detail && (status === "error" || status === "offline") ? (
        <span className="nfi-statusbar-item nfi-statusbar-dim" title={detail}>
          {detail.length > 80 ? `${detail.slice(0, 80)}…` : detail}
        </span>
      ) : null}
      <Tag type={backendAvailable ? "green" : "red"} size="sm" title="Backend reachability">
        {backendAvailable ? "backend" : "no backend"}
      </Tag>
      <Tag type={STATUS_TAG[status]} size="sm" title={detail ?? STATUS_LABEL[status]}>
        {STATUS_LABEL[status]}
      </Tag>
    </footer>
  )
}
