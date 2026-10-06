// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import {
  buildExportFilename,
  buildGroupedMerges,
  csvCell,
  dedupedExportHeaders,
  expandPositionRows,
  jsonCell,
  RELATIVE_ORDER_EXPORT_COLUMNS,
  rowsToCsv,
  rowsToJson,
  TRADE_ORDER_EXPORT_COLUMNS,
  withOrderRows,
  type ExportColumn,
} from "./export";

interface Row {
  readonly pair: string;
  readonly pnl: number;
  readonly tag?: string;
}

const COLUMNS: ReadonlyArray<ExportColumn<Row>> = [
  { header: "Pair", value: (r) => r.pair },
  { header: "PnL", value: (r) => r.pnl },
  { header: "Tag", value: (r) => r.tag },
];

describe("table export", () => {
  it("quotes cells holding commas, quotes or newlines", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(true)).toBe("true");
  });

  it("renders a header plus one line per row", () => {
    const csv = rowsToCsv(COLUMNS, [
      { pair: "BTC/USDT", pnl: 1.5, tag: "grind 1" },
      { pair: "ETH/USDT", pnl: -0.25 },
    ]);

    expect(csv).toBe(
      "﻿Pair,PnL,Tag\r\nBTC/USDT,1.5,grind 1\r\nETH/USDT,-0.25,\r\n",
    );
  });

  it("builds timestamped, filesystem-safe file names", () => {
    const name = buildExportFilename(
      "open-positions/all",
      new Date(2026, 0, 5, 12, 30),
    );

    expect(name).toBe("open-positions-all-20260105-1230");
    expect(buildExportFilename("!!!", new Date(2026, 0, 5, 0, 0))).toBe(
      "export-20260105-0000",
    );
  });

  it("pretty-prints rows as JSON with nulls for missing cells", () => {
    expect(jsonCell(undefined)).toBe(null);
    expect(jsonCell(null)).toBe(null);
    expect(jsonCell(Number.NaN)).toBe(null);
    expect(jsonCell(12.5)).toBe(12.5);
    expect(jsonCell("x")).toBe("x");

    const json = rowsToJson(COLUMNS, [
      { pair: "BTC/USDT", pnl: 1.5, tag: "grind 1" },
      { pair: "ETH/USDT", pnl: -0.25 },
    ]);

    expect(json).toBe(
      '[\n  {\n    "Pair": "BTC/USDT",\n    "PnL": 1.5,\n    "Tag": "grind 1"\n  },\n  {\n    "Pair": "ETH/USDT",\n    "PnL": -0.25,\n    "Tag": null\n  }\n]\n',
    );
    expect(JSON.parse(json)).toHaveLength(2);
  });

  it("suffixes repeated headers so JSON keeps every column", () => {
    const dupes: ReadonlyArray<ExportColumn<{ readonly v: number }>> = [
      { header: "Amount", value: () => 1 },
      { header: "Amount", value: () => 2 },
      { header: "Amount", value: () => 3 },
    ];

    expect(dedupedExportHeaders(dupes)).toEqual([
      "Amount",
      "Amount (2)",
      "Amount (3)",
    ]);
    expect(JSON.parse(rowsToJson(dupes, [{ v: 0 }]))).toEqual([
      { Amount: 1, "Amount (2)": 2, "Amount (3)": 3 },
    ]);
  });
});

interface Position {
  readonly tradeId: number;
  readonly pair: string;
  readonly orders?: ReadonlyArray<{
    readonly orderId: string;
    readonly price?: number;
  }>;
}

const POSITION_COLUMNS: ReadonlyArray<ExportColumn<Position>> = [
  { header: "Trade ID", value: (p) => p.tradeId },
  { header: "Pair", value: (p) => p.pair },
];

const ORDER_COLUMNS: ReadonlyArray<
  ExportColumn<{ readonly orderId: string; readonly price?: number }>
> = [
  { header: "Order ID", value: (o) => o.orderId },
  { header: "Price", value: (o) => o.price },
];

