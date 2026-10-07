// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import {
  deriveOrderIsEntry,
  deriveTradeDurationSeconds,
  openProfitAbs,
  openProfitPct,
  parseStrategyVersion,
  parseStrategyVersionFromLogs,
  toUtcIso,
  tradesTailBounds,
} from "./index.js";

/**
 * Regression tests for the closed-trades window translation.
 *
 * Freqtrade's `GET /api/v1/trades` is OLDEST-anchored (offset skips the
 * oldest trades, rows ascend, `total_trades` counts closed trades only —
 * verified against a live bot where `/trades?limit=50&offset=0` returned
 * trades 1..50 of a 125-trade history). `getClosedPositions` must therefore
 * translate its newest-anchored window into these coordinates before
 * fetching; these tests pin that translation.
 */
describe("tradesTailBounds (newest-anchored → oldest-anchored)", () => {
  it("maps the first page onto the tail of history", () => {
    // The bug this guards: offset=0 used to fetch trades [0,50) — the
    // OLDEST trades — instead of the newest 50.
    expect(tradesTailBounds(125, 50, 0)).toEqual({ start: 75, end: 125 });
    expect(tradesTailBounds(30, 50, 0)).toEqual({ start: 0, end: 30 });
  });

  it("pages further back as offset grows (search scans)", () => {
    expect(tradesTailBounds(1_200, 500, 0)).toEqual({ start: 700, end: 1_200 });
    expect(tradesTailBounds(1_200, 500, 500)).toEqual({
      start: 200,
      end: 700,
    });
    expect(tradesTailBounds(1_200, 500, 1_000)).toEqual({
      start: 0,
      end: 200,
    });
  });

  it("clamps past-the-end offsets and degenerate inputs", () => {
    expect(tradesTailBounds(125, 50, 200)).toEqual({ start: 0, end: 0 });
    expect(tradesTailBounds(0, 50, 0)).toEqual({ start: 0, end: 0 });
    expect(tradesTailBounds(125, 0, 0)).toEqual({ start: 125, end: 125 });
    expect(tradesTailBounds(125, -10, -5)).toEqual({ start: 125, end: 125 });
  });
});

/**
 * Regression tests for the sub-order Role column.
 *
 * Freqtrade's `/status` + `/trades` order objects (`OrderSchema`) carry
 * `ft_order_side` but never `ft_is_entry` — that flag only exists on the
 * internal `Order.to_json()` shape. Without the side-derived fallback every
 * open-position order decoded with `isEntry: undefined` and the Role column
 * rendered `—` on all rows.
 */
describe("deriveOrderIsEntry (ft_order_side → entry/exit role)", () => {
  it("marks the entry side per trade direction", () => {
    expect(deriveOrderIsEntry("buy", false, undefined)).toBe(true);
    expect(deriveOrderIsEntry("sell", false, undefined)).toBe(false);
    expect(deriveOrderIsEntry("sell", true, undefined)).toBe(true);
    expect(deriveOrderIsEntry("buy", true, undefined)).toBe(false);
    // Direction unknown → long convention (buy is entry).
    expect(deriveOrderIsEntry("buy", undefined, undefined)).toBe(true);
    expect(deriveOrderIsEntry("sell", undefined, undefined)).toBe(false);
  });

  it("marks stoploss orders as exits on both directions", () => {
    expect(deriveOrderIsEntry("stoploss", false, undefined)).toBe(false);
    expect(deriveOrderIsEntry("stoploss", true, undefined)).toBe(false);
  });

  it("leaves unknown sides unknown instead of guessing", () => {
    expect(deriveOrderIsEntry(undefined, false, undefined)).toBe(undefined);
    expect(deriveOrderIsEntry(null, false, undefined)).toBe(undefined);
    expect(deriveOrderIsEntry("?", false, undefined)).toBe(undefined);
    expect(deriveOrderIsEntry(42, true, undefined)).toBe(undefined);
  });

  it("lets an explicit backend flag win over the side", () => {
    expect(deriveOrderIsEntry("sell", false, true)).toBe(true);
    expect(deriveOrderIsEntry("buy", false, false)).toBe(false);
    expect(deriveOrderIsEntry(undefined, false, true)).toBe(true);
  });
});

