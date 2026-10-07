// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_FORMAT,
  TIME_FORMAT_IDS,
  chartTimeFormats,
  formatDateOnly,
  formatDateTime,
  formatTimeOnly,
  formatTimePrecise,
  setTimeFormat,
  timeFormatStore,
} from "./timeFormat";

/**
 * Expectations are TZ-INDEPENDENT on purpose: the formatters render
 * UTC-pinned instants in the browser's local zone, so absolute wall-clock
 * strings vary with the machine running the tests. The invariants pinned
 * here are preset SHAPES, garbage rejection, and — the UTC boundary —
 * freqtrade's naive `YYYY-MM-DD HH:mm:ss` strings formatting IDENTICALLY
 * to their UTC-annotated twins.
 */
describe("timeFormat", () => {
  afterEach(() => {
    setTimeFormat(DEFAULT_TIME_FORMAT);
  });

  it("exposes popular presets with unique ids", () => {
    expect(new Set(TIME_FORMAT_IDS).size).toBe(TIME_FORMAT_IDS.length);
    expect(TIME_FORMAT_IDS).toContain("iso-8601");
    expect(TIME_FORMAT_IDS).toContain("eu-24h");
    expect(TIME_FORMAT_IDS).toContain("us-12h");
    expect(TIME_FORMAT_IDS).toContain("locale");
  });

  it("defaults to ISO 8601 (24h, no seconds)", () => {
    // localStorage holds no format in vitest → default preset.
    expect(timeFormatStore.state).toBe(DEFAULT_TIME_FORMAT);
    expect(formatDateTime("2026-09-26 05:35:07")).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/,
    );
    expect(formatDateTime("2026-09-26 05:35:07")).not.toMatch(/AM|PM/);
  });

  it("parses freqtrade space-separated dates like their UTC twins", () => {
    expect(formatDateTime("not-a-date")).toBe("—");
    // The naive string and the same UTC instant must agree in every zone.
    expect(formatDateTime("2026-09-26 05:35:07")).toBe(
      formatDateTime("2026-09-26T05:35:07Z"),
    );
  });

  it("formats every preset from the same input", () => {
    const input = "2026-09-26 14:05:09";

    setTimeFormat("iso-8601-seconds");
    expect(formatDateTime(input)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    setTimeFormat("eu-24h");
    expect(formatDateTime(input)).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);

    setTimeFormat("eu-12h");
    expect(formatDateTime(input)).toMatch(
      /^\d{2}\/\d{2}\/\d{4} \d{1,2}:\d{2} [AP]M$/,
    );

    setTimeFormat("us-12h");
    expect(formatDateTime(input)).toMatch(
      /^\d{2}\/\d{2}\/\d{4} \d{1,2}:\d{2} [AP]M$/,
    );

    setTimeFormat("us-24h");
    expect(formatDateTime(input)).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);

    setTimeFormat("readable-24h");
    expect(formatDateTime(input)).toMatch(/^\d{1,2} Sep \d{4} \d{2}:\d{2}$/);
  });

  it("formats date-only and time-only views per preset", () => {
    const input = "2026-09-26 14:05:09";

    expect(formatDateOnly(input)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatTimeOnly(input)).toMatch(/^\d{2}:\d{2}$/);
    expect(formatTimePrecise(input)).toMatch(/^\d{2}:\d{2}:\d{2}$/);

    setTimeFormat("us-12h");
    expect(formatDateOnly(input)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(formatTimeOnly(input)).toMatch(/^\d{1,2}:\d{2} [AP]M$/);
    expect(formatTimePrecise(input)).toMatch(/^\d{1,2}:\d{2}:\d{2} [AP]M$/);
  });

  it("returns em-dash for missing input", () => {
    expect(formatDateTime(undefined)).toBe("—");
    expect(formatDateTime("")).toBe("—");
    expect(formatTimeOnly(undefined)).toBe("—");
  });

  it("derives chart tick formats from the preset", () => {
    const formats = chartTimeFormats("eu-24h");

    expect(formats.minute?.primary).toBe("HH:mm");
    expect(formats.daily?.primary).toBe("dd/MM/yyyy");
    expect(formats.yearly?.primary).toBe("yyyy");
  });

  it("round-trips the persisted format through the store", () => {
    setTimeFormat("us-12h");
    expect(timeFormatStore.state).toBe("us-12h");

    if (typeof localStorage !== "undefined") {
      expect(localStorage.getItem("nfi-desk.time-format-v1")).toBe("us-12h");
      localStorage.removeItem("nfi-desk.time-format-v1");
    }
  });
});
