// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useEffect, useState } from "react";
import type { GridShape } from "./layouts";

/**
 * GridPreview — miniature visualization of a grid shape.
 *
 * The miniature keeps the user's viewport aspect ratio (width × height from
 * `window`, live-updated on resize) and renders the exact template — track
 * fractions and spanning cells — as a CSS grid, so each preview reads as
 * "this shape on my screen".
 */

export function useViewportSize(): { width: number; height: number } {
  const [size, setSize] = useState(() =>
    typeof window === "undefined"
      ? { width: 1440, height: 900 }
      : { width: window.innerWidth, height: window.innerHeight },
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const update = () =>
      setSize({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return size;
}

export function GridPreview({
  shape,
  height,
}: {
  shape: GridShape;
  /** Preview box height in px (width stretches to fill the card). */
  height: number;
}) {
  return (
    <div
      aria-hidden="true"
      className="nfi-grid-preview"
      style={{
        height,
        display: "grid",
        gap: 2,
        gridTemplateColumns: shape.columns.map((f) => `${f}fr`).join(" "),
        gridTemplateRows: shape.rows.map((f) => `${f}fr`).join(" "),
      }}
    >
      {shape.cells.map((cell, index) => (
        <div
          key={index}
          className="nfi-grid-cell"
          style={{
            gridColumn: `${cell.col} / span ${cell.colSpan ?? 1}`,
            gridRow: `${cell.row} / span ${cell.rowSpan ?? 1}`,
          }}
        />
      ))}
    </div>
  );
}
