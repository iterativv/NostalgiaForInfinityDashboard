// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  BalanceConfigSchema,
  BotConfigConfigSchema,
  BotStatusConfigSchema,
  CandleChartConfigSchema,
  ClosedPositionsConfigSchema,
  CumulativeProfitConfigSchema,
  DailyProfitConfigSchema,
  DrawdownConfigSchema,
  EquityCurveConfigSchema,
  ExposureConfigSchema,
  FleetOverviewConfigSchema,
  PairLocksConfigSchema,
  PairSummaryConfigSchema,
  PairUniverseConfigSchema,
  PnlChartConfigSchema,
  ProfitConfigSchema,
  InstancesTableConfigSchema,
  MarketMoversConfigSchema,
  OpenPositionsConfigSchema,
  OpenTradesConfigSchema,
  PerformanceStatsConfigSchema,
  PercentClosedTradesConfigSchema,
  PercentEntryStatsConfigSchema,
  PercentOpenPositionsConfigSchema,
  RelativeBalanceConfigSchema,
  RelativeProfitConfigSchema,
  RiskMonitorConfigSchema,
  StrategyBreakdownConfigSchema,
  TagPerformanceConfigSchema,
  TickerTapeConfigSchema,
  TradeTapeConfigSchema,
  WatchlistConfigSchema,
} from "./index";

/**
 * Widget configs decode with schema defaults: persisted panels may hold
 * partial (older-version) payloads, so `{}` and sparse objects must decode
 * to fully-resolved configs — no manual merging in components.
 */
