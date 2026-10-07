// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Fixture payloads for the min-size visual harness — one entry per
 * capability name any widget consumes. Shapes mirror the result schemas in
 * `@nfi/api-contract` (field names are what widget code reads; the unary
 * transport owns decoding, so plain objects are enough here).
 *
 * Rows are deliberately varied — SHORT and LONG sides, sub-order lines,
 * long enter tags, all common exit reasons, wins and losses — so the
 * minimum-size render exercises the widest content each widget can show.
 */

import type { JsonValue } from "@nfi/capabilities";

/**
 * Capability name → canned JSON result. Partial by design: the harness
 * covers the capabilities widgets render; the transport throws for the rest.
 */
export interface FixtureBank {
  readonly [capability: string]: JsonValue;
}

const NOW = new Date("2026-09-24T12:00:00Z").getTime();

const iso = (offsetMinutes: number): string =>
  new Date(NOW - offsetMinutes * 60_000).toISOString();

const day = (daysAgo: number): string =>
  new Date(NOW - daysAgo * 86_400_000).toISOString().slice(0, 10);

const PAIRS = [
  "BTC/USDT",
  "ETH/USDT",
  "SOL/USDT",
  "BNB/USDT",
  "XRP/USDT",
  "ADA/USDT",
];

function candles(count: number) {
  const out: Array<Record<string, number>> = [];
  let price = 64000;

  for (let i = count - 1; i >= 0; i--) {
    const drift = Math.sin(i / 6) * 180 + (i % 7 === 0 ? 240 : -120);
    const open = price;
    const close = Math.max(1000, price + drift);
    const high = Math.max(open, close) + 95;
    const low = Math.min(open, close) - 85;
    out.push({
      time: NOW - i * 15 * 60_000,
      open,
      high,
      low,
      close,
      volume: 12 + (i % 5) * 3.4,
    });
    price = close;
  }

  return out;
}

const openPosition = (i: number) => ({
  tradeId: 41 + i,
  pair: PAIRS[i % PAIRS.length],
  isOpen: true,
  isShort: i % 3 === 2,
  exchange: "binance",
  amount: 0.015 + i * 0.002,
  stakeAmount: 240.5 + i * 12,
  maxStakeAmount: 250 + i * 12,
  openRate: 63400 + i * 210,
  currentRate: 63400 + i * 210 + (i % 2 === 0 ? 180 : -140),
  profitAbs: i % 2 === 0 ? 4.21 + i : -(2.6 + i * 0.7),
  profitPct: i % 2 === 0 ? 1.68 - i * 0.2 : -(0.92 + i * 0.13),
  profitFiat: i % 2 === 0 ? 5.12 : -3.1,
  openDate: iso(600 + i * 260),
  strategy: "SampleStrategy",
  timeframe: "1h",
  enterTag: i === 0 ? "long_term_hold_signal_alpha" : `signal${i + 1}`,
  leverage: i % 3 === 2 ? 3 : 1,
  nrOfEntries: 2,
  nrOfExits: 1,
  hasOpenOrders: i === 0,
  orders:
    i === 0
      ? // DCA ladder: eight timestamped entries (oldest → newest) so the
        // expansion exercises the latest-first ordering and the
        // "Load older sub-orders" reveal.
        Array.from({ length: 8 }, (_, k) => ({
          orderId: `ord-${k + 1}`,
          side: k === 7 ? "sell" : "buy",
          type: k % 3 === 0 ? "limit" : "market",
          status: k === 6 ? "open" : "closed",
          amount: 0.002 + k * 0.0015,
          price: 64100 - k * 140,
          cost: 128 + k * 9,
          filled: k === 6 ? 0 : 0.002 + k * 0.0015,
          remaining: k === 6 ? 0.002 + k * 0.0015 : 0,
          isOpen: k >= 6,
          isEntry: k < 7,
          tag: k % 2 === 0 ? "signal1" : undefined,
          timestamp: NOW - (900 + k * 40) * 60_000,
          filledTimestamp: NOW - (890 + k * 40) * 60_000,
        }))
      : undefined,
});

