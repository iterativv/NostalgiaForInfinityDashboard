// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { createContext, useContext, type ReactNode } from "react";
import { useStore } from "@tanstack/react-store";
import {
  shallow,
  useDerived,
  useElementStore,
  useLocalStore,
  useStoreEffect,
} from "@nfi/ui";
import { Add } from "@carbon/icons-react";
import type {
  AutoItemLayoutNode,
  AutoLayoutNode,
  LayoutNode,
} from "@nfi/api-contract";
import {
  AUTO_GAP_PX,
  getAutoItemMinHeight,
  getLayoutMinWidth,
  minAutoSpan,
  packAuto,
} from "@nfi/widget-sdk";
import { prefsStore } from "../store";
import { useProgressiveMount } from "./progressiveMount";

/**
 * AutoPane — workspace infrastructure (NOT a widget).
 *
 * Renders one `auto` layout node as gap-free COLUMN packing (masonry
 * gravity with flexible resize): the column grid derives from the pane
 * width and the node's target `columnWidth` (capped at MAX_AUTO_COLUMNS),
 * and every card lands in the currently shortest column run (leftmost on
 * ties) so empty space is always filled — the dashboard has gravity to
 * the top no matter the panel size. Every card keeps its EXACT persisted
 * size (width = stepless fractional span × step − gap, height = own px).
 * No justification, no stretch — a resize release re-renders
 * pixel-identical to the drag's final frame.
 * Card order IS layout order: the card's tab-strip header drag-reorders
 * like a floating window's title bar (movement threshold keeps tab clicks
 * working; one `moveAutoItem` commit on drop) and the SE corner resizes
 * both axes steplessly (dy → height px, dx → fractional column span, each
 * snapping to a neighbor edge within 5px with a Figma-style full-canvas
 * guide line while engaged). The gesture NEVER clamps to widget minimums:
 * the card tracks the pointer 1:1 and the yellow limit state warns while
 * the preview sits below a minimum (unless minimums are disabled in
 * Preferences, when no minimum exists); the release commit settles the
 * canvas once, clamping persisted sizes back to the minimums only when
 * they are enforced. `pointercancel` reverts the preview with no commit.
 * Pointer capture + rAF coalescing only; no drag
 * framework, no observers beyond the container ResizeObserver, no frame
 * scheduling loops (see MasonryPane's header for why that matters).
 *
 * Reorder is LIVE-PREVIEWED through pane-local state that feeds the
 * packing: every order change re-packs the whole canvas around the pending
 * order (pure O(n) math) while the dragged card tracks the pointer through
 * a DIRECT transform write on its element (rAF-coalesced — the per-frame
 * pointer delta never re-renders the pane), and exactly ONE store commit
 * lands on drop. Neighbors glide on a short transition per swap; the
 * dragged card alone opts out (it must track the pointer 1:1). Resize is
 * FROZEN instead: neighbors stay pinned on their persisted slots while
 * the card previews its pending size on top (lifted shadow, blue ring,
 * state tag + live size readout) — no section ever auto-moves or jumps
 * columns mid-gesture, so horizontal resizes feel exactly as smooth as
 * vertical ones.
 *
 * Smart fit: a card never renders narrower than its widget's content
 * minimum — persisted spans are floored at the live readability span
 * (`minAutoSpan`), so on a wide screen a card that would squeeze instead
 * wraps to the next row with room to spare. Only when the whole container
 * is narrower than the widget (genuinely small screens) does the card
 * stay narrow, and then the Panel scales just the widget content — the
 * tab strip is never scaled (see `Panel`). The "disable widget minimum
 * dimensions" preference skips every floor here: heights and spans render
 * exactly as persisted.
 *
 * Widgets are ADDED, never booked into slots: a trailing dashed "Add
 * widget" tile FILLS the ragged pocket gravity leaves at the wall's
 * bottom (or opens a fresh full-width band below an even wall; a
 * full-width empty state when there are no cards yet). It opens the
 * widget picker with NO tab target, so the picked widget appends as a
 * fresh card sized from its preferred dimensions — an empty bento page is
 * a valid resting state.
 *
 * The packing is a pure function of the container width over KNOWN sizes
 * (persisted px clamped through the same minimums the cards render with).
 * The pane is its own scroll container (like `.nfi-masonry`).
 */

/** Live size override for the card being resized (render-only). */
interface AutoSizePreview {
  readonly itemId: string;
  readonly height: number;
  readonly span: number;
  /**
   * True while the preview sits below a widget minimum (height or width)
   * and minimums are enforced — the yellow limit state. The drag itself is
   * never clamped: the overlay warns instead. False when minimums are
   * disabled (no minimum exists to violate) or while growing.
   */
  readonly atLimit: boolean;
  /**
   * Figma-style smart-guide positions (canvas space) while a snap is
   * engaged: `snapY` = aligned bottom edge (horizontal line), `snapX` =
   * aligned right edge (vertical line). Null when free-dragging.
   */
  readonly snapY: number | null;
  readonly snapX: number | null;
}

/**
 * Live reorder state for the card being dragged (render-only). The
 * pointer-follow offset is NOT here: it is written straight to the card
 * element's transform every frame (see `startItemHeaderDrag`), so dragging
 * costs zero React renders — this state only changes when the preview
 * ORDER changes.
 */
interface AutoDragPreview {
  readonly itemId: string;
  /** Preview card order (all item ids) — the drop commits `indexOf(itemId)`. */
  readonly order: ReadonlyArray<AutoItemLayoutNode["id"]>;
}

/**
 * Live geometry for pointer hit-testing (canvas-space rects in the CURRENT
 * render order). Held in a plain store written during render and read
 * imperatively by the drag handlers — never subscribed, so the writes cost
 * nothing while staying fresher than any closure.
 */
interface AutoGeometry {
  readonly rects: ReadonlyArray<{
    id: AutoItemLayoutNode["id"];
    left: number;
    top: number;
    width: number;
    height: number;
  }>;
  readonly columnCount: number;
  readonly columnWidth: number;
}

