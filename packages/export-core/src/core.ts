// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Export core — the pure column model + serializers shared by the web
 * widgets' client-side export and the server's `/api/export` file
 * generator.
 *
 * Columns are plain header + value accessors so exports carry raw values —
 * never a table's rendered JSX (tags, pills, links). The SAME column
 * definitions drive both sides, so a server-generated file is
 * cell-for-cell what the client used to serialize from loaded rows.
 *
 * Position tables export grouped rows (`expandPositionRows` +
 * `withOrderRows`): the header is `position columns + sub-order columns`.
 * Each position emits one position row (position cells filled, order cells
 * empty) followed by one row per sub-order (position cells empty, order
 * cells filled). CSV leaves the empty side blank; XLSX additionally merges
 * the empty side — horizontally per row, and vertically across a
 * position's order rows — so each group reads as one block.
 *
 * JSON is STRUCTURED for grouped exports: one record per position with the
 * position columns as keys and every sub-order nested under `Orders` (a
 * flat record list would strip each order row's position fields — Trade ID
 * included — leaving orders unlinkable). Plain (non-grouped) column sets
 * serialize as a flat record list.
 *
 * CSV follows RFC 4180 quoting with a UTF-8 BOM so Excel opens it
 * directly. XLSX goes through SheetJS (`aoa_to_sheet` on the caller's
 * side — this module only builds the cell matrix and merge ranges) so
 * duplicate headers (e.g. position `Amount` + order `Amount`) keep their
 * own columns. Nested order records reuse the order headers as keys,
 * suffixing repeats as `Amount (2)` so no column is lost.
 */

import { COL } from "./columns.js";
import type { RelativeOrder, TradeOrder } from "@nfi/api-contract";

/** One exportable column: header text + raw cell value. */
export interface ExportColumn<T> {
  readonly header: string;
  readonly value: (row: T) => string | number | boolean | null | undefined;
}

/**
 * One grouped export row: a position row, or one sub row per order.
 * `position` is always the owning position; `order` is present on
 * sub rows only.
 */
export interface FlatExportRow<P, O> {
  readonly kind: "position" | "order";
  readonly position: P;
  readonly order?: O;
}

/**
 * Positions → grouped export rows: one `{ kind: "position" }` row per
 * position, each followed by its `{ kind: "order" }` sub rows (in the
 * stored order order). Positions without orders export as a lone
 * position row.
 */
export function expandPositionRows<P, O>(
  rows: ReadonlyArray<P>,
  getOrders: (position: P) => ReadonlyArray<O> | undefined,
): Array<FlatExportRow<P, O>> {
  const out: Array<FlatExportRow<P, O>> = [];

  for (const position of rows) {
    out.push({ kind: "position", position });

    for (const order of getOrders(position) ?? [])
      out.push({ kind: "order", position, order });
  }

  return out;
}

/**
 * Position columns + order columns → one grouped column set for
 * `expandPositionRows` output. Position rows fill the position cells
 * (order cells blank); sub-order rows leave every position cell blank
 * and fill the order cells.
 */
export type GroupedExportColumns<T> = ReadonlyArray<ExportColumn<T>> & {
  /** Leading position-column count — the XLSX merge boundary. */
  readonly positionColumnCount: number;
};

/**
 * Column sets built by `withOrderRows` — the only sources of
 * `positionColumnCount`. Identity-based so readers never re-assert the
 * column array's shape.
 */
const groupedColumnSets = new WeakSet<object>();

/** Leading position-column count for a `withOrderRows` set; 0 otherwise. */
export const groupedBoundary = <T>(
  columns: ReadonlyArray<ExportColumn<T>>,
): number => {
  // SAFETY: membership proves this exact array came from `withOrderRows`,
  // which assigns `positionColumnCount` on it by construction.
  return groupedColumnSets.has(columns)
    ? (columns as GroupedExportColumns<T>).positionColumnCount
    : 0;
};

export function withOrderRows<P, O>(args: {
  readonly positionColumns: ReadonlyArray<ExportColumn<P>>;
  readonly orderColumns: ReadonlyArray<ExportColumn<O>>;
}): GroupedExportColumns<FlatExportRow<P, O>> {
  const positions = args.positionColumns.map(
    (column): ExportColumn<FlatExportRow<P, O>> => ({
      header: column.header,
      value: (row) =>
        row.kind === "position" ? column.value(row.position) : undefined,
    }),
  );

  const orders = args.orderColumns.map(
    (column): ExportColumn<FlatExportRow<P, O>> => ({
      header: column.header,
      value: (row) =>
        row.order !== undefined ? column.value(row.order) : undefined,
    }),
  );

  const grouped = Object.assign([...positions, ...orders], {
    positionColumnCount: args.positionColumns.length,
  });

  groupedColumnSets.add(grouped);

  return grouped;
}

