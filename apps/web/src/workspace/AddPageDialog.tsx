// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useMemo, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { Button, TextInput } from "@carbon/react";
import { PAGE_ICON_KEYS, PRESET_PAGES, type PageIconKey } from "./pages";
import { PageIconView } from "./pageIcons";
import { addPresetPage, createCustomPage, workspaceStore } from "./store";

/**
 * Add-page dialog — the "+" action of the pages bar.
 *
 * Two ways to grow the pages bar:
 *
 * - Preset pages: the curated read-only dashboards (Overview, Trading,
 *   Markets, …). Adding one stores its built workspace in the backend
 *   (`origin: "user"`), so it persists until deleted; already-added
 *   presets are not offered again.
 * - Custom page: a blank, fully editable page with a name and an optional
 *   pages-bar icon.
 */

export function AddPageDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  /** Called after a page was added (off-terminal hosts navigate home). */
  onAdded?: () => void;
}) {
  const pages = useStore(workspaceStore, (s) => s.pages);
  const addedIds = useMemo(() => new Set(pages.map((p) => p.id)), [pages]);
  const availablePresets = useMemo(
    () => PRESET_PAGES.filter((p) => !addedIds.has(p.id)),
    [addedIds],
  );

  const [name, setName] = useState("");
  const [icon, setIcon] = useState<PageIconKey | undefined>(undefined);
  const trimmed = name.trim();

  const addPreset = (presetId: string) => {
    void addPresetPage(presetId).then((added) => {
      if (!added) return;
      onAdded?.();
      onClose();
    });
  };

  const createCustom = () => {
    if (trimmed.length === 0) return;
    void createCustomPage(name, icon).then(() => {
      onAdded?.();
      onClose();
    });
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
            <p>Start from a curated preset, or build your own page.</p>
          </div>
          <Button kind="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <h3 className="nfi-layouts-section">Preset pages</h3>
        {availablePresets.length === 0 ? (
          <p className="nfi-addpage-note">
            Every preset page is already added — delete one to re-add it, or
            create a custom page below.
          </p>
        ) : (
          <div className="nfi-grid-presets">
            {availablePresets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="nfi-grid-card nfi-addpage-card"
                title={preset.description}
                onClick={() => addPreset(preset.id)}
              >
                <PageIconView iconKey={preset.icon} size={18} />
                <strong>{preset.title}</strong>
                <span>{preset.description}</span>
              </button>
            ))}
          </div>
        )}
        <h3 className="nfi-layouts-section">Custom page</h3>
        <div className="nfi-addpage-custom">
          <TextInput
            id="nfi-addpage-name"
            labelText="Page name"
            placeholder="My page"
            value={name}
            onChange={(event) => setName(event.target.value)}
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
                aria-checked={icon === undefined}
                className="nfi-addpage-icon"
                title="No icon"
                onClick={() => setIcon(undefined)}
              >
                <span className="nfi-addpage-none">None</span>
              </button>
              {PAGE_ICON_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={icon === key}
                  className="nfi-addpage-icon"
                  title={key}
                  onClick={() => setIcon(key)}
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