interface AutoPaneContextValue {
  panels: Record<string, { widgetType: string } | undefined>;
  lookup: (
    type: string,
  ) => { minWidth: number; minHeight?: number } | undefined;
  /** True on non-editable pages: handles are hidden, no drag. */
  locked: boolean;
  /** Widget minimum dimensions are off (user preference). */
  minSizesDisabled: boolean;
  autoId: string;
  /** SE-handle pointer drag: live-preview size, one commit on release. */
  startItemResize: (
    itemId: AutoItemLayoutNode["id"],
    minHeight: number,
    minWidth: number,
    event: React.PointerEvent<HTMLElement>,
  ) => void;
  /**
   * Card-header pointer drag (the tab strip row is the handle): live-
   * preview reorder after a small movement threshold, one commit on drop.
   * The threshold keeps plain clicks on the tab button working.
   */
  startItemHeaderDrag: (
    itemId: AutoItemLayoutNode["id"],
    event: React.PointerEvent<HTMLElement>,
  ) => void;
  /** Keyboard reorder commit (Alt + arrow keys nudge by one slot). */
  moveItem: (itemId: AutoItemLayoutNode["id"], delta: number) => void;
  /** Resize commit (keyboard nudge on the SE handle). */
  resizeItem: (
    itemId: AutoItemLayoutNode["id"],
    height: number,
    span: number | undefined,
  ) => void;
  /** Render one child subtree (tabs / nested grid / flow / bare panel). */
  renderChild: (node: LayoutNode) => ReactNode;
}

const AutoPaneContext = createContext<AutoPaneContextValue | null>(null);

/**
 * Frame-coalesced scheduling with a hidden-tab escape: pointermove storms
 * collapse to one update per frame, but a backgrounded tab never fires
 * animation frames — a short timer (≈2 frames) flushes instead, so drags
 * and resizes stay live even when painting pauses.
 */
function createFrameScheduler() {
  let raf = 0;
  let timer = 0;

  return {
    schedule(work: () => void): void {
      if (raf !== 0 || timer !== 0) return;

      const run = () => {
        raf = 0;
        timer = 0;
        work();
      };

      raf = window.requestAnimationFrame(run);
      timer = window.setTimeout(() => {
        window.cancelAnimationFrame(raf);
        run();
      }, 32);
    },

    cancel(): void {
      if (raf !== 0) {
        window.cancelAnimationFrame(raf);
      }

      if (timer !== 0) {
        window.clearTimeout(timer);
      }

      raf = 0;
      timer = 0;
    },
  };
}

/**
 * Pointer capture, hardened: capture routes every subsequent pointer event
 * of this pointer to the handle (so moves keep arriving even when the
 * pointer leaves it), but the call throws for synthetic pointers with no
 * active pointer record — an automation artifact worth surviving, the
 * bubbling listeners keep working without it.
 */
function capturePointer(handle: Element, pointerId: number): void {
  try {
    handle.setPointerCapture(pointerId);
  } catch {
    // No active pointer record (synthetic events) — proceed uncaptured.
  }
}

/**
 * One auto card: absolute-packed at its shortest-column position (masonry
 * gravity — no vertical gaps), exact
 * render size (persisted span floored at the readability minimum, so wide
 * screens wrap instead of squeezing), the SE-corner resize handle (height
 * + stepless span) and the tab-strip header as the reorder handle (pointer
 * drag, like a floating window's title bar — controls inside the strip
 * stay interactive and a press without movement still clicks). The
 * interacting card carries `live` (tracks the pointer 1:1 via a direct
 * transform write from the pane, shadow lift). The body is never scaled
 * here — small-screen content scaling lives in `Panel`, which keeps the
 * tab strip at full size.
 */
