// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest"
import { orderedByTime } from "./CandleChart"

/**
 * lightweight-charts asserts strictly ascending UNIQUE timestamps on every
 * `setData`; one duplicated candle from freqtrade crashes the whole chart
 * widget through the panel error boundary. `orderedByTime` is the guard.
 */
describe("orderedByTime", () => {
  it("keeps the last point per timestamp and sorts ascending", () => {
    const points = [
      { time: 300, v: "old-300" },
      { time: 100, v: "100" },
      { time: 300, v: "new-300" },
      { time: 200, v: "200" },
    ]
    expect(orderedByTime(points)).toEqual([
      { time: 100, v: "100" },
      { time: 200, v: "200" },
      { time: 300, v: "new-300" },
    ])
  })

  it("mirrors the exact duplicate shape seen in production (index 2)", () => {
    // Reproduces the field report: time=1789961 repeated at index 2.
    const candles = [
      { time: 1789959, close: 1 },
      { time: 1789961, close: 2 },
      { time: 1789961, close: 3 },
      { time: 1789963, close: 4 },
    ]
    const clean = orderedByTime(candles)
    expect(clean.map((c) => c.time)).toEqual([1789959, 1789961, 1789963])
    expect(clean[1]?.close).toBe(3)
    for (let i = 1; i < clean.length; i++) {
      expect(clean[i]!.time).toBeGreaterThan(clean[i - 1]!.time)
    }
  })

  it("handles empty and single-point series", () => {
    expect(orderedByTime([])).toEqual([])
    expect(orderedByTime([{ time: 5 }])).toEqual([{ time: 5 }])
  })
})
