// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { ReactNode } from "react";
import { useStore } from "@tanstack/react-store";
import { useElementStore, useLocalStore, useStoreEffect } from "@nfi/ui";

/**
 * ChartBox — height-adaptive chart container.
 *
 * Measures itself with a ResizeObserver and renders `children(height)` so
 * Carbon charts can be given `height: ${height}px` for the space they
 * actually have: dense grid cells never clip a fixed-height chart again.
 * Grows to fill leftover panel space (`flex: 1 1 auto`) but never shrinks
 * below `min` px. Width is always 100% with `min-width: 0` so charts shrink
 * inside slim grid cells instead of forcing horizontal overflow — embedded
 * chart libraries size themselves from the parent width.
 */
export function ChartBox({
  min = 160,
  children,
}: {
  /** Minimum rendered height in px (charts below this stay min-sized). */
  min?: number;
  children: (height: number) => ReactNode;
}) {
  const { store: elStore, setElement } = useElementStore<HTMLDivElement>();
  const el = useStore(elStore, (s) => s);
  const heightStore = useLocalStore(min);
  const height = useStore(heightStore, (s) => s);

  useStoreEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.height ?? 0);

      // Store writes with equal values are identity-compare no-ops, so the
      // old manual prev bailout is unnecessary.
      if (next > 0) heightStore.setState(() => Math.max(min, next));
    });

    observer.observe(el);
    heightStore.setState(() =>
      Math.max(min, Math.floor(el.getBoundingClientRect().height)),
    );

    return () => observer.disconnect();
  }, [el, min]);

  return (
    <div
      ref={setElement}
      style={{
        flex: "1 1 auto",
        minHeight: min,
        minWidth: 0,
        width: "100%",
        maxWidth: "100%",
        display: "flex",
        overflow: "hidden",
      }}
    >
      {children(height)}
    </div>
  );
}