const closedPosition = (i: number) => ({
  tradeId: 30 - i,
  pair: PAIRS[i % PAIRS.length],
  isOpen: false,
  isShort: i % 4 === 3,
  exchange: "binance",
  amount: 0.012 + i * 0.001,
  stakeAmount: 220 + i * 10,
  openRate: 61800 + i * 190,
  closeRate: 61800 + i * 190 + (i % 2 === 0 ? 320 : -260),
  profitAbs: i % 2 === 0 ? 6.4 + i * 0.4 : -(3.1 + i * 0.5),
  profitPct: i % 2 === 0 ? 2.4 + i * 0.2 : -(1.3 + i * 0.2),
  closeProfitAbs: i % 2 === 0 ? 6.4 + i * 0.4 : -(3.1 + i * 0.5),
  closeProfitPct: i % 2 === 0 ? 2.4 + i * 0.2 : -(1.3 + i * 0.2),
  openDate: iso(4000 + i * 900),
  closeDate: iso(2600 + i * 760),
  tradeDurationSeconds: 3600 * (4 + i * 3),
  strategy: "SampleStrategy",
  timeframe: "1h",
  enterTag: i === 1 ? "long_term_hold_signal_alpha" : `signal${(i % 4) + 1}`,
  exitReason: ["roi", "stop_loss", "trailing_stop_loss", "exit_signal"][i % 4],
  leverage: 1,
  // Entry + exit sub-orders (oldest → newest) so the collapsed-by-default
  // expansion still exercises the reveal path in the harness.
  orders:
    i % 2 === 0
      ? [
          {
            orderId: `cl-ord-in-${i}`,
            side: "buy",
            type: "limit",
            status: "closed",
            amount: 0.012 + i * 0.001,
            price: 61800 + i * 190,
            cost: 220 + i * 10,
            filled: 0.012 + i * 0.001,
            remaining: 0,
            isOpen: false,
            isEntry: true,
            tag: `signal${(i % 4) + 1}`,
            timestamp: NOW - (4000 + i * 900) * 60_000,
          },
          {
            orderId: `cl-ord-out-${i}`,
            side: "sell",
            type: "market",
            status: "closed",
            amount: 0.012 + i * 0.001,
            price: 61800 + i * 190 + 320,
            cost: 224 + i * 10,
            filled: 0.012 + i * 0.001,
            remaining: 0,
            isOpen: false,
            isEntry: false,
            timestamp: NOW - (2600 + i * 760) * 60_000,
          },
        ]
      : undefined,
});

const inst = (id: string, name: string) => ({
  id,
  name,
  baseUrl: `http://${name.toLowerCase()}.internal:8080`,
  username: "freqtrader",
  hasPassword: true,
  createdAt: iso(90000),
  updatedAt: iso(60),
});

const summary = (id: string, name: string, reachable = true) => ({
  id,
  name,
  reachable,
  version: reachable ? "2025.6" : undefined,
  state: reachable ? "running" : undefined,
  strategy: "SampleStrategy",
  strategyVersion: reachable ? "v18.0.119" : undefined,
  dryRun: true,
  openCount: reachable ? 2 : undefined,
  maxOpenTrades: 5,
  profitClosedCoin: reachable ? 128.4 : undefined,
  profitAllCoin: reachable ? 154.9 : undefined,
  profitClosedPercent: 12.8,
  profitAllPercent: 15.5,
  closedTradeCount: 96,
  tradeCount: 5,
  openProfitCoin: reachable ? 6.2 : undefined,
  wins: 61,
  losses: 35,
});

const profit = {
  profitClosedCoin: 128.4,
  profitClosedPercent: 12.84,
  profitClosedFiat: 131.9,
  profitAllCoin: 154.9,
  profitAllPercent: 15.49,
  profitAllFiat: 159.2,
  tradeCount: 5,
  closedTradeCount: 96,
  winningTrades: 61,
  losingTrades: 35,
  stakeCurrency: "USDT",
  fiatCurrency: "USD",
};

const balance = {
  stakeCurrency: "USDT",
  totalStake: 1240.55,
  startingCapital: 1000,
  currencies: [
    { currency: "USDT", free: 880.2, used: 120.35, total: 1000.55 },
    { currency: "BTC", free: 0.0042, used: 0.0011, total: 0.0053 },
    { currency: "ETH", free: 0.08, used: 0.02, total: 0.1 },
  ],
  note: "Mutual funds",
};

