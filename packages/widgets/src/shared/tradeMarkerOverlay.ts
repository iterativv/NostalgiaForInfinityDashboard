// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Trade marker overlay — a custom lightweight-charts v5 series primitive.
 *
 * The built-in series-markers plugin glues its text to the bar, so on
 * compressed timeframes entry/exit labels overlap the candles (and each
 * other). This primitive redraws the same trade events with a readable
 * visual language instead:
 *
 * - a thin 1.5px leader arrow rises off the bar (amber above = exit, violet
 *   below = entry), its head pointing at the fill candle;
 * - the label pill sits at the FAR end of the arrow, hugging the marker's
 *   LOCAL candle margin — the highest/lowest wick within
 *   `LOCAL_BOUNDS_WINDOW_PX` of the bar — so the leader stays short
 *   instead of running to the pane-wide sky/floor; a hard `MAX_LEADER_LEN`
 *   caps how far a pill may travel from its bar at all;
 * - multiple trades on one candle stack their pills (one per label) along
 *   the arrow instead of concatenating into an unreadable blob;
 * - a collision pass pushes any pill that would overlap an earlier one
 *   further into the clear band (or sideways along it), so neighboring
 *   candles never paint over each other;
 * - labels that no longer fit the band collapse into a `+N` pill — the
 *   arrow still marks the event.
 *
 * The geometry lives in pure functions (`positionTradeMarkers`,
 * `layoutTradeMarkers`) so the stacking/clamping rules stay unit-testable
 * without a canvas; the primitive itself only converts coordinates,
 * measures text against the real canvas context, and paints.
 */

import type {
  CandlestickData,
  IChartApi,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  PrimitivePaneViewZOrder,
  SeriesAttachedParameter,
  SeriesType,
  Time,
  UTCTimestamp,
} from "lightweight-charts";
import type { CanvasRenderingTarget2D } from "fancy-canvas";

export const TRADE_ENTRY_COLOR = "#8a63ff";

export const TRADE_EXIT_COLOR = "#ffa000";

/** Marker side: exits label above the bar (-1), entries below (+1). */
type MarkerSide = -1 | 1;

/** Anything the marker builders emit (structural stand-in for the chart's). */
export interface TradeMarkerInput {
  /** Candle-bucket time, whole UTC seconds. */
  readonly time: number;
  readonly kind: "entry" | "exit";
  readonly labels: ReadonlyArray<string>;
}

/** A marker anchored to a concrete bar: the arrow starts at this candle. */
export interface PositionedTradeMarker {
  readonly time: number;
  readonly kind: "entry" | "exit";
  readonly labels: ReadonlyArray<string>;
  /** Bar high (exit) / low (entry) — the arrow's anchor price. */
  readonly anchorPrice: number;
}

/**
 * Snap markers to their candle bar: exits anchor at the bar HIGH (arrow
 * hangs above), entries at the bar LOW. Markers without a matching candle
 * (window edge race) are dropped rather than drawn at a guessed spot.
 */
export function positionTradeMarkers(
  markers: ReadonlyArray<TradeMarkerInput>,
  candles: ReadonlyArray<CandlestickData>,
): PositionedTradeMarker[] {
  if (markers.length === 0 || candles.length === 0) return [];

  const byTime = new Map<number, CandlestickData>();

  for (const candle of candles) byTime.set(Number(candle.time), candle);

  const positioned: PositionedTradeMarker[] = [];

  for (const marker of markers) {
    const candle = byTime.get(Number(marker.time));

    if (!candle || marker.labels.length === 0) continue;

    const anchorPrice = marker.kind === "exit" ? candle.high : candle.low;

    if (!Number.isFinite(anchorPrice)) continue;

    positioned.push({
      time: Number(marker.time),
      kind: marker.kind,
      labels: marker.labels,
      anchorPrice,
    });
  }

  return positioned;
}

// --- Layout geometry (pure, canvas-free) -----------------------------------

/** Gap between the bar and the arrowhead tip. */
const GAP_FROM_BAR = 8;

/** Arrowhead length (its wings are slightly wider than long). */
const HEAD_LEN = 6;

