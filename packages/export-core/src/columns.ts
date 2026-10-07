// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Canonical table column names — shared vocabulary for the tables and the
 * server-side exports.
 *
 * One meaning → one name, everywhere: table headers, CSV/XLSX export
 * headers, settings toggles and order-by items all draw from this map so
 * columns with similar meaning never ship under two different names
 * ("Dir" vs "Direction", "PnL" vs "Profit", "Opened" vs "Open date", …).
 * Add new entries here when a genuinely NEW meaning appears — never inline
 * a fresh header string in a widget or an export column.
 */
export const COL = {
  /** Row number (1 = first row of the current ordering). */
  no: "No.",
  /** Source freqtrade instance (fleet attribution). */
  bot: "Bot",
  pair: "Pair",
  /** LONG / SHORT. */
  direction: "Direction",
  leverage: "Leverage",
  amount: "Amount",
  stake: "Stake",
  openRate: "Open rate",
  currentRate: "Current rate",
  closeRate: "Close rate",
  /** Per-trade absolute profit (signed). */
  profit: "Profit",
  /** Per-trade profit percent (signed). */
  profitPct: "Profit %",
  /** Summed absolute profit (tag / strategy / pair / all-time totals). */
  totalProfit: "Total profit",
  /** Per-bot aggregate of OPEN position profit (fleet views). */
  openProfit: "Open profit",
  /** Per-bot aggregate of CLOSED position profit (fleet views). */
  closedProfit: "Closed profit",
  /** Mean profit percent across aggregated trades. */
  avgPct: "Avg %",
  /** NFI entry signal tag. */
  enterTag: "Enter tag",
  /** Per-order signal tag (entry or exit side). */
  orderTag: "Order tag",
  exitReason: "Exit reason",
  strategy: "Strategy",
  openDate: "Open date",
  closeDate: "Close date",
  /** Holding/position duration (formatted, e.g. `38m`). */
  duration: "Duration",
  /** Current age of an open position (formatted). */
  age: "Age",
  trades: "Trades",
  wins: "Wins",
  losses: "Losses",
  winRate: "Win rate",
  /** Compact wins/losses pair (`24 / 10`). */
  winLoss: "W/L",
  /** Share of wallet deployed, in percent. */
  walletPct: "Wallet %",
  /** Share of aggregated trades, in percent. */
  share: "Share",
  tradeId: "Trade ID",
  version: "Version",
  /** Instance connection health (up/down). */
  connection: "Connection",
  /** Bot run state (e.g. running + dry/live badge). */
  state: "State",
  /** Tracked pair's position state (OPEN / FLAT / UNTRACKED). */
  position: "Position",
  /** Instance base host. */
  host: "Host",
  /** Open-trade count. */
  openTrades: "Open trades",
  /** Pair-lock expiry timestamp. */
  until: "Until",
  /** Pair-lock reason. */
  lockReason: "Lock reason",
  /** Wallet balance. */
  balance: "Balance",
  /** Calendar date/time of an event. */
  date: "Date",
  /** Order fill price. */
  price: "Price",
  /** Order side (BUY / SELL). */
  side: "Side",
  /** Order type (limit / market). */
  orderType: "Type",
  /** Status cell (lock lifecycle, order fill state, …). */
  status: "Status",
  /** Filled amount. */
  filled: "Filled",
  /** Remaining amount. */
  remaining: "Remaining",
  /** Order cost. */
  cost: "Cost",
  /** Exchange order id. */
  orderId: "Order ID",
  /** Entry/exit role. */
  role: "Role",
  /** Tape feed event kind (open / close). */
  event: "Event",
  /** Tape feed detail line. */
  detail: "Detail",
} as const;

export type ColumnName = (typeof COL)[keyof typeof COL];