function AutoCard({
  data: item,
  left,
  top,
  width,
  height,
  minHeight,
  minWidth,
  columnWidth,
  columnCount,
  resizing,
  atLimit,
  dragging,
}: {
  data: AutoItemLayoutNode;
  left: number;
  top: number;
  width: number;
  height: number;
  minHeight: number;
  /** Content minimum width (resize-handle floor hint; never scaled here). */
  minWidth: number;
  /** Stretched column width (the dx → span quantization step). */
  columnWidth: number;
  /** Live column count (span clamp during drag and nudges). */
  columnCount: number;
  /** True while this card is the active resize subject. */
  resizing: boolean;
  /** True while the resize preview sits below an enforced minimum. */
  atLimit: boolean;
  /** True while this card is the active drag subject. */
  dragging: boolean;
}) {
  const context = useContext(AutoPaneContext);

  if (!context) return null;

  const {
    locked,
    minSizesDisabled,
    renderChild,
    startItemHeaderDrag,
    startItemResize,
  } = context;

  const className =
    dragging
      ? "nfi-auto-item nfi-auto-item-dragging"
      : resizing
        ? `nfi-auto-item nfi-auto-item-resizing${atLimit ? " nfi-auto-item-min" : ""}`
        : "nfi-auto-item";

  const nudgeResize = (deltaHeight: number, deltaSpan: number) => {
    // Keyboard nudges stay whole-column stepped (floor 1 — with minimums
    // disabled the drag floor is 1px/1 column, else the content minimum).
    const span = Math.max(
      1,
      Math.min(
        columnCount,
        Math.max(1, Math.round(width / (columnWidth + AUTO_GAP_PX)) || 1) +
          deltaSpan,
      ),
    );

    context.resizeItem(
      item.id,
      Math.max(minSizesDisabled ? 1 : minHeight, height + deltaHeight),
      span,
    );
  };

  return (
    <div
      className={className}
      role="listitem"
      // Stable hook for the drag gesture: the pane looks the element up
      // once per drag and writes its transform directly every frame (the
      // element itself survives every re-render — the card is keyed).
      data-auto-item={item.id}
      style={{
        position: "absolute",
        top,
        left,
        width,
        height,
        // The CSS floor must never fight the gesture: while resizing the
        // preview tracks the pointer freely (the yellow overlay warns),
        // and with minimums disabled the below-min size persists at rest.
        minHeight: resizing || minSizesDisabled ? undefined : minHeight,
      }}
      onPointerDown={
        locked ? undefined : (event) => startItemHeaderDrag(item.id, event)
      }
    >
      <div className="nfi-auto-body">{renderChild(item.child)}</div>
      {resizing ? (
        <div className="nfi-auto-tags">
          {atLimit ? (
            <div
              className="nfi-auto-tag nfi-auto-tag-min"
              title="This card is below its minimum readable size — release here keeps the size when minimums are disabled in Preferences"
            >
              Minimum size
            </div>
          ) : (
            <div
              className="nfi-auto-tag nfi-auto-tag-resize"
              title="Drag the corner to resize — release to keep this size"
            >
              Release to keep this size
            </div>
          )}
          {/* Live size readout under the state tag (#1). */}
          <div className="nfi-auto-tag nfi-auto-tag-size" aria-hidden>
            {Math.round(width)} × {Math.round(height)}
          </div>
        </div>
      ) : null}
      {locked ? null : (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize card (stepless width and height${
            minSizesDisabled ? "" : `; minimum ${minHeight}px`
          }; Alt + arrow keys reorder)`}
          title={`Drag to resize height and width — snaps to neighboring edges within 5px${
            minSizesDisabled ? "" : `, minimum height ${minHeight}px`
          }; Alt + arrow keys reorder the card`}
          tabIndex={0}
          className="nfi-auto-handle"
          onPointerDown={(event) =>
            startItemResize(item.id, minHeight, minWidth, event)
          }
          onKeyDown={(event) => {
            const step = event.shiftKey ? 100 : 20;

            if (event.altKey) {
              if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                event.preventDefault();
                context.moveItem(item.id, -1);
              } else if (
                event.key === "ArrowDown" ||
                event.key === "ArrowRight"
              ) {
                event.preventDefault();
                context.moveItem(item.id, 1);
              }

              return;
            }

            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              nudgeResize(event.key === "ArrowUp" ? -step : step, 0);
            } else if (
              event.key === "ArrowLeft" ||
              event.key === "ArrowRight"
            ) {
              event.preventDefault();
              nudgeResize(0, event.key === "ArrowLeft" ? -1 : 1);
            }
          }}
        />
      )}
    </div>
  );
}

export function AutoPane({
  auto,
  panels,
  lookup,
  locked = false,
  onItemResize,
  onItemMove,
  onOpenCanvas,
  renderChild,
}: {
  auto: AutoLayoutNode;
  /** Workspace panels map (widget type lookup for min-size hints). */
  panels: Record<string, { widgetType: string } | undefined>;
  lookup: (
    type: string,
  ) => { minWidth: number; minHeight?: number } | undefined;
  /** True on non-editable pages: handles are hidden, no drag. */
  locked?: boolean;
  onItemResize: (
    autoId: string,
    itemId: string,
    height: number,
    span?: number,
  ) => void;
  /** Drag-reorder commit: splice `itemId` to `targetIndex`. */
  onItemMove: (autoId: string, itemId: string, targetIndex: number) => void;
  /**
   * Canvas-level "add widget": opens the picker with NO tab target so the
   * picked widget APPENDS as a fresh card (never books an empty slot).
   * Receives the clicked affordance's rect as the picker anchor.
   */
  onOpenCanvas?: (anchor: DOMRect | null) => void;
  /** Render one child subtree (tabs / nested grid / flow / bare panel). */
  renderChild: (node: LayoutNode) => ReactNode;
}) {
  const { store: scrollElStore, setElement: setScrollElement } =
    useElementStore<HTMLDivElement>();

  const scrollEl = useStore(scrollElStore, (el) => el);

  const { store: canvasElStore, setElement: setCanvasElement } =
    useElementStore<HTMLDivElement>();

  // Measured container width + the transition arm derived from it — one
  // store because the arm keys on the width (see the effect below).
  const paneStore = useLocalStore({
    containerWidth: 0,
    transitionsArmed: false,
  });

  const containerWidth = useStore(paneStore, (s) => s.containerWidth);
  const transitionsArmed = useStore(paneStore, (s) => s.transitionsArmed);

  // Live size / reorder previews (render-only; one store per gesture).
  const sizeStore = useLocalStore<AutoSizePreview | null>(null);
  const sizePreview = useStore(sizeStore, (s) => s);
  const dragStore = useLocalStore<AutoDragPreview | null>(null);
  const dragPreview = useStore(dragStore, (s) => s);

  // User preference: widget minimum dimensions off — cards render at their
  // exact persisted size (no height clamp, no span floor, no limit state).
  const minSizesDisabled = useStore(
    prefsStore,
    (state) => state.disableWidgetMinSize,
  );

  useStoreEffect(() => {
    const el = scrollElStore.state;

    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const width = Math.floor(entries[0]?.contentRect.width ?? 0);

      paneStore.setState((prev) =>
        prev.containerWidth === width
          ? prev
          : { ...prev, containerWidth: width },
      );
    });

    observer.observe(el);

    return () => observer.disconnect();
  }, []);

  // First-paint measure (RO fires on observe, but asynchronously — this
  // avoids one empty frame). Written during render, guarded so it only runs
  // until a width lands: an unguarded write can oscillate when the
  // scrollbar settle changes clientWidth back and forth (max update depth).
  if (scrollEl !== null && containerWidth === 0) {
    const width = scrollEl.clientWidth;

    paneStore.setState((prev) =>
      prev.containerWidth === width ? prev : { ...prev, containerWidth: width },
    );
  }

  // Arm one macrotask after the first measured paint (a timeout, not rAF —
  // background tabs throttle rAF to never, and an unarmed canvas would
  // silently lose every transition until foregrounded).
  useStoreEffect(() => {
    if (transitionsArmed || containerWidth <= 0) return;

    const timer = window.setTimeout(
      () => paneStore.setState((prev) => ({ ...prev, transitionsArmed: true })),
      50,
    );

    return () => window.clearTimeout(timer);
  }, [transitionsArmed, containerWidth]);

  // Per-card minimum heights (content minimum + tab-strip chrome). The
  // packing clamps persisted heights through the SAME minimums the cards
  // render with, so layout math and rendered boxes never disagree.
  const minHeightByItem = useDerived(
    [auto.items, panels, lookup] as const,
    ([items, panels, lookup]) =>
      new Map(
        items.map((item) => [
          item.id,
          getAutoItemMinHeight(item.child, panels, lookup),
        ]),
      ),
    { inputs: shallow },
  );

  // Per-card minimum widths (content minimums): the readability floor the
  // resize preview measures against for the yellow limit glow.
  const minWidthByItem = useDerived(
    [auto.items, panels, lookup] as const,
    ([items, panels, lookup]) =>
      new Map(
        items.map((item) => [
          item.id,
          getLayoutMinWidth(item.child, panels, lookup),
        ]),
      ),
    { inputs: shallow },
  );

  // Cards in layout order — the drag preview reorders this array (render
  // only; the drop commits the splice through the store).
  const items = useDerived(
    [dragPreview, auto.items] as const,
    ([preview, source]) => {
      if (!preview) return source;

      const byId = new Map(source.map((entry) => [entry.id, entry]));

      return preview.order.flatMap((id) => {
        const entry = byId.get(id);

        return entry ? [entry] : [];
      });
    },
    { inputs: shallow },
  );

  // Progressive mounting bounds every page mount to short tasks — keyed on
  // the auto's OWN item ids so drag previews (reordered `items`) never
  // restart the schedule; see progressiveMount.ts.
  const mountedIds = useProgressiveMount(
    useDerived(auto.items, (source) => source.map((entry) => entry.id)),
  );

  const clampedHeights = useDerived(
    [items, minHeightByItem, minSizesDisabled] as const,
    ([items, minHeightByItem, minSizesDisabled]) =>
      items.map((item) =>
        Math.max(
          item.height,
          minSizesDisabled ? 1 : (minHeightByItem.get(item.id) ?? 0),
        ),
      ),
    { inputs: shallow },
  );

  // First pass: the column grid depends only on the container width and
  // the node's target width (never on spans or the card count) — one cheap
  // probe fixes the live grid before spans are floored below.
  const gridProbe = useDerived(
    [containerWidth, auto.columnWidth, clampedHeights] as const,
    ([containerWidth, columnWidth, clampedHeights]) =>
      packAuto(containerWidth, columnWidth, AUTO_GAP_PX, clampedHeights),
    { inputs: shallow },
  );

  // Render spans: persisted spans floored at each card's readability span
  // (`minAutoSpan`) so a card never renders narrower than its widget — on
  // a screen with room it wraps to the next row instead of squeezing (no
  // rescale), and only when the whole container is narrower than the
  // widget does the floor clamp to the column count and the Panel scale
  // just the content. Persisted spans stay verbatim (explicit resizes
  // still win on the next wrap calculation). With widget minimums
  // disabled the floor is skipped entirely — the span renders as stored.
  const renderSpans = useDerived(
    [gridProbe, items, minWidthByItem, minSizesDisabled] as const,
    ([gridProbe, items, minWidthByItem, minSizesDisabled]) => {
      if (gridProbe.columnWidth <= 0 || minSizesDisabled)
        return items.map((item) => item.span);

      return items.map((item) =>
        Math.max(
          item.span,
          minAutoSpan(
            minWidthByItem.get(item.id) ?? 0,
            gridProbe.columnWidth,
            AUTO_GAP_PX,
            gridProbe.columnCount,
          ),
        ),
      );
    },
    { inputs: shallow },
  );

  // Display packing: floored spans with exact heights — never the resize
  // preview. While a resize is active every card renders from HERE, so
  // neighbors stay pinned and no section ever auto-moves or jumps rows
  // mid-gesture; the dragged card keeps its slot's corner and previews
  // width/height on top, and the release commit reproduces the preview
  // numbers pixel-identically (no justify/stretch snap).
  // (Reorder flows through `items`, so it keeps its live re-pack —
  // hovering another slot must show where the drop lands.)
  const displayPacking = useDerived(
    [containerWidth, auto.columnWidth, clampedHeights, renderSpans] as const,
    ([containerWidth, columnWidth, clampedHeights, renderSpans]) =>
      packAuto(containerWidth, columnWidth, AUTO_GAP_PX, clampedHeights, {
        spans: renderSpans,
      }),
    { inputs: shallow },
  );

  // Preview width in px (fractional spans — stepless), for the overlay box.
  const previewWidthPx =
    sizePreview !== null && displayPacking.columnWidth > 0
      ? sizePreview.span * (displayPacking.columnWidth + AUTO_GAP_PX) -
        AUTO_GAP_PX
      : null;

  // Live geometry for pointer hit-testing (canvas-space rects in the
  // CURRENT render order — the drag reads it every frame). Written during
  // render so a drag's per-frame hit-testing always sees the geometry the
  // user currently SEES (the frozen display packing — resize previews
  // overlay it without moving slots); the store has no subscribers, so
  // the plain write itself costs nothing.
  const geometryStore = useLocalStore<AutoGeometry>({
    rects: [],
    columnCount: 1,
    columnWidth: 0,
  });

  geometryStore.setState(() => ({
    rects: items.flatMap((item, index) => {
      const position = displayPacking.items[index];

      return position ? [{ id: item.id, ...position }] : [];
    }),
    columnCount: displayPacking.columnCount,
    columnWidth: displayPacking.columnWidth,
  }));

  const autoId = auto.id;

  const startItemResize = (
    itemId: AutoItemLayoutNode["id"],
    minHeight: number,
    minWidth: number,
    event: React.PointerEvent<HTMLElement>,
  ) => {
    if (locked || dragPreview !== null) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const itemEl = handle.closest<HTMLElement>(".nfi-auto-item");

    if (!itemEl) return;
    capturePointer(handle, event.pointerId);

    // Gesture-start geometry: frozen for the whole drag (mates and grid
    // steps come from the layout the user grabbed, not the preview).
    const geometry = geometryStore.state;
    const { columnWidth, columnCount } = geometry;
    const step = Math.max(1, columnWidth + AUTO_GAP_PX);

    const startHeight = itemEl.offsetHeight;

    // Seed from the EXACT rendered width (fractional, exact-size rows have
    // no justify bonus), so grabbing never jumps the card by a rounding
    // step. Floor 1 — spans never go below one column (layout integrity,
    // not a widget minimum).
    const startSpan = Math.max(
      1,
      Math.min(columnCount, (itemEl.offsetWidth + AUTO_GAP_PX) / step || 1),
    );

    const startX = event.clientX;
    const startY = event.clientY;

    // Seed the preview immediately (the flush below only UPDATES it), so
    // the resizing class + shadow apply on grab, before the first move.
    // Not at the limit on grab — the overlay only fires once a move
    // pushes below a minimum (a card sitting AT its minimum must not glow
    // while the user drags it bigger).
    sizeStore.setState(() => ({
      itemId,
      height: startHeight,
      span: startSpan,
      atLimit: false,
      snapY: null,
      snapX: null,
    }));

    // Height snap mates: every other card's height (masonry columns
    // stagger, so same-top row mates rarely exist — snapping to the
    // nearest ANY height keeps edges aligning across the wall).
    // Column-mate widths for the width snap: mates are the frozen rects
    // whose horizontal band overlaps this card's (the widgets above/below
    // it in the same columns) — side-by-side neighbors tile without
    // overlap, so they never false-trigger.
    const dragRect = geometry.rects.find((rect) => rect.id === itemId);

    const mateHeights = geometry.rects.flatMap((rect) =>
      rect.id !== itemId ? [rect.height] : [],
    );

    const mateWidths = geometry.rects.flatMap((rect) =>
      rect.id !== itemId &&
      dragRect !== undefined &&
      rect.left < dragRect.left + dragRect.width - 1e-6 &&
      dragRect.left < rect.left + rect.width - 1e-6
        ? [rect.width]
        : [],
    );

    // Stepless preview: the pending span tracks the pointer 1:1 in
    // fractions of a column and height in px, snapping each axis to the
    // nearest mate edge within 5px (smart-guide line rendered while
    // engaged). NOTHING is clamped to widget minimums mid-gesture — the
    // yellow overlay warns instead (#2) — only renderability floors
    // apply. Neighbors stay frozen; ONE commit lands on release
    // reproducing the preview numbers, so nothing jumps. pointercancel
    // reverts.
    const scheduler = createFrameScheduler();
    let pendingHeight: number | null = null;
    let pendingSpan: number | null = null;
    let pendingAtLimit = false;
    let pendingSnapY: number | null = null;
    let pendingSnapX: number | null = null;
    let appliedHeight: number | null = null;
    let appliedSpan: number | null = null;

    const flush = () => {
      if (pendingHeight === null && pendingSpan === null) return;
      const height = pendingHeight;
      const span = pendingSpan;
      const atLimit = pendingAtLimit;
      const snapY = pendingSnapY;
      const snapX = pendingSnapX;

      appliedHeight = height ?? appliedHeight;
      appliedSpan = span ?? appliedSpan;
      pendingHeight = null;
      pendingSpan = null;
      pendingSnapY = null;
      pendingSnapX = null;
      sizeStore.setState((prev) =>
        prev
          ? {
              ...prev,
              height: height ?? prev.height,
              span: span ?? prev.span,
              atLimit,
              snapY,
              snapX,
            }
          : prev,
      );
    };

    const move = (moveEvent: PointerEvent) => {
      // Free drag on both axes: track the pointer 1:1 (no minimum
      // clamp). Absolute floors only keep the card renderable.
      const height = Math.max(
        1,
        Math.round(startHeight + (moveEvent.clientY - startY)),
      );

      const rawSpan = Math.max(
        1,
        Math.min(columnCount, startSpan + (moveEvent.clientX - startX) / step),
      );

      // Height snap: line the bottom edge up with a row-mate's height
      // when within threshold (cards in a row line up instead of
      // hovering 1–4px off); the guide line renders at the aligned edge.
      let snappedHeight = height;
      let snapY: number | null = null;
      let bestDist = HEIGHT_SNAP_PX + 1e-9;

      for (const mate of mateHeights) {
        const dist = Math.abs(height - mate);

        if (dist <= HEIGHT_SNAP_PX && dist < bestDist) {
          bestDist = dist;
          snappedHeight = Math.max(1, Math.round(mate));
          snapY = dragRect !== undefined ? dragRect.top + snappedHeight : null;
        }
      }

      // Width snap mirror: line the right edge up with the widgets above
      // / below (same column band) when within threshold. Same-row
      // neighbors never qualify (they tile without overlap), so a snap
      // can never fold the card into its own row.
      const rawWidth = rawSpan * step - AUTO_GAP_PX;
      let snappedSpan = rawSpan;
      let snapX: number | null = null;
      let bestWidthDist = WIDTH_SNAP_PX + 1e-9;

      for (const mate of mateWidths) {
        const dist = Math.abs(rawWidth - mate);

        if (dist <= WIDTH_SNAP_PX && dist < bestWidthDist) {
          const candidate = (mate + AUTO_GAP_PX) / step;

          // Mates render from legal spans, but guard anyway: a snapped
          // span that needs clamping is a misfire, not an alignment.
          if (candidate >= 1 && candidate <= columnCount) {
            bestWidthDist = dist;
            snappedSpan = candidate;
            snapX = dragRect !== undefined ? dragRect.left + mate : null;
          }
        }
      }

      // Limit state AFTER snapping: a snap can resolve the drag back
      // above the floor. Fires below EITHER minimum (height or width);
      // minimums disabled → the state cannot exist.
      pendingAtLimit =
        !minSizesDisabled &&
        (snappedHeight < minHeight ||
          snappedSpan * step - AUTO_GAP_PX < minWidth);

      pendingHeight = snappedHeight;
      pendingSpan = snappedSpan;
      pendingSnapY = snapY;
      pendingSnapX = snapX;

      scheduler.schedule(flush);
    };

    // SAFETY: `move` receives a native PointerEvent; addEventListener's
    // callback parameter type is the wider EventListener, so the narrow
    // handler is widened to attach it.
    const moveListener = move as EventListener;

    const finish = (commit: boolean) => {
      scheduler.cancel();

      // Freshest size wins: pending (not yet painted) beats applied.
      const finalHeight = pendingHeight ?? appliedHeight;
      const finalSpan = pendingSpan ?? appliedSpan;

      pendingHeight = null;
      pendingSpan = null;
      pendingAtLimit = false;
      pendingSnapY = null;
      pendingSnapX = null;
      appliedHeight = null;
      appliedSpan = null;
      handle.removeEventListener("pointermove", moveListener);
      sizeStore.setState(() => null);

      if (commit && finalHeight !== null) {
        // Two decimals: no float dust in the persisted span, and the
        // re-render reproduces the release frame exactly (no snap).
        const span =
          finalSpan === null || finalSpan === undefined
            ? startSpan
            : Math.round(finalSpan * 100) / 100;

        onItemResize(autoId, itemId, finalHeight, span);
      }
    };

    handle.addEventListener("pointermove", moveListener);
    handle.addEventListener("pointerup", () => finish(true), { once: true });
    handle.addEventListener("pointercancel", () => finish(false), {
      once: true,
    });
  };

  const startItemHeaderDrag = (
    itemId: AutoItemLayoutNode["id"],
    event: React.PointerEvent<HTMLElement>,
  ) => {
    if (locked || sizePreview !== null) return;

    // The card's tab-strip row IS the drag handle (like a floating
    // window's title bar). Everything interactive inside it — the ⋯
    // menu, the add button, inputs, the strip's overlay scrollbar —
    // keeps its own pointer handling; the tab BUTTON itself drags the
    // card, and a press without movement still activates the tab
    // (threshold below).
    const target = event.target instanceof Element ? event.target : null;

    if (
      target?.closest(
        "button:not(.nfi-tab-button), a, input, textarea, select, [role=menu], [role=menuitem], .cds--btn, .cds--overflow-menu, .nfi-slim-track",
      )
    )
      return;

    const handle = target?.closest<HTMLElement>(".nfi-tabstrip-row");

    if (!handle) return;
    // No preventDefault here: canceling pointerdown suppresses the
    // compatibility mousedown and can swallow the tab button's click.
    // Text selection is blocked in CSS (.nfi-tabstrip-row) and the
    // native HTML5 tab drag by the dragstart guard installed below.
    event.stopPropagation();
    const canvas = canvasElStore.state;

    if (!canvas) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const canvasRect = canvas.getBoundingClientRect();
    const order = geometryStore.state.rects.map((rect) => rect.id);
    const fromIndex = order.indexOf(itemId);

    if (fromIndex < 0) return;

    // Threshold begin: the preview (class + lift) arms only once the
    // pointer actually moves, so clicking the tab stays a click. The
    // listeners live on WINDOW (no pointer capture — capturing on the
    // strip at press time would retarget the click away from the tab
    // button).
    let active = false;

    // Pointer-follow WITHOUT React: the card's transform is written
    // straight to its element (rAF-coalesced), so the 60+/s pointer delta
    // never re-renders the pane — the store only carries the preview
    // ORDER, which changes on card crossings, not per frame. Keyed lookup
    // at gesture start: the element survives every reorder re-render.
    let itemEl: HTMLElement | null = null;

    const applyTransform = (dx: number, dy: number): void => {
      itemEl?.style.setProperty(
        "transform",
        `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`,
      );
    };

    const clearTransform = (): void => {
      // Removing the property (not setting "none") lets the CSS class
      // rules own the element again; the drop's class change re-enables
      // the transform transition, so the card glides home from wherever
      // the pointer released it.
      itemEl?.style.removeProperty("transform");
    };

    // Hover-swap preview: every frame the pointer point hit-tests against
    // the CURRENT packed rects; hovering another card splices the dragged
    // id to that slot, the packing re-flows (neighbors glide) and the
    // dragged card keeps tracking the pointer via its transform. ONE
    // `moveAutoItem` commit lands on drop; pointercancel reverts.
    const scheduler = createFrameScheduler();
    let pendingX = 0;
    let pendingY = 0;
    let previewOrder = order;
    let committedOrder: ReadonlyArray<AutoItemLayoutNode["id"]> | null = null;

    // Hover swap runs SYNCHRONOUSLY on every move (O(n) arithmetic —
    // trivial): the preview order always tracks the pointer even when
    // frame scheduling stalls (occluded/hidden window), so the drop
    // commits the right index regardless of what painted.
    const hoverSwap = (clientX: number, clientY: number) => {
      const px = clientX - canvasRect.left;

      const py =
        clientY - canvasRect.top + (scrollElStore.state?.scrollTop ?? 0);

      const rects = geometryStore.state.rects;

      const hovered = rects.findIndex(
        (rect) =>
          px >= rect.left &&
          px <= rect.left + rect.width &&
          py >= rect.top &&
          py <= rect.top + rect.height,
      );

      if (hovered >= 0 && rects[hovered]!.id !== itemId) {
        const next = previewOrder.filter((id) => id !== itemId);

        // Swap slots: insert at the hovered card's index in the ORIGINAL
        // order — after the removal that lands the dragged card right
        // after it (dragging rightward) or right before it (leftward),
        // which is the swap either way.
        next.splice(previewOrder.indexOf(rects[hovered]!.id), 0, itemId);
        previewOrder = next;
      }
    };

    const frame = () => {
      applyTransform(pendingX, pendingY);

      // Order-only store write: re-renders happen on card crossings, not
      // on pointer deltas — that is what keeps the drag smooth on busy
      // pages (the whole pane re-packed per pointermove before).
      if (committedOrder !== previewOrder) {
        committedOrder = previewOrder;
        dragStore.setState(() => ({ itemId, order: previewOrder }));
      }
    };

    const move = (moveEvent: PointerEvent) => {
      if (!active) {
        if (
          Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) <
          HEADER_DRAG_THRESHOLD_PX
        )
          return;
        active = true;
        itemEl = canvas.querySelector<HTMLElement>(
          `[data-auto-item="${itemId}"]`,
        );
        committedOrder = order;
        dragStore.setState(() => ({ itemId, order }));
      }

      pendingX = moveEvent.clientX - startX;
      pendingY = moveEvent.clientY - startY;
      hoverSwap(moveEvent.clientX, moveEvent.clientY);

      scheduler.schedule(frame);
    };

    // SAFETY: same EventListener widening as the resize `move`.
    const moveListener = move as EventListener;

    // The gesture owns native DnD: a tab drag-start under an active
    // (or arming) pointer press would race the reorder — suppress it.
    const suppressNativeDrag = (dragEvent: Event) => dragEvent.preventDefault();

    const finish = (commit: boolean) => {
      scheduler.cancel();
      window.removeEventListener("pointermove", moveListener);
      window.removeEventListener("dragstart", suppressNativeDrag, true);

      if (active) {
        // Clearing the transform while the dragging class drops re-enables
        // the transform transition: the card glides home from wherever
        // the pointer released it (drop-at-origin and cancel alike).
        clearTransform();
        dragStore.setState(() => null);
      }

      if (commit && active) {
        const targetIndex = previewOrder.indexOf(itemId);

        if (targetIndex !== fromIndex && targetIndex >= 0) {
          onItemMove(autoId, itemId, targetIndex);
        }
      }
    };

    window.addEventListener("pointermove", moveListener);
    window.addEventListener("pointerup", () => finish(true), { once: true });
    window.addEventListener("pointercancel", () => finish(false), {
      once: true,
    });
    window.addEventListener("dragstart", suppressNativeDrag, true);
  };

  const moveItem = (itemId: AutoItemLayoutNode["id"], delta: number) => {
    if (locked) return;
    const ids = geometryStore.state.rects.map((rect) => rect.id);
    const from = ids.indexOf(itemId);
    const to = from + delta;

    if (from < 0 || to < 0 || to >= ids.length || from === to) return;
    onItemMove(autoId, itemId, to);
  };

  const resizeItem = (
    itemId: AutoItemLayoutNode["id"],
    height: number,
    span: number | undefined,
  ) => {
    if (locked) return;
    onItemResize(autoId, itemId, height, span);
  };

  const context: AutoPaneContextValue = {
    panels,
    lookup,
    locked,
    minSizesDisabled,
    autoId,
    startItemResize,
    startItemHeaderDrag,
    moveItem,
    resizeItem,
    renderChild,
  };

  const openCanvas = (event: React.MouseEvent<HTMLElement>) => {
    onOpenCanvas?.(event.currentTarget.getBoundingClientRect());
  };

  const canAdd = !locked && onOpenCanvas !== undefined;

  // While a DRAG preview is live the canvas re-packs in REAL TIME
  // (`.nfi-auto-live` disables slot transitions — animating toward a
  // moving target reads as lag); the smooth glide is for the settle after
  // the release commit, when targets are final. Resize needs no live
  // class: neighbors are pinned (frozen canvas above), only the dragged
  // card tracks the pointer.
  const interacting = dragPreview !== null;

  // Trailing "Add widget" tile: occupies ONE row at the wall's ragged edge
  // — the contiguous run of columns that end earliest gets a tile spanning
  // their width, but only one row tall (a button, not a banner: stretching
  // down the whole pocket made the tile dwarf the cards). When the wall is
  // even (no meaningful pocket) the tile starts a fresh full-width band
  // below it. Pure geometry over the packed positions (the frozen packing
  // while resizing, so the tile never jumps mid-gesture).
  const addTile = useDerived(
    [canAdd, items.length, displayPacking, containerWidth] as const,
    ([canAdd, itemCount, displayPacking, containerWidth]) => {
      if (!canAdd || itemCount === 0 || displayPacking.columnWidth <= 0)
        return null;

      const { columnWidth, columnCount, height: wallBottom } = displayPacking;
      const step = columnWidth + AUTO_GAP_PX;

      // Column bottoms under masonry gravity — the wall's ragged edge.
      const ends = Array.from<number>({ length: columnCount }).fill(0);

      for (const placed of displayPacking.items) {
        const first = Math.max(
          0,
          Math.floor((placed.left + AUTO_GAP_PX / 2) / step),
        );

        const last = Math.min(
          columnCount - 1,
          Math.floor((placed.left + placed.width) / step),
        );

        for (let c = first; c <= last; c++)
          ends[c] = Math.max(ends[c] ?? 0, placed.top + placed.height);
      }

      const shortestEnd = Math.min(...ends);
      const shortest = ends.indexOf(shortestEnd);
      const pocketTop = shortestEnd + AUTO_GAP_PX;
      const pocketHeight = wallBottom - pocketTop;

      // Contiguous run of similarly-short columns around the shortest one.
      let firstCol = shortest;
      let lastCol = shortest;

      while (firstCol > 0 && (ends[firstCol - 1] ?? 0) <= shortestEnd + 80)
        firstCol--;

      while (
        lastCol < columnCount - 1 &&
        (ends[lastCol + 1] ?? 0) <= shortestEnd + 80
      )
        lastCol++;

      const pocketLeft = firstCol * step;

      const pocketWidth =
        (lastCol - firstCol + 1) * columnWidth +
        (lastCol - firstCol) * AUTO_GAP_PX;

      if (
        pocketHeight >= ADD_TILE_MIN_FILL_PX &&
        pocketWidth >= ADD_TILE_MIN_FILL_PX
      ) {
        return {
          left: pocketLeft,
          top: pocketTop,
          width: pocketWidth,
          // One row tall even in a deep pocket — the button invites the next
          // card without pretending to be one.
          height: Math.min(pocketHeight, ADD_TILE_NEW_ROW_PX),
        };
      }

      return {
        left: 0,
        top: wallBottom + AUTO_GAP_PX,
        width: Math.max(containerWidth, ADD_TILE_MIN_FILL_PX),
        height: ADD_TILE_NEW_ROW_PX,
      };
    },
    { inputs: shallow },
  );

  // The canvas must cover a wrapped tile, not just the packed cards.
  // Frozen while resizing (no scrollbar jumps mid-gesture).
  const canvasHeight = Math.max(
    displayPacking.height,
    addTile ? addTile.top + addTile.height : 0,
  );

  if (items.length === 0) {
    return (
      <div ref={setScrollElement} className="nfi-auto">
        {canAdd ? (
          <button
            type="button"
            className="nfi-auto-empty"
            onClick={openCanvas}
            title="Add a widget — it arrives as a new card, no empty slots needed"
          >
            <Add size={20} />
            <span className="nfi-auto-empty-title">Add a widget</span>
            <span className="nfi-auto-empty-hint">
              Widgets pack into gap-free columns as you add them — no slots to
              book.
            </span>
          </button>
        ) : (
          <div className="nfi-auto-empty" aria-hidden>
            <span className="nfi-auto-empty-title">No widgets yet</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={setScrollElement} className="nfi-auto">
      <AutoPaneContext.Provider value={context}>
        <div
          ref={setCanvasElement}
          className={
            transitionsArmed
              ? interacting
                ? "nfi-auto-canvas nfi-auto-anim nfi-auto-live"
                : "nfi-auto-canvas nfi-auto-anim"
              : "nfi-auto-canvas"
          }
          role="list"
          style={{
            position: "relative",
            width: "100%",
            height: canvasHeight,
          }}
        >
          {items.map((item, index) => {
            const position = displayPacking.items[index];

            if (!position) return null;

            // Progressive mounting: cards not yet in their mount batch
            // render as inert placeholders at their exact packed geometry
            // (bento packing is pure math — nothing shifts on mount), so a
            // page's widget storm lands in short idle-time chunks instead
            // of one browser-unresponsive commit (see progressiveMount.ts).
            if (!mountedIds.has(item.id)) {
              return (
                <div
                  key={item.id}
                  className="nfi-auto-item nfi-auto-item-pending"
                  role="listitem"
                  aria-busy="true"
                  style={{
                    position: "absolute",
                    top: position.top,
                    left: position.left,
                    width: position.width,
                    height: position.height,
                    pointerEvents: "none",
                  }}
                />
              );
            }

            const isResizing = sizePreview?.itemId === item.id;

            const previewWidth =
              isResizing && previewWidthPx !== null
                ? previewWidthPx
                : position.width;

            const previewHeight = isResizing
              ? (sizePreview?.height ?? position.height)
              : position.height;

            const minWidth = minWidthByItem.get(item.id) ?? 0;
            const minHeight = minHeightByItem.get(item.id) ?? 0;

            return (
              <AutoCard
                key={item.id}
                data={item}
                left={position.left}
                top={position.top}
                width={previewWidth}
                height={previewHeight}
                minHeight={minHeight}
                minWidth={minWidth}
                columnWidth={displayPacking.columnWidth}
                columnCount={displayPacking.columnCount}
                resizing={isResizing}
                // Clamp-aware: the preview carries whether the pointer is
                // pushing into the floor — never a height comparison, which
                // misfires while growing/widening a minimum-height card.
                atLimit={isResizing && (sizePreview?.atLimit ?? false)}
                dragging={dragPreview?.itemId === item.id}
              />
            );
          })}
          {/* Figma-style smart guides: full-canvas lines at the aligned
              edge while a snap is engaged within the 5px threshold. */}
          {sizePreview?.snapY != null ? (
            <div
              aria-hidden
              className="nfi-auto-snapline nfi-auto-snapline-h"
              style={{ top: Math.round(sizePreview.snapY) }}
            />
          ) : null}
          {sizePreview?.snapX != null ? (
            <div
              aria-hidden
              className="nfi-auto-snapline nfi-auto-snapline-v"
              style={{ left: Math.round(sizePreview.snapX) }}
            />
          ) : null}
          {addTile ? (
            <button
              type="button"
              className="nfi-auto-add"
              style={{
                position: "absolute",
                top: addTile.top,
                left: addTile.left,
                width: addTile.width,
                height: addTile.height,
              }}
              title="Add a widget as a new card"
              onClick={openCanvas}
            >
              <Add size={24} />
              <span>Add widget</span>
            </button>
          ) : null}
        </div>
      </AutoPaneContext.Provider>
    </div>
  );
}

/**
 * Minimum pocket size (px, both axes) the "Add widget" tile needs to sit
 * INSIDE the wall's ragged bottom instead of starting a fresh band below —
 * a sliver smaller than this reads as a cramped button, not an invitation.
 */
const ADD_TILE_MIN_FILL_PX = 180;

/** Height of the "Add widget" tile (one row), in a pocket or a fresh band. */
const ADD_TILE_NEW_ROW_PX = 160;

/**
 * Height snap threshold (px): a vertical drag landing within this distance
 * of another card's height snaps to it (with a full-canvas guide line), so
 * card edges align across the wall.
 */
const HEIGHT_SNAP_PX = 5;

/**
 * Width snap threshold (px): a horizontal drag landing within this distance
 * of a column-mate's width (widgets above/below in the same band) snaps to
 * it (with a full-canvas guide line), so card edges align across columns.
 */
const WIDTH_SNAP_PX = 5;

/**
 * Header drag threshold (px): the card's tab strip is the reorder handle,
 * but a press on the tab button without real movement must stay a click
 * (activation) — the drag preview arms only past this movement.
 */
const HEADER_DRAG_THRESHOLD_PX = 4;
