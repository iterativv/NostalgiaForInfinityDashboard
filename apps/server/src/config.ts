// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Config } from "effect"

/**
 * Server runtime config. Freqtrade credentials/URL stay in this process —
 * they are never serialized to the frontend (see routes: the config
 * endpoint only exposes a masked host).
 */
export interface ServerConfig {
  readonly port: number
  readonly corsOrigins: ReadonlyArray<string>
  readonly freqtradeBaseUrl: string
  readonly snapshotIntervalMs: number
}

export const loadServerConfig = Config.all({
  port: Config.integer("PORT").pipe(Config.withDefault(4000)),
  corsOrigins: Config.string("CORS_ORIGINS").pipe(
    Config.withDefault("http://localhost:3000"),
    Config.map((raw) => raw.split(",").map((s) => s.trim()).filter(Boolean)),
  ),
  freqtradeBaseUrl: Config.string("FREQTRADE_URL").pipe(Config.withDefault("http://127.0.0.1:8080")),
  snapshotIntervalMs: Config.integer("SNAPSHOT_INTERVAL_MS").pipe(Config.withDefault(60_000)),
})

/** Host-only form of the freqtrade URL — safe to send to browsers. */
export const maskFreqtradeHost = (baseUrl: string): string => {
  try {
    return new URL(baseUrl).host
  } catch {
    return "unconfigured"
  }
}

/**
 * Sync env reader for layer construction (e.g. CORS middleware), mirroring
 * the `CORS_ORIGINS` default in `loadServerConfig`.
 */
export const readCorsOrigins = (): ReadonlyArray<string> => {
  const raw = process.env["CORS_ORIGINS"] ?? "http://localhost:3000"
  const origins = raw.split(",").map((s) => s.trim()).filter(Boolean)
  return origins.length > 0 ? origins : ["http://localhost:3000"]
}

/**
 * Whether the implicit `default` freqtrade instance has real credentials in
 * env (`FREQTRADE_PASSWORD` non-empty — the username defaults to
 * `freqtrader`). Surfaced (masked, boolean only) so shells can tell a
 * never-connected deployment apart from one configured via env.
 */
export const readDefaultInstanceConfigured = (): boolean =>
  (process.env["FREQTRADE_PASSWORD"] ?? "").length > 0

/**
 * Whether `FREQTRADE_URL` was explicitly set (vs the built-in localhost
 * fallback). Together with `readDefaultInstanceConfigured` this decides if
 * the env-backed `default` instance is a real connection or an empty slot
 * that should follow the first stored instance instead.
 */
export const readDefaultInstanceUrlConfigured = (): boolean =>
  (process.env["FREQTRADE_URL"] ?? "").trim().length > 0
