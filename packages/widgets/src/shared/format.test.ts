// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { fmtAge, parseCloseDate } from "./format";
import { parseTradeTime } from "./tradeSort";

/**
 * Regression tests for the UTC boundary in the shared trade-time parsers.
 *
 * Freqtrade's REST dates are NAIVE UTC strings (`"2026-10-06 13:43:00"` —
 * the client annotates them at the decode boundary, but these parsers are
 * also fed from other producers and stale caches). Parsing them as
 * browser-local time shifted every age display and epoch comparison by the
 * machine's UTC offset, so each assertion pins a naive string to the exact
 * same instant as its UTC-annotated twin.
 */
describe("parseTradeTime (naive-UTC pinning)", () => {
  const utcMs = Date.parse("2026-10-06T13:43:00Z");

  it("treats a naive string as UTC", () => {
    expect(parseTradeTime("2026-10-06 13:43:00")).toBe(utcMs);
    expect(parseTradeTime("2026-10-06T13:43:00")).toBe(utcMs);
  });

  it("honors explicit zones as-is", () => {
    expect(parseTradeTime("2026-10-06T13:43:00Z")).toBe(utcMs);
    expect(parseTradeTime("2026-10-06 15:43:00+02:00")).toBe(utcMs);
  });

  it("maps garbage and absence to 0", () => {
    expect(parseTradeTime("not a date")).toBe(0);
    expect(parseTradeTime(undefined)).toBe(0);
    expect(parseTradeTime("")).toBe(0);
  });
});

describe("fmtAge (naive and UTC-annotated inputs agree)", () => {
  /** Ninety minutes ago, in freqtrade's naive spelling. */
  const naiveMinutesAgo = (minutes: number): string => {
    const d = new Date(Date.now() - minutes * 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");

    return (
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
      ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
    );
  };

  it("computes the same age from both spellings", () => {
    const naive = fmtAge(naiveMinutesAgo(90));
    const zoned = fmtAge(new Date(Date.now() - 90 * 60_000).toISOString());

    expect(naive).toBe(zoned);
    expect(naive).not.toBe("—");
  });

  it("shows — for garbage", () => {
    expect(fmtAge("nope")).toBe("—");
    expect(fmtAge(undefined)).toBe("—");
  });
});

describe("parseCloseDate (naive-UTC pinning)", () => {
  it("matches the UTC-annotated instant", () => {
    expect(parseCloseDate("2026-10-06 13:43:00")).toBe(
      Date.parse("2026-10-06T13:43:00Z"),
    );
  });

  it("maps garbage and absence to null", () => {
    expect(parseCloseDate("nope")).toBeNull();
    expect(parseCloseDate(undefined)).toBeNull();
  });
});
