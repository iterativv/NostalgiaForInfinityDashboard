// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { ReactNode } from "react";
import { useStore } from "@tanstack/react-store";
import { Button, Modal } from "@carbon/react";
import { clearWidgetGlobalSettings, widgetGlobalsStore } from "./widgetGlobals";
import { SettingsSelect } from "./SettingsSelect";
import {
  setWidgetSettingsScope,
  useWidgetSettingsScope,
  type WidgetSettingsScope,
} from "./widgetSettingsBus";

/**
 * WidgetSettingsModal — popup settings form shared by every widget.
 *
 * Inline settings break on tiny grids (no room to edit), so every widget
 * renders its config form here instead: a Carbon `Modal` (portal to `body`,
 * so it escapes grid `overflow` clipping) with live-persisted controls.
 * Open via the widget's ⚙ button; close via X / Escape / backdrop click.
 *
 * Scope control: when `widgetType` is passed, the modal offers the two
 * settings scopes — "This tab" writes the panel's own config; "All
 * widgets" records changes as the widget TYPE's global overrides (applied
 * to every instance across pages/grids/floating windows, see
 * `widgetGlobals`) and offers a one-click reset back to per-tab values.
 */
export function WidgetSettingsModal({
  open,
  title,
  onClose,
  widgetType,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  /**
   * The widget definition's type id — enables the scope control. Omit for
   * forms that must stay strictly per-tab.
   */
  widgetType?: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <Modal
      open
      passiveModal
      size="sm"
      modalHeading={title}
      onRequestClose={onClose}
    >
      <div className="nfi-widget-settings">
        {widgetType ? (
          <SettingsScopeControl widgetType={widgetType} title={title} />
        ) : null}
        {children}
      </div>
    </Modal>
  );
}

function SettingsScopeControl({
  widgetType,
  title,
}: {
  widgetType: string;
  title: string;
}) {
  const scope = useWidgetSettingsScope();
  const hasGlobals = useStore(
    widgetGlobalsStore,
    (state) => Object.keys(state[widgetType] ?? {}).length > 0,
  );
  const widgetName = title.replace(/\s+settings$/i, "");
  return (
    <div className="nfi-settings-scope">
      <SettingsSelect
        id={`nfi-settings-scope-${widgetType}`}
        label="Apply changes to"
        items={[
          { id: "tab", text: "This tab" },
          { id: "global", text: "All widgets" },
        ]}
        value={scope}
        onChange={(id) => setWidgetSettingsScope(id as WidgetSettingsScope)}
      />
      {scope === "global" ? (
        <div className="nfi-settings-scope-note">
          <p>
            Saves each change as an override for every “{widgetName}” widget —
            all pages, grids and floating windows. Tabs fall back to their own
            values once cleared.
          </p>
          {hasGlobals ? (
            <Button
              size="sm"
              kind="ghost"
              onClick={() => clearWidgetGlobalSettings(widgetType)}
            >
              Reset global settings
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
