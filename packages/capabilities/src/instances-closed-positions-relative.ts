// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
import { Effect } from "effect";
import {
  RelativeClosedPositionsResponse,
  type ClosedPosition,
} from "@nfi/api-contract";
import { defineCapability, parseLimitParam } from "./definition.js";
import { asBackendError } from "./errors.js";
import { applySearch, normalizeSearch } from "./search.js";
import { toRelativeClosedPositions } from "./relative.js";

/** Freqtrade page size for search scans (one `/trades` request per page). */
const SEARCH_PAGE_SIZE = 500;

/** Upper bound on trades scanned per search poll. */
const SEARCH_SCAN_CAP = 5000;

const ClosedRelativeOptions = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  limit: Schema.optional(Schema.String),
  offset: Schema.optional(Schema.String),
  /** Free-text filter over non-sensitive fields, applied server-side. */
  search: Schema.optional(Schema.String),
});

/**
 * `instances.closed-positions.relative` — closed window without absolutes.
 *
 * Public-shareable mirror of `instances.closed-positions`: any `limit` /
 * `offset` still yields only percentages, so history cannot be monetized.
 * `search` pages the same newest-first windows the absolute capability
 * scans (pair, strategy, enter/exit tags — never amounts).
 */
export const InstancesClosedPositionsRelativeCapability = defineCapability({
  name: "instances.closed-positions.relative",
  optionsSchema: ClosedRelativeOptions,
  resultSchema: RelativeClosedPositionsResponse,
  description: "Closed positions window, percentages only (shareable).",
  streamable: true,
  pollMs: 30_000,
  exposes: ["relative-values"],
  run: (options, ctx) =>
    Effect.gen(function* () {
      const service = yield* ctx.resolveInstance(options.id);
      const limit = parseLimitParam(options.limit, 50, 5_000);
      const offset = parseLimitParam(options.offset, 0, 100_000);

      if (normalizeSearch(options.search) === null) {
        const positions = yield* service.getClosedPositions(limit, offset);

        return toRelativeClosedPositions(positions);
      }

      // Search spans history beyond the requested window (same bounded
      // newest-first scan as the absolute capability), then the relative
      // transform strips every amount-bearing field from the matches.
      const matches: ClosedPosition[] = [];
      let totalTrades: number | undefined;
      let scanned = 0;
      let pageIsFull = true;

      for (
        let pageOffset = 0;
        matches.length < limit && scanned < SEARCH_SCAN_CAP && pageIsFull;
        pageOffset += SEARCH_PAGE_SIZE
      ) {
        const page = yield* service.getClosedPositions(
          SEARCH_PAGE_SIZE,
          pageOffset,
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

      return toRelativeClosedPositions({
        positions: matches.slice(0, limit),
        tradesCount: matches.length,
        totalTrades,
      });
    }).pipe(
      Effect.mapError((cause) =>
        asBackendError("instance closed-positions.relative", cause),
      ),
    ),
});
