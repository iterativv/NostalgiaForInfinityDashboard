// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Fragment, type CSSProperties, type ReactNode } from "react";
import { useStore } from "@tanstack/react-store";
import {
  Table,
  TableBody,
  TableCell,
  TableExpandHeader,
  TableExpandRow,
  TableExpandedRow,
  TableHead,
  TableHeader,
  TableRow,
} from "@carbon/react";
import {
  createExpandedRowModel,
  createSortedRowModel,
  metaHelper,
  rowExpandingFeature,
  rowSelectionFeature,
  rowSortingFeature,
  functionalUpdate,
  tableFeatures,
  useTable,
  type ColumnDef,
  type ExpandedState,
  type Row,
  type RowData,
  type RowSelectionState,
  type SortingState,
  type TableOptions,
  type TableState,
} from "@tanstack/react-table";
import { useLocalStore } from "./store.js";

/**
 * TanStack Table v9 powered data table dressed in IBM Carbon markup.
 *
 * Every table in the app renders through this component: columns are plain
 * TanStack `ColumnDef`s, the row model (sorting, expansion, selection) is
 * computed by TanStack Table, and table state lives in TanStack Store atoms
 * (internal or caller-supplied stores via the controlled props below).
 *
 * Features are registered once, at module scope, per TanStack's stability
 * rules: features/data/columns references must not change per render.
 */

/** Extra per-column rendering metadata (`columnDef.meta`). */
export interface NfiColumnMeta {
  /** Class applied to both the header and the body cells of the column. */
  readonly className?: string;
  /** Inline style applied to both the header and the body cells. */
  readonly style?: CSSProperties;
}

const FEATURES = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  rowExpandingFeature,
  expandedRowModel: createExpandedRowModel(),
  rowSelectionFeature,
  columnMeta: metaHelper<NfiColumnMeta>(),
});

/** Carbon sort-direction prop per TanStack sort state. */
const SORT_DIRECTION = {
  asc: "ASC",
  desc: "DESC",
  none: "NONE",
} as const;

/** The feature set every NFI table runs on; bind column helpers to it. */
export type NfiTableFeatures = typeof FEATURES;

/** Column definition accepted by `NfiDataTable` for rows of `TData`. */
export type NfiColumnDef<TData extends RowData> = ColumnDef<
  NfiTableFeatures,
  TData,
  any
>;

export interface NfiDataTableProps<TData extends RowData> {
  /** TanStack column definitions (order = render order). */
  readonly columns: readonly NfiColumnDef<TData>[];
  readonly data: readonly TData[];
  /** Stable row ids (expansion/selection state is keyed by them). */
  readonly getRowId?: (row: TData, index: number) => string;
  /**
   * Controlled sorting state (e.g. an "Order by" select outside the table).
   * Omit to let the table own sorting internally.
   */
  readonly sorting?: SortingState;
  readonly onSortingChange?: (sorting: SortingState) => void;
  /** Enable clickable header sorting (defaults: only when uncontrolled). */
  readonly enableHeaderSort?: boolean;
  /**
   * Expandable detail rows: adds the expander column and renders one
   * detail row per expanded parent.
   */
  readonly renderExpandedRow?: (
    row: Row<NfiTableFeatures, TData>,
    colSpan: number,
  ) => ReactNode;
  /** Rows start expanded (new rows included); manual toggles persist. */
  readonly defaultExpanded?: boolean;
  /**
   * Full-width closing row inside the table body (e.g. an in-table
   * "load more" affordance): receives the column count for its colSpan.
   * Rendered after the last data row, outside the row model.
   */
  readonly footerRow?: (colSpan: number) => ReactNode;
  /** Controlled row selection state (keyed by row id). */
  readonly rowSelection?: RowSelectionState;
  readonly onRowSelectionChange?: (selection: RowSelectionState) => void;
  readonly size?: "sm" | "md";
  readonly zebra?: boolean;
  /** Class on the rendered `table` element (page-level table skins). */
  readonly className?: string;
}

