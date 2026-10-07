// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import type { CandlestickData, UTCTimestamp } from "lightweight-charts";
import {
  MAX_LEADER_LEN,
  PILL_HEIGHT,
  fitLabelText,
  layoutTradeMarkers,
  localExtremesOf,
  positionTradeMarkers,
  type MarkerLayoutItem,
} from "./tradeMarkerOverlay";

/** Monospace-ish fake measure: 6px per character. */
const measure = (text: string): number => text.length * 6;

const PANE_W = 400;

const PANE_H = 300;

/** Test candle with the whole-second time the chart library brands. */
const candle = (
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
): CandlestickData => {
  // SAFETY: `UTCTimestamp` brands a number of whole UTC seconds; these
  // literal test times are exactly that.
  return { time: time as UTCTimestamp, open, high, low, close };
};

const item = (overrides: Partial<MarkerLayoutItem>): MarkerLayoutItem => ({
  x: 100,
  y: 150,
  side: -1,
  labels: [{ text: "Long +1.00%", width: measure("Long +1.00%") }],
  ...overrides,
});

describe("positionTradeMarkers", () => {
  const candles = [
    candle(1000, 5, 10, 1, 7),
    candle(2000, 7, 12, 4, 6),
  ];

  it("anchors exits at the bar high and entries at the bar low", () => {
    const positioned = positionTradeMarkers(
      [
        { time: 1000, kind: "exit", labels: ["Long +2.35% exit"] },
        { time: 2000, kind: "entry", labels: ["Long"] },
      ],
      candles,
    );

    expect(positioned).toEqual([
      { time: 1000, kind: "exit", labels: ["Long +2.35% exit"], anchorPrice: 10 },
      { time: 2000, kind: "entry", labels: ["Long"], anchorPrice: 4 },
    ]);
  });

  it("drops markers without a matching candle or labels", () => {
    expect(
      positionTradeMarkers(
        [
          { time: 999, kind: "exit", labels: ["ghost"] },
          { time: 1000, kind: "exit", labels: [] },
        ],
        candles,
      ),
    ).toEqual([]);
    expect(positionTradeMarkers([], candles)).toEqual([]);
  });
});

