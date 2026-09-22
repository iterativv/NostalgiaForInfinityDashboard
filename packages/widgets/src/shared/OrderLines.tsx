// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Expandable sub-order rows shared by the Open/Closed Positions widgets.
 *
 * Layout per position: an optional section header, a hidden-count row, then
 * the last N sub-orders. Which order parts render is driven by the
 * `OrderVisibility` schema — callers pass their decoded widget config, which
 * structurally satisfies it.
 */

import { Schema } from "effect"
import type { TradeOrder } from "@nfi/api-contract"
import { orderDate } from "./format"

export const OrderVisibilitySchema = Schema.Struct({
  showOrderSide: Schema.Boolean,
  showOrderPrice: Schema.Boolean,
  showOrderAmount: Schema.Boolean,
  showOrderCost: Schema.Boolean,
  showOrderTag: Schema.Boolean,
  showOrderDate: Schema.Boolean,
})
export type OrderVisibility = typeof OrderVisibilitySchema.Type

export function OrderLines({
  orders,
  total,
  maxVisible,
  showHiddenCountRow,
  showOrderHeaderRow,
  show,
}: {
  orders: ReadonlyArray<TradeOrder>
  total: number
  maxVisible: number
  showHiddenCountRow: boolean
  showOrderHeaderRow: boolean
  show: OrderVisibility
}) {
  const visible = maxVisible <= 0 ? [] : orders.slice(-maxVisible)
  const hidden = Math.max(0, total - visible.length)
  return (
    <>
      {showOrderHeaderRow ? (
        <div style={{ fontSize: "0.75rem", fontWeight: 600, opacity: 0.8, marginBottom: "0.25rem" }}>
          Sub-orders ({total})
        </div>
      ) : null}
      {showHiddenCountRow && total > 0 ? (
        <div style={{ fontSize: "0.75rem", opacity: 0.65, marginBottom: "0.25rem" }}>
          {hidden > 0 ? `+${hidden} more hidden — showing last ${visible.length}` : `All ${total} shown`}
        </div>
      ) : null}
      {visible.length === 0 && total > 0 && showHiddenCountRow ? (
        <div style={{ fontSize: "0.75rem", opacity: 0.55 }}>Sub-orders hidden (maxVisibleOrders = 0).</div>
      ) : null}
      {total === 0 ? <div style={{ fontSize: "0.75rem", opacity: 0.55 }}>No sub-orders.</div> : null}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.125rem" }}>
        {visible.map((o, i) => (
          <div key={i} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.75rem", opacity: 0.9 }}>
            {show.showOrderSide ? <span style={{ fontWeight: 600 }}>{o.side.toUpperCase() || "?"}</span> : null}
            {show.showOrderPrice && o.price !== undefined ? <span> @ {o.price}</span> : null}
            {show.showOrderAmount && o.amount !== undefined ? <span> × {o.amount}</span> : null}
            {show.showOrderCost && o.cost !== undefined ? <span> = {o.cost.toFixed(2)}</span> : null}
            {show.showOrderTag && o.tag ? <span style={{ opacity: 0.7 }}> [{o.tag.trim() || o.tag}]</span> : null}
            {show.showOrderDate ? <span style={{ opacity: 0.6 }}> · {orderDate(o.timestamp)}</span> : null}
          </div>
        ))}
      </div>
    </>
  )
}
