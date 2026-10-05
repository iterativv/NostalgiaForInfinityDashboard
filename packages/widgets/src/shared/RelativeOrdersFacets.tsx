// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Sub-order table for the percent-only (relative) trade tables.
 *
 * Relative orders deliberately carry no prices, amounts or timestamps
 * (see `@nfi/capabilities` relative transforms) — the shareable expansion
 * is this compact numbered table: side, entry/exit role, signal tag and
 * status per order. Rows flow through the TanStack Table row model
 * (`NfiDataTable`), matching the absolute position tables' expansion
 * pattern (`SubOrdersTable`) without leaking absolute values.
 *
 * Role renders as an entry/exit pill (unknown roles show `—` instead of a
 * placeholder column), and the routine `closed` order status renders as
 * `filled` so it never reads as "the position is closed" inside the
 * open-trades expansion — only non-routine statuses (`open`, `canceled`,
 * …) render as a gray tag.
 */

import { Tag } from "@carbon/react";
import type { RelativeOrder } from "@nfi/api-contract";
import { NfiDataTable, type NfiColumnDef } from "@nfi/ui";
import { COL } from "./columns";

const sideClass = (side: string): string => {
  if (side === "buy") return "nfi-pnl-positive";

  if (side === "sell") return "nfi-pnl-negative";

  return "";
};

/**
 * Non-routine order statuses worth surfacing as a tag. `closed` (filled) is
 * the expected state of a listed order — the table shows it as `filled`
 * (plain text, never a tag) so it never reads as "position closed" inside
 * the open-trades expansion.
 */
export const isNotableStatus = (status: string | undefined): status is string =>
  status !== undefined && status !== "" && status !== "closed";

/** Static column set — module scope keeps the table inputs stable. */
const COLUMNS: NfiColumnDef<RelativeOrder>[] = [
  {
    id: "no",
    header: COL.no,
    cell: ({ row }) => row.index + 1,
    meta: { className: "nfi-mono" },
    enableSorting: false,
  },
  {
    id: "side",
    header: COL.side,
    cell: ({ row }) => (
      <span className={`nfi-mono ${sideClass(row.original.side)}`}>
        {row.original.side.toUpperCase()}
      </span>
    ),
    enableSorting: false,
  },
  {
    id: "role",
    header: COL.role,
    cell: ({ row }) =>
      row.original.isEntry === undefined ? (
        "—"
      ) : (
        <Tag
          type={row.original.isEntry ? "blue" : "cool-gray"}
          size="sm"
          title={
            row.original.isEntry
              ? "Entry order (opens or adds to the position)"
              : "Exit order (takes profit or derisks)"
          }
        >
          {row.original.isEntry ? "entry" : "exit"}
        </Tag>
      ),
    enableSorting: false,
  },
  {
    id: "tag",
    header: COL.orderTag,
    cell: ({ row }) => (
      <span className="nfi-mono nfi-suborder-tag">
        {row.original.tag?.trim() || "—"}
      </span>
    ),
    enableSorting: false,
  },
  {
    id: "status",
    header: COL.status,
    cell: ({ row }) => {
      const status = row.original.status;

      if (status === undefined || status === "") return "—";

      if (status === "closed")
        return (
          <span title="Order filled (closed)">filled</span>
        );

      return (
        <Tag type="gray" size="sm" title="Order status">
          {status}
        </Tag>
      );
    },
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
      <p className="nfi-suborders-caption">
        {orders.length} {orders.length === 1 ? "order" : "orders"}
      </p>
      <div className="nfi-table-scroll">
        <NfiDataTable
          columns={COLUMNS}
          data={orders}
          getRowId={(order, index) =>
            `${order.side}-${order.status ?? "?"}-${index}`
          }
          size="sm"
          className="nfi-suborders-table"
        />
      </div>
    </div>
  );
}
