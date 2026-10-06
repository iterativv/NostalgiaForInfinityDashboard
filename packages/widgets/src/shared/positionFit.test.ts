// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { fitWindowToEntry } from "./positionFit";

/** `fitWindowToEntry` keeps the followed position's entry → now in view. */

const NOW = 1_800_000_000;

const at = (daysAgo: number): number => NOW - Math.round(daysAgo * 86_400);

describe("fitWindowToEntry", () => {
  it("does nothing when the window already covers the entry", () => {
    // 200 × 5m ≈ 16.6h; entry 3h ago fits with room to spare.
    expect(fitWindowToEntry(at(3 / 24), "5m", 200, { nowSec: NOW })).toBeNull();
  });

  it("raises the limit instead of the timeframe when the ceiling allows", () => {
    // Entry 2 days ago at 5m needs ~577+pad candles: over 200, under 1000.
    const fit = fitWindowToEntry(at(2), "5m", 200, { nowSec: NOW });

    expect(fit).not.toBeNull();
    expect(fit?.timeframe).toBe("5m");
    expect(fit?.limit).toBeGreaterThan(200);
    expect(fit?.limit).toBeLessThanOrEqual(1000);
  });

  it("zooms out to the finest timeframe whose window fits a long span", () => {
    // 57 days: 5m/15m/30m/1h all exceed 1000 candles; 4h fits (~342+pad).
    const fit = fitWindowToEntry(at(57), "5m", 200, { nowSec: NOW });

    expect(fit).not.toBeNull();
    expect(fit?.timeframe).toBe("4h");
    expect(fit?.limit).toBeGreaterThan(342);
    expect(fit?.limit).toBeLessThanOrEqual(1000);
  });

  it("pins to 1d × 1000 for spans beyond every timeframe", () => {
    const fit = fitWindowToEntry(at(3650), "1d", 200, { nowSec: NOW });

    expect(fit).toEqual({ timeframe: "1d", limit: 1000 });
  });

  it("never lowers an existing larger limit", () => {
    // Entry 1 day ago at 5m needs ~288+pad; the configured 900 already
    // covers it.
    expect(fitWindowToEntry(at(1), "5m", 900, { nowSec: NOW })).toBeNull();
  });

  it("returns null for unknown timeframes and future entries", () => {
    expect(fitWindowToEntry(at(1), "7h", 200, { nowSec: NOW })).toBeNull();
    expect(
      fitWindowToEntry(NOW + 500, "5m", 200, { nowSec: NOW }),
    ).toBeNull();
  });

  it("coarser-only skips the current timeframe even when a raised limit would fit", () => {
    // 2 days at 5m fits in ≤1000 candles, but the bot's rolling window
    // cannot reach it — the refit must step to 15m (exchange-backed).
    const fit = fitWindowToEntry(at(2), "5m", 200, {
      nowSec: NOW,
      mode: "coarser-only",
    });

    expect(fit).not.toBeNull();
    expect(fit?.timeframe).toBe("15m");
    expect(fit?.limit).toBeGreaterThan(190);
  });

  it("coarser-only never returns the same or a finer timeframe", () => {
    const fit = fitWindowToEntry(at(57), "4h", 400, {
      nowSec: NOW,
      mode: "coarser-only",
    });

    expect(fit).toEqual({ timeframe: "1d", limit: expect.any(Number) });
  });
});
