// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import type { RelativeClosedPosition } from "@nfi/api-contract";
import { groupPositionsByTag } from "./PercentEntryStatsWidget";
import { PercentClosedTradesConfigSchema } from "./PercentClosedTradesWidget";

const position = (
  overrides: Partial<RelativeClosedPosition> & { tradeId: number },
): RelativeClosedPosition => ({
  pair: "BTC/USDT",
  isOpen: false,
  openDate: "2026-10-01 10:00:00",
  ...overrides,
});

describe("groupPositionsByTag", () => {
  it("buckets by entry tag, newest first", () => {
    const map = groupPositionsByTag(
      [
        position({ tradeId: 1, enterTag: "grind", closeDate: "2026-10-01 11:00:00" }),
        position({ tradeId: 2, enterTag: "grind", closeDate: "2026-10-02 11:00:00" }),
        position({ tradeId: 3, enterTag: "rapid", closeDate: "2026-10-03 11:00:00" }),
      ],
      false,
    );

    expect([...map.keys()].sort()).toEqual(["grind", "rapid"]);
    expect(map.get("grind")?.map((p) => p.tradeId)).toEqual([2, 1]);
  });

  it("buckets by exit reason when grouped by exit", () => {
    const map = groupPositionsByTag(
      [
        position({ tradeId: 1, enterTag: "grind", exitReason: "trailing" }),
        position({ tradeId: 2, enterTag: "grind", exitReason: "roi" }),
      ],
      true,
    );

    expect(map.get("trailing")?.map((p) => p.tradeId)).toEqual([1]);
    expect(map.get("roi")?.map((p) => p.tradeId)).toEqual([2]);
    expect(map.has("grind")).toBe(false);
  });

  it("buckets blank tags as unknown (matching the backend aggregation)", () => {
    const map = groupPositionsByTag(
      [
        position({ tradeId: 1, enterTag: "grind" }),
        position({ tradeId: 2, enterTag: "" }),
        position({ tradeId: 3 }),
        position({ tradeId: 4, enterTag: "  grind  " }),
      ],
      false,
    );

    expect([...map.keys()].sort()).toEqual(["grind", "unknown"]);
    expect(map.get("grind")?.map((p) => p.tradeId)).toEqual([1, 4]);
    expect(map.get("unknown")?.map((p) => p.tradeId)).toEqual([2, 3]);
  });
});

describe("closed trades % columns", () => {
  it("ships no Since-open column (Profit % is the single profit column)", () => {
    const decoded = Schema.decodeUnknownSync(PercentClosedTradesConfigSchema)(
      {},
    );

    expect(decoded).not.toHaveProperty("showSinceOpen");
  });

  it("still decodes stored payloads carrying the retired key", () => {
    expect(() =>
      Schema.decodeUnknownSync(PercentClosedTradesConfigSchema)({
        showSinceOpen: true,
      }),
    ).not.toThrow();
  });
});
