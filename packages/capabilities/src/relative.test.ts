// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest"
import type {
  BalanceHistoryResponse,
  BalanceResponse,
  ClosedPositionsResponse,
  OpenPositionsResponse,
  OpenTradesResponse,
  ProfitHistoryResponse,
  ProfitSummary,
  TagPerformanceResponse,
} from "@nfi/api-contract"
import {
  RELATIVE_BANNED_KEYS,
  collectKeys,
  rebaseToIndex,
  toRelativeBalance,
  toRelativeBalanceHistory,
  toRelativeClosedPositions,
  toRelativeOpenPositions,
  toRelativeProfit,
  toRelativeProfitHistory,
  toRelativeTagPerformance,
  toRelativeTrades,
} from "./relative.js"

const balance: BalanceResponse = {
  stakeCurrency: "USDT",
  totalStake: 10_000,
  currencies: [
    { currency: "USDT", free: 6000, used: 1000, total: 7000 },
    { currency: "BTC", free: 0.05, used: 0, total: 3000 },
  ],
}

const profit: ProfitSummary = {
  profitClosedCoin: 1234.5,
  profitClosedPercent: 12.3,
  profitClosedFiat: 1230,
  profitAllCoin: 1500,
  profitAllPercent: 15,
  profitAllFiat: 1490,
  tradeCount: 42,
  closedTradeCount: 40,
  winningTrades: 30,
  losingTrades: 10,
  stakeCurrency: "USDT",
  fiatCurrency: "USD",
}

const profitHistory: ProfitHistoryResponse = {
  points: [
    { recordedAt: "2026-01-01T00:00:00.000Z", profitClosedCoin: 100, profitAllCoin: 120, tradeCount: 2, stakeCurrency: "USDT" },
    { recordedAt: "2026-01-02T00:00:00.000Z", profitClosedCoin: 150, profitAllCoin: 180, tradeCount: 3, stakeCurrency: "USDT" },
    { recordedAt: "2026-01-03T00:00:00.000Z", profitClosedCoin: 50, profitAllCoin: 90, tradeCount: 4, stakeCurrency: "USDT" },
  ],
}

const balanceHistory: BalanceHistoryResponse = {
  points: [
    { recordedAt: "2026-01-01T00:00:00.000Z", totalStake: 9000, stakeCurrency: "USDT" },
    { recordedAt: "2026-01-02T00:00:00.000Z", totalStake: 9900, stakeCurrency: "USDT" },
  ],
}

const openPositions: OpenPositionsResponse = {
  positions: [
    {
      tradeId: 7,
      pair: "BTC/USDT",
      isOpen: true,
      isShort: false,
      amount: 0.5,
      stakeAmount: 5000,
      openRate: 60000,
      currentRate: 66000,
      profitAbs: 500,
      profitPct: 10,
      profitFiat: 499,
      openDate: "2026-01-02T00:00:00.000Z",
      enterTag: "nfi-entry",
      leverage: 1,
      orders: [
        { orderId: "o1", side: "buy", price: 60000, amount: 0.5, cost: 30000, isEntry: true, tag: "enter" },
      ],
    },
  ],
}

const closedPositions: ClosedPositionsResponse = {
  positions: [
    {
      tradeId: 6,
      pair: "ETH/USDT",
      isOpen: false,
      amount: 2,
      stakeAmount: 4000,
      openRate: 2000,
      closeRate: 2200,
      profitAbs: 400,
      closeProfitAbs: 400,
      closeProfitPct: 10,
      openDate: "2026-01-01T00:00:00.000Z",
      closeDate: "2026-01-02T00:00:00.000Z",
      tradeDurationSeconds: 86400,
      enterTag: "ema",
      exitReason: "roi",
      orders: [{ orderId: "o0", side: "sell", price: 2200 }],
    },
  ],
  tradesCount: 1,
  totalTrades: 40,
  offset: 0,
}

const tagPerformance: TagPerformanceResponse = {
  groupBy: "enter",
  rows: [{ tag: "ema", trades: 10, wins: 6, losses: 4, winrate: 0.6, profitAbs: 999, profitPctAvg: 1.5 }],
  aggregatedTrades: 10,
  totalTrades: 40,
}

