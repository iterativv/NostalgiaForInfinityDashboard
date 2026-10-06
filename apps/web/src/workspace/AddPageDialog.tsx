// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useStore } from "@tanstack/react-store";
import { Button, TextInput } from "@carbon/react";
import { Add } from "@carbon/icons-react";
import { useLocalStore } from "@nfi/ui";
import { PAGE_ICON_KEYS, PRESET_PAGES, type PageIconKey } from "./pages";
import { PageIconView } from "./pageIcons";
import { createCustomPage, createPresetPage } from "./store";

/**
 * Add-page dialog — the "+" action of the pages bar.
 *
 * Preset dashboards first (curated bento layouts for common pro
 * trader/investor workflows — fully editable once added, Reset restores
 * the canonical layout), then a blank fully-editable custom page with a
 * name and an optional pages-bar icon.
 */

export function AddPageDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  /** Called after a page was added (off-terminal hosts navigate home). */
  onAdded?: () => void;
}) {
  // Custom-page draft in one component store: name + optional icon.
  interface PageDraftState {
    name: string;
    icon: PageIconKey | undefined;
  }

  const draftStore = useLocalStore<PageDraftState>({
    name: "",
    icon: undefined,
  });

  const draft = useStore(draftStore, (s) => s);
  const trimmed = draft.name.trim();

  // Optimistic close: the dialog dismisses instantly while the page builds
  // in the background — awaiting the backend round trip with the dialog
  // open is what froze the UI on preset adds (six widgets mounting their
  // live queries at once behind a modal).
  const createCustom = () => {
    if (trimmed.length === 0) return;
    const pendingName = draft.name;
    const pendingIcon = draft.icon;
    draftStore.setState((p) => ({ ...p, name: "" }));
    onAdded?.();
    onClose();
    void createCustomPage(pendingName, pendingIcon);
  };

  const addPreset = (presetId: string) => {
    onAdded?.();
    onClose();
    void createPresetPage(presetId);
  };

  return (
    <div
      className="nfi-palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add page"
        className="nfi-layouts nfi-addpage"
      >
        <div className="nfi-layouts-head">
          <div>
            <h2>Add page</h2>
            <p>Build your own bento page.</p>
          </div>
          <Button kind="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <h3 className="nfi-layouts-section">Preset pages</h3>
        <p className="nfi-addpage-note">
          Curated dashboards for professional traders and investors — fully
          editable once added.
        </p>
        <div className="nfi-addpage-presets">
          {PRESET_PAGES.map((preset) => (
            <div key={preset.id} className="nfi-addpage-preset">
              <div className="nfi-addpage-preset-head">
                <PageIconView iconKey={preset.icon} size={16} />
                <strong>{preset.title}</strong>
              </div>
              <p className="nfi-addpage-note">{preset.description}</p>
              <p className="nfi-addpage-note">
                {preset.widgets.length} widgets ·{" "}
                {preset.widgets.slice(0, 3).join(", ")}
                {preset.widgets.length > 3 ? ", …" : ""}
              </p>
              <Button
                size="sm"
                kind="tertiary"
                renderIcon={Add}
                onClick={() => addPreset(preset.id)}
              >
                Add page
              </Button>
            </div>
          ))}
        </div>
        <h3 className="nfi-layouts-section">Custom page</h3>
        <div className="nfi-addpage-custom">
          <TextInput
            id="nfi-addpage-name"
            labelText="Page name"
            placeholder="My page"
            value={draft.name}
            onChange={(event) =>
              draftStore.setState((p) => ({ ...p, name: event.target.value }))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && trimmed.length > 0) {
                event.preventDefault();
                createCustom();
              }
            }}
            autoFocus
          />
          <div className="nfi-addpage-field">
            <span className="nfi-addpage-label">Icon</span>
            <div
              className="nfi-addpage-icons"
              role="radiogroup"
              aria-label="Page icon"
            >
              <button
                type="button"
                role="radio"
                aria-checked={draft.icon === undefined}
                className="nfi-addpage-icon"
                title="No icon"
                onClick={() =>
                  draftStore.setState((p) => ({ ...p, icon: undefined }))
                }
              >
                <span className="nfi-addpage-none">None</span>
              </button>
              {PAGE_ICON_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={draft.icon === key}
                  className="nfi-addpage-icon"
                  title={key}
                  onClick={() =>
                    draftStore.setState((p) => ({ ...p, icon: key }))
                  }
                >
                  <PageIconView iconKey={key} size={16} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <Button
              size="sm"
              disabled={trimmed.length === 0}
              onClick={createCustom}
            >
              Create page
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Change-page-icon dialog — the "Change icon" action of the page actions
 * menu. Works for every page kind: custom pages store the pick directly,
 * Home stores an override (cleared = house glyph), preset pages store an
 * override (cleared = built-in preset icon).
 */
export function ChangePageIconDialog({
  pageName,
  currentIcon,
  defaultLabel,
  onPick,
  onClose,
}: {
  pageName: string;
  /** Currently effective icon (override or built-in); undefined = default look. */
  currentIcon: PageIconKey | undefined;
  /** Caption for the "cleared" choice (e.g. "House (default)" on Home). */
  defaultLabel: string;
  onPick: (icon: PageIconKey | undefined) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="nfi-palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Change icon for ${pageName}`}
        className="nfi-layouts nfi-addpage"
      >
        <div className="nfi-layouts-head">
          <div>
            <h2>Change icon</h2>
            <p>{pageName}</p>
          </div>
          <Button kind="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="nfi-addpage-field">
          <span className="nfi-addpage-label">Icon</span>
          <div
            className="nfi-addpage-icons"
            role="radiogroup"
            aria-label="Page icon"
          >
            <button
              type="button"
              role="radio"
              aria-checked={currentIcon === undefined}
              className="nfi-addpage-icon"
              title={defaultLabel}
              onClick={() => {
                onPick(undefined);
              }}
            >
              <span className="nfi-addpage-none">{defaultLabel}</span>
            </button>
            {PAGE_ICON_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={currentIcon === key}
                className="nfi-addpage-icon"
                title={key}
                onClick={() => {
                  onPick(key);
                }}
              >
                <PageIconView iconKey={key} size={16} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
