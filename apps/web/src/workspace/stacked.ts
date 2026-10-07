// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useSyncExternalStore } from "react";
import { useStore } from "@tanstack/react-store";
import { workspaceStore } from "./store";

/**
 * Tetris workspace render modes.
 *
 * Two independent overrides share the natural-height render (panes exactly
 * as large as their active tab's content, the page the only scroller):
 *
 * - the page's Tetris wall mode (`Workspace.stacked`, applied via the
 *   "Tetris" presets): blocks of different widths packed into shelves
 *   (`.nfi-trellis-tetris` in styles.css) — on at any viewport width;
 * - the narrow-viewport breakpoint (`.nfi-trellis-stacked`) — below 56rem
 *   every pane is a full-width card regardless of mode, so side-by-side
 *   cells never squeeze below a widget's readable minimum.
 *
 * In both, minimum-size walls and small-screen scale-downs are meaningless
 * (a pane is exactly its content's size — see Panel), so consumers key off
 * `useStackedWorkspace`; the wall's own annotation keys off
 * `useTetrisWorkspace`.
 */

export const STACKED_MEDIA_QUERY = "(max-width: 56rem)";

const stackedMedia =
  typeof matchMedia === "undefined"
    ? undefined
    : matchMedia(STACKED_MEDIA_QUERY);

function subscribeStacked(callback: () => void): () => void {
  stackedMedia?.addEventListener("change", callback);

  return () => stackedMedia?.removeEventListener("change", callback);
}

function useNarrowViewport(): boolean {
  return useSyncExternalStore(
    subscribeStacked,
    () => stackedMedia?.matches ?? false,
    () => false,
  );
}

/** True when the active page renders as the Tetris wall (page mode flag). */
export function useTetrisWorkspace(): boolean {
  return useStore(
    workspaceStore,
    (state) => state.workspace.stacked === true,
  );
}

/**
 * True when the active page renders at natural height — the Tetris wall
 * (page mode) OR a narrow viewport (render-only stacking). Consumers that
 * only care "is a pane exactly its content's size" (Panel's too-small
 * guard) read this one.
 */
export function useStackedWorkspace(): boolean {
  const pageTetris = useTetrisWorkspace();
  const narrow = useNarrowViewport();

  return pageTetris || narrow;
}

/** Narrow-viewport class only — the wall mode has its own root class. */
export function useWorkspaceModeClass(): string {
  const pageTetris = useTetrisWorkspace();
  const narrow = useNarrowViewport();

  if (pageTetris) return "nfi-trellis nfi-trellis-tetris";

  return narrow ? "nfi-trellis nfi-trellis-stacked" : "nfi-trellis";
}
