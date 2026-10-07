// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import {
  MAX_HISTORY_PNL_SPANS,
  averageEntryPrice,
  buildHistoryPnlSpans,
  buildPositionHistoryMarkers,
  buildTradeMarkers,
  earliestEntrySecond,
  parsePositionTime,
  positionDirection,
  positionExitText,
  prettifyOrderTag,
  timeframeSeconds,
} from "./tradeOverlay";

const TF = 14_400; // 4h

/** Aligned 4h buckets: [b0, b1, b2]. */
const buckets = (() => {
  const b0 =
    Math.floor(Date.UTC(2024, 4, 1) / 1000 / TF) * TF;

  return [b0, b0 + TF, b0 + 2 * TF];
})();

describe("timeframeSeconds", () => {
  it("maps the chart timeframes and rejects unknown ones", () => {
    expect(timeframeSeconds("1m")).toBe(60);
    expect(timeframeSeconds("5m")).toBe(300);
    expect(timeframeSeconds("4h")).toBe(14_400);
    expect(timeframeSeconds("1d")).toBe(86_400);
    expect(timeframeSeconds("2h")).toBeNull();
  });
});

describe("prettifyOrderTag", () => {
  it("turns snake_case tags into labels", () => {
    expect(prettifyOrderTag("grind_4_entry", "entry")).toBe("grind 4 entry");
    expect(prettifyOrderTag("derisk_level_3", "exit")).toBe("derisk level 3");
  });

  it("appends an exit suffix unless the tag already says it", () => {
    expect(prettifyOrderTag("grind_5", "exit")).toBe("grind 5 exit");
    expect(prettifyOrderTag("grind_5_exit", "exit")).toBe("grind 5 exit");
    expect(prettifyOrderTag("grind_2", "entry")).toBe("grind 2");
  });

  it("falls back to the kind for empty tags", () => {
    expect(prettifyOrderTag(undefined, "entry")).toBe("entry");
    expect(prettifyOrderTag("  ", "exit")).toBe("exit");
  });
});

describe("buildTradeMarkers", () => {
  it("snaps entries below and exits above their candle bucket", () => {
    const [b0, b1] = buckets;

    const markers = buildTradeMarkers(
      [
        {
          tag: "grind_2",
          isEntry: true,
          side: "buy",
          timestamp: b0! * 1000 + 3_600_000,
          price: 0.32,
        },
        {
          tag: "grind_1",
          isEntry: false,
          side: "sell",
          timestamp: b1! * 1000 + 1_000,
          price: 0.37,
        },
      ],
      buckets,
      TF,
    );

    expect(markers).toEqual([
      { time: b0, kind: "entry", labels: ["grind 2"] },
      { time: b1, kind: "exit", labels: ["grind 1 exit"] },
    ]);
  });

  it("merges same-candle same-side orders into one marker", () => {
    const [b0] = buckets;

    const markers = buildTradeMarkers(
      [
        { tag: "grind_5", side: "sell", timestamp: b0! * 1000 + 10_000 },
        { tag: "501", side: "sell", timestamp: b0! * 1000 + 20_000 },
        { tag: "472", side: "sell", timestamp: b0! * 1000 + 30_000 },
      ],
      buckets,
      TF,
    );

    expect(markers).toHaveLength(1);
    expect(markers[0]?.kind).toBe("exit");
    expect(markers[0]?.labels).toEqual(["grind 5 exit", "501 exit", "472 exit"]);
  });

  it("caps the labels stacked per marker", () => {
    const [b0] = buckets;

    const markers = buildTradeMarkers(
      Array.from({ length: 12 }, (_, i) => ({
        tag: `t${i}`,
        side: "sell",
        timestamp: b0! * 1000 + (i + 1) * 1_000,
      })),
      buckets,
      TF,
    );

    expect(markers).toHaveLength(1);
    expect(markers[0]?.labels).toHaveLength(8);
  });

  it("keeps entries and exits on the same candle as two markers", () => {
    const [b0] = buckets;

    const markers = buildTradeMarkers(
      [
        { tag: "grind_5", isEntry: true, timestamp: b0! * 1000 + 10_000 },
        { tag: "grind_5", isEntry: false, timestamp: b0! * 1000 + 20_000 },
      ],
      buckets,
      TF,
    );

    expect(markers.map((m) => m.kind).sort()).toEqual(["entry", "exit"]);
  });

  it("drops orders outside the candle window and order-less input", () => {
    const [b0] = buckets;

    const markers = buildTradeMarkers(
      [
        // A month before the window — another pair's history must not pin.
        { tag: "old", side: "buy", timestamp: (b0! - 30 * 86_400) * 1000 },
        // No timestamp at all.
        { tag: "ghost", side: "buy" },
      ],
      buckets,
      TF,
    );

    expect(markers).toEqual([]);
    expect(buildTradeMarkers([], buckets, TF)).toEqual([]);
    expect(buildTradeMarkers([{ tag: "x" }], [], TF)).toEqual([]);
  });

  it("prefers the fill timestamp over the order timestamp", () => {
    const [b0, , b2] = buckets;

    const markers = buildTradeMarkers(
      [
        {
          tag: "grind_3",
          isEntry: true,
          timestamp: b0! * 1000,
          filledTimestamp: b2! * 1000 + 5_000,
        },
      ],
      buckets,
      TF,
    );

    expect(markers).toEqual([{ time: b2, kind: "entry", labels: ["grind 3"] }]);
  });
});

