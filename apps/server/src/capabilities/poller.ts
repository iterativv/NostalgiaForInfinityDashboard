// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Cause, Duration, Effect, Layer } from "effect"
import { CAPABILITY_REGISTRY, type CapabilityContext, type CapabilityName, DEFAULT_INSTANCE_ID, optional } from "@nfi/capabilities"
import type { FleetInstance } from "@nfi/capabilities"
import { fleetInstances } from "@nfi/capabilities"
import { BackendError } from "@nfi/api-contract"
import { migrate } from "@nfi/db"
import { loadServerConfig } from "../config.js"
import { buildCapabilityContext } from "./context.js"
import { POLL_TICK_MS, SNAPSHOT_THROTTLE_MS } from "./feed.js"
import { liveHub } from "./hub.js"

/**
 * Live poller — the ONLY interval in the system.
 *
 * One 5s tick refreshes every tracked capability key whose `pollMs` cadence
 * is due (subscribed SSE keys + the always-on default profit/balance baseline
 * that also feeds sqlite snapshots, throttled to 60s). Refreshes fan out via
 * `liveHub.publish` to SSE subscribers; failures are logged and keep the
 * previous snapshot — the poller never crashes the server.
 *
 * The frontend holds NO interval: widgets render pushed snapshots from a
 * TanStack Store (`useCapability`), seeded once over REST.
 */

let lastSnapshotMs = 0
let snapshotThrottleMs = SNAPSHOT_THROTTLE_MS

/** Local URL for the "nothing configured" hint — set once at layer init. */
let localUrl = "http://localhost:4000"
/** Log the unconfigured hint once per empty stretch, not once per tick. */
let unconfiguredHintLogged = false

// Per-key failure memory: an unreachable freqtrade fails EVERY tracked key on
// EVERY tick, so repeated identical failures log once per outage and stay
// quiet until the error changes or the key recovers — one WARN per key, not
// one per 5s per key.
const lastFailureSignatures = new Map<string, string>()

const refreshKey = (
  key: string,
  name: CapabilityName,
  options: unknown,
  ctx: CapabilityContext,
): Effect.Effect<void> => {
  const def = CAPABILITY_REGISTRY[name]
  const run = def.run as (options: unknown, ctx: CapabilityContext) => Effect.Effect<unknown, BackendError>
  return Effect.asVoid(
    Effect.tap(run(options, ctx), (result) => {
      lastFailureSignatures.delete(key)
      return Effect.sync(() => liveHub.publish(key, result))
    }),
  ).pipe(
    Effect.catchAllCause((cause) =>
      Effect.gen(function* () {
        // Dedupe on the STABLE error summary, not the full detail: the
        // freqtrade breaker's fail-fast message carries a changing retry
        // countdown that would defeat an exact-match comparison.
        const failure = Cause.failureOption(cause)
        let summary = "unknown"
        if (failure._tag === "Some") {
          const errorField = (failure.value as { error?: unknown }).error
          summary = typeof errorField === "string" ? errorField : JSON.stringify(failure.value)
        }
        if (lastFailureSignatures.get(key) === summary) return
        lastFailureSignatures.set(key, summary)
        yield* Effect.logWarning(`live refresh of ${key} failed, keeping stale snapshot`, cause)
      }),
    ),
  )
}

/** Fetch + record one stored instance's profit/balance; failures are logged. */
const snapshotStoredInstance = (
  ctx: CapabilityContext,
  instance: FleetInstance,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const [profit, balance] = yield* Effect.all([
      optional(instance.service.getProfit()),
      optional(instance.service.getBalance()),
    ])
    if (profit !== undefined)
      yield* ctx.snapshots
        .recordProfit(instance.id, profit)
        .pipe(Effect.catchAllCause((cause) => Effect.logWarning(`profit snapshot for ${instance.name} failed, skipping`, cause)))
    if (balance !== undefined)
      yield* ctx.snapshots
        .recordBalance(instance.id, balance)
        .pipe(Effect.catchAllCause((cause) => Effect.logWarning(`balance snapshot for ${instance.name} failed, skipping`, cause)))
  })