export function NfiDataTable<TData extends RowData>({
  columns,
  data,
  getRowId,
  sorting,
  onSortingChange,
  enableHeaderSort,
  renderExpandedRow,
  defaultExpanded = false,
  footerRow,
  rowSelection,
  onRowSelectionChange,
  size = "sm",
  zebra = false,
  className,
}: NfiDataTableProps<TData>) {
  const headerSort =
    enableHeaderSort ?? (sorting === undefined && onSortingChange === undefined);

  // Expansion lives in a component store keyed by row id so a data refresh
  // never collapses rows the user expanded (or collapsed) by hand. `seen`
  // tracks every row id the table has ever rendered: default expansion
  // applies exactly once per id — collapsing a row removes its id from the
  // expansion map, and without `seen` that collapsed id would look new
  // again on the next data refresh.
  interface ExpansionState {
    expanded: ExpandedState;
    seen: Record<string, boolean>;
  }

  const expansionStore = useLocalStore<ExpansionState>({
    expanded: {},
    seen: {},
  });

  // Subscribing here closes the loop: `onExpandedChange` writes the store,
  // this read re-renders the table, and the new state reaches the table's
  // atoms on the next options sync.
  const expanded = useStore(expansionStore, (s) => s.expanded);

  if (renderExpandedRow && defaultExpanded) {
    let added = false;
    // Expand-all (`true`) never occurs through this table's UI (no
    // toggle-all control), but the state type allows it; degrade to an
    // empty map and let the loop below mark every row.
    const current = expansionStore.state.expanded;

    const nextExpanded: Record<string, boolean> =
      current === true ? {} : { ...current };

    const nextSeen = { ...expansionStore.state.seen };
    data.forEach((row, index) => {
      const id = getRowId ? getRowId(row, index) : String(index);

      if (nextSeen[id] === undefined) {
        nextSeen[id] = true;

        if (nextExpanded[id] === undefined) {
          nextExpanded[id] = true;
          added = true;
        }
      }
    });

    // Identity-compare store: only notifies when new rows actually appeared.
    if (added) {
      expansionStore.setState(() => ({
        expanded: nextExpanded,
        seen: nextSeen,
      }));
    }
  }

  // One merged controlled-state object: every slice that has an owner flows
  // into the same `state` key — slices without an owner stay absent so the
  // table keeps owning them.
  const controlledState: Partial<TableState<NfiTableFeatures>> = {};

  if (renderExpandedRow) {
    controlledState.expanded = expanded;
  }

  if (sorting !== undefined || onSortingChange !== undefined) {
    controlledState.sorting = sorting ?? [];
  }

  if (rowSelection !== undefined || onRowSelectionChange !== undefined) {
    controlledState.rowSelection = rowSelection ?? {};
  }

  // Options are assembled imperatively: a slice's callback is only present
  // when its controlled value is, so untouched slices stay fully
  // table-owned (uncontrolled).
  // An empty `state` object syncs nothing — untouched slices stay fully
  // table-owned (uncontrolled).
  // SAFETY: the mutable-array typing is a library artifact — the table
  // never mutates columns and copying per render would break model
  // memoization, so the readonly reference passes through unchanged.
  const tableColumns = columns as ColumnDef<NfiTableFeatures, TData, any>[];

  // SAFETY: same as `tableColumns` — the table never mutates `data`.
  const tableData = data as TData[];

  const options: TableOptions<NfiTableFeatures, TData> = {
    features: FEATURES,
    columns: tableColumns,
    data: tableData,
    getRowId,
    enableSorting: headerSort || sorting !== undefined,
    state: controlledState,
  };

  if (renderExpandedRow) {
    // Detail-row pattern: rows are expandable by definition — the default
    // `getCanExpand` requires hierarchical `subRows`, which flat detail
    // tables never have, and the toggle would no-op.
    options.getRowCanExpand = () => true;
    options.onExpandedChange = (updater) =>
      expansionStore.setState((prev) => ({
        ...prev,
        expanded: functionalUpdate(updater, prev.expanded),
      }));
  }

  if (sorting !== undefined || onSortingChange !== undefined) {
    options.onSortingChange = (updater) =>
      onSortingChange?.(functionalUpdate(updater, sorting ?? []));
  }

  if (rowSelection !== undefined || onRowSelectionChange !== undefined) {
    options.onRowSelectionChange = (updater) =>
      onRowSelectionChange?.(functionalUpdate(updater, rowSelection ?? {}));
  }

  const table = useTable<NfiTableFeatures, TData>(options);

  const headerGroup = table.getHeaderGroups()[0];

  if (!headerGroup) {
    return null;
  }

  const columnCount = headerGroup.headers.length;
  const rows = table.getRowModel().rows;

  return (
    <Table size={size} useZebraStyles={zebra} className={className}>
      <TableHead>
        <TableRow>
          {renderExpandedRow ? (
            <TableExpandHeader aria-label="Expand row" />
          ) : null}
          {headerGroup.headers.map((header) => {
            const sorted = header.column.getIsSorted();
            const sortable = headerSort && header.column.getCanSort();

            return (
              <TableHeader
                key={header.id}
                scope="col"
                className={header.column.columnDef.meta?.className}
                style={header.column.columnDef.meta?.style}
                isSortHeader={sortable && sorted !== false}
                sortDirection={SORT_DIRECTION[sorted === false ? "none" : sorted]}
                onClick={
                  sortable ? header.column.getToggleSortingHandler() : undefined
                }
              >
                {header.isPlaceholder ? null : <table.FlexRender header={header} />}
              </TableHeader>
            );
          })}
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) =>
          renderExpandedRow ? (
            <Fragment key={row.id}>
              <TableExpandRow
                aria-label="Expand row"
                expandIconDescription="Toggle detail row"
                isExpanded={row.getIsExpanded()}
                onExpand={row.getToggleExpandedHandler()}
              >
                {row.getAllCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cell.column.columnDef.meta?.className}
                  >
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableExpandRow>
              {row.getIsExpanded() ? (
                <TableExpandedRow colSpan={columnCount + 1}>
                  {renderExpandedRow(row, columnCount + 1)}
                </TableExpandedRow>
              ) : null}
            </Fragment>
          ) : (
            <TableRow key={row.id}>
              {row.getAllCells().map((cell) => (
                <TableCell
                  key={cell.id}
                  className={cell.column.columnDef.meta?.className}
                  style={cell.column.columnDef.meta?.style}
                >
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ),
        )}
        {footerRow ? footerRow(columnCount + (renderExpandedRow ? 1 : 0)) : null}
      </TableBody>
    </Table>
  );
}
