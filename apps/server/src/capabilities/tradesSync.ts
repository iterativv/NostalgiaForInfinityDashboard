// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Cause, Duration, Effect, Option, Schema } from "effect";
import { Either } from "effect";
import type { CapabilityContext } from "@nfi/capabilities";
import type { FleetInstance } from "@nfi/capabilities";
import { BackendError } from "@nfi/api-contract";

/**
 * Trades sync — mirrors every instance's trade history, open positions,
 * pair lists and locks into SQLite (`@nfi/db` TradesRepo) so table
 * capabilities can push their filters down to SQL with full-history
 * coverage.
 *
 * Driven from the live poller's tick (no second interval): each instance
 * syncs at most every `SYNC_INTERVAL_MS`:
 * - open positions (`/status`) upsert every round — keeps the live profit
 *   columns fresh;
 * - whitelist / blacklist / locks replace wholesale (tiny payloads);
 * - the closed tail (newest page) upserts incrementally; a count probe
 *   reconciles the mirror against freqtrade. Drift (missing or
 *   freqtrade-deleted rows) clears the closed mirror and re-runs the FULL
 *   backfill — newest-first, paced — in its own fiber so a big history
 *   never blocks the poller (upserts converge the rows as pages land).
 *
 * Everything is failure-isolated per instance: an unreachable bot skips its
 * round and logs once per unique error signature, exactly like the poller's
 * capability refreshes.
 */

const TAIL_PAGE = 500;

const SYNC_INTERVAL_MS = 30_000;

/**
 * Hard ceiling for one sync round. The freqtrade client caps every request,
 * but a round makes several calls back-to-back — a bot that stalls past all
 * of them must still release the single-flight `syncing` flag, or the
 * mirror silently stops updating forever (the desk then shows a stale open
 * book while freqtrade has live trades).
 */
const SYNC_ROUND_TIMEOUT_MS = 45_000;

/** Hard ceiling for a full-history backfill — same reason, for the
 * `backfilling` flag: a repair that never ends blocks every later repair. */
const BACKFILL_TIMEOUT_MS = 15 * 60_000;

/** Pace between backfill pages so a huge history never starves the API. */
const BACKFILL_PAGE_PACE_MS = 100;

/** Minimum spacing between drift repairs (a repair is a full re-backfill). */
const REPAIR_COOLDOWN_MS = 10 * 60_000;

/** Per-instance throttle + single-flight guards. */
const lastSyncMs = new Map<string, number>();

const syncing = new Map<string, boolean>();

const backfilling = new Map<string, boolean>();

const lastRepairMs = new Map<string, number>();

/** Dedupe repeated identical failures per instance (one log per outage). */
const lastErrorSignatures = new Map<string, string>();

const logSyncFailure = (instance: FleetInstance, cause: Cause.Cause<unknown>) =>
  Effect.gen(function* () {
    const failure = Cause.failureOption(cause);
    let summary: string;

    if (Option.isSome(failure)) {
      const decoded = Schema.decodeUnknownEither(BackendError)(failure.value);

      summary = Either.isRight(decoded)
        ? decoded.right.error
        : JSON.stringify(failure.value);
    } else {
      summary = "unknown";
    }

    if (lastErrorSignatures.get(instance.id) === summary) return;
    lastErrorSignatures.set(instance.id, summary);
    yield* Effect.logWarning(
      `trades sync for ${instance.name} failed, skipping round`,
      cause,
    );
  });

/**
 * Backfill the whole closed-trade history, newest-first, paced. Runs as a
 * forked fiber; rows appear in the mirror page by page while it runs.
 */
const backfillHistory = (
  ctx: CapabilityContext,
  instance: FleetInstance,
  total: number,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let offset = 0; offset < total; offset += TAIL_PAGE) {
      const page = yield* instance.service.getClosedPositions(
        TAIL_PAGE,
        offset,
      );

      if (page.positions.length === 0) break;

      yield* ctx.trades.upsertClosed(instance.id, page.positions);
      yield* Effect.sleep(Duration.millis(BACKFILL_PAGE_PACE_MS));
    }

    yield* ctx.trades.setSyncState(instance.id, {
      backfillDone: true,
      lastTailAt: new Date().toISOString(),
      lastTotal: total,
    });
    yield* Effect.log(
      `trades backfill for ${instance.name} complete (${total} closed trades)`,
    );
  }).pipe(
    Effect.timeoutFail({
      duration: BACKFILL_TIMEOUT_MS,
      onTimeout: () =>
        BackendError.make({
          error: "trades backfill timed out",
          detail: `over ${Math.round(BACKFILL_TIMEOUT_MS / 60_000)}min for ${instance.name} — retrying on the next drift repair`,
        }),
    }),
    Effect.catchAllCause((cause) => logSyncFailure(instance, cause)),
    Effect.ensuring(
      Effect.sync(() => {
        backfilling.set(instance.id, false);
      }),
    ),
  );

