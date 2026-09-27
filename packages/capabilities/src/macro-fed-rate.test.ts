// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import {
  joinNyFedHistory,
  nyFedStartParam,
  parseFredCsv,
  parseNyFedRow,
  parseNyFedSearch,
} from "./macro-fed-rate.js";

describe("macro.fed-rate scrapers (NY Fed + FRED, no key)", () => {
  it("decodes NY Fed search rows and skips malformed entries", () => {
    const rows = parseNyFedSearch({
      refRates: [
        {
          effectiveDate: "2026-09-22",
          type: "EFFR",
          percentRate: 3.88,
          targetRateFrom: 3.75,
          targetRateTo: 4.0,
          volumeInBillions: 103,
        },
        { effectiveDate: "2026-09-22" },
        null,
        "nope",
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      effectiveDate: "2026-09-22",
      type: "EFFR",
      percentRate: 3.88,
      targetRateFrom: 3.75,
      targetRateTo: 4.0,
      volumeInBillions: 103,
    });
    expect(parseNyFedRow(null)).toBeNull();
    expect(parseNyFedSearch({ refRates: "nope" })).toEqual([]);
  });

  it("parses FRED public CSVs, skipping headers, blanks and `.` gaps", () => {
    expect(
      parseFredCsv(
        "DATE,VALUE\n2026-09-22,3.88\n2026-09-21,.\n2026-09-20,3.63\n\n",
      ),
    ).toEqual([
      { date: "2026-09-22", value: 3.88 },
      { date: "2026-09-20", value: 3.63 },
    ]);
    expect(parseFredCsv("DATE,VALUE\n")).toEqual([]);
  });

  it("joins EFFR + SOFR legs into date-ordered history", () => {
    const history = joinNyFedHistory(
      [
        {
          effectiveDate: "2026-09-22",
          type: "EFFR",
          percentRate: 3.88,
          targetRateFrom: 3.75,
          targetRateTo: 4.0,
        },
        {
          effectiveDate: "2026-09-21",
          type: "EFFR",
          percentRate: 3.88,
          targetRateFrom: 3.75,
          targetRateTo: 4.0,
        },
      ],
      [
        {
          effectiveDate: "2026-09-22",
          type: "SOFR",
          percentRate: 3.87,
        },
      ],
    );

    expect(history).toHaveLength(2);
    expect(history[0]?.date).toBe("2026-09-21");
    expect(history[1]).toMatchObject({
      date: "2026-09-22",
      effective: 3.88,
      targetLower: 3.75,
      targetUpper: 4.0,
      sofr: 3.87,
    });
    expect(history[0]?.sofr).toBeUndefined();
  });

  it("formats the NY Fed startDate param as MM/DD/YYYY", () => {
    expect(nyFedStartParam(0, Date.UTC(2026, 8, 23))).toBe("09/23/2026");
  });
});
