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
  PUBLIC_CANDLE_CAPABILITIES,
  PublicCandleChartConfigSchema,
  PublicCandleChartWidgetDef,
} from "./index";

const NON_SENSITIVE = new Set<Capability>(NON_SENSITIVE_CAPABILITIES);

describe("public candle chart widget", () => {
  it("decodes empty configs to full defaults", () => {
    expect(
      Schema.decodeUnknownSync(PublicCandleChartConfigSchema)({}),
    ).toMatchObject({
      instanceId: "default",
      pair: "BTC/USDT",
      timeframe: "5m",
      limit: 200,
      showSma20: true,
      showVwap: true,
      showVolume: true,
      showPositions: true,
      subplot: "rsi",
    });
  });

  it("rejects bad timeframe/subplot literals", () => {
    expect(() =>
      Schema.decodeUnknownSync(PublicCandleChartConfigSchema)({
        timeframe: "5x",
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(PublicCandleChartConfigSchema)({
        subplot: "vibes",
      }),
    ).toThrow();
  });

  it("stays non-sensitive under the default criteria", () => {
    // Trade-details (and every other default-sensitive kind) must never
    // sneak back in: the widget's whole point is shareability. Position
    // history rides the two `.relative` ids (percentages only) — both in
    // the anonymous seed grant, so markers render signed-out too.
    expect(PUBLIC_CANDLE_CAPABILITIES).toEqual(
      PublicCandleChartWidgetDef.capabilities,
    );
    expect(PUBLIC_CANDLE_CAPABILITIES.length).toBeGreaterThan(0);
    expect(PUBLIC_CANDLE_CAPABILITIES).toContain(
      "instances.open-positions.relative",
    );
    expect(PUBLIC_CANDLE_CAPABILITIES).toContain(
      "instances.closed-positions.relative",
    );

    for (const capability of PUBLIC_CANDLE_CAPABILITIES) {
      expect(
        NON_SENSITIVE.has(capability),
        `${capability} is not in the anonymous seed grant`,
      ).toBe(true);
    }

    // Belt and braces: also assert against the raw default criteria, so a
    // future InfoKind addition that swallows `market-data` fails loudly
    // here instead of silently leaking onto public pages.
    expect(DEFAULT_SENSITIVE_INFO_KINDS).not.toContain("market-data");
  });

  it("is registered exactly once", () => {
    const matches = builtinWidgets.filter(
      (widget) => widget.type === "candle-chart-public",
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]?.title).toBe("Candle Chart (Public)");
  });
});

describe("widget preferred sizes stay above the readable minimums", () => {
  it("every builtin widget fits its own default card", () => {
    // A `defaultWidth` below `minWidth` (or height likewise) ships a fresh
    // card that immediately hits the "needs more room" wall — the
    // responsiveness regression this guards against.
    for (const widget of builtinWidgets) {
      expect(
        widget.defaultWidth >= widget.minWidth,
        `${widget.type}: defaultWidth ${widget.defaultWidth} < minWidth ${widget.minWidth}`,
      ).toBe(true);
      expect(
        widget.defaultHeight >= widget.minHeight,
        `${widget.type}: defaultHeight ${widget.defaultHeight} < minHeight ${widget.minHeight}`,
      ).toBe(true);
    }
  });
});
