// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Button } from "@carbon/react";
import { useStore } from "@tanstack/react-store";
import { collectPanelIds, findEnclosingGrid } from "@nfi/widget-sdk";
import { GRID_PRESETS } from "./layouts";
import { GridPreview, useViewportSize } from "./GridPreview";
import { arrangeGridPanels, isActivePagePreset, workspaceStore } from "./store";

/**
 * Layouts dialog — arrange one grid's panels into one of the grid presets
 * (each with a miniature preview scaled to the user's viewport aspect).
 *
 * Opened from the header layout button (or Ctrl/⌘ K → Layout); the id it
 * receives is a tab-strip id inside the active grid — the innermost grid
 * containing that group is rebuilt — every cell of that grid fans out while
 * the rest of the page stays untouched. Empty grids offer the same presets
 * as skeletons (blank slots ready for dropped widgets); single-widget grids
 * explain that multi-slot shapes need more widgets. Nothing is created or
 * destroyed. Preset pages own fixed, uneditable grids, so the dialog
 * explains the lock instead of offering controls. When the target vanished
 * while open (closed/moved underneath), the dialog says so instead of
 * acting on a stale id.
 */

export function LayoutsDialog({
  tabsId,
  onClose,
}: {
  tabsId: string;
  onClose: () => void;
}) {
  const locked = isActivePagePreset();
  const viewport = useViewportSize();
  const workspace = useStore(workspaceStore, (state) => state.workspace);

  const enclosing = findEnclosingGrid(workspace.layout, tabsId);
  const rootGroup =
    workspace.layout.type === "tabs" && workspace.layout.id === tabsId
      ? workspace.layout
      : undefined;
  const target = enclosing ?? rootGroup;
  const panelCount = target ? collectPanelIds(target).length : 0;

  const arrange = (id: string) => {
    if (arrangeGridPanels(tabsId, id)) onClose();
  };

  // Preview height follows the user's viewport aspect (wide screens get a
  // wide miniature), clamped so cards stay compact.
  const previewHeight = Math.min(
    132,
    Math.max(
      72,
      Math.round((168 * viewport.height) / Math.max(1, viewport.width)),
    ),
  );

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
        aria-label="Layouts"
        className="nfi-layouts"
      >
        <div className="nfi-layouts-head">
          <div>
            <h2>Layouts</h2>
            {locked ? (
              <p>
                This preset page keeps fixed grids — arrange and resize are
                disabled here.
              </p>
            ) : panelCount === 0 ? (
              <p>
                This grid is empty — pick a shape to pre-structure it, then drop
                widgets in. Page: {workspace.name}
              </p>
            ) : (
              <p>
                Rearrange the {panelCount} open widget
                {panelCount === 1 ? "" : "s"} in this grid. Page:{" "}
                {workspace.name}
              </p>
            )}
          </div>
          <Button kind="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        {locked ? (
          <p style={{ fontSize: "0.8125rem", opacity: 0.7 }}>
            Preset pages (Overview, Trading, Markets, …) keep their curated grid
            so they always read the same — use Ctrl/⌘ K → Layout on a custom
            page for full control. You can still add any non-opened widget to
            this page with the + button; your added tabs stay editable and
            closeable.
          </p>
        ) : target === undefined ? (
          <p style={{ fontSize: "0.8125rem", opacity: 0.7 }}>
            This page has no grid to arrange yet — open a widget first, then
            use the header layout button again.
          </p>
        ) : (
          <>
            <h3 className="nfi-layouts-section">Arrange current grid</h3>
            {panelCount === 1 ? (
              <p style={{ fontSize: "0.8125rem", opacity: 0.7, marginTop: 0 }}>
                One widget fills a single grid — open more widgets with + to
                fill multi-slot shapes.
              </p>
            ) : null}
            <div className="nfi-grid-presets">
              {GRID_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="nfi-grid-card"
                  title={preset.description}
                  onClick={() => arrange(preset.id)}
                >
                  <GridPreview shape={preset.shape} height={previewHeight} />
                  <strong>{preset.title}</strong>
                  <span>{preset.description}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
