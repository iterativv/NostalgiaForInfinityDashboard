// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * @nfi/export-core — the shared export vocabulary.
 *
 * Pure (no React, no I/O): the canonical column-name map, the column
 * model + CSV/XLSX-matrix/JSON serializers, and the per-dataset export
 * column sets. Consumed by the web widgets (client-side export of
 * fully-loaded datasets) and by the server's `/api/export` file
 * generator (full-history exports for the windowed tables), so both
 * sides serialize identical columns.
 */

export { COL, type ColumnName } from "./columns.js";

export { fmtDuration, fmtSigned } from "./format.js";

export {
  buildExportFilename,
  buildGroupedMerges,
  csvCell,
  dedupedExportHeaders,
  expandPositionRows,
  groupedBoundary,
  groupedJsonRecords,
  jsonCell,
  orderIso,
  rowsToCellMatrix,
  rowsToCsv,
  rowsToJson,
  withOrderRows,
  RELATIVE_ORDER_EXPORT_COLUMNS,
  TRADE_ORDER_EXPORT_COLUMNS,
  type ExportColumn,
  type FlatExportRow,
  type GroupedExportColumns,
  type XlsxMerge,
} from "./core.js";

export {
  CLOSED_POSITIONS_EXPORT,
  OPEN_POSITIONS_EXPORT,
  OPEN_TRADES_EXPORT,
  RELATIVE_CLOSED_EXPORT,
  RELATIVE_OPEN_EXPORT,
  TAPE_EXPORT_COLUMNS,
  tagPerformanceExportColumns,
  tagPerformanceRelativeExportColumns,
  type SourcedClosedPosition,
  type SourcedOpenPosition,
} from "./datasets.js";