describe("averageEntryPrice", () => {
  it("returns the single position rate untouched", () => {
    expect(
      averageEntryPrice([{ openRate: 0.35, stakeAmount: 23.1 }]),
    ).toBeCloseTo(0.35, 12);
  });

  it("stake-weights multiple positions and skips junk rows", () => {
    expect(
      averageEntryPrice([
        { openRate: 0.4, stakeAmount: 10 },
        { openRate: 0.3, stakeAmount: 30 },
        { openRate: Number.NaN, stakeAmount: 5 },
        { openRate: 0.5, stakeAmount: 0 },
      ]),
    ).toBeCloseTo(0.325, 12);
  });

  it("returns null with nothing to average", () => {
    expect(averageEntryPrice([])).toBeNull();
    expect(
      averageEntryPrice([{ openRate: 0, stakeAmount: 10 }]),
    ).toBeNull();
  });
});

describe("parsePositionTime", () => {
  it("pins naive freqtrade timestamps to UTC, not browser-local", () => {
    expect(parsePositionTime("2024-05-01 12:00:00")).toBe(
      Date.UTC(2024, 4, 1, 12, 0, 0),
    );
  });

  it("honors explicit offsets and ISO strings", () => {
    expect(parsePositionTime("2024-05-01T12:00:00+02:00")).toBe(
      Date.UTC(2024, 4, 1, 10, 0, 0),
    );
    expect(parsePositionTime("2024-05-01T12:00:00Z")).toBe(
      Date.UTC(2024, 4, 1, 12, 0, 0),
    );
  });

  it("returns null for missing or garbage input", () => {
    expect(parsePositionTime(undefined)).toBeNull();
    expect(parsePositionTime("")).toBeNull();
    expect(parsePositionTime("not a date")).toBeNull();
  });
});

describe("position marker labels", () => {
  it("labels direction without absolutes", () => {
    expect(positionDirection(true)).toBe("Short");
    expect(positionDirection(false)).toBe("Long");
    expect(positionDirection(undefined)).toBe("Long");
  });

  it("appends the signed percentage to exits, preferring close profit", () => {
    expect(positionExitText(false, 2.345, 1)).toBe("Long +2.35%");
    expect(positionExitText(true, undefined, -1.2)).toBe("Short -1.20%");
    expect(positionExitText(false, 0, 5)).toBe("Long +0.00%");
    expect(positionExitText(false, undefined, undefined)).toBe("Long");
    expect(positionExitText(false, Number.NaN, 1)).toBe("Long +1.00%");
  });
});

