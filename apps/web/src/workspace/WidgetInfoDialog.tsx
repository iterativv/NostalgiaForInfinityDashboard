// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { AnyWidgetDefinition } from "@nfi/widget-sdk"
import {
  capabilityExposes,
  isCapabilitySensitive,
  isNonSensitiveCapabilities,
} from "@nfi/capabilities"
import { Modal, Tag } from "@carbon/react"
import { INFO_KIND_META, useSensitivity } from "../capabilities/sensitivity"

/**
 * WidgetInfoDialog — the "Information" action from a widget's ⋯ menu.
 *
 * Everything the shell knows about the hosted widget: description, wire
 * type, required capabilities, minimum size, refresh model and the
 * instance's current (decoded) configuration. Read-only reference card —
 * settings stay in the Settings action.
 */

function configValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "yes" : "no"
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—"
  if (typeof value === "string") return value.length > 0 ? value : "—"
  if (value === null || value === undefined) return "—"
  try {
    return JSON.stringify(value)
  } catch {
    return "—"
  }
}

const FIELD_LABELS: Record<string, string> = {
  instanceId: "Instance",
  pair: "Pair",
  timeframe: "Timeframe",
  limit: "Row limit",
}

function fieldLabel(key: string): string {
  // CamelCase -> "Camel case", then apply known friendlier labels.
  if (FIELD_LABELS[key]) return FIELD_LABELS[key]
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase()
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="nfi-widget-info-row">
      <span className="nfi-widget-info-label">{label}</span>
      <span className="nfi-widget-info-value">{children}</span>
    </div>
  )
}

export function WidgetInfoDialog({
  definition,
  config,
  panelId,
  onClose,
}: {
  definition: AnyWidgetDefinition
  config: unknown
  panelId: string
  onClose: () => void
}) {
  // Live criteria: the root user configures which information kinds are
  // sensitive, so widget marks follow the current settings, not a
  // hard-coded classification.
  const { sensitiveKinds } = useSensitivity()
  const nonSensitive = isNonSensitiveCapabilities(definition.capabilities, sensitiveKinds)
  const configEntries = Object.entries(
    (config ?? {}) as Record<string, unknown>,
  ).filter(([, value]) => value !== undefined)
  return (
    <Modal
      open
      passiveModal
      size="md"
      modalHeading={`About ${definition.title}`}
      onRequestClose={onClose}
      className="nfi-widget-info"
    >
      <div className="nfi-widget-info-body">
        <p className="nfi-widget-info-description">{definition.description}</p>

        <div className="nfi-widget-info-section">Details</div>
        <Row label="Widget type">
          <code className="nfi-tab-code">{definition.type}</code>
        </Row>
        <Row label="Panel id">
          <code className="nfi-tab-code">{panelId}</code>
        </Row>
        <Row label="Refresh">
          {definition.capabilities.length > 0
            ? "Live — server-sent events push updates as data changes"
            : "Local — computed in the browser, no backend data"}
        </Row>
        <Row label="Settings">
          {definition.hasSettings
            ? "Configurable via the ⋯ menu → Settings"
            : "No settings — works out of the box"}
        </Row>
        <Row label="Minimum size">
          {definition.minWidth}×{definition.minHeight}px
        </Row>
        <Row label="Sensitivity">
          {nonSensitive ? (
            <span className="nfi-widget-info-sub">
              Non-sensitive — every capability it uses only exposes kinds the
              root has marked non-sensitive. Nothing that can reveal
              absolute balances, absolute profit, infrastructure or other
              private data under the current criteria.
            </span>
          ) : (
            <span className="nfi-widget-info-sub">
              Sensitive — at least one capability it uses exposes a kind the
              root has marked sensitive (absolute amounts, infrastructure,
              user data…). Keep off shared screens.
            </span>
          )}
        </Row>

        <div className="nfi-widget-info-section">Required capabilities</div>
        {definition.capabilities.length > 0 ? (
          <>
            <div className="nfi-widget-info-tags">
              {definition.capabilities.map((capability) => {
                const sensitive = isCapabilitySensitive(capability, sensitiveKinds)
                const kinds = capabilityExposes(capability)
                const kindText = kinds
                  .map((kind) => INFO_KIND_META[kind]?.label ?? kind)
                  .join(", ")
                return (
                  <Tag
                    key={capability}
                    type={sensitive ? "red" : "green"}
                    size="sm"
                    title={`Exposes: ${kindText}${
                      sensitive ? " — sensitive under the current criteria" : " — non-sensitive under the current criteria"
                    }`}
                  >
                    {capability}
                  </Tag>
                )
              })}
            </div>
            <p className="nfi-widget-info-none">
              Green tags expose only kinds the root marked non-sensitive;
              red tags expose at least one sensitive kind. The root adjusts
              the criteria on the Manage users page.
            </p>
          </>
        ) : (
          <p className="nfi-widget-info-none">
            None — the widget runs entirely in the browser with no backend
            data.
          </p>
        )}

        {configEntries.length > 0 ? (
          <>
            <div className="nfi-widget-info-section">Current configuration</div>
            <div className="nfi-widget-info-config">
              {configEntries.map(([key, value]) => (
                <Row key={key} label={fieldLabel(key)}>
                  {configValue(value)}
                </Row>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  )
}
