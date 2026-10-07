// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Per-dataset export column sets.
 *
 * One set per server-side export dataset (`/api/export?dataset=…`), defined
 * over the SAME contract DTOs the mirror-backed capabilities return — the
 * server serializes full history through these, so a download is
 * cell-for-cell the table's export, just unbounded by the loaded window.
 *
 * Position datasets are GROUPED (position columns + sub-order columns via
 * `withOrderRows`); aggregation/tape datasets are plain column lists.
 * The relative (percent-only) sets carry no absolute amounts by design —
 * the same guarantee their capabilities' payloads have.
 */

import type {
  ClosedPosition,
  OpenPosition,
  RelativeClosedPosition,
  RelativeOpenPosition,
  RelativeOrder,
  RelativeTagPerformanceRow,
  TagGroupBy,
  TagPerformanceRow,
  TapeEvent,
  TradeOrder,
} from "@nfi/api-contract";
import { COL } from "./columns.js";
import { fmtDuration } from "./format.js";
import {
  RELATIVE_ORDER_EXPORT_COLUMNS,
  TRADE_ORDER_EXPORT_COLUMNS,
  withOrderRows,
  type ExportColumn,
  type FlatExportRow,
  type GroupedExportColumns,
} from "./core.js";

/** A position row tagged with its source instance (fleet attribution). */
export type SourcedOpenPosition = OpenPosition & {
  readonly instanceId?: string;
  readonly instanceName?: string;
};

/** A closed-position row tagged with its source instance. */
export type SourcedClosedPosition = ClosedPosition & {
  readonly instanceId?: string;
  readonly instanceName?: string;
};

// ---------------------------------------------------------------------------
// Open trades (per-instance table: profit %, wallet %, leverage, age)
// ---------------------------------------------------------------------------

const OPEN_TRADES_POSITION_COLUMNS: ReadonlyArray<
  ExportColumn<SourcedOpenPosition>
> = [
  { header: COL.bot, value: (p) => p.instanceName ?? p.instanceId ?? "" },
  { header: COL.tradeId, value: (p) => p.tradeId },
  { header: COL.pair, value: (p) => p.pair },
  { header: COL.direction, value: (p) => (p.isShort ? "SHORT" : "LONG") },
  { header: COL.stake, value: (p) => p.stakeAmount },
  { header: COL.openRate, value: (p) => p.openRate },
  { header: COL.currentRate, value: (p) => p.currentRate },
  { header: COL.profit, value: (p) => p.profitAbs },
  { header: COL.profitPct, value: (p) => p.profitPct },
  { header: COL.enterTag, value: (p) => p.enterTag?.trim() ?? "" },
  { header: COL.strategy, value: (p) => p.strategy ?? "" },
  { header: COL.openDate, value: (p) => p.openDate },
];

/** `open-trades` dataset — grouped (position row + one row per sub-order). */
export const OPEN_TRADES_EXPORT: GroupedExportColumns<
  FlatExportRow<SourcedOpenPosition, TradeOrder>
> = withOrderRows({
  positionColumns: OPEN_TRADES_POSITION_COLUMNS,
  orderColumns: TRADE_ORDER_EXPORT_COLUMNS,
});

// ---------------------------------------------------------------------------
// Open positions (full-field table: adds leverage + amount)
// ---------------------------------------------------------------------------

const OPEN_POSITIONS_POSITION_COLUMNS: ReadonlyArray<
  ExportColumn<SourcedOpenPosition>
> = [
  { header: COL.bot, value: (p) => p.instanceName ?? p.instanceId ?? "" },
  { header: COL.tradeId, value: (p) => p.tradeId },
  { header: COL.pair, value: (p) => p.pair },
  { header: COL.direction, value: (p) => (p.isShort ? "SHORT" : "LONG") },
  { header: COL.leverage, value: (p) => p.leverage },
  { header: COL.amount, value: (p) => p.amount },
  { header: COL.stake, value: (p) => p.stakeAmount },
  { header: COL.openRate, value: (p) => p.openRate },
  { header: COL.currentRate, value: (p) => p.currentRate },
  { header: COL.profit, value: (p) => p.profitAbs },
  { header: COL.profitPct, value: (p) => p.profitPct },
  { header: COL.enterTag, value: (p) => p.enterTag?.trim() ?? "" },
  { header: COL.strategy, value: (p) => p.strategy ?? "" },
  { header: COL.openDate, value: (p) => p.openDate },
];

