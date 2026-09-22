// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect";
import type { BackendError } from "@nfi/api-contract";
import type { FreqtradeClientService } from "@nfi/freqtrade-client";
import { DEFAULT_INSTANCE_ID, type CapabilityContext } from "./definition.js";
import { asBackendError } from "./errors.js";

/**
 * Fleet helpers — enumerate every configured instance (default env entry +
 * stored rows) with a resolved service, and run per-instance effects with
 * graceful degradation: one unreachable bot never fails the whole fleet.
 */

export interface FleetInstance {
  readonly id: string;
  readonly name: string;
  readonly service: FreqtradeClientService;
}

/** All configured instances with resolved services (default first). */
export const fleetInstances = (
  ctx: CapabilityContext,
): Effect.Effect<ReadonlyArray<FleetInstance>, BackendError> =>
  Effect.gen(function* () {
    const stored = yield* ctx.instances
      .listInstances()
      .pipe(Effect.mapError((cause) => asBackendError("instance list", cause)));
    const rows: Array<{ id: string; name: string }> = [];
    // The implicit env-backed entry only exists when the env default is
    // actually configured (FREQTRADE_URL / FREQTRADE_PASSWORD set); the
    // built-in fallback URL is an empty slot, not an instance. When
    // `default` follows a stored instance it IS that row — listing both
    // would duplicate the same bot across the fleet.
    if (ctx.defaultEnvConfigured && !ctx.defaultFollowsStoredInstance)
      rows.push({ id: DEFAULT_INSTANCE_ID, name: "default" });
    for (const row of stored) rows.push({ id: row.id, name: row.name });
    return yield* Effect.forEach(rows, ({ id, name }) =>
      ctx
        .resolveInstance(id)
        .pipe(Effect.map((service) => ({ id, name, service }))),
    );
  });

export interface FleetOutcome<T> {
  readonly instance: FleetInstance;
  readonly data?: T;
  /** Human-readable per-instance failure. */
  readonly error?: string;
}

const describeError = (cause: unknown): string => {
  if (typeof cause === "object" && cause !== null) {
    const record = cause as Record<string, unknown>;
    if (typeof record["error"] === "string") {
      const detail = record["detail"];
      return detail !== undefined
        ? `${record["error"]}: ${String(detail)}`
        : record["error"];
    }
    if (
      typeof record["operation"] === "string" &&
      record["reason"] !== undefined
    ) {
      return `${record["operation"]} failed: ${String(record["reason"])}`;
    }
  }
  return cause instanceof Error ? cause.message : String(cause);
};

/**
 * Run `task` on every instance concurrently, capturing per-instance failures
 * as `error` outcomes instead of failing the whole effect.
 */
export const perInstance = <T>(
  instances: ReadonlyArray<FleetInstance>,
  task: (instance: FleetInstance) => Effect.Effect<T, unknown>,
): Effect.Effect<ReadonlyArray<FleetOutcome<T>>, never> =>
  Effect.forEach(
    instances,
    (instance) =>
      task(instance).pipe(
        Effect.map((data): FleetOutcome<T> => ({ instance, data })),
        Effect.catchAll((cause): Effect.Effect<FleetOutcome<T>, never> =>
          Effect.succeed({ instance, error: describeError(cause) }),
        ),
      ),
    { concurrency: "unbounded" },
  );

/** Run an effect, downgrading failures to `undefined` (partial overviews). */
export const optional = <T, E>(
  effect: Effect.Effect<T, E>,
): Effect.Effect<T | undefined, never> =>
  effect.pipe(
    Effect.map((data): T | undefined => data),
    Effect.catchAll((): Effect.Effect<T | undefined, never> =>
      Effect.succeed(undefined),
    ),
  );
