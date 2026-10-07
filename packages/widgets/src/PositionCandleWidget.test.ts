// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  DEFAULT_SENSITIVE_INFO_KINDS,
  NON_SENSITIVE_CAPABILITIES,
  type Capability,
} from "@nfi/api-contract";
import {
  builtinWidgets,
  entryLevelBaseline,
  POSITION_CANDLE_CAPABILITIES,
  POSITION_CANDLE_PUBLIC_CAPABILITIES,
  PositionCandleConfigSchema,
  PositionCandlePublicConfigSchema,
  PositionCandlePublicWidgetDef,
  PositionCandleWidgetDef,
} from "./index";

const NON_SENSITIVE = new Set<Capability>(NON_SENSITIVE_CAPABILITIES);

describe("position candle widget (sensitive)", () => {
  it("decodes empty configs to follow-mode defaults", () => {
    expect(Schema.decodeUnknownSync(PositionCandleConfigSchema)({})).toMatchObject(
      {
        instanceId: "default",
        pair: "",
        timeframe: "5m",
        limit: 200,
        showSma20: false,
        showVwap: false,
        showVolume: false,
        showTrades: true,
        showAvgEntry: true,
        subplot: "none",
      },
    );
  });

  it("rejects bad timeframe/subplot literals", () => {
    expect(() =>
      Schema.decodeUnknownSync(PositionCandleConfigSchema)({ timeframe: "5x" }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(PositionCandleConfigSchema)({ subplot: "vibes" }),
    ).toThrow();
  });

  it("keeps a pinned pair through decode", () => {
    expect(
      Schema.decodeUnknownSync(PositionCandleConfigSchema)({
        pair: "SOL/USDT",
      }),
    ).toMatchObject({ pair: "SOL/USDT" });
  });

  it("is registered exactly once", () => {
    const matches = builtinWidgets.filter(
      (widget) => widget.type === "position-candle",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.title).toBe("Position Chart");
    expect(POSITION_CANDLE_CAPABILITIES).toEqual(
      PositionCandleWidgetDef.capabilities,
    );
  });
});

describe("position candle widget (public)", () => {
  it("decodes empty configs to follow-mode defaults", () => {
    expect(
      Schema.decodeUnknownSync(PositionCandlePublicConfigSchema)({}),
    ).toMatchObject({
      instanceId: "default",
      pair: "",
      timeframe: "5m",
      limit: 200,
      showSma20: false,
      showVwap: false,
      showVolume: false,
      showPositions: true,
      showEntryLevel: true,
      subplot: "none",
    });
  });

  it("stays non-sensitive under the default criteria", () => {
    expect(POSITION_CANDLE_PUBLIC_CAPABILITIES).toEqual(
      PositionCandlePublicWidgetDef.capabilities,
    );
    expect(POSITION_CANDLE_PUBLIC_CAPABILITIES.length).toBeGreaterThan(0);
    expect(POSITION_CANDLE_PUBLIC_CAPABILITIES).toContain(
      "instances.open-positions.relative",
    );
    expect(POSITION_CANDLE_PUBLIC_CAPABILITIES).toContain(
      "instances.closed-positions.relative",
    );

    for (const capability of POSITION_CANDLE_PUBLIC_CAPABILITIES) {
      expect(
        NON_SENSITIVE.has(capability),
        `${capability} is not in the anonymous seed grant`,
      ).toBe(true);
    }

    expect(DEFAULT_SENSITIVE_INFO_KINDS).not.toContain("market-data");
  });

  it("is registered exactly once", () => {
    const matches = builtinWidgets.filter(
      (widget) => widget.type === "position-candle-public",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.title).toBe("Position Chart (Public)");
  });
});

describe("entryLevelBaseline", () => {
  // 5m buckets: 1000 → bucket 900 (close 10), 1300 → bucket 1200 (close 20).
  const candles = [
    { time: 1_000_000, close: 10 },
    { time: 1_300_000, close: 20 },
  ];

  it("weights entry-bucket closes by allocation weight", () => {
    expect(
      entryLevelBaseline(
        [
          {
            tradeId: 1,
            pair: "BTC/USDT",
            isOpen: true,
            allocationWeight: 0.75,
            openDate: "1970-01-01T00:16:40Z",
            profitPct: 1,
          },
          {
            tradeId: 2,
            pair: "BTC/USDT",
            isOpen: true,
            allocationWeight: 0.25,
            openDate: "1970-01-01T00:21:40Z",
            profitPct: 1,
          },
        ],
        candles,
        300,
      ),
    ).toBeCloseTo(12.5, 10);
  });

  it("falls back to equal shares without weights", () => {
    expect(
      entryLevelBaseline(
        [
          {
            tradeId: 1,
            pair: "BTC/USDT",
            isOpen: true,
            openDate: "1970-01-01T00:16:40Z",
          },
          {
            tradeId: 2,
            pair: "BTC/USDT",
            isOpen: true,
            openDate: "1970-01-01T00:21:40Z",
          },
        ],
        candles,
        300,
      ),
    ).toBeCloseTo(15, 10);
  });

  it("returns null when entries predate the window", () => {
    expect(
      entryLevelBaseline(
        [
          {
            tradeId: 1,
            pair: "BTC/USDT",
            isOpen: true,
            allocationWeight: 1,
            openDate: "2020-01-01T00:00:00Z",
          },
        ],
        candles,
        300,
      ),
    ).toBeNull();
    expect(entryLevelBaseline([], candles, 300)).toBeNull();
  });
});
