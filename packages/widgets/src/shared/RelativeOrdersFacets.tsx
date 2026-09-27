// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Sub-order facets for the percent-only (relative) trade tables.
 *
 * Relative orders deliberately carry no prices, amounts or timestamps
 * (see `@nfi/capabilities` relative transforms) — the shareable expansion
 * is this compact numbered facet list: side, status, signal tag and
 * entry/exit role per order. Rows flow through the TanStack Table row
 * model (`NfiDataTable`).
 */

import type { RelativeOrder } from "@nfi/api-contract";
import { NfiDataTable, type NfiColumnDef } from "@nfi/ui";

const sideClass = (side: string): string => {
  if (side === "buy") return "nfi-pnl-positive";

  if (side === "sell") return "nfi-pnl-negative";

  return "";
};

/** Static column set — module scope keeps the table inputs stable. */
const COLUMNS: NfiColumnDef<RelativeOrder>[] = [
  {
    id: "no",
    header: "No.",
    cell: ({ row }) => row.index + 1,
    meta: { className: "nfi-mono" },
    enableSorting: false,
  },
  {
    id: "side",
    header: "Side",
    cell: ({ row }) => (
      <span className={`nfi-mono ${sideClass(row.original.side)}`}>
        {row.original.side.toUpperCase()}
      </span>
    ),
    enableSorting: false,
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => row.original.status ?? "—",
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
        : row.original.isEntry
          ? "entry"
          : "exit",
    enableSorting: false,
  },
];

export function RelativeOrdersFacets({
  orders,
}: {
  orders: ReadonlyArray<RelativeOrder>;
}) {
  if (orders.length === 0) {
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
          data={orders}
          getRowId={(order, index) =>
            `${order.side}-${order.status ?? "?"}-${index}`
          }
        />
      </div>
    </div>
  );
}
