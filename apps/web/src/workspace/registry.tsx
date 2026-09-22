// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { createWidgetRegistry, type WidgetRegistry } from "@nfi/widget-sdk";
import { builtinWidgets } from "@nfi/widgets";

/**
 * Frontend widget registry: `widgetType -> definition -> React component`.
 * The WorkspaceRenderer only knows this registry — every widget definition
 * lives in the dedicated `@nfi/widgets` package, which exports them as one
 * ordered list (`builtinWidgets`). Renderer, shell and persistence code
 * never change when widgets are added there.
 */

function buildRegistry(): WidgetRegistry {
  return createWidgetRegistry([...builtinWidgets]);
}

export const widgetRegistry: WidgetRegistry = buildRegistry();