/** Minimum leader length between the arrowhead and the first pill. */
const MIN_SHAFT = 22;

/**
 * Hard cap on the leader: a pill may never sit farther than this from its
 * bar, even when the candle-free margin reaches further. A shorter arrow
 * that may graze a distant tall wick beats a line spanning half the pane.
 */
export const MAX_LEADER_LEN = 96;

/** Leader stroke width — a touch heavier than hairline so it reads. */
const LEADER_WIDTH = 1.5;

/** Vertical step between stacked pills, and the pill's own padding. */
const PILL_GAP = 3;

const PILL_PAD_X = 6;

const PILL_PAD_Y = 4;

const PILL_LINE_HEIGHT = 14;

/** Pills never exceed most of the pane width (text ellipsizes instead). */
const PILL_MAX_WIDTH_FRACTION = 0.6;

const PILL_MAX_WIDTH = 340;

/** Pane-edge padding for pill rects. */
const EDGE_PAD = 2;

/**
 * Minimum clearance between a pill and the nearest candle wick — pills
 * live entirely above the highest visible high (exits) or below the
 * lowest visible low (entries), never on top of candles.
 */
const PILL_CANDLE_GAP = 5;

/**
 * Half-width of the candle neighborhood a marker's pills are placed
 * against: the renderer hands each marker the highest/lowest wick within
 * this many pixels of its bar (roughly its pill's x-extent), so pills hug
 * the LOCAL margin and the leader arrow stays short instead of running
 * all the way to the pane-wide sky/floor.
 */
export const LOCAL_BOUNDS_WINDOW_PX = 90;

/**
 * Top reserve for the chart's floating legend row (`.nfi-candle-legend`
 * overlays the top of the price pane) — top-clamped pills must stay below
 * it instead of hiding behind the OHLCV readout.
 */
export const LEGEND_INSET = 40;

/** Extra separation demanded between any two pill rects. */
const COLLIDE_PAD = 2;

/** Sideways nudge step when the vertical stack reaches the pane edge. */
const NUDGE_STEP = 8;

const MAX_NUDGES = 6;

const MAX_PLACEMENT_TRIES = 80;

export const PILL_FONT =
  '600 12px "IBM Plex Mono", ui-monospace, monospace';

export const PILL_HEIGHT = PILL_LINE_HEIGHT + 2 * PILL_PAD_Y;

export interface PillRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A label plus its measured (unpadded) text width in px. */
export interface LabelMeasure {
  readonly text: string;
  readonly width: number;
}

/** One marker's geometry in pane pixels, ready to place. */
export interface MarkerLayoutItem {
  /** Bar center x. */
  readonly x: number;
  /** Anchor y (bar high for exits, low for entries). */
  readonly y: number;
  readonly side: MarkerSide;
  readonly labels: ReadonlyArray<LabelMeasure>;
  /**
   * LOCAL candle extremes within `LOCAL_BOUNDS_WINDOW_PX` of the bar —
   * the neighborhood skyline (exits) / floor (entries). When present,
   * pills hug this edge so the leader arrow stays short; the pane-wide
   * `LayoutBounds` remain the hard band. Absent (or without pane bounds)
   * the layout falls back to the band edge / legacy offset behavior.
   */
  readonly skyY?: number;
  readonly floorY?: number;
}

export interface PlacedPill {
  readonly rect: PillRect;
  /** The pill edge facing the bar — where the leader line lands. */
  readonly attachX: number;
  readonly attachY: number;
  readonly text: string;
}

export interface MarkerPlacement {
  readonly x: number;
  readonly y: number;
  readonly side: MarkerSide;
  readonly pills: ReadonlyArray<PlacedPill>;
  /** Labels that fit nowhere — the renderer keeps only the arrow. */
  readonly hidden: number;
}

export type MeasureText = (text: string) => number;

/** Pane geometry that constrains pill placement (candle avoidance). */
export interface LayoutBounds {
  /** Extra y reserve at the pane's top edge (the floating legend row). */
  readonly topInset?: number;
  /** y of the HIGHEST visible candle wick — exit pills stay above it. */
  readonly skyY?: number;
  /** y of the LOWEST visible candle wick — entry pills stay below it. */
  readonly floorY?: number;
}

