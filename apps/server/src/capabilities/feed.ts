// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Freqtrade feed seam: polling today, websocket tomorrow.
 *
 * Freqtrade exposes these reads over its REST API, which has no stable
 * websocket equivalent — so the backend keeps exactly ONE interval
 * (`LivePollerLive` in `poller.ts`, per-capability `pollMs` cadences) between
 * itself and all freqtrade instances, and pushes every refresh to SSE
 * subscribers. The frontend holds no interval at all.
 *
 * If freqtrade (or a proxy in front of it) ever offers a websocket feed,
 * implement it HERE: subscribe to instance sockets and call
 * `liveHub.publish(key, result)` on message. The hub, the `/api/stream`
 * route and every frontend store keep working unchanged — only this file and
 * the poller wiring change.
 */

export const POLL_TICK_MS = 5_000

/** Sqlite snapshot writes are throttled to this (history depth, not liveness). */
export const SNAPSHOT_THROTTLE_MS = 60_000
