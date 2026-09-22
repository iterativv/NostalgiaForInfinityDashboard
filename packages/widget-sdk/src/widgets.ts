// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { ComponentType } from "react"
import { Schema } from "effect"
import type { Capability, PanelId } from "@nfi/api-contract"

/**
 * Canonical widget abstraction.
 *
 * A widget definition binds a stable `type` (e.g. `development.inspector`)
 * to a typed config schema and a React implementation. Widget *types* and
 * widget *instances* are different things: many panels may host the same
 * type with different configs — widgets are never singletons.
 *
 * This module is intentionally free of Carbon/DOM imports: the shell
 * resolves `type -> definition -> component` through `WidgetRegistry` and
 * renders with React + Carbon. A future plugin only calls
 * `registerWidget` — the renderer never changes.
 */

export interface WidgetProps<Config> {
  /** Panel hosting this instance (focus identity, commands, status bar). */
  readonly panelId: PanelId
  /** Config decoded through `configSchema` — always valid when rendered. */
  readonly config: Config
  /** Whether this panel currently holds workspace focus. */
  readonly focused: boolean
}

export interface WidgetDefinition<Type extends string, Config> {
  /** Stable identifier persisted in workspace state. Never rename once shipped. */
  readonly type: Type
  readonly title: string
  readonly description: string
  /** Single source of truth for config validation AND the TypeScript type. */
  readonly configSchema: Schema.Schema<Config, any>
  /** Default config for freshly opened instances. Must satisfy `configSchema`. */
  readonly defaultConfig: Config
  readonly component: ComponentType<WidgetProps<Config>>
  /**
   * Backend capabilities this widget needs to function (hard-coded ids from
   * `@nfi/api-contract`, one function per id — unknown ids are a compile
   * error). A user missing any entry cannot enable the widget: registry
   * listings, palette/sidebar and `Panel` all enforce the same
   * `canEnableWidget` check. Defaults to `[]` (no backend access).
   */
  readonly capabilities?: ReadonlyArray<Capability>
  /**
   * Minimum readable width in px for responsive layouting. Splits derive
   * their drag minimums from these hints and stack vertically when the
   * container cannot fit both sides. Defaults to 280.
   */
  readonly minWidth?: number
  /**
   * Minimum readable height in px. The hosting panel measures its cell and
   * swaps the widget for a standardized "too small" warning state well
   * below this size (declare the floor where content truly breaks, not the
   * ideal size — normal preset rows must never trigger the warning).
   * Defaults to 160.
   */
  readonly minHeight?: number
  /**
   * True when this widget owns a settings form (opened from the tab strip
   * / panel header gear via the shared settings bus). The shell shows the
   * gear only for flagged widgets; content must not render its own.
   * Defaults to false.
   */
  readonly hasSettings?: boolean
}

/**
 * Type-erased definition stored in the registry. Created only through
 * `defineWidget`, which wraps config decoding so renderers deal with plain
 * `unknown` plus one explicit failure mode (invalid config -> placeholder).
 */
export interface AnyWidgetDefinition {
  readonly type: string
  readonly title: string
  readonly description: string
  readonly defaultConfig: unknown
  /** Throws on invalid input; the Panel boundary converts this to UI. */
  readonly decodeConfig: (input: unknown) => unknown
  readonly component: ComponentType<WidgetProps<unknown>>
  /** Backend capabilities required to enable this widget (empty = public). */
  readonly capabilities: ReadonlyArray<Capability>
  /** Minimum readable width in px (responsive layout hint). */
  readonly minWidth: number
  /** Minimum readable height in px (too-small warning hint). */
  readonly minHeight: number
  /** True when the shell should offer a tab/panel settings gear. */
  readonly hasSettings: boolean
}

export function defineWidget<Type extends string, Config>(
  definition: WidgetDefinition<Type, Config>,
): AnyWidgetDefinition {
  const decodeSync = Schema.decodeUnknownSync(definition.configSchema)
  const capabilities = [...(definition.capabilities ?? [])]
  return {
    type: definition.type,
    title: definition.title,
    description: definition.description,
    defaultConfig: definition.defaultConfig,
    decodeConfig: (input: unknown) => decodeSync(input),
    component: definition.component as unknown as ComponentType<WidgetProps<unknown>>,
    capabilities,
    minWidth: definition.minWidth ?? 280,
    minHeight: definition.minHeight ?? 160,
    hasSettings: definition.hasSettings ?? false,
  }
}

export interface WidgetRegistry {
  /** Idempotent: re-registering the same type replaces the previous entry. */
  readonly registerWidget: (definition: AnyWidgetDefinition) => void
  readonly getWidget: (type: string) => AnyWidgetDefinition | undefined
  readonly listWidgets: () => ReadonlyArray<AnyWidgetDefinition>
}

export function createWidgetRegistry(initial: ReadonlyArray<AnyWidgetDefinition> = []): WidgetRegistry {
  const entries = new Map<string, AnyWidgetDefinition>()
  for (const definition of initial) {
    entries.set(definition.type, definition)
  }
  return {
    registerWidget: (definition) => {
      entries.set(definition.type, definition)
    },
    getWidget: (type) => entries.get(type),
    listWidgets: () => [...entries.values()],
  }
}