/**
 * Strategy-version extraction for the bot status widget.
 *
 * `show_config.strategy_version` is the primary source; older bots omit it,
 * so the backend falls back to the `Bot heartbeat … strategy_version: …`
 * log line (and the `/version` string when it carries the same suffix).
 */
describe("parseStrategyVersion (heartbeat / version string)", () => {
  it("extracts the version from a heartbeat line", () => {
    expect(
      parseStrategyVersion(
        "2026-10-05 18:25:54 INFO    freqtrade.worker - Bot heartbeat. PID=1, version='2026.8, strategy_version: v18.0.119', state='RUNNING'",
      ),
    ).toBe("v18.0.119");
  });

  it("handles bare version strings carrying the suffix", () => {
    expect(parseStrategyVersion("2026.8, strategy_version: v18.0.119")).toBe(
      "v18.0.119",
    );
    expect(parseStrategyVersion("2026.8")).toBe(undefined);
  });

  it("returns undefined for missing or blank inputs", () => {
    expect(parseStrategyVersion(undefined)).toBe(undefined);
    expect(parseStrategyVersion(null)).toBe(undefined);
    expect(parseStrategyVersion("")).toBe(undefined);
    expect(parseStrategyVersion("no version here")).toBe(undefined);
  });
});

describe("parseStrategyVersionFromLogs (newest heartbeat wins)", () => {
  it("finds the heartbeat line among structured log rows", () => {
    expect(
      parseStrategyVersionFromLogs([
        [
          "2026-10-05 18:20:01",
          "INFO",
          "freqtrade.worker",
          "Starting worker …",
        ],
        [
          "2026-10-05 18:25:54",
          "INFO",
          "freqtrade.worker",
          "Bot heartbeat. PID=1, version='2026.8, strategy_version: v18.0.119', state='RUNNING'",
        ],
      ]),
    ).toBe("v18.0.119");
  });

  it("prefers the newest heartbeat when several are present", () => {
    expect(
      parseStrategyVersionFromLogs([
        [
          "t1",
          "INFO",
          "w",
          "Bot heartbeat. PID=1, version='1, strategy_version: v1', state='RUNNING'",
        ],
        ["t2", "INFO", "w", "unrelated line"],
        [
          "t3",
          "INFO",
          "w",
          "Bot heartbeat. PID=1, version='2, strategy_version: v2', state='RUNNING'",
        ],
      ]),
    ).toBe("v2");
  });

  it("returns undefined when no heartbeat is present", () => {
    expect(parseStrategyVersionFromLogs([])).toBe(undefined);
    expect(parseStrategyVersionFromLogs(undefined)).toBe(undefined);
    expect(
      parseStrategyVersionFromLogs([["t", "INFO", "w", "nothing here"]]),
    ).toBe(undefined);
  });
});

/**
 * Regression tests for the UTC/timezone boundary.
 *
 * Freqtrade serializes trade dates as NAIVE UTC strings (`Trade.to_json`
 * renders UTC datetimes with `DATETIME_PRINT_FORMAT` — no zone marker).
 * JavaScript parses those as browser-LOCAL time, shifting every age,
 * duration and timestamp display by the machine's UTC offset. The client
 * annotates the zone at the decode boundary; these tests pin that.
 */
