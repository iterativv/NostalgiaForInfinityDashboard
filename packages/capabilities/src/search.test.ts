// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import {
  applySearch,
  matchesSearch,
  normalizeSearch,
  positionIdFields,
} from "./search.js";

describe("server-side search", () => {
  it("normalizes empty input to no-search", () => {
    expect(normalizeSearch(undefined)).toBeNull();
    expect(normalizeSearch("")).toBeNull();
    expect(normalizeSearch("   ")).toBeNull();
    expect(normalizeSearch("  BTC ")).toBe("btc");
  });

  it("matches case-insensitively across fields", () => {
    // `matchesSearch` takes an already-normalized needle (see
    // `normalizeSearch`); `applySearch` below covers the raw-input path.
    expect(matchesSearch(["BTC/USDT", "default"], "btc")).toBe(true);
    expect(matchesSearch(["BTC/USDT", "Default"], "default")).toBe(true);
    expect(matchesSearch(["BTC/USDT", undefined, null], "eth")).toBe(false);
    expect(matchesSearch([], "btc")).toBe(false);
  });

  it("filters rows, preserving order", () => {
    const rows = [{ pair: "BTC/USDT" }, { pair: "ETH/USDT" }];

    const fieldsOf = (row: { pair: string }): ReadonlyArray<string> => [
      row.pair,
    ];

    expect(applySearch(rows, fieldsOf, undefined)).toEqual(rows);
    expect(applySearch(rows, fieldsOf, "  ")).toEqual(rows);
    expect(applySearch(rows, fieldsOf, "BTC").map((row) => row.pair)).toEqual([
      "BTC/USDT",
    ]);
    expect(
      applySearch(rows, fieldsOf, "eth").map((row) => row.pair),
    ).toEqual(["ETH/USDT"]);
    expect(applySearch(rows, fieldsOf, "sol")).toEqual([]);
  });

  it("collects trade and sub-order ids as searchable fields", () => {
    expect(positionIdFields(101, [{ orderId: "9000101" }])).toEqual([
      "101",
      "9000101",
    ]);
    // Orders are optional on the position payloads.
    expect(positionIdFields(102, undefined)).toEqual(["102"]);
  });
});