describe("position + sub-order grouped export", () => {
  it("expands one position row plus one sub row per order", () => {
    const rows = expandPositionRows(
      [
        {
          tradeId: 7,
          pair: "BTC/USDT",
          orders: [
            { orderId: "a", price: 1 },
            { orderId: "b", price: 2 },
          ],
        },
        { tradeId: 8, pair: "ETH/USDT" },
      ],
      (p) => p.orders,
    );

    expect(rows.map((r) => r.kind)).toEqual([
      "position",
      "order",
      "order",
      "position",
    ]);
    expect(rows[1]?.order).toMatchObject({ orderId: "a" });
    expect(rows[1]?.position.tradeId).toBe(7);
  });

  it("headers position columns + order columns; blanks the empty side", () => {
    const columns = withOrderRows({
      positionColumns: POSITION_COLUMNS,
      orderColumns: ORDER_COLUMNS,
    });

    const rows = expandPositionRows(
      [
        {
          tradeId: 7,
          pair: "BTC/USDT",
          orders: [{ orderId: "a", price: 1 }],
        },
      ],
      (p) => p.orders,
    );

    const csv = rowsToCsv(columns, rows);

    expect(csv).toBe(
      "﻿Trade ID,Pair,Order ID,Price\r\n7,BTC/USDT,,\r\n,,a,1\r\n",
    );
  });

  it("merges the empty side per row for XLSX", () => {
    const columns = withOrderRows({
      positionColumns: POSITION_COLUMNS,
      orderColumns: ORDER_COLUMNS,
    });

    const rows = expandPositionRows(
      [
        {
          tradeId: 7,
          pair: "BTC/USDT",
          orders: [{ orderId: "a", price: 1 }],
        },
        { tradeId: 8, pair: "ETH/USDT" },
      ],
      (p) => p.orders,
    );

    const merges = buildGroupedMerges(columns, rows);

    // Row 1 (position): merge order side C-D. Row 2 (order): merge
    // position side A-B. Row 3 (lone position): merge order side C-D.
    expect(merges).toEqual([
      { s: { r: 1, c: 2 }, e: { r: 1, c: 3 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 1 } },
      { s: { r: 3, c: 2 }, e: { r: 3, c: 3 } },
    ]);
    expect(columns.positionColumnCount).toBe(2);
  });

  it("yields no merges for plain column sets", () => {
    expect(buildGroupedMerges(COLUMNS, [{ pair: "x", pnl: 1 }])).toEqual([]);
  });

  it("merges a position's order rows vertically into one block", () => {
    const columns = withOrderRows({
      positionColumns: POSITION_COLUMNS,
      orderColumns: ORDER_COLUMNS,
    });

    const rows = expandPositionRows(
      [
        {
          tradeId: 7,
          pair: "BTC/USDT",
          orders: [
            { orderId: "a", price: 1 },
            { orderId: "b", price: 2 },
          ],
        },
        { tradeId: 8, pair: "ETH/USDT" },
      ],
      (p) => p.orders,
    );

    const merges = buildGroupedMerges(columns, rows);

    // Row 1 (position): order side C-D. Rows 2-3 (orders): one A2:B3
    // block instead of two horizontal merges. Row 4 (lone): C-D.
    expect(merges).toEqual([
      { s: { r: 1, c: 2 }, e: { r: 1, c: 3 } },
      { s: { r: 2, c: 0 }, e: { r: 3, c: 1 } },
      { s: { r: 4, c: 2 }, e: { r: 4, c: 3 } },
    ]);
  });

  it("merges a single position column vertically across order rows", () => {
    const columns = withOrderRows({
      positionColumns: [POSITION_COLUMNS[0]!],
      orderColumns: ORDER_COLUMNS,
    });

    const rows = expandPositionRows(
      [
        {
          tradeId: 7,
          pair: "BTC/USDT",
          orders: [
            { orderId: "a", price: 1 },
            { orderId: "b", price: 2 },
          ],
        },
      ],
      (p) => p.orders,
    );

    const merges = buildGroupedMerges(columns, rows);

    // Row 1 (position): order side B-C. Rows 2-3 (orders): one tall A2:A3.
    expect(merges).toEqual([
      { s: { r: 1, c: 1 }, e: { r: 1, c: 2 } },
      { s: { r: 2, c: 0 }, e: { r: 3, c: 0 } },
    ]);
  });

  it("exports grouped rows as JSON with nulls on the empty side", () => {
    const columns = withOrderRows({
      positionColumns: POSITION_COLUMNS,
      orderColumns: ORDER_COLUMNS,
    });

    const rows = expandPositionRows(
      [
        {
          tradeId: 7,
          pair: "BTC/USDT",
          orders: [{ orderId: "a", price: 1 }],
        },
      ],
      (p) => p.orders,
    );

    expect(JSON.parse(rowsToJson(columns, rows))).toEqual([
      { "Trade ID": 7, Pair: "BTC/USDT", "Order ID": null, Price: null },
      { "Trade ID": null, Pair: null, "Order ID": "a", Price: 1 },
    ]);
  });

  it("shares one order-column set per order kind", () => {
    expect(
      TRADE_ORDER_EXPORT_COLUMNS.map((c) => c.header),
    ).toContain("Order ID");
    expect(
      RELATIVE_ORDER_EXPORT_COLUMNS.map((c) => c.header),
    ).toContain("Order tag");
  });
});
