// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Formatting helpers used inside export column values.
 *
 * Exports carry the same human-rendered duration/percent strings the
 * tables show (the widgets' `fmtDuration`/`fmtSigned`, moved here so the
 * server's `/api/export` serializes identical values); every other export
 * cell stays raw (ISO dates, full-precision numbers).
 */

/** Signed fixed-point string (`+1.23`, `-0.45`, `0.00`) for PnL values. */
export const fmtSigned = (
  value: number | undefined,
  digits: number,
  fallback = "—",
): string => {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const fixed = value.toFixed(digits);

  return value > 0 ? `+${fixed}` : fixed;
};

/** Compact age/duration (`2d 4h`, `38m`, `45s`) from seconds. */
export const fmtDuration = (seconds: number | undefined | null): string => {
  if (
    seconds === undefined ||
    seconds === null ||
    !Number.isFinite(seconds) ||
    seconds < 0
  )
    return "—";
  const s = Math.floor(seconds);

  if (s < 60) return `${s}s`;
  const minutes = Math.floor(s / 60);

  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;

  if (hours < 24)
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;

  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
};
