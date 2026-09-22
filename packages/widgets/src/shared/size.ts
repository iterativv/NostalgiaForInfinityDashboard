// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Cell-size hooks — the responsive contract between a widget and the cell
 * hosting it. The Panel measures the panel body and publishes it through
 * `WidgetChromeContext`; widgets switch between dense and full presentations
 * so every size the grid layouter can produce stays readable.
 *
 * 0×0 means "not measured yet" (hidden tab / first paint): callers keep the
 * full presentation rather than guessing compact.
 */

import { useContext } from "react";
import { WidgetChromeContext } from "@nfi/ui";

/** Panel body border-box size (0×0 while hidden or before first measure). */
export function useContentSize(): { width: number; height: number } {
  return useContext(WidgetChromeContext).contentSize;
}

/**
 * True once the cell is measured below `thresholdPx` tall — the compact
 * presentation kicks in and the full layout (stat rows above charts, donuts)
 * gives way to the part that still reads at that size.
 */
export function useCompactMode(thresholdPx: number): boolean {
  const { height } = useContentSize();
  return height > 0 && height < thresholdPx;
}