const overlaps = (a: PillRect, b: PillRect): boolean =>
  a.x - COLLIDE_PAD < b.x + b.w &&
  a.x + a.w + COLLIDE_PAD > b.x &&
  a.y - COLLIDE_PAD < b.y + b.h &&
  a.y + a.h + COLLIDE_PAD > b.y;

const overlapsAny = (rect: PillRect, placed: ReadonlyArray<PillRect>): boolean =>
  placed.some((p) => overlaps(rect, p));

/** Arrow attachment point on a placed pill (stacking continues from here). */
interface PillAttachPoint {
  readonly attachX: number;
  readonly attachY: number;
}

/** Ellipsized label text plus its measured width. */
interface FittedLabel {
  readonly text: string;
  readonly width: number;
}

const attachPointOf = (
  rect: PillRect,
  x: number,
  side: MarkerSide,
): PillAttachPoint => ({
  attachX: Math.min(
    Math.max(rect.x + PILL_PAD_X, x),
    rect.x + rect.w - PILL_PAD_X,
  ),
  attachY: side === -1 ? rect.y + rect.h : rect.y,
});

/** Ellipsize to fit `maxTextWidth`, measured with `measure`. */
export function fitLabelText(
  text: string,
  measure: MeasureText,
  maxTextWidth: number,
): FittedLabel {
  const full = measure(text);

  if (full <= maxTextWidth) return { text, width: full };

  let cut = text.length;

  while (cut > 1) {
    const candidate = `${text.slice(0, cut - 1).trimEnd()}…`;
    const width = measure(candidate);

    if (width <= maxTextWidth) return { text: candidate, width };
    cut -= 1;
  }

  return { text: "…", width: measure("…") };
}

/**
 * Place every marker's label pills in pane space.
 *
 * With candle bounds (`skyY` / `floorY`) the pills never cover candles:
 * exit pills stack UPWARD from just above the highest visible candle
 * wick, entry pills stack DOWNWARD from just below the lowest wick, all
 * centered on their bar. A pill that would overlap an already-placed one
 * steps further into the band; once the band is exhausted it nudges
 * sideways along it, and only then gives up (counted into `hidden`,
 * surfaced as a `+N` pill). Without bounds the pills stack outward from
 * the anchor at a fixed distance — the legacy behavior.
 */
