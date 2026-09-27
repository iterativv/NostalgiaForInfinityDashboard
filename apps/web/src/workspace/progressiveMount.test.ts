// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { planMountBatches } from "./progressiveMount";

/**
 * Progressive mounting keeps every page mount bounded: the planner must
 * cover every id exactly once, keep tree order, cap the first batch (the
 * page top) and cap every later batch (one idle tick's worth of widgets).
 * These invariants are what turn an N-widget page from one unresponsive
 * commit into N/batch short tasks.
 */

describe("planMountBatches", () => {
  it("covers every id exactly once, in order", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];

    expect(planMountBatches(ids, 3, 2).flat()).toEqual(ids);
    expect(planMountBatches([], 3, 2)).toEqual([]);
  });

  it("first batch carries the page top, later batches the step size", () => {
    const batches = planMountBatches(["a", "b", "c", "d", "e", "f", "g", "h"], 3, 2);

    expect(batches.map((batch) => [...batch])).toEqual([
      ["a", "b", "c"],
      ["d", "e"],
      ["f", "g"],
      ["h"],
    ]);
  });

  it("short pages fit in the first batch", () => {
    expect(planMountBatches(["a"], 3, 2).map((b) => [...b])).toEqual([["a"]]);
    expect(planMountBatches(["a", "b"], 3, 2).map((b) => [...b])).toEqual([
      ["a", "b"],
    ]);
  });

  it("never emits an empty batch and floors degenerate options", () => {
    expect(planMountBatches(["a", "b", "c"], 0, 0).map((b) => [...b])).toEqual([
      ["a"],
      ["b"],
      ["c"],
    ]);
  });
});
