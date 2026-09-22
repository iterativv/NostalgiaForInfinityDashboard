// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/** Plain formatting helpers shared by widgets (not components, not schemas). */

export const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === "number" ? Math.floor(value) : Number.parseInt(String(value ?? ""), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

export const fmt = (value: number | undefined, digits: number, fallback = "—"): string =>
  value === undefined || !Number.isFinite(value) ? fallback : value.toFixed(digits)

export const fmtDate = (value: string | undefined): string => {
  if (!value) return "—"
  const d = new Date(value.replace(" ", "T"))
  if (Number.isNaN(d.getTime())) return value
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`
}

export const parseCloseDate = (value: string | undefined): number | null => {
  if (!value) return null
  const t = new Date(value.replace(" ", "T")).getTime()
  return Number.isNaN(t) ? null : t
}

export const orderDate = (timestamp: number | undefined): string => {
  if (timestamp === undefined) return "—"
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return "—"
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`
}

export const hostOf = (baseUrl: string): string => {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

/** Profit/loss tone for color-coded PnL display (green vs red). */
export type PnlTone = "positive" | "negative" | "neutral"

export const pnlTone = (value: number | undefined | null): PnlTone => {
  if (value === undefined || value === null || !Number.isFinite(value)) return "neutral"
  if (value > 0) return "positive"
  if (value < 0) return "negative"
  return "neutral"
}

/** CSS class for a PnL value (`nfi-pnl-positive` / `nfi-pnl-negative` / neutral). */
export const pnlClass = (value: number | undefined | null): string =>
  `nfi-pnl-${pnlTone(value)}`

/** Signed fixed-point string (`+1.23`, `-0.45`, `0.00`) for PnL values. */
export const fmtSigned = (value: number | undefined, digits: number, fallback = "—"): string => {
  if (value === undefined || !Number.isFinite(value)) return fallback
  const fixed = value.toFixed(digits)
  return value > 0 ? `+${fixed}` : fixed
}

/** Compact age/duration (`2d 4h`, `38m`, `45s`) from seconds. */
export const fmtDuration = (seconds: number | undefined | null): string => {
  if (seconds === undefined || seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—"
  const s = Math.floor(seconds)
  if (s < 60) return `${s}s`
  const minutes = Math.floor(s / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remMinutes = minutes % 60
  if (hours < 24) return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`
}

/** Age of a date string (space or ISO separated), as compact duration from now. */
export const fmtAge = (iso: string | undefined): string => {
  if (!iso) return "—"
  const t = new Date(iso.includes("T") ? iso : iso.replace(" ", "T")).getTime()
  if (Number.isNaN(t)) return "—"
  return fmtDuration((Date.now() - t) / 1000)
}

/** Compact volume/amount (`1.2M`, `384.0K`, `912`). */
export const fmtCompact = (value: number | undefined | null): string => {
  if (value === undefined || value === null || !Number.isFinite(value)) return "—"
  const abs = Math.abs(value)
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`
  return value.toFixed(abs >= 1 ? 0 : 4)
}