/** `open-positions` dataset — grouped (position row + one row per sub-order). */
export const OPEN_POSITIONS_EXPORT: GroupedExportColumns<
  FlatExportRow<SourcedOpenPosition, TradeOrder>
> = withOrderRows({
  positionColumns: OPEN_POSITIONS_POSITION_COLUMNS,
  orderColumns: TRADE_ORDER_EXPORT_COLUMNS,
});

// ---------------------------------------------------------------------------
// Closed positions (absolute amounts, full history)
// ---------------------------------------------------------------------------

const CLOSED_POSITIONS_POSITION_COLUMNS: ReadonlyArray<
  ExportColumn<SourcedClosedPosition>
> = [
  { header: COL.bot, value: (p) => p.instanceName ?? p.instanceId ?? "" },
  { header: COL.tradeId, value: (p) => p.tradeId },
  { header: COL.pair, value: (p) => p.pair },
  { header: COL.direction, value: (p) => (p.isShort ? "SHORT" : "LONG") },
  { header: COL.leverage, value: (p) => p.leverage },
  { header: COL.amount, value: (p) => p.amount },
  { header: COL.stake, value: (p) => p.stakeAmount },
  { header: COL.openRate, value: (p) => p.openRate },
  { header: COL.closeRate, value: (p) => p.closeRate },
  {
    header: COL.profit,
    value: (p) => p.closeProfitAbs ?? p.profitAbs,
  },
  {
    header: COL.profitPct,
    value: (p) => p.closeProfitPct ?? p.profitPct,
  },
  { header: COL.enterTag, value: (p) => p.enterTag?.trim() ?? "" },
  { header: COL.exitReason, value: (p) => p.exitReason ?? "" },
  { header: COL.strategy, value: (p) => p.strategy ?? "" },
  { header: COL.openDate, value: (p) => p.openDate },
  { header: COL.closeDate, value: (p) => p.closeDate ?? "" },
  { header: COL.duration, value: (p) => fmtDuration(p.tradeDurationSeconds) },
];

/** `closed-positions` dataset — grouped (position row + one row per sub-order). */
export const CLOSED_POSITIONS_EXPORT: GroupedExportColumns<
  FlatExportRow<SourcedClosedPosition, TradeOrder>
> = withOrderRows({
  positionColumns: CLOSED_POSITIONS_POSITION_COLUMNS,
  orderColumns: TRADE_ORDER_EXPORT_COLUMNS,
});

// ---------------------------------------------------------------------------
// Relative (percent-only) twins
// ---------------------------------------------------------------------------

const RELATIVE_OPEN_POSITION_COLUMNS: ReadonlyArray<
  ExportColumn<RelativeOpenPosition>
> = [
  { header: COL.tradeId, value: (p) => p.tradeId },
  { header: COL.pair, value: (p) => p.pair },
  { header: COL.direction, value: (p) => (p.isShort ? "SHORT" : "LONG") },
  { header: COL.profitPct, value: (p) => p.profitPct },
  {
    header: COL.walletPct,
    value: (p) =>
      p.allocationWeight !== undefined && Number.isFinite(p.allocationWeight)
        ? p.allocationWeight * 100
        : undefined,
  },
  { header: COL.leverage, value: (p) => p.leverage },
  { header: COL.enterTag, value: (p) => p.enterTag?.trim() ?? "" },
  { header: COL.strategy, value: (p) => p.strategy ?? "" },
  { header: COL.openDate, value: (p) => p.openDate },
];

/**
 * `open-trades-relative` dataset — grouped, percent-only (no prices,
 * amounts or absolute profits anywhere).
 */
export const RELATIVE_OPEN_EXPORT: GroupedExportColumns<
  FlatExportRow<RelativeOpenPosition, RelativeOrder>
> = withOrderRows({
  positionColumns: RELATIVE_OPEN_POSITION_COLUMNS,
  orderColumns: RELATIVE_ORDER_EXPORT_COLUMNS,
});