export const FIXTURES = {
  "instances.list": {
    instances: [inst("default", "Alpha"), inst("beta", "Beta")],
  },
  "bot.status": {
    state: "running",
    strategy: "SampleStrategy",
    strategyVersion: "v18.0.119",
    exchange: "binance",
    stakeCurrency: "USDT",
    dryRun: true,
    tradingMode: "futures",
  },
  "instances.status": {
    state: "running",
    strategy: "SampleStrategy",
    strategyVersion: "v18.0.119",
    exchange: "binance",
    stakeCurrency: "USDT",
    dryRun: true,
    tradingMode: "futures",
  },
  "instances.health": {
    id: "default",
    reachable: true,
    version: "2025.6",
    state: "running",
    botName: "Alpha",
  },
  "bot.profit": profit,
  "instances.profit": profit,
  "instances.profit.relative": {
    profitClosedPercent: 12.84,
    profitAllPercent: 15.49,
    tradeCount: 5,
    closedTradeCount: 96,
    stakeCurrency: "USDT",
    fiatCurrency: "USD",
  },
  "bot.balance": balance,
  "instances.balance": balance,
  "instances.balance.relative": {
    stakeCurrency: "USDT",
    currencies: [
      { currency: "USDT", weight: 0.82, freeWeight: 0.71, usedWeight: 0.11 },
      { currency: "BTC", weight: 0.12, freeWeight: 0.09, usedWeight: 0.03 },
      { currency: "ETH", weight: 0.06, freeWeight: 0.04, usedWeight: 0.02 },
    ],
  },
  "instances.overview": {
    instances: [summary("default", "Alpha"), summary("beta", "Beta", false)],
    totals: {
      instanceCount: 2,
      reachableCount: 1,
      openCount: 2,
      profitClosedCoin: 128.4,
      profitAllCoin: 154.9,
      openProfitCoin: 6.2,
      wins: 61,
      losses: 35,
      totalStake: 1240.55,
      stakeCurrency: "USDT",
    },
  },
  "instances.open-positions": {
    positions: [0, 1, 2, 3].map((i) => openPosition(i)),
  },
  "instances.open-positions.relative": {
    positions: [0, 1, 2, 3].map((i) => {
      const p = openPosition(i);

      return {
        tradeId: p.tradeId,
        pair: p.pair,
        isOpen: true,
        isShort: p.isShort,
        profitPct: p.profitPct,
        allocationWeight: 0.25 - i * 0.04,
        openDate: p.openDate,
        strategy: p.strategy,
        timeframe: p.timeframe,
        enterTag: p.enterTag,
        leverage: p.leverage,
        orders: p.orders?.map((o) => ({
          side: o.side,
          status: o.status,
          isEntry: o.isEntry,
          tag: o.tag,
        })),
      };
    }),
    stats: {
      deployedWeight: 0.84,
      avgProfitPct: 0.62,
      largestWeight: 0.25,
    },
  },
  "instances.positions-all": {
    positions: [0, 1, 2, 3].map((i) => ({
      ...openPosition(i),
      instanceId: i % 2 === 0 ? "default" : "beta",
      instanceName: i % 2 === 0 ? "Alpha" : "Beta",
    })),
  },
  "instances.closed-positions": {
    positions: [0, 1, 2, 3, 4, 5].map((i) => closedPosition(i)),
    tradesCount: 6,
    totalTrades: 96,
    offset: 0,
  },
  "instances.closed-all": {
    positions: [0, 1, 2, 3, 4, 5].map((i) => ({
      ...closedPosition(i),
      instanceId: i % 2 === 0 ? "default" : "beta",
      instanceName: i % 2 === 0 ? "Alpha" : "Beta",
    })),
    tradesCount: 6,
    totalTrades: 96,
    offset: 0,
  },
  "instances.closed-positions.relative": {
    positions: [0, 1, 2, 3, 4, 5].map((i) => {
      const p = closedPosition(i);

      return {
        tradeId: p.tradeId,
        pair: p.pair,
        isOpen: false,
        isShort: p.isShort,
        profitPct: p.profitPct,
        closeProfitPct: p.closeProfitPct,
        openDate: p.openDate,
        closeDate: p.closeDate,
        tradeDurationSeconds: p.tradeDurationSeconds,
        strategy: p.strategy,
        timeframe: p.timeframe,
        enterTag: p.enterTag,
        exitReason: p.exitReason,
        leverage: p.leverage,
        orders: p.orders?.map((o) => ({
          side: o.side,
          status: o.status,
          isEntry: o.isEntry,
          tag: o.tag,
        })),
      };
    }),
    tradesCount: 6,
    totalTrades: 96,
    offset: 0,
    stats: {
      withPnl: 96,
      wins: 61,
      winRatePct: 63.5,
      avgProfitPct: 1.58,
      bestPct: 9.4,
      worstPct: -5.2,
    },
  },
  "instances.trade-count": { current: 2, max: 5 },
  "instances.pairs": {
    pairs: PAIRS,
    length: PAIRS.length,
    stakeCurrency: "USDT",
  },
  "instances.whitelist": { pairs: PAIRS, length: PAIRS.length },
  "instances.blacklist": {
    pairs: [
      { pair: "LUNA/USDT", reason: "delisted on binance" },
      { pair: "FTT/USDT", reason: "manual blacklist — high risk" },
    ],
    length: 2,
  },
  "instances.locks": {
    locks: [
      {
        id: 1,
        pair: "SOL/USDT",
        lockTime: iso(300),
        lockEndTime: iso(-120),
        reason: "stoploss guard triggered 4 times",
        active: true,
        side: "*",
      },
      {
        id: 2,
        pair: "XRP/USDT",
        lockTime: iso(1200),
        lockEndTime: iso(-60),
        reason: "manual lock pending news",
        active: true,
        side: "long",
      },
    ],
  },
  "instances.candles": {
    pair: "BTC/USDT",
    timeframe: "15m",
    candles: candles(160),
  },
  "instances.plot-config": {
    mainPlot: ["sma_fast", "sma_slow", "buy_tag"],
    subplots: { RSI: ["rsi"], MACD: ["macd", "macdsignal"] },
  },
  "instances.profit-daily": {
    bucket: "daily",
    buckets: Array.from({ length: 30 }, (_, i) => ({
      date: day(29 - i),
      profitAbs: Math.sin(i / 4) * 9 + (i % 2 === 0 ? 6 : -3),
      profitRel: Math.sin(i / 4) * 0.009 + (i % 2 === 0 ? 0.006 : -0.003),
      profitFiat: Math.sin(i / 4) * 9.4 + (i % 2 === 0 ? 6.2 : -3.1),
      trades: 1 + (i % 4),
    })),
  },
  "instances.profit-daily-all": {
    bucket: "daily",
    buckets: Array.from({ length: 30 }, (_, i) => ({
      date: day(29 - i),
      profitAbs: Math.sin(i / 4) * 14 + (i % 2 === 0 ? 9 : -5),
      profitRel: Math.sin(i / 4) * 0.011 + (i % 2 === 0 ? 0.007 : -0.004),
      profitFiat: Math.sin(i / 4) * 14.2 + (i % 2 === 0 ? 9.1 : -5.2),
      trades: 2 + (i % 5),
    })),
  },
  "instances.profit-history": {
    points: Array.from({ length: 48 }, (_, i) => ({
      recordedAt: iso((47 - i) * 60),
      profitClosedCoin: 40 + i * 1.9 + Math.sin(i / 5) * 6,
      profitAllCoin: 52 + i * 2.1 + Math.sin(i / 5) * 7,
      tradeCount: 40 + i,
      stakeCurrency: "USDT",
    })),
  },
  "bot.profit-history.relative": {
    points: Array.from({ length: 48 }, (_, i) => ({
      recordedAt: iso((47 - i) * 60),
      profitClosedIndex: 100 + i * 0.9 + Math.sin(i / 5) * 1.4,
      profitAllIndex: 100 + i * 1.1 + Math.sin(i / 5) * 1.7,
    })),
  },
  "instances.profit-history-all.relative": {
    instances: [
      {
        instanceId: "default",
        instanceName: "Alpha",
        points: Array.from({ length: 48 }, (_, i) => ({
          recordedAt: iso((47 - i) * 60),
          profitClosedIndex: 100 + i * 0.9 + Math.sin(i / 5) * 1.4,
          profitAllIndex: 100 + i * 1.1 + Math.sin(i / 5) * 1.7,
        })),
      },
      {
        instanceId: "beta",
        instanceName: "Beta",
        points: Array.from({ length: 48 }, (_, i) => ({
          recordedAt: iso((47 - i) * 60),
          profitClosedIndex: 100 + i * 0.4 + Math.cos(i / 6) * 1.1,
          profitAllIndex: 100 + i * 0.6 + Math.cos(i / 6) * 1.3,
        })),
      },
    ],
  },
  "instances.balance-history": {
    instances: [
      {
        instanceId: "default",
        instanceName: "Alpha",
        points: Array.from({ length: 40 }, (_, i) => ({
          recordedAt: iso((39 - i) * 90),
          totalStake: 1000 + i * 6.2 + Math.sin(i / 4) * 18,
          stakeCurrency: "USDT",
        })),
        startingCapital: 1000,
        stakeCurrency: "USDT",
      },
      {
        instanceId: "beta",
        instanceName: "Beta",
        points: Array.from({ length: 40 }, (_, i) => ({
          recordedAt: iso((39 - i) * 90),
          totalStake: 800 + i * 4.1 + Math.sin(i / 5) * 12,
          stakeCurrency: "USDT",
        })),
        startingCapital: 800,
        stakeCurrency: "USDT",
      },
    ],
    stakeCurrency: "USDT",
  },
  "instances.tag-performance": {
    groupBy: "enter",
    rows: [
      {
        tag: "signal1",
        trades: 34,
        wins: 24,
        losses: 10,
        winrate: 0.7059,
        profitAbs: 88.2,
        profitPctAvg: 2.61,
      },
      {
        tag: "signal2",
        trades: 28,
        wins: 15,
        losses: 13,
        winrate: 0.5357,
        profitAbs: 31.5,
        profitPctAvg: 1.12,
      },
      {
        tag: "long_term_hold_signal_alpha",
        trades: 19,
        wins: 14,
        losses: 5,
        winrate: 0.7368,
        profitAbs: 64.9,
        profitPctAvg: 3.4,
      },
      {
        tag: "signal4",
        trades: 15,
        wins: 8,
        losses: 7,
        winrate: 0.5333,
        profitAbs: -12.3,
        profitPctAvg: -0.81,
      },
    ],
    aggregatedTrades: 96,
    totalTrades: 96,
    totals: {
      trades: 96,
      wins: 61,
      losses: 35,
      winrate: 0.6354,
      profitAbs: 172.3,
      profitPctAvg: 1.58,
    },
    best: { tag: "signal1", value: 88.2 },
    worst: { tag: "signal4", value: -12.3 },
  },
  "instances.performance-stats": {
    trades: 96,
    wins: 61,
    losses: 35,
    grossWin: 220.4,
    grossLoss: 48.1,
    net: 172.3,
    winrate: 63.5,
    profitFactor: 4.58,
    expectancy: 1.79,
    avgWin: 3.61,
    avgLoss: 1.37,
    best: 12.4,
    worst: -4.8,
  },
  "instances.drawdown": {
    points: Array.from({ length: 60 }, (_, i) => ({
      recordedAt: iso(600 - i * 10),
      drawdown: Number(
        (-Math.abs(Math.sin(i / 7)) * 12 - (i % 11 === 0 ? 6 : 0)).toFixed(2),
      ),
    })),
    maxDrawdown: -21.4,
    currentDrawdown: -3.2,
    peakValue: 812.6,
  },
  "instances.cumulative-profit": {
    series: [
      {
        points: Array.from({ length: 40 }, (_, i) => ({
          at: iso(1200 - i * 25),
          profit: Number(((i % 5) - 2 + 0.4).toFixed(2)),
          cumulative: Number((3.1 * (40 - i)).toFixed(2)),
        })),
        totalProfit: 124.5,
        trades: 96,
      },
    ],
  },
  "instances.traded-pairs": {
    pairs: PAIRS.map((pair, i) => ({
      pair,
      trades: 24 - i * 3,
      openTrades: i === 0 ? 1 : 0,
      closedTrades: 23 - i * 3,
      lastAt: iso(90 + i * 140),
    })),
    length: PAIRS.length,
  },
  "instances.exposure": {
    summary: {
      positions: 6,
      deployed: 1452.3,
      unrealized: 18.4,
      maxLeverage: 3,
      longs: 4,
      shorts: 2,
      largestStake: 402.7,
      pairs: 6,
      avgProfitPct: 1.02,
    },
    rows: PAIRS.map((pair, i) => ({
      pair,
      positions: 1,
      stake: Number((402.7 - i * 51.2).toFixed(2)),
      unrealized: Number((8.4 - i * 2.9).toFixed(2)),
      share: Number(((402.7 - i * 51.2) / 1452.3).toFixed(4)),
    })),
  },
  "instances.tag-performance.relative": {
    groupBy: "enter",
    rows: [
      {
        tag: "signal1",
        trades: 34,
        wins: 24,
        losses: 10,
        winrate: 0.7059,
        profitPctAvg: 2.61,
      },
      {
        tag: "signal2",
        trades: 28,
        wins: 15,
        losses: 13,
        winrate: 0.5357,
        profitPctAvg: 1.12,
      },
      {
        tag: "long_term_hold_signal_alpha",
        trades: 19,
        wins: 14,
        losses: 5,
        winrate: 0.7368,
        profitPctAvg: 3.4,
      },
      {
        tag: "signal4",
        trades: 15,
        wins: 8,
        losses: 7,
        winrate: 0.5333,
        profitPctAvg: -0.81,
      },
    ],
    aggregatedTrades: 96,
    totalTrades: 96,
    stats: {
      trades: 96,
      wins: 61,
      losses: 35,
      winrate: 0.6354,
      profitPctAvg: 1.58,
      bestEdge: { tag: "long_term_hold_signal_alpha", value: 3.4 },
    },
  },
  "instances.config": {
    strategy: "SampleStrategy",
    exchange: "binance",
    stakeCurrency: "USDT",
    stakeAmount: 240.5,
    maxOpenTrades: 5,
    dryRun: true,
    tradingMode: "futures",
    timeframe: "5m",
  },
  "macro.fed-rate": {
    targetLower: 4.0,
    targetUpper: 4.25,
    effective: 4.08,
    effectiveDate: day(3),
    sofr: 4.05,
    obfr: 4.07,
    volumeBillions: 96.2,
    history: Array.from({ length: 90 }, (_, i) => ({
      date: day(89 - i),
      effective: i < 40 ? 5.33 : i < 70 ? 4.58 : 4.08,
      targetLower: i < 40 ? 5.25 : i < 70 ? 4.5 : 4.0,
      targetUpper: i < 40 ? 5.5 : i < 70 ? 4.75 : 4.25,
      sofr: (i < 40 ? 5.35 : i < 70 ? 4.6 : 4.05) + Math.sin(i / 7) * 0.03,
    })),
    sources: [
      {
        name: "NY Fed Markets API",
        href: "https://markets.newyorkfed.org",
        ok: true,
      },
      { name: "FRED", href: "https://fred.stlouisfed.org", ok: true },
    ],
    updatedAt: iso(30),
  },
  "system.health": {
    status: "ok",
    freqtrade: "reachable",
    timestamp: iso(1),
  },
  "system.backend-config": {
    freqtradeHost: "alpha.internal:8080",
    freqtradeConfigured: true,
    defaultInstanceConfigured: true,
  },
} satisfies Readonly<Record<string, JsonValue>>;

/** String-indexable view of the fixture bank for the generic transport. */
const FIXTURES_BY_NAME: FixtureBank = FIXTURES;

/** Unary transport standing in for the app: any capability, any options. */
export async function fixtureTransport(name: string): Promise<JsonValue> {
  const fixture = FIXTURES_BY_NAME[name];

  if (fixture === undefined) {
    throw new Error(`visual-harness: no fixture for capability "${name}"`);
  }

  return fixture;
}
