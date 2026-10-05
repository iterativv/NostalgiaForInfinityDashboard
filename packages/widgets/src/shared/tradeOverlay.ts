// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Trade overlay helpers for the candle chart — pure functions, no chart
 * imports (kept import-free so they stay unit-testable without a canvas).
 *
 * Visual language (mirrors the reference NFI trade view):
 * - entries → violet dot below the bar, labeled with the order tag
 *   (e.g. `grind 4 entry` renders as `grind 4 entry`);
 * - exits / derisks → amber arrow above the bar, labeled with the tag plus
 *   an `exit` suffix unless the tag already says exit/derisk
 *   (e.g. `grind 5 exit`);
 * - orders landing on the same candle + side collapse into ONE marker with
 *   space-joined labels (e.g. `grind 5 exit 501 472 403` in the reference).
 */

export type TradeMarkerKind = "entry" | "exit";

/** One chart marker, time in whole seconds (UTC candle-bucket time). */
export interface TradeMarker {
  readonly time: number;
  readonly kind: TradeMarkerKind;
  readonly text: string;
}

/** Minimal order shape the overlay needs (subset of `TradeOrder`). */
export interface OverlayOrder {
  readonly price?: number;
  readonly tag?: string;
  readonly side?: string;
  readonly isEntry?: boolean;
  readonly timestamp?: number;
  readonly filledTimestamp?: number;
}

/** Freqtrade candle timeframes the chart supports → seconds per candle. */
export function timeframeSeconds(timeframe: string): number | null {
  switch (timeframe) {
    case "1m":
      return 60;
    case "5m":
      return 300;
    case "15m":
      return 900;
    case "30m":
      return 1800;
    case "1h":
      return 3600;
    case "4h":
      return 14400;
    case "1d":
      return 86400;
    default:
      return null;
  }
}

/** Order event time: fill time when known, else the order time. */
export const orderEventMs = (order: OverlayOrder): number | null => {
  const t = order.filledTimestamp ?? order.timestamp;

  if (t === undefined || !Number.isFinite(t) || t <= 0) return null;

  return t;
};

const EXIT_HINT = /exit|derisk|take|stop|close/i;

/** `grind_4_entry` → `grind 4 entry`; empty tags fall back to the kind. */
export function prettifyOrderTag(
  tag: string | undefined,
  kind: TradeMarkerKind,
): string {
  const cleaned = (tag ?? "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const base = cleaned.length > 0 ? cleaned : kind;

  if (kind === "exit" && !EXIT_HINT.test(base)) return `${base} exit`;

  return base;
}

const isExitOrder = (order: OverlayOrder): boolean => {
  if (order.isEntry === true) return false;

  if (order.isEntry === false) return true;

  return (order.side ?? "").toLowerCase() === "sell";
};

const MAX_MARKER_LABELS = 3;

const MAX_LABEL_CHARS = 64;

/**
 * Orders → chart markers snapped to the visible candle buckets.
 *
 * - buckets snap via timeframe flooring (`Math.floor(sec / tf) * tf`);
 * - orders outside `[first, last + tf]` are dropped (another pair's history
 *   or pre-window fills must never pin markers to the window edge);
 * - gapped buckets fall back to the nearest candle within one timeframe step;
 * - same `(bucket, kind)` groups merge into one marker, first-seen order.
 */
export function buildTradeMarkers(
  orders: ReadonlyArray<OverlayOrder>,
  candleSeconds: ReadonlyArray<number>,
  tfSeconds: number,
): TradeMarker[] {
  if (
    orders.length === 0 ||
    candleSeconds.length === 0 ||
    !Number.isFinite(tfSeconds) ||
    tfSeconds <= 0
  ) {
    return [];
  }

  const buckets = new Set<number>(candleSeconds);
  const sorted = [...candleSeconds].sort((a, b) => a - b);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  const grouped = new Map<string, { time: number; kind: TradeMarkerKind; labels: string[] }>();

  for (const order of orders) {
    const eventMs = orderEventMs(order);

    if (eventMs === null) continue;

    const sec = Math.floor(eventMs / 1000);
    let bucket = Math.floor(sec / tfSeconds) * tfSeconds;

    if (bucket < first || bucket > last + tfSeconds) continue;

    if (!buckets.has(bucket)) {
      let nearest: number | null = null;
      let nearestDist = Infinity;

      for (const c of sorted) {
        const dist = Math.abs(c - bucket);

        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = c;
        }
      }

      if (nearest === null || nearestDist > tfSeconds) continue;

      bucket = nearest;
    }

    const kind: TradeMarkerKind = isExitOrder(order) ? "exit" : "entry";
    const label = prettifyOrderTag(order.tag, kind);
    const key = `${bucket}:${kind}`;
    const existing = grouped.get(key);

    if (existing) {
      if (!existing.labels.includes(label)) existing.labels.push(label);
    } else {
      grouped.set(key, { time: bucket, kind, labels: [label] });
    }
  }

  return [...grouped.values()]
    .sort((a, b) => a.time - b.time || (a.kind === b.kind ? 0 : a.kind === "entry" ? -1 : 1))
    .slice(-200)
    .map(({ time, kind, labels }): TradeMarker => {
      const shown = labels.slice(0, MAX_MARKER_LABELS).join(" ");
      const extra = labels.length - Math.min(labels.length, MAX_MARKER_LABELS);

      const text =
        (extra > 0 ? `${shown} +${extra}` : shown).slice(0, MAX_LABEL_CHARS).trim() || kind;

      return { time, kind, text };
    });
}

