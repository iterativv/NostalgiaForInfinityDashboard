// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import {
  buildPositionSearch,
  buildShareUrl,
  buildWidgetShareSearch,
  decodeWidgetConfig,
  encodeWidgetConfig,
  parseTerminalSearch,
  sanitizeId,
} from "./urlState";

describe("urlState", () => {
  it("sanitizes ids", () => {
    expect(sanitizeId("page-home")).toBe("page-home");
    expect(sanitizeId("page-custom-abc123")).toBe("page-custom-abc123");
    expect(sanitizeId("candle-chart")).toBe("candle-chart");
    expect(sanitizeId("")).toBeUndefined();
    expect(sanitizeId(undefined)).toBeUndefined();

    // Repeated URL keys arrive as arrays; only the first value counts.
    expect(sanitizeId(["page-home", "page-other"])).toBe("page-home");
    expect(sanitizeId([])).toBeUndefined();
    expect(sanitizeId(["../etc"])).toBeUndefined();

    expect(sanitizeId("../etc")).toBeUndefined();
    expect(sanitizeId("a b")).toBeUndefined();
    expect(sanitizeId("x".repeat(129))).toBeUndefined();
  });

  it("parses terminal search, dropping invalid params", () => {
    expect(
      parseTerminalSearch({ page: "page-home", panel: "panel-1" }),
    ).toEqual({
      page: "page-home",
      panel: "panel-1",
      widget: undefined,
      config: undefined,
    });

    expect(parseTerminalSearch({ page: "", panel: ["panel-1", "x"] })).toEqual({
      page: undefined,
      panel: "panel-1",
      widget: undefined,
      config: undefined,
    });

    expect(parseTerminalSearch({})).toEqual({
      page: undefined,
      panel: undefined,
      widget: undefined,
      config: undefined,
    });
  });

  it("round-trips widget configs through base64url", () => {
    const config = {
      instanceId: "all",
      pair: "BTC/USDT",
      timeframe: "1h",
      limit: 50,
      showBot: true,
      nested: { a: [1, 2, null] },
    };

    const encoded = encodeWidgetConfig(config);

    expect(encoded).toBeDefined();
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeWidgetConfig(encoded!)).toEqual(config);
  });

  it("rejects oversized configs", () => {
    const big = { blob: "x".repeat(5000) };

    expect(encodeWidgetConfig(big)).toBeUndefined();
    expect(decodeWidgetConfig("!!!")).toBeNull();
    expect(decodeWidgetConfig("a")).toBeNull();
  });

  it("builds position and widget share searches", () => {
    expect(buildPositionSearch("page-home", "panel-1")).toEqual({
      page: "page-home",
      panel: "panel-1",
      widget: undefined,
      config: undefined,
    });

    expect(buildPositionSearch("page-home", null).panel).toBeUndefined();

    const share = buildWidgetShareSearch("page-home", "panel-1", "candle-chart", {
      instanceId: "all",
    });

    expect(share?.page).toBe("page-home");
    expect(share?.panel).toBe("panel-1");
    expect(share?.widget).toBe("candle-chart");
    expect(share?.config).toMatch(/^[A-Za-z0-9_-]+$/);

    expect(
      buildWidgetShareSearch("page-home", "panel-1", "candle-chart", {
        blob: "x".repeat(5000),
      }),
    ).toBeNull();
  });

  it("builds share URLs", () => {
    expect(
      buildShareUrl("https://desk.example", "/", {
        page: "page-home",
        panel: "panel-1",
      }),
    ).toBe("https://desk.example/?page=page-home&panel=panel-1");

    expect(buildShareUrl("https://desk.example", "/", {})).toBe(
      "https://desk.example/",
    );
  });
});