export function layoutTradeMarkers(
  items: ReadonlyArray<MarkerLayoutItem>,
  width: number,
  height: number,
  measure: MeasureText,
  bounds: LayoutBounds = {},
): MarkerPlacement[] {
  if (items.length === 0 || width <= 0 || height <= 0) return [];

  const maxPillWidth = Math.max(
    48,
    Math.min(PILL_MAX_WIDTH, width * PILL_MAX_WIDTH_FRACTION),
  );

  const maxTextWidth = maxPillWidth - 2 * PILL_PAD_X;

  const topInset = Math.max(0, bounds.topInset ?? 0);
  const step = PILL_HEIGHT + PILL_GAP;
  const paneMinPy = topInset;
  const paneMaxPy = height - EDGE_PAD - PILL_HEIGHT;

  const placedRects: PillRect[] = [];
  const placements: MarkerPlacement[] = [];

  for (const item of items) {
    const pills: PlacedPill[] = [];
    let hidden = 0;

    // The pill band for this marker's side, as a [minPy, maxPy] window:
    // exit pills stay above the highest wick, entry pills below the
    // lowest one. Without candle bounds the band spans the whole pane.
    let minPy = paneMinPy;
    let maxPy = paneMaxPy;

    if (item.side === -1 && bounds.skyY !== undefined) {
      maxPy = Math.min(maxPy, bounds.skyY - PILL_CANDLE_GAP - PILL_HEIGHT);
    }

    if (item.side === 1 && bounds.floorY !== undefined) {
      minPy = Math.max(minPy, bounds.floorY + PILL_CANDLE_GAP);
    }

    if (minPy > maxPy) {
      // No candle-free band on this side — best effort at the pane edge.
      minPy = item.side === -1 ? paneMinPy : paneMaxPy;
      maxPy = minPy;
    }

    // When the sky/floor-tightened band has room, the first pill starts
    // from the marker's LOCAL candle edge (the neighborhood skyline for
    // exits, floor for entries) — a SHORT leader from the bar — instead of
    // the pane-wide margin, and never farther than MAX_LEADER_LEN from the
    // anchor. Only the pane extremes bound the start: clamping into the
    // tightened band would drag the pill back out to the pane-wide sky/
    // floor, the long-leader look this placement replaces. Collision
    // stacking below still walks the tightened band. When the band
    // collapsed (skyline pinned to the pane edge) the pill rides that edge
    // — the best an overcrowded pane allows. Without any bounds the pill
    // stacks just beyond the arrowhead (legacy).
    const anchorOffset = GAP_FROM_BAR + HEAD_LEN + PILL_HEIGHT + 4;
    const bandCollapsed = minPy === maxPy;
    const startMinPy = bandCollapsed ? minPy : paneMinPy;
    const startMaxPy = bandCollapsed ? maxPy : paneMaxPy;
    let nearPy: number;

    if (item.side === -1 && (item.skyY !== undefined || bounds.skyY !== undefined)) {
      const edge = Math.min(item.y, item.skyY ?? bounds.skyY!);
      const bottom = Math.max(edge - PILL_CANDLE_GAP, item.y - MAX_LEADER_LEN);

      nearPy = Math.min(
        Math.max(startMinPy, bottom - PILL_HEIGHT),
        startMaxPy,
      );
    } else if (
      item.side === 1 &&
      (item.floorY !== undefined || bounds.floorY !== undefined)
    ) {
      const edge = Math.max(item.y, item.floorY ?? bounds.floorY!);
      const top = Math.min(edge + PILL_CANDLE_GAP, item.y + MAX_LEADER_LEN);

      nearPy = Math.min(Math.max(startMinPy, top), startMaxPy);
    } else if (item.side === -1) {
      nearPy = Math.max(minPy, Math.min(maxPy, item.y - anchorOffset));
    } else {
      nearPy = Math.max(
        minPy,
        Math.min(maxPy, item.y + GAP_FROM_BAR + HEAD_LEN + 4),
      );
    }

    const place = (label: LabelMeasure): boolean => {
      const fitted = fitLabelText(label.text, measure, maxTextWidth);
      const w = fitted.width + 2 * PILL_PAD_X;

      const x = Math.min(
        Math.max(EDGE_PAD, item.x - w / 2),
        Math.max(EDGE_PAD, width - EDGE_PAD - w),
      );

      let py = nearPy;

      for (let attempt = 0; attempt < MAX_PLACEMENT_TRIES; attempt++) {
        const rect: PillRect = { x, y: py, w, h: PILL_HEIGHT };

        if (!overlapsAny(rect, placedRects)) {
          const { attachX, attachY } = attachPointOf(rect, item.x, item.side);

          placedRects.push(rect);
          pills.push({ rect, attachX, attachY, text: fitted.text });

          return true;
        }

        const next = item.side === -1 ? py - step : py + step;

        if (next < minPy - 0.5 || next > maxPy + 0.5) break;

        py = next;
      }

      // Band exhausted on this column — nudge sideways along the band's
      // nearest edge before giving the label up.
      const bandPy = Math.min(Math.max(nearPy, minPy), maxPy);

      for (let nudge = 1; nudge <= MAX_NUDGES; nudge++) {
        const offset =
          Math.ceil(nudge / 2) * (w + NUDGE_STEP) * (nudge % 2 === 1 ? 1 : -1);

        const nx = Math.min(
          Math.max(EDGE_PAD, x + offset),
          Math.max(EDGE_PAD, width - EDGE_PAD - w),
        );

        if (Math.abs(nx - x) < 1) continue;

        const rect: PillRect = { x: nx, y: bandPy, w, h: PILL_HEIGHT };

        if (!overlapsAny(rect, placedRects)) {
          const { attachX, attachY } = attachPointOf(rect, item.x, item.side);

          placedRects.push(rect);
          pills.push({ rect, attachX, attachY, text: fitted.text });

          return true;
        }
      }

      return false;
    };

    for (const label of item.labels) {
      if (!place(label)) hidden += 1;
    }

    if (hidden > 0) {
      const plusText = `+${hidden}`;

      if (place({ text: plusText, width: measure(plusText) })) hidden = 0;
    }

    placements.push({ x: item.x, y: item.y, side: item.side, pills, hidden });
  }

  return placements;
}

