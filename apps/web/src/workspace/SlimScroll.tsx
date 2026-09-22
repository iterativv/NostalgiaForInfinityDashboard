// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";

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
  const innerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<SlimMetrics>(IDLE_METRICS);
  const [dragging, setDragging] = useState<"v" | "h" | null>(null);

  const setScroller = (el: HTMLDivElement | null) => {
    innerRef.current = el;
    if (typeof scrollerRef === "function") scrollerRef(el);
    else if (scrollerRef && typeof scrollerRef === "object")
      (scrollerRef as React.RefObject<HTMLDivElement | null>).current = el;
  };

  const update = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    const vertical = el.scrollHeight > el.clientHeight + 1;
    const horizontal = el.scrollWidth > el.clientWidth + 1;
    setMetrics({
      vertical,
      horizontal,
      vSize: vertical ? el.clientHeight / el.scrollHeight : 1,
      hSize: horizontal ? el.clientWidth / el.scrollWidth : 1,
      vPos: vertical ? el.scrollTop / el.scrollHeight : 0,
      hPos: horizontal ? el.scrollLeft / el.scrollWidth : 0,
    });
  }, []);

  useEffect(() => {
    const el = innerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (contentRef.current) observer.observe(contentRef.current);
    update();
    return () => observer.disconnect();
  }, [update]);

  /** Drag a thumb: pointer position maps 1:1 onto scroll offset (scaled). */
  const beginThumbDrag = (kind: "v" | "h") =>
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const el = innerRef.current;
      const track = event.currentTarget.parentElement;
      if (!el || !track) return;
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      setDragging(kind);
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
        handle.removeEventListener("pointermove", move as EventListener);
        setDragging(null);
      };
      handle.addEventListener("pointermove", move as EventListener);
      handle.addEventListener("pointerup", up, { once: true });
      handle.addEventListener("pointercancel", up, { once: true });
    };

  /** Track click: jump so the thumb centers under the pointer. */
  const jumpTrack = (kind: "v" | "h") =>
    (event: React.PointerEvent<HTMLDivElement>) => {
      const el = innerRef.current;
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
      data-dragging={dragging ?? undefined}
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
          ref={contentRef}
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
