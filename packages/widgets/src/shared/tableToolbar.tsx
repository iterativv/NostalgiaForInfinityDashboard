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
 * debounced subscription wiring — this component only renders).
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
  exportRowsToCsv,
  exportRowsToJson,
  exportRowsToXlsx,
  type ExportColumn,
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

/** Export overflow section (CSV + XLSX + JSON of the exported rows). */
export interface ToolbarExportProps<T> {
  readonly filenameBase: string;
  readonly columns: ReadonlyArray<ExportColumn<T>>;
  readonly rows: ReadonlyArray<T>;
}

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

  const empty =
    exportMenu === undefined ||
    exportMenu.rows.length === 0 ||
    exportMenu.columns.length === 0;

  const onXlsx = (): void => {
    if (exportMenu === undefined || empty || busy) return;
    setBusy(true);
    void exportRowsToXlsx(
      exportMenu.filenameBase,
      exportMenu.columns,
      exportMenu.rows,
    ).finally(() => setBusy(false));
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
              disabled={empty}
              itemText="Export CSV"
              onClick={() =>
                exportRowsToCsv(
                  exportMenu.filenameBase,
                  exportMenu.columns,
                  exportMenu.rows,
                )
              }
            />
            <OverflowMenuItem
              disabled={empty || busy}
              itemText={busy ? "Preparing…" : "Export XLSX"}
              onClick={onXlsx}
            />
            <OverflowMenuItem
              disabled={empty}
              itemText="Export JSON"
              onClick={() =>
                exportRowsToJson(
                  exportMenu.filenameBase,
                  exportMenu.columns,
                  exportMenu.rows,
                )
              }
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
  return <TableContainer className="nfi-table-container">{children}</TableContainer>;
}
