// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import {
  parseTradeTime,
  sortClosedPositions,
  sortOpenPositions,
  sortRelativeClosed,
  sortRelativeOpen,
} from "./tradeSort";

describe("tradeSort", () => {
  it("parses space-separated freqtrade dates", () => {
    expect(parseTradeTime(undefined)).toBe(0);
    expect(parseTradeTime("")).toBe(0);
    expect(parseTradeTime("not-a-date")).toBe(0);
    const t = parseTradeTime("2026-09-26 05:35:00");

    expect(t).toBeGreaterThan(0);
    expect(parseTradeTime("2026-09-26T05:35:00")).toBe(t);
  });

  it("sorts open positions newest-first by default", () => {
    const rows = [
      { openDate: "2026-09-24 10:00:00", pair: "A", stakeAmount: 1 },
      { openDate: "2026-09-26 05:35:00", pair: "B", stakeAmount: 1 },
      { openDate: "2026-09-25 10:00:00", pair: "C", stakeAmount: 1 },
    ];

    expect(
      sortOpenPositions(rows, "openDate", "desc").map((r) => r.pair),
    ).toEqual(["B", "C", "A"]);
    expect(
      sortOpenPositions(rows, "openDate", "asc").map((r) => r.pair),
    ).toEqual(["A", "C", "B"]);
  });

  it("sorts closed positions by closeDate desc by default", () => {
    const rows = [
      {
        openDate: "2026-09-24 10:00:00",
        closeDate: "2026-09-24 12:00:00",
        pair: "A",
        stakeAmount: 1,
      },
      {
        openDate: "2026-09-26 05:00:00",
        closeDate: "2026-09-26 05:35:00",
        pair: "B",
        stakeAmount: 1,
      },
      {
        openDate: "2026-09-25 10:00:00",
        closeDate: undefined,
        pair: "C",
        stakeAmount: 1,
      },
    ];

    expect(
      sortClosedPositions(rows, "closeDate", "desc").map((r) => r.pair),
    ).toEqual(["B", "C", "A"]);
  });

  it("sorts relative open rows by date, pair, profit % and wallet weight", () => {
    const rows = [
      {
        openDate: "2026-09-24 10:00:00",
        pair: "A",
        profitPct: 5,
        allocationWeight: 0.5,
      },
      {
        openDate: "2026-09-26 05:35:00",
        pair: "B",
        profitPct: -1,
        allocationWeight: 0.2,
      },
      {
        openDate: "2026-09-25 10:00:00",
        pair: "C",
        profitPct: 2,
        allocationWeight: 0.3,
      },
    ];

    expect(
      sortRelativeOpen(rows, "openDate", "desc").map((r) => r.pair),
    ).toEqual(["B", "C", "A"]);
    expect(sortRelativeOpen(rows, "pair", "asc").map((r) => r.pair)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(
      sortRelativeOpen(rows, "profitPct", "desc").map((r) => r.pair),
    ).toEqual(["A", "C", "B"]);
    expect(sortRelativeOpen(rows, "weight", "desc").map((r) => r.pair)).toEqual(
      ["A", "C", "B"],
    );
  });

  it("sorts relative closed rows by close date and close profit %", () => {
    const rows = [
      {
        openDate: "2026-09-24 10:00:00",
        closeDate: "2026-09-24 12:00:00",
        pair: "A",
        closeProfitPct: 4,
      },
      {
        openDate: "2026-09-26 05:00:00",
        closeDate: "2026-09-26 05:35:00",
        pair: "B",
        closeProfitPct: -2,
      },
      {
        openDate: "2026-09-25 10:00:00",
        closeDate: undefined,
        pair: "C",
        closeProfitPct: 1,
      },
    ];

    expect(
      sortRelativeClosed(rows, "closeDate", "desc").map((r) => r.pair),
    ).toEqual(["B", "C", "A"]);
    expect(
      sortRelativeClosed(rows, "profitPct", "desc").map((r) => r.pair),
    ).toEqual(["A", "C", "B"]);
  });
});