/**
 * Default-instance baseline: the capability runs also republish into the
 * live hub so open widgets converge immediately between SSE cadences.
 */
const snapshotDefaultInstance = (ctx: CapabilityContext): Effect.Effect<void> =>
  Effect.gen(function* () {
    const baseline = yield* Effect.all([
      CAPABILITY_REGISTRY["bot.profit"].run({}, ctx),
      CAPABILITY_REGISTRY["bot.balance"].run({}, ctx),
    ]).pipe(
      Effect.catchAllCause(() => Effect.succeed(undefined)),
    )
    if (baseline === undefined) return
    const [profit, balance] = baseline
    liveHub.publish(liveHub.track("bot.profit", {}), profit)
    liveHub.publish(liveHub.track("bot.balance", {}), balance)
    yield* ctx.snapshots.recordProfit(DEFAULT_INSTANCE_ID, profit).pipe(
      Effect.andThen(ctx.snapshots.recordBalance(DEFAULT_INSTANCE_ID, balance)),
      Effect.catchAllCause((cause) => Effect.logWarning("snapshot record failed, skipping", cause)),
    )
  })

const tick = Effect.gen(function* () {
  const ctx = yield* buildCapabilityContext
  const instances = yield* fleetInstances(ctx).pipe(
    Effect.catchAllCause(() => Effect.succeed([] as FleetInstance[])),
  )
  // Fresh install, nothing configured: `default` is an empty slot (the
  // built-in FREQTRADE_URL fallback is NOT an instance) — there is no bot
  // to poll, so keep the baseline untracked, skip the snapshots and leave
  // the log quiet (a one-time hint instead of login failures every tick).
  if (instances.length === 0) {
    if (!unconfiguredHintLogged) {
      unconfiguredHintLogged = true
      yield* Effect.log(
        `No freqtrade configured yet — open ${localUrl} and add your bot (System page → Freqtrade Instances), or set FREQTRADE_* env. Polling starts automatically once one exists.`,
      )
    }
    return
  }
  unconfiguredHintLogged = false
  // Baseline: default profit/balance stay fresh even with no viewers, so
  // sqlite history is continuous across restarts and idle periods.
  liveHub.track("bot.profit", {})
  liveHub.track("bot.balance", {})
  const now = Date.now()
  const due = liveHub
    .trackedKeys()
    .filter((entry) => now - entry.lastRefreshMs >= (CAPABILITY_REGISTRY[entry.name]?.pollMs ?? 60_000))
  yield* Effect.forEach(
    due,
    (entry) => refreshKey(entry.key, entry.name, entry.options, ctx),
    { concurrency: 4, discard: true },
  )
  // Sqlite snapshots (throttled), reusing the fleet resolved above.
  // Recorded per instance so every bot gets its own wallet/PnL history;
  // instances that are unreachable simply skip this round. The default
  // instance goes through its capability run so the live hub republishes
  // its baseline even with no SSE subscribers tracking those keys.
  if (now - lastSnapshotMs >= snapshotThrottleMs) {
    yield* Effect.forEach(
      instances,
      (instance) =>
        instance.id === DEFAULT_INSTANCE_ID
          ? snapshotDefaultInstance(ctx)
          : snapshotStoredInstance(ctx, instance),
      { concurrency: 4, discard: true },
    )
    lastSnapshotMs = now
  }
}).pipe(Effect.catchAllCause((cause) => Effect.logWarning("live tick failed, skipping", cause)))

export const LivePollerLive = Layer.scopedDiscard(
  Effect.gen(function* () {
    yield* migrate
    const config = yield* loadServerConfig.pipe(
      Effect.orElseSucceed(
        () =>
          ({ snapshotIntervalMs: SNAPSHOT_THROTTLE_MS, port: 4000 }) as const,
      ),
    )
    snapshotThrottleMs = Math.max(5_000, config.snapshotIntervalMs)
    localUrl = `http://localhost:${config.port}`
    yield* Effect.log(`live poller ticking every ${POLL_TICK_MS}ms (backend <-> freqtrade only)`)
    yield* Effect.forever(Effect.andThen(tick, Effect.sleep(Duration.millis(POLL_TICK_MS)))).pipe(Effect.forkScoped)
  }),
)
