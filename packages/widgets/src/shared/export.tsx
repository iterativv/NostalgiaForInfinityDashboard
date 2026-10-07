// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Table export — CSV / XLSX / JSON downloads.
 *
 * Two paths share one column model (`@nfi/export-core`):
 *
 * - SERVER (`ServerExportMenu`, used by every windowed table): the browser
 *   fetches `GET /api/export?dataset=…&format=…` and the backend generates
 *   the file from the FULL matching set in the mirror — not just the rows
 *   currently loaded in the table. Errors surface through the shared
 *   `formatQueryError` (403 on ungranted datasets included).
 * - CLIENT (`ExportMenu`, snapshot datasets that are fully loaded anyway —
 *   e.g. market movers): the same serialization runs in the browser over
 *   the rows the widget already holds.
 *
 * Grouped position exports (position row + one row per sub-order) are
 * defined once in `@nfi/export-core`, so a server-generated file is
 * cell-for-cell what the client used to serialize — including the XLSX
 * merge blocks and the nested `Orders` JSON records.
 */

import { useState } from "react";
import { Button } from "@carbon/react";
import { Download } from "@carbon/icons-react";
import {
  buildExportFilename,
  buildGroupedMerges,
  rowsToCellMatrix,
  rowsToCsv,
  rowsToJson,
  type ExportColumn,
} from "@nfi/export-core";
import { formatQueryError } from "@nfi/api-contract";
import { resolveRestUrl } from "../live/transport";

// Pure column/serialization core — owned by @nfi/export-core, re-exported
// for the package's existing import surface.
export {
  buildExportFilename,
  buildGroupedMerges,
  csvCell,
  dedupedExportHeaders,
  expandPositionRows,
  jsonCell,
  orderIso,
  rowsToCsv,
  rowsToJson,
  withOrderRows,
  RELATIVE_ORDER_EXPORT_COLUMNS,
  TRADE_ORDER_EXPORT_COLUMNS,
  type ExportColumn,
  type FlatExportRow,
  type GroupedExportColumns,
  type XlsxMerge,
} from "@nfi/export-core";

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so the download has started (revoking
  // synchronously aborts large files in some browsers).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Immediate CSV download (pure, synchronous — safe for tests). */
export function exportRowsToCsv<T>(
  filenameBase: string,
  columns: ReadonlyArray<ExportColumn<T>>,
  rows: ReadonlyArray<T>,
): void {
  downloadBlob(
    `${buildExportFilename(filenameBase)}.csv`,
    new Blob([rowsToCsv(columns, rows)], {
      type: "text/csv;charset=utf-8",
    }),
  );
}

/** Immediate pretty-JSON download (pure serialization — safe for tests). */
export function exportRowsToJson<T>(
  filenameBase: string,
  columns: ReadonlyArray<ExportColumn<T>>,
  rows: ReadonlyArray<T>,
): void {
  downloadBlob(
    `${buildExportFilename(filenameBase)}.json`,
    new Blob([rowsToJson(columns, rows)], {
      type: "application/json;charset=utf-8",
    }),
  );
}

/** XLSX download via SheetJS (lazy import — keeps it out of the main chunk). */
export async function exportRowsToXlsx<T>(
  filenameBase: string,
  columns: ReadonlyArray<ExportColumn<T>>,
  rows: ReadonlyArray<T>,
): Promise<void> {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet(rowsToCellMatrix(columns, rows));

  const merges = buildGroupedMerges(columns, rows);

  if (merges.length > 0) sheet["!merges"] = merges;
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, sheet, "positions");
  XLSX.writeFile(workbook, `${buildExportFilename(filenameBase)}.xlsx`);
}

// ---------------------------------------------------------------------------
// Server-side export (`GET /api/export`)
// ---------------------------------------------------------------------------

/** Query parameters for one server export request. */
export interface ServerExportParams {
  /** `undefined` = fleet (every instance). */
  readonly instanceId?: string;
  /** Free-text filter — the same WHERE the table's subscription uses. */
  readonly search?: string;
  /** Aggregation dimension (tag-performance datasets). */
  readonly groupBy?: "enter" | "exit" | "pair" | "strategy";
  /** HAVING COUNT(*) >= minTrades (tag-performance datasets). */
  readonly minTrades?: number;
  /** Aggregation order key (tag-performance datasets). */
  readonly sortBy?: string;
  readonly sortDir?: "asc" | "desc";
}

const FORMATS = ["csv", "xlsx", "json"] as const;

export type ServerExportFormat = (typeof FORMATS)[number];

const CONTENT_TYPES: Record<ServerExportFormat, string> = {
  csv: "text/csv;charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json;charset=utf-8",
};

/**
 * Fetch one server-generated export file and hand it to the browser.
 * Rejects with the backend's formatted message (`formatQueryError`), so
 * callers surface 403/500 exactly like capability errors.
 */