describe("layoutTradeMarkers", () => {
  it("places a single label above (exit) / below (entry) the bar", () => {
    const [exit] = layoutTradeMarkers(
      [item({ side: -1 })],
      PANE_W,
      PANE_H,
      measure,
    );

    const [entry] = layoutTradeMarkers(
      [item({ side: 1 })],
      PANE_W,
      PANE_H,
      measure,
    );

    expect(exit?.pills).toHaveLength(1);
    expect(entry?.pills).toHaveLength(1);

    // Exit pill sits fully above the anchor; entry below.
    expect((exit?.pills[0]?.rect.y ?? 0) + PILL_HEIGHT).toBeLessThanOrEqual(150);
    expect(entry?.pills[0]?.rect.y ?? PANE_H).toBeGreaterThanOrEqual(150);
    expect(exit?.hidden).toBe(0);
  });

  it("stacks same-candle labels outward without overlap", () => {
    const labels = ["one", "two", "three"].map((text) => ({
      text,
      width: measure(text),
    }));

    const [placement] = layoutTradeMarkers(
      [item({ labels })],
      PANE_W,
      PANE_H,
      measure,
    );

    expect(placement?.pills.map((p) => p.text)).toEqual(["one", "two", "three"]);

    const rects = placement?.pills.map((p) => p.rect) ?? [];

    for (let i = 1; i < rects.length; i++) {
      // Each next pill is FURTHER from the bar and clear of the previous.
      expect(rects[i]!.y).toBeLessThan(rects[i - 1]!.y);
    }
  });

  it("pushes a colliding neighbor's label further out", () => {
    // Two bars 2px apart with wide labels — the second must not overlap.
    const wide = { text: "Long +0.98% exit profit long", width: measure("Long +0.98% exit profit long") };

    const [a, b] = layoutTradeMarkers(
      [item({ x: 100, labels: [wide] }), item({ x: 102, labels: [wide] })],
      PANE_W,
      PANE_H,
      measure,
    );

    const rectA = a?.pills[0]?.rect;
    const rectB = b?.pills[0]?.rect;

    expect(rectA).toBeDefined();
    expect(rectB).toBeDefined();
    expect(rectB!.y + PILL_HEIGHT).toBeLessThan(rectA!.y);
  });

  it("keeps pills inside the pane and ellipsizes oversized text", () => {
    const huge = "x".repeat(200);

    const [placement] = layoutTradeMarkers(
      [item({ x: 20, y: 20, labels: [{ text: huge, width: measure(huge) }] })],
      PANE_W,
      PANE_H,
      measure,
    );

    const rect = placement?.pills[0]?.rect;

    expect(rect).toBeDefined();
    expect(rect!.x).toBeGreaterThanOrEqual(2);
    expect(rect!.x + rect!.w).toBeLessThanOrEqual(PANE_W - 2);
    expect(placement?.pills[0]?.text.endsWith("…")).toBe(true);
  });

  it("respects the top inset so pills clear the floating legend", () => {
    // Anchor near the pane top: without an inset the pill clamps to y=0,
    // with LEGEND_INSET it must clamp below the reserved band.
    const marker = item({ x: 200, y: 30 });
    const [bare] = layoutTradeMarkers([marker], PANE_W, PANE_H, measure);

    const [inset] = layoutTradeMarkers([marker], PANE_W, PANE_H, measure, {
      topInset: 40,
    });

    expect(bare?.pills[0]?.rect.y).toBe(0);
    expect(inset?.pills[0]?.rect.y).toBe(40);
  });

  it("keeps exit pills above the highest candle and entries below the lowest", () => {
    const skyY = 90;
    const floorY = 210;
    const bounds = { skyY, floorY };

    const [exit] = layoutTradeMarkers(
      [item({ x: 100, y: 150, side: -1 })],
      PANE_W,
      PANE_H,
      measure,
      bounds,
    );

    const [entry] = layoutTradeMarkers(
      [item({ x: 100, y: 150, side: 1 })],
      PANE_W,
      PANE_H,
      measure,
      bounds,
    );

    const exitRect = exit?.pills[0]?.rect;
    const entryRect = entry?.pills[0]?.rect;

    // Pill clears the wick with the gap, entirely off the candles.
    expect(exitRect!.y + PILL_HEIGHT).toBeLessThanOrEqual(skyY - 5);
    expect(entryRect!.y).toBeGreaterThanOrEqual(floorY + 5);
  });

  it("stacks multiple exit pills upward within the candle-free band", () => {
    const skyY = 120;

    const [placement] = layoutTradeMarkers(
      [
        item({
          x: 200,
          y: 150,
          side: -1,
          labels: ["one", "two", "three", "four"].map((t) => ({
            text: t,
            width: measure(t),
          })),
        }),
      ],
      PANE_W,
      PANE_H,
      measure,
      { skyY },
    );

    const rects = placement?.pills.map((p) => p.rect) ?? [];

    expect(rects.length).toBe(4);

    for (const rect of rects) {
      // Every pill stays above the skyline (candle-free).
      expect(rect.y + PILL_HEIGHT).toBeLessThanOrEqual(skyY - 5);
    }

    for (let i = 1; i < rects.length; i++) {
      expect(rects[i]!.y).toBeLessThan(rects[i - 1]!.y);
    }
  });

  it("falls back to the pane edge when no band fits above the candles", () => {
    // Skyline right at the pane top: no room above the candles.
    const [placement] = layoutTradeMarkers(
      [item({ x: 200, y: 150, side: -1 })],
      PANE_W,
      PANE_H,
      measure,
      { skyY: 24 },
    );

    const rect = placement?.pills[0]?.rect;

    expect(rect).toBeDefined();
    // The band collapses to the sliver above the skyline — the pill rides
    // the pane top, the best an overcrowded pane allows.
    expect(rect!.y).toBeLessThanOrEqual(1);
  });

  it("hugs the LOCAL skyline so the leader stays short", () => {
    // Bar mid-pane; the pane-wide skyline sits high up (a tall candle
    // elsewhere) while the bar's own neighborhood tops out just above it.
    const [exit] = layoutTradeMarkers(
      [item({ x: 100, y: 150, side: -1, skyY: 120 })],
      PANE_W,
      PANE_H,
      measure,
      { skyY: 30 },
    );

    const rect = exit?.pills[0]?.rect;

    expect(rect).toBeDefined();
    // Clear of the local wick, but hugging it — nowhere near the pane-wide
    // margin the old global-band placement parked pills at.
    expect(rect!.y + PILL_HEIGHT).toBeLessThanOrEqual(120 - 5);
    expect(rect!.y + PILL_HEIGHT).toBeGreaterThan(90);
  });

  it("caps the leader length even under a far skyline", () => {
    const [exit] = layoutTradeMarkers(
      [item({ x: 100, y: 290, side: -1, skyY: 60 })],
      PANE_W,
      PANE_H,
      measure,
      { skyY: 60 },
    );

    const rect = exit?.pills[0]?.rect;

    expect(rect).toBeDefined();
    // The pill's bar-facing edge never travels farther than
    // MAX_LEADER_LEN above the anchor, however far the margin reaches.
    expect(rect!.y + PILL_HEIGHT).toBeGreaterThanOrEqual(290 - MAX_LEADER_LEN);
  });

  it("places entry pills just below the local floor", () => {
    const [entry] = layoutTradeMarkers(
      [item({ x: 100, y: 150, side: 1, floorY: 170 })],
      PANE_W,
      PANE_H,
      measure,
      { floorY: 260 },
    );

    const rect = entry?.pills[0]?.rect;

    expect(rect).toBeDefined();
    // Top edge just under the neighborhood floor, not the pane-wide one.
    expect(rect!.y).toBeGreaterThanOrEqual(170 + 5);
    expect(rect!.y).toBeLessThanOrEqual(190);
  });

  it("counts labels that fit nowhere into hidden with a +N pill", () => {
    // A pane only a few pills tall, fed a dozen labels at one bar.
    const labels = Array.from({ length: 12 }, (_, i) => ({
      text: `label-${i}`,
      width: measure(`label-${i}`),
    }));

    const [placement] = layoutTradeMarkers(
      [item({ y: 290, labels })],
      PANE_W,
      60,
      measure,
    );

    const pills = placement?.pills ?? [];
    const shownLabels = pills.filter((p) => p.text.startsWith("label-"));

    // Conservation: every label is either shown, rolled into the +N pill,
    // or counted as hidden.
    expect(shownLabels.length + (placement?.hidden ?? 0)).toBe(12);
    expect(shownLabels.length).toBeGreaterThan(0);
    expect(shownLabels.length).toBeLessThan(12);
    expect(pills.at(-1)?.text).toMatch(/^(\+\d+|label-\d+)$/);

    // Whatever fit stays inside the pane and never overlaps.
    for (const pill of pills) {
      expect(pill.rect.y).toBeGreaterThanOrEqual(2);
      expect(pill.rect.y + PILL_HEIGHT).toBeLessThanOrEqual(58);
      expect(pill.rect.x).toBeGreaterThanOrEqual(2);
      expect(pill.rect.x + pill.rect.w).toBeLessThanOrEqual(PANE_W - 2);
    }

    for (let i = 0; i < pills.length; i++) {
      for (let j = i + 1; j < pills.length; j++) {
        const a = pills[i]!.rect;
        const b = pills[j]!.rect;

        const separated =
          a.x + a.w + 2 <= b.x ||
          b.x + b.w + 2 <= a.x ||
          a.y + a.h + 2 <= b.y ||
          b.y + b.h + 2 <= a.y;

        expect(separated).toBe(true);
      }
    }
  });

  it("returns no placements for empty input or degenerate panes", () => {
    expect(layoutTradeMarkers([], PANE_W, PANE_H, measure)).toEqual([]);
    expect(layoutTradeMarkers([item({})], 0, 0, measure)).toEqual([]);
  });
});

