// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import {
  buildExportFilename,
  csvCell,
  rowsToCsv,
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
});
