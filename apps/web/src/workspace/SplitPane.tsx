// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { ReactNode } from "react";
import type { SplitDirection } from "@nfi/api-contract";
import {
  MAX_SPLIT_RATIO,
  MIN_SPLIT_RATIO,
  clampRatioForMinWidths,
  effectiveSplitDirection,
} from "@nfi/widget-sdk";
import {
  useElementStore,
  useLocalStore,
  useStore,
  useStoreEffect,
} from "@nfi/ui";

/**
 * SplitPane — workspace infrastructure (NOT a widget).
 *
 * Renders one `split` layout node: two children with a draggable divider.
 * `direction: "horizontal"` places children side-by-side (row);
 * `"vertical"` stacks them (column). During a drag the live ratio is
 * written straight to the children's inline `flexGrow` (rAF-coalesced) and
 * the store is committed once on release — a per-event `onRatioChange`
 * would re-render the whole workspace tree at pointer frequency.
 *
 * Responsive behavior (smart layouting):
 * - Each side declares its minimum readable width (`minFirst`/`minSecond`,
 *   derived from the widgets it contains). Drag clamps respect those
 *   minimums so a table pane cannot be squeezed into illegibility.
 * - When the container cannot fit both minimums side-by-side, a persisted
 *   `horizontal` split automatically stacks vertically (render-only — the
 *   persisted `direction` and `ratio` are untouched, so widening the window
 *   restores side-by-side). `vertical` splits never stack-switch.
 */

export function SplitPane({
  splitId,
  direction,
  ratio,
  onRatioChange,
  first,
  second,
  minFirst = 280,
  minSecond = 280,
  locked = false,
}: {
  splitId: string;
  direction: SplitDirection;
  ratio: number;
  onRatioChange: (splitId: string, ratio: number) => void;
  first: ReactNode;
  second: ReactNode;
  /** Minimum readable width (px) of the first/second subtree. */
  minFirst?: number;
  minSecond?: number;
  /** True on non-editable (preset) pages: divider is fixed, no drag/resize. */
  locked?: boolean;
}) {
  const { store: containerEl, setElement: setContainerEl } =
    useElementStore<HTMLDivElement>();

  const { store: firstEl, setElement: setFirstEl } =
    useElementStore<HTMLDivElement>();

  const { store: secondEl, setElement: setSecondEl } =
    useElementStore<HTMLDivElement>();

  const widthStore = useLocalStore(0);
  const containerWidth = useStore(widthStore, (s) => s);

  useStoreEffect(() => {
    const el = containerEl.state;

    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      widthStore.setState(() => width);
    });

    observer.observe(el);
    widthStore.setState(() => el.getBoundingClientRect().width);

    return () => observer.disconnect();
  }, []);

  const effective = effectiveSplitDirection(
    direction,
    containerWidth,
    minFirst,
    minSecond,
  );

  const horizontal = effective === "horizontal";
  const stacked = direction === "horizontal" && effective === "vertical";

  const ratioFromClient = (clientX: number, clientY: number): number | null => {
    const el = containerEl.state;

    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const size = horizontal ? rect.width : rect.height;

    if (size <= 0) return null;
    const pos = horizontal ? clientX - rect.left : clientY - rect.top;
    const raw = pos / size;

    if (horizontal) {
      const width = rect.width;

      return clampRatioForMinWidths(
        raw,
        width,
        minFirst,
        minSecond,
        MIN_SPLIT_RATIO,
        MAX_SPLIT_RATIO,
      );
    }

    // Vertical drags keep the global ratio bounds (heights vary freely).
    return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, raw));
  };

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (locked) return;
    event.preventDefault();
    const divider = event.currentTarget;
    divider.setPointerCapture(event.pointerId);
    const firstChild = firstEl.state;
    const secondChild = secondEl.state;

    // Zero-commit drag: live flexGrow on the two children (rAF-coalesced),
    // one store commit on release. A per-event onRatioChange is a
    // workspace commit — a full workspace-tree render per pointermove.
    let raf = 0;
    let pending: number | null = null;
    let applied: number | null = null;

    const applyRatio = (value: number): void => {
      applied = value;

      if (firstChild) firstChild.style.flexGrow = `${value}`;

      if (secondChild) secondChild.style.flexGrow = `${1 - value}`;
    };

    const flush = () => {
      raf = 0;

      if (pending !== null) {
        applyRatio(pending);
        pending = null;
      }
    };

    const move = (moveEvent: PointerEvent) => {
      const next = ratioFromClient(moveEvent.clientX, moveEvent.clientY);

      if (next === null) return;
      pending = next;

      if (raf === 0) raf = window.requestAnimationFrame(flush);
    };

    const finish = (commit: boolean) => {
      if (raf !== 0) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }

      // Freshest position wins: pending (not yet painted) beats applied.
      const finalRatio = pending !== null ? pending : applied;
      pending = null;
      applied = null;

      if (finalRatio !== null) {
        if (commit) {
          // Land exactly at the release point, then persist once (the
          // re-render reapplies the same flexGrow).
          applyRatio(finalRatio);
          onRatioChange(splitId, finalRatio);
        } else {
          applyRatio(ratio);
        }
      }

      // SAFETY: `move` handles PointerEvent; the Element/Window listener
      // signature union collapses handlers to EventListener.
      divider.removeEventListener("pointermove", move as EventListener);
    };

    const up = () => finish(true);

    const cancel = () => finish(false);

    // SAFETY: `move` handles PointerEvent; the Element/Window listener
    // signature union collapses handlers to EventListener.
    divider.addEventListener("pointermove", move as EventListener);
    divider.addEventListener("pointerup", up, { once: true });
    divider.addEventListener("pointercancel", cancel, { once: true });
  };

  const clamped = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));

  return (
    <div
      ref={setContainerEl}
      className={
        horizontal
          ? "nfi-split nfi-split-horizontal"
          : `nfi-split nfi-split-vertical${stacked ? " nfi-split-stacked" : ""}`
      }
      data-stacked={stacked ? "true" : "false"}
    >
      <div
        ref={setFirstEl}
        className="nfi-split-child"
        style={
          stacked
            ? { flexBasis: "auto" }
            : {
                flexGrow: clamped,
                flexBasis: 0,
                minWidth: horizontal ? Math.min(minFirst, 280) : undefined,
              }
        }
      >
        {first}
      </div>
      <div
        role="separator"
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-label={
          locked
            ? "Split (fixed on this page)"
            : stacked
              ? "Resize split (stacked for narrow width)"
              : "Resize split"
        }
        aria-valuenow={Math.round(clamped * 100)}
        aria-valuemin={10}
        aria-valuemax={90}
        aria-disabled={locked ? true : undefined}
        tabIndex={locked ? -1 : 0}
        className={
          locked
            ? "nfi-split-divider nfi-split-divider-locked"
            : "nfi-split-divider"
        }
        onPointerDown={locked ? undefined : beginDrag}
        onKeyDown={(event) => {
          if (locked) return;

          if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
            event.preventDefault();
            onRatioChange(splitId, clamped - 0.05);
          } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            onRatioChange(splitId, clamped + 0.05);
          }
        }}
      />
      <div
        ref={setSecondEl}
        className="nfi-split-child"
        style={
          stacked
            ? { flexBasis: "auto" }
            : {
                flexGrow: 1 - clamped,
                flexBasis: 0,
                minWidth: horizontal ? Math.min(minSecond, 280) : undefined,
              }
        }
      >
        {second}
      </div>
    </div>
  );
}