/** One SheetJS merge range (`!merges` entry). */
export interface XlsxMerge {
  readonly s: { readonly r: number; readonly c: number };
  readonly e: { readonly r: number; readonly c: number };
}

const rowKindOf = <T>(row: T): string | undefined => {
  // Grouped rows carry a `kind` tag; plain rows don't. `instanceof Object`
  // rejects malformed entries (primitives, null/undefined), and `in` probes
  // the same prototype chain the old `.kind` read did — no cast needed.
  if (!(row instanceof Object) || !("kind" in row)) return undefined;

  const kind = row.kind;

  return kind === "position" || kind === "order" ? kind : undefined;
};

/**
 * Grouped rows → XLSX merge ranges. Position rows merge the empty
 * order-side cells horizontally; a position's order rows merge the empty
 * position side into one block — horizontally within one row and
 * additionally vertically across the group's order rows. Header row
 * (r = 0) never merges; plain (non-grouped) column sets yield no merges.
 */
export function buildGroupedMerges<T>(
  columns: ReadonlyArray<ExportColumn<T>>,
  rows: ReadonlyArray<T>,
): Array<XlsxMerge> {
  const total = columns.length;
  const boundary = groupedBoundary(columns);

  if (boundary <= 0 || boundary >= total) return [];

  const merges: Array<XlsxMerge> = [];
  const orderSideWidth = total - boundary;

  // First sheet row of the current group's order block (null between groups).
  let orderStart: number | null = null;

  /** Close the pending order block at `endExclusive` (sheet-row space). */
  const flushOrders = (endExclusive: number): void => {
    if (orderStart === null) return;

    const start = orderStart;

    orderStart = null;

    if (boundary >= 2) {
      // One rectangle over the whole block: horizontal for a lone order
      // row, horizontal + vertical for several.
      merges.push({
        s: { r: start, c: 0 },
        e: { r: endExclusive - 1, c: boundary - 1 },
      });
    } else if (endExclusive - 1 > start) {
      // Single position column: only a vertical merge is possible.
      merges.push({ s: { r: start, c: 0 }, e: { r: endExclusive - 1, c: 0 } });
    }
  };

  rows.forEach((row, index) => {
    const sheetRow = index + 1;
    const kind = rowKindOf(row);

    if (kind === "position") {
      flushOrders(sheetRow);

      // Trailing order side is empty — merge into one block (needs ≥2 cols).
      if (orderSideWidth >= 2)
        merges.push({
          s: { r: sheetRow, c: boundary },
          e: { r: sheetRow, c: total - 1 },
        });
    } else if (kind === "order") {
      if (orderStart === null) orderStart = sheetRow;
    } else {
      flushOrders(sheetRow);
    }
  });
  flushOrders(rows.length + 1);

  return merges;
}

/** Rows → the SheetJS `aoa_to_sheet` cell matrix (header row first). */
export function rowsToCellMatrix<T>(
  columns: ReadonlyArray<ExportColumn<T>>,
  rows: ReadonlyArray<T>,
): Array<Array<string | number | boolean>> {
  return [
    columns.map((column) => column.header),
    ...rows.map((row) =>
      columns.map((column) => {
        const value = column.value(row);

        return value === null || value === undefined ? "" : value;
      }),
    ),
  ];
}

/** Epoch-millis order stamp → ISO text (blank when absent). */
export const orderIso = (stamp: number | undefined): string | undefined =>
  stamp !== undefined && Number.isFinite(stamp) && stamp > 0
    ? new Date(stamp).toISOString()
    : undefined;

/** Order-side export columns shared by every absolute position table. */
export const TRADE_ORDER_EXPORT_COLUMNS: ReadonlyArray<
  ExportColumn<TradeOrder>
> = [
  { header: COL.orderId, value: (o) => o.orderId },
  {
    header: COL.date,
    value: (o) => orderIso(o.filledTimestamp ?? o.timestamp),
  },
  { header: COL.side, value: (o) => o.side.toUpperCase() },
  { header: COL.orderType, value: (o) => o.type },
  { header: COL.status, value: (o) => o.status },
  { header: COL.price, value: (o) => o.price },
  { header: COL.amount, value: (o) => o.amount },
  { header: COL.filled, value: (o) => o.filled },
  { header: COL.remaining, value: (o) => o.remaining },
  { header: COL.cost, value: (o) => o.cost },
  { header: COL.orderTag, value: (o) => o.tag?.trim() || undefined },
  {
    header: COL.role,
    value: (o) =>
      o.isEntry === undefined ? undefined : o.isEntry ? "entry" : "exit",
  },
];

