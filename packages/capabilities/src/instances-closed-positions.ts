// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
import { Effect } from "effect";
import {
  ClosedPositionsResponse,
  type ClosedPosition,
} from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError } from "./errors.js";
import { applySearch, normalizeSearch } from "./search.js";

/** Freqtrade page size for search scans (one `/trades` request per page). */
const SEARCH_PAGE_SIZE = 500;

/**
 * Upper bound on trades scanned per search poll: correctness (newest
 * matches first) is worth a few extra freqtrade reads, but an unbounded
 * scan would stall the 30s stream cadence on huge histories.
 */
const SEARCH_SCAN_CAP = 5000;

const ClosedPositionsOptions = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  limit: Schema.optional(Schema.String),
  offset: Schema.optional(Schema.String),
  /** Free-text filter applied server-side, before limit/offset slicing. */
  search: Schema.optional(Schema.String),
});

/**
 * `instances.closed-positions` — closed positions window (ABSOLUTE amounts).
 *
 * Never grant publicly: use `instances.closed-positions.relative` instead.
 */
export const InstancesClosedPositionsCapability = defineCapability({
  name: "instances.closed-positions",
  optionsSchema: ClosedPositionsOptions,
  resultSchema: ClosedPositionsResponse,
  description: "Closed positions window for one instance (absolute amounts).",
  streamable: true,
  pollMs: 30_000,
  exposes: ["trade-details"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const service = yield* ctx.resolveInstance(options.id);
      const limit = parseLimitParam(options.limit, 50, 5_000);

      if (normalizeSearch(options.search) === null) {
        return yield* service.getClosedPositions(
          limit,
          parseLimitParam(options.offset, 0, 100_000),
        );
      }

      // Search spans history beyond the requested window: page freqtrade
      // until `limit` matches are collected (or history / the scan cap is
      // exhausted), then newest-first slice — so a match on page 5 still
      // surfaces instead of being cut off by the window.
      const matches: ClosedPosition[] = [];
      let totalTrades: number | undefined;
      let scanned = 0;
      let pageIsFull = true;

      for (
        let offset = 0;
        matches.length < limit && scanned < SEARCH_SCAN_CAP && pageIsFull;
        offset += SEARCH_PAGE_SIZE
      ) {
        const page = yield* service.getClosedPositions(
          SEARCH_PAGE_SIZE,
          offset,
        );

        totalTrades = totalTrades ?? page.totalTrades;
        scanned += page.positions.length;
        pageIsFull = page.positions.length >= SEARCH_PAGE_SIZE;

        matches.push(
          ...applySearch(
            page.positions,
            (p) => [p.pair, p.strategy, p.enterTag, p.exitReason],
            options.search,
          ),
        );
      }

      matches.sort((a, b) =>
        (b.closeDate ?? b.openDate).localeCompare(a.closeDate ?? a.openDate),
      );

      return {
        positions: matches.slice(0, limit),
        tradesCount: matches.length,
        totalTrades,
      };
    }).pipe(
      Effect.mapError((cause) =>
        asBackendError("instance closed positions", cause),
      ),
    ),
});