const RELATIVE_CLOSED_POSITION_COLUMNS: ReadonlyArray<
  ExportColumn<RelativeClosedPosition>
> = [
  { header: COL.tradeId, value: (p) => p.tradeId },
  { header: COL.pair, value: (p) => p.pair },
  { header: COL.direction, value: (p) => (p.isShort ? "SHORT" : "LONG") },
  { header: COL.profitPct, value: (p) => p.closeProfitPct ?? p.profitPct },
  { header: COL.duration, value: (p) => fmtDuration(p.tradeDurationSeconds) },
  { header: COL.exitReason, value: (p) => p.exitReason ?? "" },
  { header: COL.strategy, value: (p) => p.strategy ?? "" },
  { header: COL.openDate, value: (p) => p.openDate },
  { header: COL.closeDate, value: (p) => p.closeDate ?? "" },
  { header: COL.enterTag, value: (p) => p.enterTag?.trim() ?? "" },
];

/**
 * `closed-trades-relative` dataset — grouped, percent-only (no prices,
 * amounts or absolute profits anywhere).
 */
export const RELATIVE_CLOSED_EXPORT: GroupedExportColumns<
  FlatExportRow<RelativeClosedPosition, RelativeOrder>
> = withOrderRows({
  positionColumns: RELATIVE_CLOSED_POSITION_COLUMNS,
  orderColumns: RELATIVE_ORDER_EXPORT_COLUMNS,
});

// ---------------------------------------------------------------------------
// Aggregations (tag / strategy / pair — one GROUP BY, no sub-orders)
// ---------------------------------------------------------------------------

/** Header of the dimension column for each aggregation group-by. */
const GROUP_HEADER: Record<TagGroupBy, string> = {
  enter: COL.enterTag,
  exit: COL.exitReason,
  pair: COL.pair,
  strategy: COL.strategy,
};

/** `tag-performance` dataset columns (absolute profit included). */
export const tagPerformanceExportColumns = (
  groupBy: TagGroupBy,
): ReadonlyArray<ExportColumn<TagPerformanceRow>> => [
  { header: GROUP_HEADER[groupBy], value: (r) => r.tag },
  { header: COL.trades, value: (r) => r.trades },
  { header: COL.wins, value: (r) => r.wins },
  { header: COL.losses, value: (r) => r.losses },
  { header: COL.winRate, value: (r) => r.winrate },
  { header: COL.totalProfit, value: (r) => r.profitAbs },
  { header: COL.avgPct, value: (r) => r.profitPctAvg },
];

/** `tag-performance-relative` dataset columns (percent-only). */
export const tagPerformanceRelativeExportColumns = (
  groupBy: TagGroupBy,
): ReadonlyArray<ExportColumn<RelativeTagPerformanceRow>> => [
  { header: GROUP_HEADER[groupBy], value: (r) => r.tag },
  { header: COL.trades, value: (r) => r.trades },
  { header: COL.wins, value: (r) => r.wins },
  { header: COL.losses, value: (r) => r.losses },
  { header: COL.winRate, value: (r) => r.winrate },
  { header: COL.avgPct, value: (r) => r.profitPctAvg },
];

// ---------------------------------------------------------------------------
// Trade tape (open/close events over the full mirror history)
// ---------------------------------------------------------------------------

/** `trade-tape` dataset columns — structured event fields, full history. */
export const TAPE_EXPORT_COLUMNS: ReadonlyArray<ExportColumn<TapeEvent>> = [
  { header: COL.event, value: (e) => e.kind },
  { header: COL.tradeId, value: (e) => e.tradeId },
  { header: COL.pair, value: (e) => e.pair },
  { header: COL.bot, value: (e) => e.instanceName ?? e.instanceId ?? "" },
  {
    header: COL.direction,
    value: (e) =>
      e.isShort === undefined ? undefined : e.isShort ? "SHORT" : "LONG",
  },
  { header: COL.openRate, value: (e) => e.openRate },
  { header: COL.enterTag, value: (e) => e.enterTag?.trim() ?? "" },
  { header: COL.exitReason, value: (e) => e.exitReason ?? "" },
  { header: COL.profit, value: (e) => e.profitAbs },
  { header: COL.date, value: (e) => e.at },
];
