// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * `@nfi/widgets` — every production widget in one dedicated package.
 *
 * Each widget module owns its component, its Effect Schema config (with
 * decoding defaults) and its `defineWidget` definition. The app's workspace
 * `WidgetRegistry` (see `apps/web/src/workspace/registry.tsx`) only collects
 * `builtinWidgets` from here — shell code never references widget files
 * directly.
 *
 * The package is self-contained EXCEPT for two app-injected bridges: the
 * panel-config write path (`setPanelConfigSink`) and the live-layer
 * transport + capability grant (`@nfi/widgets/live`), both registered by
 * the app at boot.
 */

export * from "./shared/config";
export * from "./shared/format";
export * from "./shared/query";
export * from "./shared/InstanceSelect";
export * from "./shared/sources";
export * from "./shared/SettingsToggle";
export * from "./shared/SettingsSelect";
export * from "./shared/WidgetSettings";
export * from "./shared/widgetSettingsBus";
export * from "./shared/widgetGlobals";
export * from "./shared/dialogs";
export * from "./shared/panelConfig";
export * from "./shared/OrderLines";
export * from "./demoWidgets";
export * from "./BotStatusWidget";
export * from "./ProfitWidget";
export * from "./BalanceWidget";
export * from "./RelativeProfitWidget";
export * from "./RelativeBalanceWidget";
export * from "./RelativeEquityWidget";
export * from "./PercentOpenPositionsWidget";
export * from "./PercentClosedTradesWidget";
export * from "./PercentEntryStatsWidget";
export * from "./OpenTradesWidget";
export * from "./PnlChartWidget";
export * from "./EquityCurveWidget";
export * from "./BotConfigWidget";
export * from "./ConnectionWidget";
export * from "./InstanceHealthRow";
export * from "./InstanceManagerWidget";
export * from "./OpenPositionsWidget";
export * from "./ClosedPositionsWidget";
export * from "./InstancesTableWidget";
export * from "./CumulativeProfitWidget";
export * from "./TagPerformanceWidget";
export * from "./TickerTapeWidget";
export * from "./WatchlistWidget";
export * from "./MarketMoversWidget";
export * from "./ExposureWidget";
export * from "./PerformanceStatsWidget";
export * from "./StrategyBreakdownWidget";
export * from "./TradeTapeWidget";
export * from "./RiskMonitorWidget";
export * from "./SessionClockWidget";
export * from "./CandleChartWidget";
export * from "./FleetOverviewWidget";
export * from "./DailyProfitWidget";
export * from "./PairLocksWidget";
export * from "./PairUniverseWidget";
export * from "./DrawdownWidget";
export * from "./PairSummaryWidget";
export * from "./WalletHistoryWidget";
import type { AnyWidgetDefinition } from "@nfi/widget-sdk";
import { DEMO_WIDGETS } from "./demoWidgets";
import { BotStatusWidgetDef } from "./BotStatusWidget";
import { CandleChartWidgetDef } from "./CandleChartWidget";
import { ProfitWidgetDef } from "./ProfitWidget";
import { RelativeProfitWidgetDef } from "./RelativeProfitWidget";
import { RelativeBalanceWidgetDef } from "./RelativeBalanceWidget";
import { RelativeEquityWidgetDef } from "./RelativeEquityWidget";
import { PercentOpenPositionsWidgetDef } from "./PercentOpenPositionsWidget";
import { PercentClosedTradesWidgetDef } from "./PercentClosedTradesWidget";
import { PercentEntryStatsWidgetDef } from "./PercentEntryStatsWidget";
import { BalanceWidgetDef } from "./BalanceWidget";
import { OpenTradesWidgetDef } from "./OpenTradesWidget";
import { PnlChartWidgetDef } from "./PnlChartWidget";
import { EquityCurveWidgetDef } from "./EquityCurveWidget";
import { BotConfigWidgetDef } from "./BotConfigWidget";
import { ConnectionWidgetDef } from "./ConnectionWidget";
import { InstanceManagerWidgetDef } from "./InstanceManagerWidget";
import { OpenPositionsWidgetDef } from "./OpenPositionsWidget";
import { ClosedPositionsWidgetDef } from "./ClosedPositionsWidget";
import { InstancesTableWidgetDef } from "./InstancesTableWidget";
import { CumulativeProfitWidgetDef } from "./CumulativeProfitWidget";
import { TagPerformanceWidgetDef } from "./TagPerformanceWidget";
import { TickerTapeWidgetDef } from "./TickerTapeWidget";
import { WatchlistWidgetDef } from "./WatchlistWidget";
import { MarketMoversWidgetDef } from "./MarketMoversWidget";
import { ExposureWidgetDef } from "./ExposureWidget";
import { PerformanceStatsWidgetDef } from "./PerformanceStatsWidget";
import { StrategyBreakdownWidgetDef } from "./StrategyBreakdownWidget";
import { TradeTapeWidgetDef } from "./TradeTapeWidget";
import { RiskMonitorWidgetDef } from "./RiskMonitorWidget";
import { SessionClockWidgetDef } from "./SessionClockWidget";
import { FleetOverviewWidgetDef } from "./FleetOverviewWidget";
import { DailyProfitWidgetDef } from "./DailyProfitWidget";
import { PairLocksWidgetDef } from "./PairLocksWidget";
import { PairUniverseWidgetDef } from "./PairUniverseWidget";
import { DrawdownWidgetDef } from "./DrawdownWidget";
import { PairSummaryWidgetDef } from "./PairSummaryWidget";
import { WalletHistoryWidgetDef } from "./WalletHistoryWidget";

/**
 * Every built-in widget definition, registry order. Demo/development
 * fixtures lead (they power architecture tests); production widgets follow
 * the order of the exports above.
 */
export const builtinWidgets: ReadonlyArray<AnyWidgetDefinition> = [
  ...DEMO_WIDGETS,
  BotStatusWidgetDef,
  CandleChartWidgetDef,
  ProfitWidgetDef,
  RelativeProfitWidgetDef,
  RelativeBalanceWidgetDef,
  RelativeEquityWidgetDef,
  PercentOpenPositionsWidgetDef,
  PercentClosedTradesWidgetDef,
  PercentEntryStatsWidgetDef,
  BalanceWidgetDef,
  OpenTradesWidgetDef,
  PnlChartWidgetDef,
  EquityCurveWidgetDef,
  BotConfigWidgetDef,
  ConnectionWidgetDef,
  InstanceManagerWidgetDef,
  OpenPositionsWidgetDef,
  ClosedPositionsWidgetDef,
  InstancesTableWidgetDef,
  CumulativeProfitWidgetDef,
  TagPerformanceWidgetDef,
  TickerTapeWidgetDef,
  WatchlistWidgetDef,
  MarketMoversWidgetDef,
  ExposureWidgetDef,
  PerformanceStatsWidgetDef,
  StrategyBreakdownWidgetDef,
  TradeTapeWidgetDef,
  RiskMonitorWidgetDef,
  SessionClockWidgetDef,
  FleetOverviewWidgetDef,
  DailyProfitWidgetDef,
  PairLocksWidgetDef,
  PairUniverseWidgetDef,
  DrawdownWidgetDef,
  PairSummaryWidgetDef,
  WalletHistoryWidgetDef,
];