describe("widget config schemas", () => {
  it("decodes empty configs to full defaults", () => {
    expect(
      Schema.decodeUnknownSync(OpenPositionsConfigSchema)({}),
    ).toMatchObject({
      instanceId: "default",
      maxVisibleOrders: 4,
      showHiddenCountRow: true,
      showStrategy: false,
    });
    expect(
      Schema.decodeUnknownSync(ClosedPositionsConfigSchema)({}),
    ).toMatchObject({
      instanceId: "default",
      limit: 50,
      showDuration: false,
    });
    expect(
      Schema.decodeUnknownSync(InstancesTableConfigSchema)({}),
    ).toMatchObject({
      showName: true,
      showVersion: false,
    });
    expect(
      Schema.decodeUnknownSync(CumulativeProfitConfigSchema)({}),
    ).toMatchObject({
      instanceId: "default",
      limit: 200,
      showPerTrade: false,
    });
    expect(
      Schema.decodeUnknownSync(TagPerformanceConfigSchema)({}),
    ).toMatchObject({
      groupBy: "enter",
      sortBy: "profitAbs",
      minTrades: 1,
    });
  });

  it("keeps explicit values and fills only the gaps", () => {
    const decoded = Schema.decodeUnknownSync(OpenPositionsConfigSchema)({
      instanceId: "ft-1",
      showStrategy: true,
    });
    expect(decoded.instanceId).toBe("ft-1");
    expect(decoded.showStrategy).toBe(true);
    expect(decoded.maxVisibleOrders).toBe(4);
  });

  it("inherits open-positions fields in the closed-positions schema", () => {
    const decoded = Schema.decodeUnknownSync(ClosedPositionsConfigSchema)({
      limit: 10,
    });
    expect(decoded.limit).toBe(10);
    expect(decoded.maxVisibleOrders).toBe(4);
    expect(decoded.showPair).toBe(true);
    expect(decoded.showOrderTag).toBe(false);
  });

  it("decodes terminal widget defaults", () => {
    expect(Schema.decodeUnknownSync(TickerTapeConfigSchema)({})).toMatchObject({
      instanceId: "default",
      maxItems: 20,
      showProfit: true,
    });
    expect(Schema.decodeUnknownSync(WatchlistConfigSchema)({})).toMatchObject({
      instanceId: "default",
      showOnlyOpen: false,
    });
    expect(
      Schema.decodeUnknownSync(MarketMoversConfigSchema)({}),
    ).toMatchObject({
      count: 5,
    });
    expect(Schema.decodeUnknownSync(ExposureConfigSchema)({})).toMatchObject({
      showChart: true,
    });
    expect(
      Schema.decodeUnknownSync(PerformanceStatsConfigSchema)({}),
    ).toMatchObject({
      limit: 200,
    });
    expect(
      Schema.decodeUnknownSync(StrategyBreakdownConfigSchema)({}),
    ).toMatchObject({
      limit: 200,
      minTrades: 1,
    });
    expect(Schema.decodeUnknownSync(TradeTapeConfigSchema)({})).toMatchObject({
      limit: 30,
      showOpens: true,
      showCloses: true,
    });
    expect(Schema.decodeUnknownSync(RiskMonitorConfigSchema)({})).toMatchObject(
      {
        warnExposurePct: 50,
        maxExposurePct: 80,
      },
    );
  });

  it("decodes candle chart defaults and rejects bad literals", () => {
    expect(Schema.decodeUnknownSync(CandleChartConfigSchema)({})).toMatchObject(
      {
        instanceId: "default",
        pair: "BTC/USDT",
        timeframe: "5m",
        limit: 200,
        showSma20: true,
        showVwap: true,
        showVolume: true,
        subplot: "rsi",
      },
    );
    expect(() =>
      Schema.decodeUnknownSync(CandleChartConfigSchema)({ timeframe: "5x" }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(CandleChartConfigSchema)({ subplot: "vibes" }),
    ).toThrow();
  });

  it("decodes percent (shareable) widget defaults", () => {
    expect(
      Schema.decodeUnknownSync(PercentOpenPositionsConfigSchema)({}),
    ).toMatchObject({ instanceId: "default" });
    expect(
      Schema.decodeUnknownSync(PercentClosedTradesConfigSchema)({}),
    ).toMatchObject({ instanceId: "default", limit: 50 });
    expect(
      Schema.decodeUnknownSync(PercentEntryStatsConfigSchema)({}),
    ).toMatchObject({ instanceId: "default", groupBy: "enter" });
  });

  it("rejects invalid tag group/sort literals instead of mis-sorting", () => {
    expect(() =>
      Schema.decodeUnknownSync(TagPerformanceConfigSchema)({
        groupBy: "sideways",
      }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(TagPerformanceConfigSchema)({ sortBy: "vibes" }),
    ).toThrow();
    expect(
      Schema.decodeUnknownSync(TagPerformanceConfigSchema)({
        groupBy: "exit",
        sortBy: "tag",
      }),
    ).toMatchObject({ groupBy: "exit", sortBy: "tag" });
  });

  it("decodes migrated per-instance widget defaults (bot.* -> instances.*)", () => {
    expect(Schema.decodeUnknownSync(BotStatusConfigSchema)({})).toMatchObject({
      instanceId: "default",
    });
    expect(Schema.decodeUnknownSync(ProfitConfigSchema)({})).toMatchObject({
      instanceId: "default",
    });
    expect(Schema.decodeUnknownSync(BalanceConfigSchema)({})).toMatchObject({
      instanceId: "default",
    });
    expect(Schema.decodeUnknownSync(BotConfigConfigSchema)({})).toMatchObject({
      instanceId: "default",
    });
    expect(Schema.decodeUnknownSync(OpenTradesConfigSchema)({})).toMatchObject({
      instanceId: "default",
    });
    expect(Schema.decodeUnknownSync(PnlChartConfigSchema)({})).toMatchObject({
      instanceId: "default",
    });
    expect(
      Schema.decodeUnknownSync(RelativeProfitConfigSchema)({}),
    ).toMatchObject({ instanceId: "default" });
    expect(
      Schema.decodeUnknownSync(RelativeBalanceConfigSchema)({}),
    ).toMatchObject({ instanceId: "default" });
  });

  it("decodes new widget defaults and validates literals", () => {
    expect(
      Schema.decodeUnknownSync(FleetOverviewConfigSchema)({}),
    ).toMatchObject({
      showVersion: false,
      showBalance: true,
    });
    expect(Schema.decodeUnknownSync(DailyProfitConfigSchema)({})).toMatchObject(
      {
        instanceId: "default",
        bucket: "daily",
        days: 30,
      },
    );
    expect(() =>
      Schema.decodeUnknownSync(DailyProfitConfigSchema)({ bucket: "yearly" }),
    ).toThrow();
    expect(Schema.decodeUnknownSync(PairLocksConfigSchema)({})).toMatchObject({
      instanceId: "default",
      showExpired: false,
    });
    expect(
      Schema.decodeUnknownSync(PairUniverseConfigSchema)({}),
    ).toMatchObject({
      instanceId: "default",
      showBlacklist: true,
    });
    expect(Schema.decodeUnknownSync(DrawdownConfigSchema)({})).toMatchObject({
      instanceId: "default",
      limit: 500,
    });
    expect(
      Schema.decodeUnknownSync(EquityCurveConfigSchema)({}),
    ).toMatchObject({
      instanceId: "default",
    });
    expect(Schema.decodeUnknownSync(PairSummaryConfigSchema)({})).toMatchObject(
      {
        instanceId: "default",
        limit: 200,
        minTrades: 1,
        sortBy: "profitAbs",
        sortAsc: false,
      },
    );
    expect(() =>
      Schema.decodeUnknownSync(PairSummaryConfigSchema)({ sortBy: "vibes" }),
    ).toThrow();
  });
});