/** One sync round for one instance (failure-isolated, single-flight). */
const syncInstance = (
  ctx: CapabilityContext,
  instance: FleetInstance,
): Effect.Effect<void> =>
  Effect.suspend(() => {
    const now = Date.now();
    const last = lastSyncMs.get(instance.id) ?? 0;

    if (now - last < SYNC_INTERVAL_MS || syncing.get(instance.id) === true)
      return Effect.void;

    lastSyncMs.set(instance.id, now);
    syncing.set(instance.id, true);

    const round = Effect.gen(function* () {
      // Live open positions first: freshest profit columns for the wall.
      const openPositions = yield* instance.service.getOpenPositions();

      yield* ctx.trades.upsertOpen(instance.id, openPositions.positions);

      // Pair lists + locks: wholesale replace (tiny).
      const [whitelist, blacklist, locks] = yield* Effect.all([
        instance.service.getWhitelist(),
        instance.service.getBlacklist(),
        instance.service.getLocks(),
      ]);

      yield* ctx.trades.replaceWhitelist(instance.id, whitelist.pairs);
      yield* ctx.trades.replaceBlacklist(instance.id, blacklist.pairs);
      yield* ctx.trades.replaceLocks(instance.id, locks.locks);

      // Closed side: upsert the newest tail, then reconcile counts.
      const state = yield* ctx.trades.getSyncState(instance.id);
      const tail = yield* instance.service.getClosedPositions(TAIL_PAGE, 0);

      yield* ctx.trades.upsertClosed(instance.id, tail.positions);

      const expectedTotal = tail.totalTrades ?? 0;
      // Freqtrade builds differ here: some list (and count) CLOSED trades
      // only in `/trades`; others fold the open trades into the list and
      // `total_trades`. `openSeen` counts the open rows actually inside the
      // fetched window, so the mirror's expected closed count is right for
      // both — subtracting the live open count (the old formula) tripped a
      // drift repair every cooldown forever on closed-only builds.
      const expectedClosed = Math.max(0, expectedTotal - tail.openSeen);
      const mirrored = yield* ctx.trades.countClosed(instance.id);

      if (state === null || !state.backfillDone) {
        yield* backfillHistory(ctx, instance, expectedTotal);

        return;
      }

      if (
        mirrored !== expectedClosed &&
        now - (lastRepairMs.get(instance.id) ?? 0) > REPAIR_COOLDOWN_MS
      ) {
        // Drift: freqtrade grew beyond the tail or deleted trades the
        // mirror still holds. Clear the closed side and re-backfill fresh —
        // upserts alone can never remove a deleted trade's row.
        lastRepairMs.set(instance.id, now);
        yield* ctx.trades.clearClosed(instance.id);

        if (backfilling.get(instance.id) !== true) {
          backfilling.set(instance.id, true);
          yield* Effect.fork(backfillHistory(ctx, instance, expectedTotal));
        }

        return;
      }

      yield* ctx.trades.setSyncState(instance.id, {
        backfillDone: true,
        lastTailAt: new Date().toISOString(),
        lastTotal: expectedTotal,
      });
    });

    return round.pipe(
      Effect.timeoutFail({
        duration: SYNC_ROUND_TIMEOUT_MS,
        onTimeout: () =>
          BackendError.make({
            error: "trades sync round timed out",
            detail: `over ${Math.round(SYNC_ROUND_TIMEOUT_MS / 1000)}s for ${instance.name} — skipping this round`,
          }),
      }),
      Effect.tap(() =>
        Effect.sync(() => {
          lastErrorSignatures.delete(instance.id);
        }),
      ),
      Effect.catchAllCause((cause) => logSyncFailure(instance, cause)),
      Effect.ensuring(
        Effect.sync(() => {
          syncing.set(instance.id, false);
        }),
      ),
    );
  });

/**
 * One trades-sync pass over the fleet, called from the poller tick. Cheap
 * when throttles hold (a map read per instance) — no work, no logging.
 */
export const syncTradesTick = (
  ctx: CapabilityContext,
  instances: ReadonlyArray<FleetInstance>,
): Effect.Effect<void> =>
  Effect.forEach(instances, (instance) => syncInstance(ctx, instance), {
    concurrency: 2,
    discard: true,
  });
