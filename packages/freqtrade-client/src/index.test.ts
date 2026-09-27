// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { tradesTailBounds } from "./index.js";

/**
 * Regression tests for the closed-trades window translation.
 *
 * Freqtrade's `GET /api/v1/trades` is OLDEST-anchored (offset skips the
 * oldest trades, rows ascend, `total_trades` counts closed trades only —
 * verified against a live bot where `/trades?limit=50&offset=0` returned
 * trades 1..50 of a 125-trade history). `getClosedPositions` must therefore
 * translate its newest-anchored window into these coordinates before
 * fetching; these tests pin that translation.
 */
describe("tradesTailBounds (newest-anchored → oldest-anchored)", () => {
  it("maps the first page onto the tail of history", () => {
    // The bug this guards: offset=0 used to fetch trades [0,50) — the
    // OLDEST trades — instead of the newest 50.
    expect(tradesTailBounds(125, 50, 0)).toEqual({ start: 75, end: 125 });
    expect(tradesTailBounds(30, 50, 0)).toEqual({ start: 0, end: 30 });
  });

  it("pages further back as offset grows (search scans)", () => {
    expect(tradesTailBounds(1_200, 500, 0)).toEqual({ start: 700, end: 1_200 });
    expect(tradesTailBounds(1_200, 500, 500)).toEqual({
      start: 200,
      end: 700,
    });
    expect(tradesTailBounds(1_200, 500, 1_000)).toEqual({
      start: 0,
      end: 200,
    });
  });

  it("clamps past-the-end offsets and degenerate inputs", () => {
    expect(tradesTailBounds(125, 50, 200)).toEqual({ start: 0, end: 0 });
    expect(tradesTailBounds(0, 50, 0)).toEqual({ start: 0, end: 0 });
    expect(tradesTailBounds(125, 0, 0)).toEqual({ start: 125, end: 125 });
    expect(tradesTailBounds(125, -10, -5)).toEqual({ start: 125, end: 125 });
  });
});