/**
 * Stake-weighted average entry across the pair's open positions (the blue
 * `avg entry` line). Single-position pairs — the common case — return their
 * `openRate` untouched.
 */
export function averageEntryPrice(
  positions: ReadonlyArray<{ openRate: number; stakeAmount: number }>,
): number | null {
  let weighted = 0;
  let stake = 0;

  for (const p of positions) {
    if (!Number.isFinite(p.openRate) || p.openRate <= 0) continue;

    if (!Number.isFinite(p.stakeAmount) || p.stakeAmount <= 0) continue;

    weighted += p.openRate * p.stakeAmount;
    stake += p.stakeAmount;
  }

  if (stake <= 0) return null;

  return weighted / stake;
}

/**
 * Parse a freqtrade position date (`"YYYY-MM-DD HH:mm:ss"` naive UTC, or an
 * ISO string) to epoch millis. Unlike `parseTradeTime` (tradeSort — local
 * zone, fine for ordering), markers must align with UTC candle buckets, so
 * naive strings pin `Z` and explicit offsets are honored as-is. Garbage
 * yields null (the caller drops the event).
 */
export function parsePositionTime(value: string | undefined): number | null {
  if (!value) return null;

  const normalized = value.includes("T") ? value : value.replace(" ", "T");

  const zoned =
    /[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? normalized : `${normalized}Z`;

  const t = new Date(zoned).getTime();

  return Number.isNaN(t) ? null : t;
}

/** One position-history event feeding the public marker builder. */
export interface PositionMarkerEvent {
  /** Event time in epoch millis (UTC) — e.g. `parsePositionTime(openDate)`. */
  readonly timeMs: number;
  readonly kind: TradeMarkerKind;
  /**
   * Final label — direction plus an optional signed percentage
   * (e.g. `"Long"`, `"Short -1.23%"`). Never an absolute amount: the caller
   * builds it from `isShort` / `profitPct` / `closeProfitPct` only. Exits
   * gain the same ` exit` suffix the order path appends.
   */
  readonly text: string;
}

/** `Long` / `Short` marker label for a (relative) position's direction. */
export function positionDirection(isShort: boolean | undefined): string {
  return isShort === true ? "Short" : "Long";
}

/**
 * Exit label for a closed (relative) position: direction plus the signed
 * percentage (`closeProfitPct`, falling back to `profitPct`). Percentages
 * are scale-free, so the text stays shareable. Missing percentages fall
 * back to the bare direction.
 */
export function positionExitText(
  isShort: boolean | undefined,
  closeProfitPct: number | undefined,
  profitPct: number | undefined,
): string {
  const dir = positionDirection(isShort);

  // NaN is missing data, not zero: skip non-finite candidates so a NaN
  // close percentage falls back to the open percentage (and both-NaN to
  // the bare direction).
  const pct = [closeProfitPct, profitPct].find(
    (v) => v !== undefined && Number.isFinite(v),
  );

  if (pct === undefined) return dir;

  return `${dir} ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

/**
 * Position-history events → chart markers, snapped to the visible candle
 * buckets with the exact semantics of `buildTradeMarkers` (timeframe floor,
 * window cut, nearest-candle fallback, same-bucket merge, newest 200).
 *
 * Position-level dates stand in for per-order fill times: the `.relative`
 * capabilities strip order timestamps (and every amount) by design, while
 * position `openDate` / `closeDate` are already public. One entry per open
 * position, one entry + one exit per closed position.
 */
export function buildPositionHistoryMarkers(
  events: ReadonlyArray<PositionMarkerEvent>,
  candleSeconds: ReadonlyArray<number>,
  tfSeconds: number,
): TradeMarker[] {
  return buildTradeMarkers(
    events.map((event) => ({
      timestamp: event.timeMs,
      isEntry: event.kind === "entry",
      tag: event.text,
    })),
    candleSeconds,
    tfSeconds,
  );
}