describe("toUtcIso (naive-UTC trade dates → ISO UTC)", () => {
  it("pins Z onto freqtrade's space-separated dates", () => {
    expect(toUtcIso("2026-10-06 13:43:00")).toBe("2026-10-06T13:43:00Z");
  });

  it("pins Z onto naive T-separated dates", () => {
    expect(toUtcIso("2026-10-06T13:43:00")).toBe("2026-10-06T13:43:00Z");
  });

  it("leaves explicit zones untouched", () => {
    expect(toUtcIso("2026-10-06T13:43:00Z")).toBe("2026-10-06T13:43:00Z");
    expect(toUtcIso("2026-10-06T13:43:00+02:00")).toBe(
      "2026-10-06T13:43:00+02:00",
    );
    expect(toUtcIso("2026-10-06 13:43:00-0530")).toBe(
      "2026-10-06 13:43:00-0530",
    );
  });
});

/**
 * The REST `/trades` schema carries NO duration field — FreqUI derives it
 * as `close_timestamp - open_timestamp`. Without the derivation the tables'
 * Duration columns read a field that never exists.
 */
describe("deriveTradeDurationSeconds (client-side duration)", () => {
  it("prefers an explicit trade_duration_s (forks/newer builds)", () => {
    expect(
      deriveTradeDurationSeconds({
        trade_duration_s: 42,
        open_timestamp: 1_000_000,
        close_timestamp: 9_000_000,
        open_date: "2026-10-06T13:00:00Z",
        close_date: "2026-10-06T13:01:00Z",
      }),
    ).toBe(42);
  });

  it("derives from the epoch-ms timestamps (freqtrade's real payload)", () => {
    expect(
      deriveTradeDurationSeconds({
        open_timestamp: 1_000_000,
        close_timestamp: 1_090_000,
        open_date: "2026-10-06T13:00:00Z",
        close_date: "2026-10-06T13:01:30Z",
      }),
    ).toBe(90);
  });

  it("falls back to the UTC-normalized date strings", () => {
    expect(
      deriveTradeDurationSeconds({
        open_date: "2026-10-06 13:00:00",
        close_date: "2026-10-06 13:01:00",
      }),
    ).toBe(60);
  });

  it("is undefined for open trades (no close)", () => {
    expect(
      deriveTradeDurationSeconds({
        open_timestamp: 1_000_000,
        open_date: "2026-10-06T13:00:00Z",
      }),
    ).toBeUndefined();
  });
});

/**
 * Whole-stake open-trade profit (NFI calc_total_profit convention).
 *
 * Freqtrade's `/status` `profit_ratio`/`profit_abs` cover only the REMAINING
 * position — realized P/L from NFI de-risks and grind exits is invisible to
 * them, so a de-risked trade reads a number the strategy never acted on.
 * `total_profit_ratio`/`total_profit_abs` carry the whole-stake view (same
 * convention as the closed side's `close_profit`); the desk must prefer them.
 */
describe("openProfitPct / openProfitAbs (whole-stake open profit)", () => {
  it("prefers total_profit_ratio (×100) over the remaining-position ratio", () => {
    expect(
      openProfitPct({ total_profit_ratio: -0.3529, profit_ratio: 0.4 }),
    ).toBe(-35.29);
    expect(openProfitAbs({ total_profit_abs: -14.49, profit_abs: 2.5 })).toBe(
      -14.49,
    );
  });

  it("falls back to profit_ratio for builds predating the total fields", () => {
    expect(openProfitPct({ profit_ratio: -0.095, profit_pct: -9.5 })).toBe(
      -9.5,
    );
    expect(openProfitAbs({ profit_abs: -0.62 })).toBe(-0.62);
  });

  it("falls back to the pre-rounded profit_pct when no ratio exists", () => {
    expect(openProfitPct({ profit_pct: -9.5 })).toBe(-9.5);
  });

  it("skips NaN ratios (freqtrade sends NaN when the rate is unavailable)", () => {
    expect(
      openProfitPct({
        total_profit_ratio: Number.NaN,
        profit_ratio: Number.NaN,
        profit_pct: Number.NaN,
      }),
    ).toBeUndefined();
    expect(openProfitAbs({ total_profit_abs: Number.NaN })).toBeUndefined();
  });
});