/** One candle's pane coordinates (x plus wick extremes), ascending by x. */
export interface CandleX {
  readonly x: number;
  readonly high: number;
  readonly low: number;
}

/** Local wick bounds around a marker (undefined at the pane edge). */
export interface LocalExtremes {
  readonly skyY: number | undefined;
  readonly floorY: number | undefined;
}

/**
 * Highest/lowest wick within `windowPx` of `x`, over candle coordinates
 * sorted ascending by x (time → x is monotonic, so one binary search
 * bounds the walk). Feeds each marker's LOCAL pill band — pills hug the
 * bar's neighborhood instead of the pane-wide margins, keeping leader
 * arrows short. Empty window (marker at the pane edge) yields undefined
 * bounds and the layout falls back to the pane-wide band.
 */
export function localExtremesOf(
  coords: ReadonlyArray<CandleX>,
  x: number,
  windowPx: number,
): LocalExtremes {
  let lo = 0;
  let hi = coords.length;
  const min = x - windowPx;

  while (lo < hi) {
    const mid = (lo + hi) >> 1;

    if (coords[mid]!.x < min) lo = mid + 1;
    else hi = mid;
  }

  let skyY: number | undefined;
  let floorY: number | undefined;

  for (let i = lo; i < coords.length && coords[i]!.x <= x + windowPx; i++) {
    if (skyY === undefined || coords[i]!.high < skyY) skyY = coords[i]!.high;

    if (floorY === undefined || coords[i]!.low > floorY) {
      floorY = coords[i]!.low;
    }
  }

  return { skyY, floorY };
}

// --- Canvas painting --------------------------------------------------------

