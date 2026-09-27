// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Sub-orders table rendered inside an expanded position row — one row per
 * order, LATEST FIRST, every TradeOrder column that carries information.
 * Only the last `initiallyVisible` orders render until the user asks for
 * more, so a DCA marathon never floods the panel. The reveal affordance is
 * the table's own closing row — a quiet full-width "Load N older" button
 * in place of a footer (it reads as the next batch of rows, not chrome
 * bolted under the table).
 *
 * Rows/columns flow through the TanStack Table row model (`NfiDataTable`);
 * the reveal count lives in a component-local TanStack Store.
 */

import { useStore } from "@tanstack/react-store";
import { TableCell, TableRow } from "@carbon/react";
import { ChevronDown } from "@carbon/icons-react";
import type { TradeOrder } from "@nfi/api-contract";
import { NfiDataTable, useLocalStore, type NfiColumnDef } from "@nfi/ui";
import { fmt, orderDate } from "./format";

/** How many older sub-orders one "Load older" click reveals. */
const LOAD_STEP = 10;

/** Fill time when known, else the order time; 0 only when both are absent. */
const orderTime = (order: TradeOrder): number => {
  if (order.filledTimestamp !== undefined) return order.filledTimestamp;

  if (order.timestamp !== undefined) return order.timestamp;

  return 0;
};

const sideClass = (side: string | undefined): string => {
  if (side === "buy") return "nfi-pnl-positive";

  if (side === "sell") return "nfi-pnl-negative";

  return "";
};

/** Static column set — module scope keeps the table inputs stable. */
const COLUMNS: NfiColumnDef<TradeOrder>[] = [
  {
    id: "no",
    header: "No.",
    cell: ({ row }) => row.index + 1,
    meta: { className: "nfi-mono" },
    enableSorting: false,
  },
  {
    id: "date",
    header: "Date",
    cell: ({ row }) => orderDate(row.original.timestamp),
    enableSorting: false,
  },
  {
    id: "side",
    header: "Side",
    cell: ({ row }) => (
      <span className={`nfi-mono ${sideClass(row.original.side)}`}>
        {(row.original.side ?? "?").toUpperCase()}
      </span>
    ),
    enableSorting: false,
  },
  {
    id: "type",
    header: "Type",
    cell: ({ row }) => row.original.type ?? "—",
    enableSorting: false,
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => row.original.status ?? "—",
    enableSorting: false,
  },
  {
    id: "price",
    header: "Price",
    cell: ({ row }) => fmt(row.original.price, 8),
    meta: { className: "nfi-mono" },
    enableSorting: false,
  },
  {
    id: "amount",
    header: "Amount",
    cell: ({ row }) => fmt(row.original.amount, 8),
    meta: { className: "nfi-mono" },
    enableSorting: false,
  },
  {
    id: "filled",
    header: "Filled",
    cell: ({ row }) => fmt(row.original.filled, 8),
    meta: { className: "nfi-mono" },
    enableSorting: false,
  },
  {
    id: "remaining",
    header: "Remaining",
    cell: ({ row }) => fmt(row.original.remaining, 8),
    meta: { className: "nfi-mono" },
    enableSorting: false,
  },
  {
    id: "cost",
    header: "Cost",
    cell: ({ row }) => fmt(row.original.cost, 2),
    meta: { className: "nfi-mono" },
    enableSorting: false,
  },
  {
    id: "tag",
    header: "Tag",
    cell: ({ row }) => row.original.tag?.trim() || "—",
    enableSorting: false,
  },
  {
    id: "role",
    header: "Role",
    cell: ({ row }) =>
      row.original.isEntry === undefined
        ? "—"
        : `${row.original.isEntry ? "entry" : "exit"}${row.original.isOpen ? " · open" : ""}`,
    enableSorting: false,
  },
  {
    id: "orderId",
    header: "Order ID",
    cell: ({ row }) => (
      <span className="nfi-mono nfi-suborders-id" title={row.original.orderId}>
        {row.original.orderId}
      </span>
    ),
    enableSorting: false,
  },
];

export function SubOrdersTable({
  rowKey,
  orders,
  initiallyVisible,
}: {
  /** Stable key of the parent position — keeps reveal state per position. */
  rowKey: string;
  orders: ReadonlyArray<TradeOrder>;
  /** Latest-N orders shown before the user loads older ones. */
  initiallyVisible: number;
}) {
  const visibleStore = useLocalStore(() =>
    Math.max(1, Math.min(initiallyVisible, Math.max(orders.length, 1))),
  );

  const visible = useStore(visibleStore, (v) => v);

  // Latest → oldest. Freqtrade returns oldest-first; a timestamp sort makes
  // the order explicit and keeps partially-filled updates in sequence.
  const sorted = [...orders].sort((a, b) => orderTime(b) - orderTime(a));
  const shown = sorted.slice(0, visible);
  const hidden = sorted.length - shown.length;

  if (sorted.length === 0) {
    return (
      <p className="nfi-suborders-empty">
        No sub-orders recorded for this position.
      </p>
    );
  }

  return (
    <div className="nfi-suborders">
      <div className="nfi-table-scroll">
        <NfiDataTable
          columns={COLUMNS}
          data={shown}
          getRowId={(order) => `${rowKey}-${order.orderId}`}
          footerRow={
            hidden > 0
              ? (colSpan) => (
                  <TableRow className="nfi-suborders-more-row">
                    <TableCell colSpan={colSpan}>
                      <button
                        type="button"
                        className="nfi-suborders-more"
                        title={`Showing the latest ${shown.length} of ${sorted.length} sub-orders — reveal the previous ${Math.min(LOAD_STEP, hidden)}`}
                        onClick={() => visibleStore.setState((v) => v + LOAD_STEP)}
                      >
                        <ChevronDown size={14} aria-hidden />
                        <span className="nfi-suborders-more-label">
                          Load {Math.min(LOAD_STEP, hidden)} older
                        </span>
                        <span className="nfi-suborders-more-count">
                          {hidden} hidden
                        </span>
                      </button>
                    </TableCell>
                  </TableRow>
                )
              : undefined
          }
        />
      </div>
    </div>
  );
}
