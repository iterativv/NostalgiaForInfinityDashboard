// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Table export — CSV / XLSX download for position-related tables.
 *
 * Every position table (open/closed positions, their `.relative` twins,
 * and the aggregations built from them) offers the same two-button export
 * (`ExportMenu`, rendered in the widget frame's `actions` slot). Columns
 * are plain header + value accessors so exports carry raw values — never
 * the table's rendered JSX (tags, pills, links).
 *
 * CSV follows RFC 4180 quoting with a UTF-8 BOM so Excel opens it
 * directly. XLSX goes through SheetJS (`xlsx`, dynamically imported so the
 * heavy parser stays out of the initial bundle).
 */

import { useState } from "react";
import { Button } from "@carbon/react";
import { Download } from "@carbon/icons-react";

/** One exportable column: header text + raw cell value. */
export interface ExportColumn<T> {
  readonly header: string;
  readonly value: (row: T) => string | number | boolean | null | undefined;
}

/** Cell values a table export renders: text, numbers, flags or blanks. */
export type CsvCellValue = string | number | boolean | null | undefined;

/** RFC 4180 cell quoting: quote when the text holds `"`, `,` or a newline. */
export function csvCell(value: CsvCellValue): string {
  // Only numbers can be non-finite; they export as blank cells rather than
  // the "NaN"/"Infinity" spellings String() would produce.
  const nonFinite =
    Number.isNaN(value) ||
    value === Number.POSITIVE_INFINITY ||
    value === Number.NEGATIVE_INFINITY;

  const text = value == null || nonFinite ? "" : String(value);

  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows → CSV text (CRLF, BOM included for Excel). */
export function rowsToCsv<T>(
  columns: ReadonlyArray<ExportColumn<T>>,
  rows: ReadonlyArray<T>,
): string {
  const lines = [
    columns.map((c) => csvCell(c.header)).join(","),
    ...rows.map((row) => columns.map((c) => csvCell(c.value(row))).join(",")),
  ];

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function stampOf(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");

  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** `open-positions` + instance + timestamp → `open-positions-all-20240101-1200`. */
export function buildExportFilename(base: string, now = new Date()): string {
  const safe = base.trim().replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");

  return `${safe.length > 0 ? safe : "export"}-${stampOf(now)}`;
}

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
  const text = rowsToCsv(columns, rows);

  downloadBlob(
    `${buildExportFilename(filenameBase)}.csv`,
    new Blob([text], { type: "text/csv;charset=utf-8" }),
  );
}

/** XLSX download via SheetJS (lazy import — keeps it out of the main chunk). */
export async function exportRowsToXlsx<T>(
  filenameBase: string,
  columns: ReadonlyArray<ExportColumn<T>>,
  rows: ReadonlyArray<T>,
): Promise<void> {
  const XLSX = await import("xlsx");

  const sheet = XLSX.utils.json_to_sheet(
    rows.map((row) => {
      const record: Record<string, string | number | boolean> = {};

      for (const column of columns) {
        const value = column.value(row);

        record[column.header] =
          value === null || value === undefined ? "" : value;
      }

      return record;
    }),
  );

  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, sheet, "positions");
  XLSX.writeFile(workbook, `${buildExportFilename(filenameBase)}.xlsx`);
}

/**
 * Two-button CSV/XLSX export for a widget frame's `actions` slot.
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
    </div>
  );
}