describe("buildPositionHistoryMarkers", () => {
  it("marks entries below and exits above their candle bucket", () => {
    const [b0, b1] = buckets;

    const markers = buildPositionHistoryMarkers(
      [
        {
          timeMs: b0! * 1000 + 3_600_000,
          kind: "entry",
          text: "Long",
        },
        {
          timeMs: b1! * 1000 + 1_000,
          kind: "exit",
          text: "Long +2.35%",
        },
      ],
      buckets,
      TF,
    );

    expect(markers).toEqual([
      { time: b0, kind: "entry", labels: ["Long"] },
      { time: b1, kind: "exit", labels: ["Long +2.35% exit"] },
    ]);
  });

  it("merges same-candle same-side events and drops out-of-window ones", () => {
    const [b0] = buckets;

    const markers = buildPositionHistoryMarkers(
      [
        { timeMs: b0! * 1000 + 10_000, kind: "entry", text: "Long" },
        { timeMs: b0! * 1000 + 20_000, kind: "entry", text: "Short" },
        // A month before the window — another pair's history must not pin.
        { timeMs: (b0! - 30 * 86_400) * 1000, kind: "entry", text: "Long" },
      ],
      buckets,
      TF,
    );

    expect(markers).toHaveLength(1);
    expect(markers[0]?.kind).toBe("entry");
    expect(markers[0]?.labels).toEqual(["Long", "Short"]);
  });

  it("returns nothing for empty input", () => {
    expect(buildPositionHistoryMarkers([], buckets, TF)).toEqual([]);
  });
});

describe("earliestEntrySecond", () => {
  const day = Date.UTC(2024, 4, 1);

  it("prefers the earliest order fill time across positions", () => {
    expect(
      earliestEntrySecond([
        {
          openDate: "2024-05-01T00:00:00Z",
          orders: [{ timestamp: day + 3_600_000 }],
        },
        {
          openDate: "2024-05-01T00:00:00Z",
          orders: [{ filledTimestamp: day + 1_800_000 }],
        },
      ]),
    ).toBe(Math.floor((day + 1_800_000) / 1000));
  });

  it("falls back to open dates when orders carry no times", () => {
    expect(
      earliestEntrySecond([
        { openDate: "2024-05-02T00:00:00Z", orders: [] },
        { openDate: "2024-05-01T12:00:00Z" },
      ]),
    ).toBe(Date.UTC(2024, 4, 1, 12) / 1000);
  });

  it("returns null for empty or undated input", () => {
    expect(earliestEntrySecond([])).toBeNull();
    expect(earliestEntrySecond([{ openDate: "not a date" }])).toBeNull();
  });
});

describe("buildHistoryPnlSpans", () => {
  const TF = 3_600;
  const base = Date.UTC(2024, 4, 1);
  const at = (h: number) => new Date(base + h * 3_600_000).toISOString();
  const bucket = (h: number) => Math.floor((base / 1000 + h * TF) / TF) * TF;

  it("snaps each trade to its entry→exit buckets", () => {
    const spans = buildHistoryPnlSpans(
      [
        {
          openDate: at(2),
          closeDate: at(9),
          isShort: true,
        },
      ],
      TF,
      () => 0.35,
    );

    expect(spans).toEqual([
      { since: bucket(2), until: bucket(9), entry: 0.35, isShort: true },
    ]);
  });

  it("skips trades without dates, inverted ranges or resolvable entries", () => {
    const spans = buildHistoryPnlSpans(
      [
        { openDate: "not a date", closeDate: at(5) },
        { openDate: at(5), closeDate: at(3) },
        { openDate: at(1), closeDate: at(2) },
        { openDate: at(1) },
      ],
      TF,
      () => null,
    );

    expect(spans).toEqual([]);
  });

  it("caps at the newest trades (input is newest-first)", () => {
    // Newest-first window, exactly what the closed-position sources emit.
    const trades = Array.from(
      { length: MAX_HISTORY_PNL_SPANS + 10 },
      (_, i) => ({
        openDate: at(MAX_HISTORY_PNL_SPANS + 9 - i),
        closeDate: at(MAX_HISTORY_PNL_SPANS + 10 - i),
      }),
    );

    const spans = buildHistoryPnlSpans(trades, TF, () => 1);

    expect(spans).toHaveLength(MAX_HISTORY_PNL_SPANS);
    // Kept spans are the newest 60: spans[0] is the newest trade
    // (hour 69→70), the last kept one starts at hour 10.
    expect(spans[0]?.since).toBe(bucket(MAX_HISTORY_PNL_SPANS + 9));
    expect(spans[0]?.until).toBe(bucket(MAX_HISTORY_PNL_SPANS + 10));
    expect(spans.at(-1)?.since).toBe(bucket(10));
  });
});
