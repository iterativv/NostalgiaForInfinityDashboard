// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Carbon table toolbar — one grouped home for every table action.
 *
 * Every data table renders the same chrome (the Carbon DataTable pattern):
 * a persistent filter search, an order-by select and an overflow menu
 * holding the CSV/XLSX/JSON export — instead of bespoke search rows plus
 * header buttons scattered per widget. Widgets compose `NfiTableToolbar`
 * with exactly the sections their table has (all three for the filtered
 * position tables, export-only for the aggregation tables) and wrap
 * toolbar + table in `TableContainer`.
 *
 * The filter stays server-side: the search text rides the stream
 * subscription exactly like the old bespoke inputs (callers keep their
 * debounced subscription wiring). Exports come in two variants sharing one
 * busy-guarded menu: SERVER (`dataset` + `params`) downloads a file the
 * backend generated over the FULL matching set — the path every windowed
 * table uses — and CLIENT (`columns` + `rows`) serializes rows the widget
 * already holds in full.
 */

import { useState } from "react";
import {
  OverflowMenuItem,
  TableContainer,
  TableToolbar,
  TableToolbarContent,
  TableToolbarMenu,
  TableToolbarSearch,
} from "@carbon/react";
import {
  downloadServerExport,
  exportRowsToCsv,
  exportRowsToJson,
  exportRowsToXlsx,
  type ExportColumn,
  type ServerExportParams,
} from "./export";
import { Download } from "@carbon/icons-react";

/** Filter search section (persistent Carbon toolbar search). */
export interface ToolbarSearchProps {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly labelText: string;
}

/** Order-by section (compact native select — never clipped). */
export interface ToolbarOrderProps {
  readonly id: string;
  readonly value: string;
  readonly items: ReadonlyArray<{ readonly id: string; readonly text: string }>;
  readonly onChange: (id: string) => void;
}

/**
 * Export overflow section (CSV + XLSX + JSON). Two variants:
 *
 * - SERVER (`dataset` + `params`): the backend generates the file from the
 *   FULL matching set in the mirror — the windowed tables' export path
 *   (loaded rows are a viewport, never the export).
 * - CLIENT (`columns` + `rows`): in-browser serialization of rows the
 *   widget already holds in full (snapshot datasets only).
 */
export interface ServerToolbarExport {
  readonly dataset: string;
  readonly params?: ServerExportParams;
  readonly filenameBase: string;
  /** Nothing loaded yet — the server set can't be empty-matched blindly. */
  readonly disabled?: boolean;
}

export interface ClientToolbarExport<T> {
  readonly filenameBase: string;
  readonly columns: ReadonlyArray<ExportColumn<T>>;
  readonly rows: ReadonlyArray<T>;
  /**
   * Full-dataset fetch run on export, INSTEAD of `rows` — for the rare
   * client-side table whose dataset is bigger than its loaded window.
   * Errors fall back to `rows` so an export never no-ops.
   */
  readonly loadRows?: () => Promise<ReadonlyArray<T>>;
}

export type ToolbarExportProps<T> =
  ServerToolbarExport | ClientToolbarExport<T>;

export function NfiTableToolbar<T extends object>({
  label,
  search,
  orderBy,
  exportMenu,
}: {
  /** Accessible label for the toolbar region. */
  readonly label: string;
  readonly search?: ToolbarSearchProps;
  readonly orderBy?: ToolbarOrderProps;
  readonly exportMenu?: ToolbarExportProps<T>;
}) {
  const [busy, setBusy] = useState(false);


  const server =
    exportMenu !== undefined && "dataset" in exportMenu
      ? exportMenu
      : undefined;

  const client =
    exportMenu !== undefined && !("dataset" in exportMenu)
      ? exportMenu
      : undefined;

  const empty =
    exportMenu === undefined ||
    (server !== undefined && server.disabled === true) ||
    (client !== undefined &&
      (client.rows.length === 0 || client.columns.length === 0));

  /** Rows to serialize: the full fetch when the caller provides one. */
  const resolveRows = async (): Promise<ReadonlyArray<T>> => {
    if (client === undefined) return [];

    if (client.loadRows === undefined) return client.rows;

    try {
      const rows = await client.loadRows();

      return rows.length > 0 ? rows : client.rows;
    } catch {
      return client.rows;
    }
  };

  /** One export run — server download or client serialization. */
  const onExport = async (format: "csv" | "xlsx" | "json"): Promise<void> => {
    if (exportMenu === undefined || empty || busy) return;

    setBusy(true);

    try {
      if (server !== undefined) {
        await downloadServerExport(
          server.dataset,
          format,
          server.params,
          server.filenameBase,
        );

        return;
      }

      const columns = client?.columns ?? [];
      const rows = await resolveRows();

      if (format === "csv")
        exportRowsToCsv(exportMenu.filenameBase, columns, rows);
      else if (format === "json")
        exportRowsToJson(exportMenu.filenameBase, columns, rows);
      else await exportRowsToXlsx(exportMenu.filenameBase, columns, rows);
    } catch (cause) {
      // Server exports reject with the backend's formatted message; the
      // menu stays usable and the failure is visible instead of silent.
      window.alert(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <TableToolbar aria-label={label}>
      <TableToolbarContent>
        {search !== undefined ? (
          <TableToolbarSearch
            persistent
            id={search.id}
            value={search.value}
            placeholder={search.placeholder}
            labelText={search.labelText}
            onChange={(_event, next) => search.onChange(next ?? "")}
            onClear={() => search.onChange("")}
          />
        ) : null}
        {orderBy !== undefined ? (
          <select
            id={orderBy.id}
            aria-label="Order by"
            title="Order by"
            className="nfi-toolbar-select"
            value={orderBy.value}
            onChange={(event) => orderBy.onChange(event.target.value)}
          >
            {orderBy.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.text}
              </option>
            ))}
          </select>
        ) : null}
        {exportMenu !== undefined ? (
          <TableToolbarMenu
            aria-label="Table actions"
            iconDescription="Table actions"
            renderIcon={Download}
          >
            <OverflowMenuItem
              disabled={empty || busy}
              itemText={busy ? "Preparing…" : "Export CSV"}
              onClick={() => void onExport("csv")}
            />
            <OverflowMenuItem
              disabled={empty || busy}
              itemText={busy ? "Preparing…" : "Export XLSX"}
              onClick={() => void onExport("xlsx")}
            />
            <OverflowMenuItem
              disabled={empty || busy}
              itemText={busy ? "Preparing…" : "Export JSON"}
              onClick={() => void onExport("json")}
            />
          </TableToolbarMenu>
        ) : null}
      </TableToolbarContent>
    </TableToolbar>
  );
}

/**
 * Carbon table shell: toolbar pinned above a horizontally scrolling table.
 * Replaces the bespoke filter row + `.nfi-table-scroll` wrapper per widget
 * so every table carries identical chrome.
 */
export function NfiTableContainer({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <TableContainer className="nfi-table-container">{children}</TableContainer>
  );
}
