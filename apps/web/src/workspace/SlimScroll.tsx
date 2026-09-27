// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { ReactNode, Ref } from "react";
import {
  useElementStore,
  useLocalStore,
  useStore,
  useStoreEffect,
} from "@nfi/ui";

/**
 * SlimScroll — custom overlay scrollbars for dense workspace surfaces.
 *
 * The global CSS thin scrollbars are not enough: modern Chrome and Firefox
 * honor the standard `scrollbar-width` and ignore `::-webkit-scrollbar`, so
 * native "thin" bars still render browser-sized — far too fat for 1.44rem
 * tab strips and small grid cells. SlimScroll hides the native bar on its
 * scroller and draws its own 6px overlay thumbs, one per overflowing axis:
 * always visible while content overflows, brighter on hover, draggable with
 * pointer capture, track click jumps. The scroller itself keeps native
 * wheel/keyboard scrolling, so the region stays keyboard accessible (the
 * thumbs are decorative, aria-hidden).
 *
 * Structure:
 *
 * ```text
 * .nfi-slim (positioning context, fills its flex slot)
 *   ├─ .nfi-slim-scroller  (real scroller, native bar hidden, axis overflow)
 *   │    └─ content        (children; class via contentClassName)
 *   ├─ .nfi-slim-track-v > .nfi-slim-thumb   (when content overflows vertically)
 *   └─ .nfi-slim-track-h > .nfi-slim-thumb   (when content overflows horizontally)
 * ```
 *
 * Thumb metrics update on scroll and via a ResizeObserver on both the
 * scroller and the content wrapper — content growth without a scroll event
 * (e.g. a tab appended to the strip) still resizes the thumb.
 */

type SlimAxis = "x" | "y" | "both";

interface SlimMetrics {
  vertical: boolean;
  horizontal: boolean;
  /** Thumb length as a fraction of the track (0–1). */
  vSize: number;
  hSize: number;
  /** Thumb offset as a fraction of the track (0–1 − size). */
  vPos: number;
  hPos: number;
}

const IDLE_METRICS: SlimMetrics = {
  vertical: false,
  horizontal: false,
  vSize: 1,
  hSize: 1,
  vPos: 0,
  hPos: 0,
};

