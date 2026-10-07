// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { mergeOlderCandles } from "./candleHistory";

const candle = (time: number, close: number) => ({
  time,
  open: close,
  high: close + 1,
  low: close - 1,
  close,
  volume: 1,
});

describe("mergeOlderCandles", () => {
  it("prepends the incoming older page ascending", () => {
    const live = [candle(900_000, 5), candle(960_000, 6)];
    const page = [candle(780_000, 3), candle(840_000, 4)];

    expect(mergeOlderCandles([], page).map((c) => c.time)).toEqual([
      780_000, 840_000,
    ]);
    expect(mergeOlderCandles(page, live).map((c) => c.time)).toEqual([
      780_000, 840_000, 900_000, 960_000,
    ]);
  });

  it("keeps the newest duplicate per time at the page seam", () => {
    const accumulated = [candle(840_000, 4)];
    const page = [candle(780_000, 3), candle(840_000, 99)];

    // The incoming page's copy of the seam candle wins (newest data wins —
    // same rule as the chart's own sanitizer).
    expect(mergeOlderCandles(accumulated, page)).toHaveLength(2);
    expect(
      mergeOlderCandles(accumulated, page).find((c) => c.time === 840_000)
        ?.close,
    ).toBe(99);
  });

  it("returns accumulated untouched for an empty page", () => {
    const accumulated = [candle(900_000, 5)];

    expect(mergeOlderCandles(accumulated, [])).toEqual(accumulated);
  });
});