describe("localExtremesOf", () => {
  const coords = [
    { x: 10, high: 50, low: 60 },
    { x: 20, high: 40, low: 70 },
    { x: 30, high: 30, low: 80 },
    { x: 40, high: 45, low: 65 },
    { x: 200, high: 5, low: 95 },
  ];

  it("returns the window's highest wick and lowest wick", () => {
    expect(localExtremesOf(coords, 25, 10)).toEqual({
      skyY: 30,
      floorY: 80,
    });
  });

  it("ignores candles outside the window", () => {
    expect(localExtremesOf(coords, 30, 5)).toEqual({ skyY: 30, floorY: 80 });
    expect(localExtremesOf(coords, 200, 10)).toEqual({ skyY: 5, floorY: 95 });
  });

  it("yields no bounds for an empty window", () => {
    expect(localExtremesOf([], 25, 90)).toEqual({
      skyY: undefined,
      floorY: undefined,
    });
    expect(localExtremesOf(coords, 500, 10)).toEqual({
      skyY: undefined,
      floorY: undefined,
    });
  });
});

describe("fitLabelText", () => {
  it("keeps text that already fits", () => {
    expect(fitLabelText("Short", measure, 60)).toEqual({
      text: "Short",
      width: 30,
    });
  });

  it("ellipsizes with a trailing ellipsis inside the budget", () => {
    const fitted = fitLabelText("Long +0.98% exit profit", measure, 40);

    expect(fitted.width).toBeLessThanOrEqual(40);
    expect(fitted.text.endsWith("…")).toBe(true);
    expect(fitted.text.length).toBeLessThan("Long +0.98% exit profit".length);
  });
});
