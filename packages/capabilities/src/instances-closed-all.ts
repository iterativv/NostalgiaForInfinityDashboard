// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import {
  FleetClosedPositionsResponse,
  type ClosedPosition,
  type TaggedClosedPosition,
} from "@nfi/api-contract";
import type { FreqtradeClientService } from "@nfi/freqtrade-client";
import { defineCapability, parseLimitParam } from "./definition.js";
import { toBackendError } from "./errors.js";
import { fleetInstances, perInstance } from "./fleet.js";
import { applySearch, matchesSearch, normalizeSearch } from "./search.js";

const ClosedAllOptions = Schema.Struct({
  /** Recent closed positions per instance. Default 50, capped at 5000. */
  limit: Schema.optional(Schema.String),
  /** Free-text filter applied server-side, before limit slicing. */
  search: Schema.optional(Schema.String),
});

/** Freqtrade page size for per-instance search scans. */
const SEARCH_PAGE_SIZE = 500;

/** Upper bound on trades scanned per instance per search poll. */
const SEARCH_SCAN_CAP = 5000;

/** One instance's newest closed window plus its full-history size. */
interface InstanceClosedWindow {
  readonly positions: ClosedPosition[];
  /** Closed trades on record for the instance (drives load-more in the UI). */
  readonly totalTrades: number | undefined;
}

/**
 * Collect an instance's closed positions newest-first; with a search, page
 * freqtrade until `limit` matches are found (bounded scan) so matches
 * outside the first window still surface. A search matching the instance
 * itself qualifies its whole newest window without paging.
 */
const collectInstanceClosed = (
  service: Pick<FreqtradeClientService, "getClosedPositions">,
  instanceId: string,
  instanceName: string,
  limit: number,
  search: string | undefined,
): Effect.Effect<InstanceClosedWindow, unknown> =>
  Effect.gen(function* () {
    const needle = normalizeSearch(search);

    if (needle === null || matchesSearch([instanceId, instanceName], needle)) {
      const page = yield* service.getClosedPositions(limit, 0);

      return {
        positions: [...page.positions],
        totalTrades: page.totalTrades,
      };
    }

    const matches: ClosedPosition[] = [];
    let totalTrades: number | undefined;
    let scanned = 0;
    let pageIsFull = true;

    for (
      let offset = 0;
      matches.length < limit && scanned < SEARCH_SCAN_CAP && pageIsFull;
      offset += SEARCH_PAGE_SIZE
    ) {
      const page = yield* service.getClosedPositions(SEARCH_PAGE_SIZE, offset);

      totalTrades = totalTrades ?? page.totalTrades;
      scanned += page.positions.length;
      pageIsFull = page.positions.length >= SEARCH_PAGE_SIZE;

      matches.push(
        ...applySearch(
          page.positions,
          (p) => [p.pair, p.strategy, p.enterTag, p.exitReason],
          search,
        ),
      );
    }

    matches.sort((a, b) =>
      (b.closeDate ?? b.openDate).localeCompare(a.closeDate ?? a.openDate),
    );

    return {
      positions: matches.slice(0, limit),
      totalTrades,
    };
  });

/** One instance's tagged closed window plus its full-history size. */
interface TaggedClosedWindow {
  readonly rows: TaggedClosedPosition[];
  readonly totalTrades: number | undefined;
}

/**
 * `instances.closed-all` — recent closed positions across every configured
 * instance, each tagged with its source instance and merged into one
 * close-date-descending list (per-instance failures degrade).
 */
export const InstancesClosedAllCapability = defineCapability({
  name: "instances.closed-all",
  optionsSchema: ClosedAllOptions,
  resultSchema: FleetClosedPositionsResponse,
  description:
    "Recent closed positions across all instances, tagged per instance.",
  streamable: true,
  pollMs: 30_000,
  exposes: ["trade-details"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const limit = parseLimitParam(options.limit, 50, 5_000);
      const instances = yield* fleetInstances(ctx);

      const outcomes = yield* perInstance(instances, (instance) =>
        collectInstanceClosed(
          instance.service,
          instance.id,
          instance.name,
          limit,
          options.search,
        ).pipe(
          Effect.map((window): TaggedClosedWindow => ({
            rows: window.positions.map((position) => ({
              ...position,
              instanceId: instance.id,
              instanceName: instance.name,
            })),
            totalTrades: window.totalTrades,
          })),
        ),
      );

      const positions: TaggedClosedPosition[] = [];
      let failures = 0;
      let firstError: string | null = null;
      let totalTrades = 0;
      let totalKnown = false;

      for (const outcome of outcomes) {
        if (outcome.data !== undefined) {
          positions.push(...outcome.data.rows);

          if (outcome.data.totalTrades !== undefined) {
            totalTrades += outcome.data.totalTrades;
            totalKnown = true;
          }
        } else {
          failures += 1;
          firstError = firstError ?? outcome.error ?? "unreachable";
        }
      }

      if (
        positions.length === 0 &&
        failures > 0 &&
        failures === instances.length
      ) {
        return yield* Effect.fail(
          toBackendError(
            "fleet closed positions",
            firstError ?? "all instances unreachable",
          ),
        );
      }

      positions.sort((a, b) =>
        (b.closeDate ?? b.openDate).localeCompare(a.closeDate ?? a.openDate),
      );

      const withFleetSearch = applySearch(
        positions,
        (p) => [p.pair, p.instanceName, p.strategy, p.enterTag, p.exitReason],
        // Instance names only exist after tagging, so the fleet-level pass
        // covers them; per-instance collection already filtered the rest.
        // Running the row filter again here is idempotent and cheap.
        options.search,
      );

      return {
        positions: withFleetSearch.slice(
          0,
          limit * Math.max(1, instances.length),
        ),
        tradesCount: withFleetSearch.length,
        totalTrades: totalKnown ? totalTrades : undefined,
      };
    }).pipe(
      Effect.mapError((cause) =>
        toBackendError("fleet closed positions", cause),
      ),
    ),
});

export type ClosedAllOptions = typeof ClosedAllOptions.Type;