export async function downloadServerExport(
  dataset: string,
  format: ServerExportFormat,
  params: ServerExportParams | undefined,
  filenameBase: string,
): Promise<void> {
  const query = new URLSearchParams({ dataset, format });

  if (params?.instanceId !== undefined)
    query.set("instanceId", params.instanceId);

  if (params?.search !== undefined && params.search.trim().length > 0)
    query.set("search", params.search.trim());

  if (params?.groupBy !== undefined) query.set("groupBy", params.groupBy);

  if (params?.minTrades !== undefined)
    query.set("minTrades", String(params.minTrades));

  if (params?.sortBy !== undefined) query.set("sortBy", params.sortBy);

  if (params?.sortDir !== undefined) query.set("sortDir", params.sortDir);

  const response = await fetch(resolveRestUrl(`/api/export?${query}`), {
    credentials: "include",
  });

  if (!response.ok) {
    // Error bodies are the contract's `{ error, detail? }` — same shape the
    // capability transport surfaces.
    const text = await response.text().catch(() => "");

    let message = `Export failed (${response.status})`;

    try {
      message = formatQueryError(JSON.parse(text)) ?? message;
    } catch {
      // Non-JSON body — keep the status-based fallback.
    }

    throw new Error(message);
  }

  const blob = new Blob([await response.arrayBuffer()], {
    type: CONTENT_TYPES[format],
  });

  downloadBlob(`${buildExportFilename(filenameBase)}.${format}`, blob);
}

/**
 * CSV/XLSX/JSON export backed by the server's full-set generator. Same
 * three buttons as the client-side `ExportMenu`; disabled (with a tooltip)
 * when nothing is loaded yet.
 */
export function ServerExportMenu({
  filenameBase,
  dataset,
  params,
  disabled,
}: {
  /** Base file name (instance id included by the caller); timestamp added. */
  readonly filenameBase: string;
  /** Export dataset id (`/api/export?dataset=…`). */
  readonly dataset: string;
  /** Filter/scope parameters — the table's current view. */
  readonly params?: ServerExportParams;
  readonly disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const empty = disabled === true;

  const run = (format: ServerExportFormat): void => {
    if (empty || busy) return;

    setBusy(true);

    void downloadServerExport(dataset, format, params, filenameBase)
      .catch((cause: unknown) => {
        window.alert(
          formatQueryError(cause) ??
            (cause instanceof Error ? cause.message : String(cause)),
        );
      })
      .finally(() => setBusy(false));
  };

  return (
    <div style={{ display: "inline-flex", gap: "0.25rem" }}>
      <Button
        size="sm"
        kind="ghost"
        renderIcon={Download}
        disabled={empty || busy}
        title={
          empty
            ? "Nothing to export yet"
            : "Download the FULL matching set as CSV"
        }
        onClick={() => run("csv")}
      >
        CSV
      </Button>
      <Button
        size="sm"
        kind="ghost"
        renderIcon={Download}
        disabled={empty || busy}
        title={
          empty
            ? "Nothing to export yet"
            : "Download the FULL matching set as XLSX"
        }
        onClick={() => run("xlsx")}
      >
        XLSX
      </Button>
      <Button
        size="sm"
        kind="ghost"
        renderIcon={Download}
        disabled={empty || busy}
        title={
          empty
            ? "Nothing to export yet"
            : "Download the FULL matching set as JSON"
        }
        onClick={() => run("json")}
      >
        JSON
      </Button>
    </div>
  );
}

/**
 * CSV/XLSX/JSON export for a widget frame's `actions` slot (client-side
 * serialization of rows the widget already holds in full).
 * Disabled (with a tooltip) when there is nothing to export.
 */
export function ExportMenu<T>({
  filenameBase,
  columns,
  rows,
  disabled,
}: {
  /** Base file name (instance id included by the caller); timestamp added. */
  readonly filenameBase: string;
  readonly columns: ReadonlyArray<ExportColumn<T>>;
  readonly rows: ReadonlyArray<T>;
  readonly disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const empty = disabled === true || rows.length === 0 || columns.length === 0;

  const onXlsx = (): void => {
    if (empty || busy) return;
    setBusy(true);
    void exportRowsToXlsx(filenameBase, columns, rows).finally(() =>
      setBusy(false),
    );
  };

  return (
    <div style={{ display: "inline-flex", gap: "0.25rem" }}>
      <Button
        size="sm"
        kind="ghost"
        renderIcon={Download}
        disabled={empty}
        title={empty ? "Nothing to export yet" : "Download as CSV"}
        onClick={() => exportRowsToCsv(filenameBase, columns, rows)}
      >
        CSV
      </Button>
      <Button
        size="sm"
        kind="ghost"
        renderIcon={Download}
        disabled={empty || busy}
        title={empty ? "Nothing to export yet" : "Download as XLSX"}
        onClick={onXlsx}
      >
        XLSX
      </Button>
      <Button
        size="sm"
        kind="ghost"
        renderIcon={Download}
        disabled={empty}
        title={empty ? "Nothing to export yet" : "Download as JSON"}
        onClick={() => exportRowsToJson(filenameBase, columns, rows)}
      >
        JSON
      </Button>
    </div>
  );
}
