// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Dataset column sanity — the guarantees the /api/export generator and the
 * widgets both rely on.
 *
 * The relative (percent-only) column sets must never carry an
 * absolute-amount header: they back the public shareable pages' exports,
 * where the server-side column model is the only leak boundary. The
 * grouped position sets must keep their merge boundary intact through
 * `withOrderRows`.
 */
import { describe, expect, it } from "vitest";
import {
  CLOSED_POSITIONS_EXPORT,
  OPEN_POSITIONS_EXPORT,
  OPEN_TRADES_EXPORT,
  RELATIVE_CLOSED_EXPORT,
  RELATIVE_OPEN_EXPORT,
  TAPE_EXPORT_COLUMNS,
  expandPositionRows,
  groupedBoundary,
  tagPerformanceExportColumns,
  tagPerformanceRelativeExportColumns,
} from "./index.js";

/** Headers that would leak an absolute amount from a relative dataset. */
const ABSOLUTE_HEADERS = new Set([
  "Stake",
  "Profit",
  "Total profit",
  "Price",
  "Open rate",
  "Current rate",
  "Close rate",
  "Amount",
  "Cost",
  "Filled",
  "Remaining",
  "Balance",
]);

const headers = (columns: ReadonlyArray<{ header: string }>): string[] =>
  columns.map((c) => c.header);

describe("relative export column sets", () => {
  it("carry no absolute-amount column", () => {
    for (const columns of [
      RELATIVE_OPEN_EXPORT,
      RELATIVE_CLOSED_EXPORT,
      tagPerformanceRelativeExportColumns("enter"),
    ]) {
      for (const header of headers(columns)) {
        expect(ABSOLUTE_HEADERS.has(header)).toBe(false);
      }
    }
  });

  it("keep the grouped position/order boundary", () => {
    expect(groupedBoundary(RELATIVE_OPEN_EXPORT)).toBeGreaterThan(0);
    expect(groupedBoundary(RELATIVE_CLOSED_EXPORT)).toBeGreaterThan(0);
  });
});

describe("absolute export column sets", () => {
  it("group every position dataset with sub-order columns", () => {
    for (const columns of [
      OPEN_TRADES_EXPORT,
      OPEN_POSITIONS_EXPORT,
      CLOSED_POSITIONS_EXPORT,
    ]) {
      const boundary = groupedBoundary(columns);

      expect(boundary).toBeGreaterThan(0);
      expect(boundary).toBeLessThan(columns.length);
      expect(headers(columns).slice(boundary)).toContain("Order ID");
    }
  });

  it("tag / tape datasets stay flat (no merge boundary)", () => {
    expect(groupedBoundary(tagPerformanceExportColumns("pair"))).toBe(0);
    expect(groupedBoundary(TAPE_EXPORT_COLUMNS)).toBe(0);
  });
});

describe("grouped rows", () => {
  it("expand one position row + one row per order", () => {
    const positions = [
      { tradeId: 1, orders: [{ orderId: "a" }, { orderId: "b" }] },
      { tradeId: 2, orders: [] },
    ];

    const rows = expandPositionRows(positions, (p) => p.orders);

    expect(rows.map((r) => r.kind)).toEqual([
      "position",
      "order",
      "order",
      "position",
    ]);
  });
});