const hexToRgba = (hex: string, alpha: number): string => {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const PILL_BACKGROUND = "rgba(22, 22, 26, 0.92)";

const roundRectPath = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

const colorOf = (kind: "entry" | "exit"): string =>
  kind === "exit" ? TRADE_EXIT_COLOR : TRADE_ENTRY_COLOR;

/**
 * Paints the primitive's markers for one frame. Everything view-dependent
 * happens here: bar/price coordinates, text measurement, layout, then the
 * leader arrows + pill stacks.
 */
class TradeMarkerPaneRenderer {
  constructor(private readonly primitive: TradeMarkerPrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    const chart = this.primitive.chart;
    const series = this.primitive.series;
    const markers = this.primitive.markers;

    if (!chart || !series || markers.length === 0) return;

    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const { width, height } = mediaSize;
      const timeScale = chart.timeScale();

      ctx.font = PILL_FONT;

      const measure: MeasureText = (text) => ctx.measureText(text).width;
      const items: MarkerLayoutItem[] = [];
      const colors: string[] = [];

      // Candle coordinates for this frame, ascending by x (time → x is
      // monotonic): one pass feeds both the pane-wide skyline/floor and
      // the per-marker local neighborhoods.
      const coords: CandleX[] = [];
      let skyY = height;
      let floorY = 0;

      for (const candle of this.primitive.candles) {
        // SAFETY: `UTCTimestamp` brands a number of whole UTC seconds; the
        // chart's candle times are exactly that (Number() only collapses
        // the Time union to its numeric member).
        const x = timeScale.timeToCoordinate(
          Number(candle.time) as UTCTimestamp,
        );

        if (x === null || x < 0 || x > width) continue;

        const yHigh = series.priceToCoordinate(candle.high);
        const yLow = series.priceToCoordinate(candle.low);

        if (yHigh === null || yLow === null) continue;

        if (yHigh < skyY) skyY = yHigh;

        if (yLow > floorY) floorY = yLow;
        coords.push({ x, high: yHigh, low: yLow });
      }

      for (const marker of markers) {
        // SAFETY: `UTCTimestamp` brands a number of whole UTC seconds —
        // exactly what the candle-bucket marker times are.
        const x = timeScale.timeToCoordinate(marker.time as UTCTimestamp);

        if (x === null || x < 0 || x > width) continue;

        const y = series.priceToCoordinate(marker.anchorPrice);

        if (y === null || y < -PILL_HEIGHT || y > height + PILL_HEIGHT) continue;

        const side: MarkerSide = marker.kind === "exit" ? -1 : 1;
        const local = localExtremesOf(coords, x, LOCAL_BOUNDS_WINDOW_PX);

        items.push({
          x,
          y,
          side,
          labels: marker.labels.map((text) => ({ text, width: measure(text) })),
          skyY: local.skyY,
          floorY: local.floorY,
        });
        colors.push(colorOf(marker.kind));
      }

      if (items.length === 0) return;

      // Reserve the legend row; pills keep clear of the candles.
      const placements = layoutTradeMarkers(items, width, height, measure, {
        topInset: LEGEND_INSET,
        skyY,
        floorY,
      });

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = LEADER_WIDTH;

      placements.forEach((placement, i) => {
        const color = colors[i]!;
        const { x, y, side, pills } = placement;
        const tipY = y + side * GAP_FROM_BAR;
        const first = pills[0];
        const endX = first ? first.attachX : x;

        const endY = first
          ? first.attachY
          : y + side * (GAP_FROM_BAR + HEAD_LEN + MIN_SHAFT);

        // Leader line + arrowhead pointing at the bar.
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(x, tipY);
        ctx.lineTo(endX, endY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(x - HEAD_LEN * 0.7, tipY - side * HEAD_LEN);
        ctx.lineTo(x, tipY);
        ctx.lineTo(x + HEAD_LEN * 0.7, tipY - side * HEAD_LEN);
        ctx.stroke();
        ctx.globalAlpha = 1;

        for (const pill of pills) {
          const { rect } = pill;

          roundRectPath(
            ctx,
            rect.x + 0.5,
            rect.y + 0.5,
            rect.w - 1,
            rect.h - 1,
            4,
          );
          ctx.fillStyle = PILL_BACKGROUND;
          ctx.fill();
          ctx.strokeStyle = hexToRgba(color, 0.55);
          ctx.stroke();

          ctx.fillStyle = color;
          ctx.fillText(pill.text, rect.x + rect.w / 2, rect.y + rect.h / 2 + 0.5);
        }
      });
    });
  }
}

/**
 * The series primitive: holds the positioned markers and exposes one "top"
 * pane view that paints above the candles. `setMarkers` requests exactly
 * one re-render; panning/zooming re-runs the renderer on its own.
 */
export class TradeMarkerPrimitive implements ISeriesPrimitive<Time> {
  /** Module-internal: the pane renderer reads these to draw. */
  chart: IChartApi | null = null;

  series: ISeriesApi<SeriesType, Time> | null = null;

  markers: ReadonlyArray<PositionedTradeMarker> = [];

  /** The loaded candle window — drives the pill-avoidance skyline/floor. */
  candles: ReadonlyArray<CandlestickData> = [];

  private requestUpdate: (() => void) | null = null;

  private readonly view: IPrimitivePaneView = {
    zOrder: (): PrimitivePaneViewZOrder => "top",
    renderer: (): TradeMarkerPaneRenderer | null => {
      if (this.markers.length === 0) return null;

      return new TradeMarkerPaneRenderer(this);
    },
  };

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart;
    this.series = param.series;
    this.requestUpdate = param.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  /** Swap the marker set (identity-compared — SSE ticks pass stable arrays). */
  setMarkers(markers: ReadonlyArray<PositionedTradeMarker>): void {
    if (markers === this.markers) return;

    this.markers = markers;
    this.requestUpdate?.();
  }

  /** Swap the candle window (identity-compared) for pill avoidance. */
  setCandles(candles: ReadonlyArray<CandlestickData>): void {
    if (candles === this.candles) return;

    this.candles = candles;
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  updateAllViews(): void {
    // The renderer reads live state at draw time; nothing to invalidate.
  }
}