export function SlimScroll({
  axis = "both",
  className,
  scrollerClassName,
  contentClassName,
  scrollerRef,
  children,
}: {
  axis?: SlimAxis;
  /** Extra classes for the outer positioning box (flex sizing lives here). */
  className?: string;
  /** Class for the real scroller (e.g. `nfi-panel-body`). */
  scrollerClassName?: string;
  /** Class for the content wrapper (e.g. `nfi-tabstrip`); default is plain flow. */
  contentClassName?: string;
  /** Ref to the real scroller (callers measure it, e.g. Panel's too-small guard). */
  scrollerRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const { store: scrollerEl, setElement: setInnerEl } =
    useElementStore<HTMLDivElement>();

  const { store: contentEl, setElement: setContentEl } =
    useElementStore<HTMLDivElement>();

  // Scrollbar metrics + active thumb drag in one component store. The
  // equality guard below keeps per-frame scroll/resize events no-ops.
  interface SlimScrollState {
    metrics: SlimMetrics;
    dragging: "v" | "h" | null;
  }

  const slimStore = useLocalStore<SlimScrollState>({
    metrics: IDLE_METRICS,
    dragging: null,
  });

  const slim = useStore(slimStore, (s) => s);
  const metrics = slim.metrics;

  const setScroller = (el: HTMLDivElement | null) => {
    setInnerEl(el);

    if (scrollerRef instanceof Function) scrollerRef(el);
    else if (scrollerRef) scrollerRef.current = el;
  };

  const update = () => {
    const el = scrollerEl.state;

    if (!el) return;
    const vertical = el.scrollHeight > el.clientHeight + 1;
    const horizontal = el.scrollWidth > el.clientWidth + 1;

    const next: SlimMetrics = {
      vertical,
      horizontal,
      vSize: vertical ? el.clientHeight / el.scrollHeight : 1,
      hSize: horizontal ? el.clientWidth / el.scrollWidth : 1,
      vPos: vertical ? el.scrollTop / el.scrollHeight : 0,
      hPos: horizontal ? el.scrollLeft / el.scrollWidth : 0,
    };

    // Equality guard: scroll/resize fire per frame — a fresh object
    // identity would re-render the scroller subtree every time (returning
    // the same state object is an identity no-op on the store).
    slimStore.setState((prev) =>
      prev.metrics.vertical === next.vertical &&
      prev.metrics.horizontal === next.horizontal &&
      Math.abs(prev.metrics.vSize - next.vSize) < 1e-4 &&
      Math.abs(prev.metrics.hSize - next.hSize) < 1e-4 &&
      Math.abs(prev.metrics.vPos - next.vPos) < 1e-4 &&
      Math.abs(prev.metrics.hPos - next.hPos) < 1e-4
        ? prev
        : { ...prev, metrics: next },
    );
  };

  // Deps []: `update` is a plain per-render function reading per-instance
  // element stores, so wiring the observer once on mount is the whole
  // dependency story.
  useStoreEffect(() => {
    const el = scrollerEl.state;

    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);

    if (contentEl.state) observer.observe(contentEl.state);
    update();

    return () => observer.disconnect();
  }, []);

  /** Drag a thumb: pointer position maps 1:1 onto scroll offset (scaled). */
  const beginThumbDrag =
    (kind: "v" | "h") => (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const el = scrollerEl.state;
      const track = event.currentTarget.parentElement;

      if (!el || !track) return;
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      slimStore.setState((prev) => ({ ...prev, dragging: kind }));
      const vertical = kind === "v";

      const trackPx = vertical
        ? track.getBoundingClientRect().height
        : track.getBoundingClientRect().width;

      const startPointer = vertical ? event.clientY : event.clientX;
      const startScroll = vertical ? el.scrollTop : el.scrollLeft;
      const scrollPx = vertical ? el.scrollHeight : el.scrollWidth;
      const contentPerTrack = trackPx > 0 ? scrollPx / trackPx : 0;

      const move = (moveEvent: PointerEvent) => {
        const delta =
          (vertical ? moveEvent.clientY : moveEvent.clientX) - startPointer;

        const next = startScroll + delta * contentPerTrack;

        if (vertical) el.scrollTop = next;
        else el.scrollLeft = next;
      };

      const up = () => {
        // SAFETY: `move` handles PointerEvent; the Element/Window listener
        // signature union collapses handlers to EventListener.
        handle.removeEventListener("pointermove", move as EventListener);
        slimStore.setState((prev) => ({ ...prev, dragging: null }));
      };

      // SAFETY: `move` handles PointerEvent; the Element/Window listener
      // signature union collapses handlers to EventListener.
      handle.addEventListener("pointermove", move as EventListener);
      handle.addEventListener("pointerup", up, { once: true });
      handle.addEventListener("pointercancel", up, { once: true });
    };

  /** Track click: jump so the thumb centers under the pointer. */
  const jumpTrack =
    (kind: "v" | "h") => (event: React.PointerEvent<HTMLDivElement>) => {
      const el = scrollerEl.state;

      if (!el) return;
      const vertical = kind === "v";
      const track = event.currentTarget;
      const rect = track.getBoundingClientRect();
      const trackPx = vertical ? rect.height : rect.width;

      if (trackPx <= 0) return;

      const fraction =
        ((vertical ? event.clientY : event.clientX) -
          (vertical ? rect.top : rect.left)) /
        trackPx;

      const size = vertical ? metrics.vSize : metrics.hSize;
      const pos = Math.min(1 - size, Math.max(0, fraction - size / 2));
      const scrollPx = vertical ? el.scrollHeight : el.scrollWidth;

      if (vertical) el.scrollTop = pos * scrollPx;
      else el.scrollLeft = pos * scrollPx;
    };

  return (
    <div
      className={className ? `nfi-slim ${className}` : "nfi-slim"}
      data-dragging={slim.dragging ?? undefined}
    >
      <div
        ref={setScroller}
        className={
          scrollerClassName
            ? `nfi-slim-scroller ${scrollerClassName}`
            : "nfi-slim-scroller"
        }
        data-axis={axis}
        onScroll={update}
      >
        <div
          ref={setContentEl}
          className={contentClassName ?? "nfi-slim-content"}
        >
          {children}
        </div>
      </div>
      {metrics.vertical ? (
        <div
          aria-hidden="true"
          className="nfi-slim-track nfi-slim-track-v"
          onPointerDown={jumpTrack("v")}
        >
          <div
            className="nfi-slim-thumb"
            style={{
              height: `${metrics.vSize * 100}%`,
              top: `${metrics.vPos * 100}%`,
            }}
            onPointerDown={beginThumbDrag("v")}
          />
        </div>
      ) : null}
      {metrics.horizontal ? (
        <div
          aria-hidden="true"
          className="nfi-slim-track nfi-slim-track-h"
          onPointerDown={jumpTrack("h")}
        >
          <div
            className="nfi-slim-thumb"
            style={{
              width: `${metrics.hSize * 100}%`,
              left: `${metrics.hPos * 100}%`,
            }}
            onPointerDown={beginThumbDrag("h")}
          />
        </div>
      ) : null}
    </div>
  );
}
