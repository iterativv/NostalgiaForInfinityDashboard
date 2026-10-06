// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
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
 * renders its config form here instead: a Carbon `Modal` portalled into
 * the Carbon Theme subtree, so it escapes grid/panel `overflow` clipping
 * (panel bodies scroll with `overflow-y: auto` + `overflow-x: hidden`, and
 * grid cells clip with `overflow: hidden` — an inline modal would be cut
 * off inside the cell) while still resolving the user's theme tokens. Open
 * via the widget's ⚙ button; close via X / Escape / backdrop click.
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

  if (typeof document === "undefined") return null;

  // Portal into the Carbon Theme subtree (the `cds--white/g10/g90/g100`
  // wrapper in the web shell) so the dialog resolves the user's theme
  // tokens — `document.body` and `#root` both sit OUTSIDE the theme scope
  // (the Theme element renders inside #root) and would paint the
  // light/default palette on a dark terminal. Still far above every
  // grid/panel overflow-clipping ancestor, so the dialog never clips.
  // When the theme scope cannot be found (tests, harness), render inline
  // so the dialog at least inherits the surrounding theme.
  const host =
    document.querySelector(
      "#root .cds--g100, #root .cds--g90, #root .cds--g10, #root .cds--white",
    ) ??
    document.querySelector(".cds--g100, .cds--g90, .cds--g10, .cds--white") ??
    null;

  const dialog = (
    <Modal
      open
      passiveModal
      size="sm"
      modalHeading={title}
      onRequestClose={onClose}
      className="nfi-widget-settings-dialog"
      hasScrollingContent
    >
      <div className="nfi-widget-settings">
        {widgetType ? (
          <SettingsScopeControl widgetType={widgetType} title={title} />
        ) : null}
        {children}
      </div>
    </Modal>
  );

  // No theme scope (tests, harness): render inline so the dialog inherits
  // whatever theme surrounds it instead of escaping to an unthemed body.
  if (!host) return dialog;

  return createPortal(dialog, host);
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
        onChange={(id) =>
          // SAFETY: the only ids rendered above are "tab" and "global" —
          // exactly the WidgetSettingsScope union.
          setWidgetSettingsScope(id as WidgetSettingsScope)
        }
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
