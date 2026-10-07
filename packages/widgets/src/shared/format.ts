// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { isConfigNumber } from "./config";
import { formatDateTime } from "./timeFormat";
import { parseTradeTime } from "./tradeSort";

/** Plain formatting helpers shared by widgets (not components, not schemas). */

export const clampInt = (
  value: string | number,
  fallback: number,
  min: number,
  max: number,
): number => {
  // Raw settings input: config values arrive decoded as numbers, Carbon
  // NumberInput hands its text back as strings — decode at this boundary.
  const n = isConfigNumber(value)
    ? Math.floor(value)
    : Number.parseInt(String(value), 10);

  if (!Number.isFinite(n)) return fallback;

  return Math.min(max, Math.max(min, n));
};

export const fmt = (
  value: number | undefined,
  digits: number,
  fallback = "—",
): string =>
  value === undefined || !Number.isFinite(value)
    ? fallback
    : value.toFixed(digits);

/** Timestamp in the globally configured time format (Settings → Appearance). */
export const fmtDate = (value: string | undefined): string => {
  if (!value) return "—";
  // `parseTradeTime` yields 0 exactly for unparseable input — show the raw
  // string then instead of formatting the epoch.

  if (parseTradeTime(value) === 0) return value;

  return formatDateTime(value);
};

/**
 * Close-date to epoch ms, naive-UTC strings pinned to UTC (see
 * `parseTradeTime`) so chart x-positions never shift by the machine's
 * UTC offset.
 */
export const parseCloseDate = (value: string | undefined): number | null => {
  if (!value) return null;
  const t = parseTradeTime(value);

  return t === 0 ? null : t;
};

/** Order timestamp (ms) in the globally configured time format. */
export const orderDate = (timestamp: number | undefined): string => {
  if (timestamp === undefined) return "—";
  const d = new Date(timestamp);

  if (Number.isNaN(d.getTime())) return "—";

  return formatDateTime(d);
};

export const hostOf = (baseUrl: string): string => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
};

/** Profit/loss tone for color-coded PnL display (green vs red). */
export type PnlTone = "positive" | "negative" | "neutral";

export const pnlTone = (value: number | undefined | null): PnlTone => {
  if (value === undefined || value === null || !Number.isFinite(value))
    return "neutral";

  if (value > 0) return "positive";

  if (value < 0) return "negative";

  return "neutral";
};

/** CSS class for a PnL value (`nfi-pnl-positive` / `nfi-pnl-negative` / neutral). */
export const pnlClass = (value: number | undefined | null): string =>
  `nfi-pnl-${pnlTone(value)}`;

/** Signed fixed-point string (`+1.23`, `-0.45`, `0.00`) for PnL values. */
import { fmtDuration, fmtSigned } from "@nfi/export-core";

export { fmtDuration, fmtSigned };

/**
 * Age of a trade date as a compact duration from now. Naive-UTC strings
 * pin to UTC (see `parseTradeTime`) — the difference against `Date.now()`
 * is only correct when both sides share a zone.
 */
export const fmtAge = (iso: string | undefined): string => {
  if (!iso) return "—";
  const t = parseTradeTime(iso);

  if (t === 0) return "—";

  return fmtDuration((Date.now() - t) / 1000);
};

/** Compact volume/amount (`1.2M`, `384.0K`, `912`). */
export const fmtCompact = (value: number | undefined | null): string => {
  if (value === undefined || value === null || !Number.isFinite(value))
    return "—";
  const abs = Math.abs(value);

  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;

  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;

  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;

  return value.toFixed(abs >= 1 ? 0 : 4);
};