/**
 * Order-side export columns for the percent-only (relative) tables —
 * no prices, amounts or timestamps exist on these by design.
 */
export const RELATIVE_ORDER_EXPORT_COLUMNS: ReadonlyArray<
  ExportColumn<RelativeOrder>
> = [
  { header: COL.side, value: (o) => o.side.toUpperCase() },
  {
    header: COL.role,
    value: (o) =>
      o.isEntry === undefined ? undefined : o.isEntry ? "entry" : "exit",
  },
  { header: COL.orderTag, value: (o) => o.tag?.trim() || undefined },
  { header: COL.status, value: (o) => o.status },
];

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

/**
 * Column headers with repeats suffixed (`Amount`, `Amount (2)`) so JSON
 * objects keyed by header keep every column — e.g. position `Amount` +
 * order `Amount` in the grouped position exports.
 */
export function dedupedExportHeaders<T>(
  columns: ReadonlyArray<ExportColumn<T>>,
): ReadonlyArray<string> {
  const seen = new Map<string, number>();

  return columns.map((column) => {
    const count = (seen.get(column.header) ?? 0) + 1;

    seen.set(column.header, count);

    return count === 1 ? column.header : `${column.header} (${count})`;
  });
}

/** Raw cell → JSON value: missing / non-finite numbers become `null`. */
export function jsonCell(
  value: string | number | boolean | null | undefined,
): string | number | boolean | null {
  if (value === null || value === undefined) return null;

  // JSON has no NaN/Infinity spelling — non-finite numbers encode as null.
  const nonFinite =
    Number.isNaN(value) ||
    value === Number.POSITIVE_INFINITY ||
    value === Number.NEGATIVE_INFINITY;

  if (nonFinite) return null;

  return value;
}

/**
 * Grouped exports serialize as one record per POSITION with its sub-orders
 * nested under `Orders` — the row objects themselves don't survive as flat
 * records, because order rows would lose every position field (Trade ID
 * included) and become unlinkable. `boundary <= 0` keeps the plain flat
 * record list.
 */
export function groupedJsonRecords<T>(
  columns: ReadonlyArray<ExportColumn<T>>,
  headers: ReadonlyArray<string>,
  rows: ReadonlyArray<T>,
): Array<
  Record<
    string,
    | string
    | number
    | boolean
    | null
    | Array<Record<string, string | number | boolean | null>>
  >
> {
  const boundary = groupedBoundary(columns);
  const positionHeaders = headers.slice(0, boundary);
  const orderHeaders = headers.slice(boundary);

  type JsonRecord = Record<string, string | number | boolean | null>;

  type GroupedRecord = Record<
    string,
    string | number | boolean | null | JsonRecord[]
  >;

  const records: GroupedRecord[] = [];
  let current: GroupedRecord | null = null;
  let orders: JsonRecord[] = [];

  const flush = (): void => {
    if (current === null) return;

    current["Orders"] = orders;
    records.push(current);
    current = null;
    orders = [];
  };

  for (const row of rows) {
    const kind = rowKindOf(row);

    if (kind === "order") {
      if (current === null) continue;

      const orderRecord: JsonRecord = {};

      columns.forEach((column, index) => {
        const header = orderHeaders[index - boundary];

        if (index >= boundary && header !== undefined) {
          orderRecord[header] = jsonCell(column.value(row));
        }
      });
      orders.push(orderRecord);

      continue;
    }

    flush();

    const record: GroupedRecord = {};

    columns.forEach((column, index) => {
      const header = positionHeaders[index];

      if (index < boundary && header !== undefined) {
        record[header] = jsonCell(column.value(row));
      }
    });

    current = record;
  }

  flush();

  return records;
}

/** Rows → pretty-printed JSON text (2-space indent, trailing newline). */
export function rowsToJson<T>(
  columns: ReadonlyArray<ExportColumn<T>>,
  rows: ReadonlyArray<T>,
): string {
  const headers = dedupedExportHeaders(columns);

  const grouped =
    groupedBoundary(columns) > 0 &&
    rows.some((row) => rowKindOf(row) !== undefined);

  const records = grouped
    ? groupedJsonRecords(columns, headers, rows)
    : rows.map((row) => {
        const record: Record<string, string | number | boolean | null> = {};

        columns.forEach((column, index) => {
          const header = headers[index];

          if (header !== undefined)
            record[header] = jsonCell(column.value(row));
        });

        return record;
      });

  return `${JSON.stringify(records, null, 2)}\n`;
}

function stampOf(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");

  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

/** `open-positions` + instance + timestamp → `open-positions-all-20240101-1200`. */
export function buildExportFilename(base: string, now = new Date()): string {
  const safe = base
    .trim()
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${safe.length > 0 ? safe : "export"}-${stampOf(now)}`;
}