const trades: OpenTradesResponse = {
  trades: [
    {
      tradeId: 7,
      pair: "BTC/USDT",
      isOpen: true,
      amount: 0.5,
      stakeAmount: 5000,
      openRate: 60000,
      currentRate: 66000,
      profitAbs: 500,
      profitPct: 10,
      openDate: "2026-01-02T00:00:00.000Z",
    },
  ],
}

describe("relative transforms (no absolute leak for any options)", () => {
  it("converts balances to weights summing to ~1", () => {
    const relative = toRelativeBalance(balance)
    expect(relative.stakeCurrency).toBe("USDT")
    const sum = relative.currencies.reduce((acc, c) => acc + c.weight, 0)
    expect(sum).toBeCloseTo(1, 10)
    expect(relative.currencies[0]).toMatchObject({ currency: "USDT", weight: 0.7 })
    expect(collectKeys(relative).filter((k) => RELATIVE_BANNED_KEYS.includes(k))).toEqual([])
  })

  it("handles zero totals without NaN", () => {
    const relative = toRelativeBalance({ stakeCurrency: "USDT", totalStake: 0, currencies: [] })
    expect(relative.currencies).toEqual([])
  })

  it("keeps only percentages and counts for profit", () => {
    const relative = toRelativeProfit(profit)
    expect(relative).toEqual({
      profitClosedPercent: 12.3,
      profitAllPercent: 15,
      tradeCount: 42,
      closedTradeCount: 40,
      stakeCurrency: "USDT",
      fiatCurrency: "USD",
    })
    expect(collectKeys(relative).filter((k) => RELATIVE_BANNED_KEYS.includes(k))).toEqual([])
  })

  it("strips stake and absolute profit from trades and positions", () => {
    expect(collectKeys(toRelativeTrades(trades)).filter((k) => RELATIVE_BANNED_KEYS.includes(k))).toEqual([])
    const open = toRelativeOpenPositions(openPositions, balance.totalStake)
    expect(open.positions[0]?.allocationWeight ?? 0).toBeCloseTo(0.5, 10)
    expect(open.positions[0]?.profitPct).toBe(10)
    expect(collectKeys(open).filter((k) => RELATIVE_BANNED_KEYS.includes(k))).toEqual([])
    const closed = toRelativeClosedPositions(closedPositions)
    expect(closed.positions[0]?.closeProfitPct).toBe(10)
    expect(closed.totalTrades).toBe(40)
    expect(collectKeys(closed).filter((k) => RELATIVE_BANNED_KEYS.includes(k))).toEqual([])
  })

  it("rebases histories so the first visible point is exactly 100", () => {
    const profitRelative = toRelativeProfitHistory(profitHistory)
    expect(profitRelative.points[0]).toMatchObject({ profitClosedIndex: 100, profitAllIndex: 100 })
    const balanceRelative = toRelativeBalanceHistory(balanceHistory)
    expect(balanceRelative.points[0]?.balanceIndex).toBe(100)
    // Direction preserved even when the window starts negative.
    const falling = rebaseToIndex([50, 100, 150])
    expect(falling[0]).toBe(100)
    expect(falling[2] ?? 0).toBeGreaterThan(falling[1] ?? 0)
    // Any window rebase hides its baseline: two different limits both start at 100.
    const narrow = toRelativeProfitHistory({ points: profitHistory.points.slice(1) })
    expect(narrow.points[0]?.profitClosedIndex).toBe(100)
    expect(narrow.points[0]?.profitClosedIndex).toBe(profitRelative.points[0]?.profitClosedIndex)
    expect(collectKeys(profitRelative).filter((k) => RELATIVE_BANNED_KEYS.includes(k))).toEqual([])
    expect(collectKeys(balanceRelative).filter((k) => RELATIVE_BANNED_KEYS.includes(k))).toEqual([])
  })

  it("drops absolute profit from tag performance but keeps winrate", () => {
    const relative = toRelativeTagPerformance(tagPerformance)
    expect(relative.rows[0]).toEqual({ tag: "ema", trades: 10, wins: 6, losses: 4, winrate: 0.6, profitPctAvg: 1.5 })
    expect(collectKeys(relative).filter((k) => RELATIVE_BANNED_KEYS.includes(k))).toEqual([])
  })
})
