// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Either, Schema } from "effect";
import { FedRateResponse, type FedRatePoint } from "@nfi/api-contract";
import { defineCapability, NoOptions, type JsonValue } from "./definition.js";
import { toBackendError } from "./errors.js";

/**
 * `macro.fed-rate` — Federal Reserve policy rate scraped from free public
 * sources (no API key, no freqtrade).
 *
 * Primary: NY Fed Markets API (official, daily ~9am ET, previous business
 * day) —
 * - `.../api/rates/unsecured/effr/search.json?startDate=MM/DD/YYYY`
 *   (EFFR + FOMC target range + volume, with history)
 * - `.../api/rates/secured/sofr/search.json?startDate=...` (SOFR)
 * - `.../api/rates/unsecured/obfr/search.json?startDate=...` (OBFR)
 *
 * Fallback: FRED public CSVs (St. Louis Fed, no auth —
 * `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DFF|DFEDTARU|DFEDTARL|SOFR|OBFR`)
 * for the effective rate, target-range bounds and money-market rates plus
 * history.
 *
 * The server merges NY Fed first, FRED second; `sources` reports which
 * upstream fed the snapshot. Streamed hourly (`pollMs`) — the FOMC moves
 * ~8x/year and the effective rate prints once per business day, so hourly
 * is fresh without hammering free endpoints.
 */

const NYFED_BASE = "https://markets.newyorkfed.org/api/rates";

const FRED_CSV_BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv";

export const NYFED_EFFR_URL = `${NYFED_BASE}/unsecured/effr/search.json`;

export const NYFED_SOFR_URL = `${NYFED_BASE}/secured/sofr/search.json`;

export const NYFED_OBFR_URL = `${NYFED_BASE}/unsecured/obfr/search.json`;

const FETCH_TIMEOUT_MS = 15_000;

const HISTORY_DAYS = 90;

const HISTORY_CAP = 120;

const USER_AGENT = "nfi-desk macro.fed-rate (free public scrape: NY Fed + FRED)";

/** One NY Fed `refRates` entry (unknown fields are dropped by the schema). */
const NyFedRowSchema = Schema.Struct({
  effectiveDate: Schema.String,
  type: Schema.String,
  percentRate: Schema.optional(Schema.Number),
  targetRateFrom: Schema.optional(Schema.Number),
  targetRateTo: Schema.optional(Schema.Number),
  volumeInBillions: Schema.optional(Schema.Number),
});

type NyFedRow = typeof NyFedRowSchema.Type;

const NyFedSearchResponse = Schema.Struct({
  refRates: Schema.Array(Schema.Unknown),
});

const decodeNyFedRow = Schema.decodeUnknownEither(NyFedRowSchema);

/** Decode one NY Fed `refRates` entry (null when malformed). */
export const parseNyFedRow = (raw: JsonValue): NyFedRow | null => {
  const decoded = decodeNyFedRow(raw);

  return Either.isRight(decoded) ? decoded.right : null;
};

/** Decode a NY Fed search payload into typed rows (skips malformed). */
export const parseNyFedSearch = (body: JsonValue): ReadonlyArray<NyFedRow> => {
  const decoded = Schema.decodeUnknownEither(NyFedSearchResponse)(body);

  if (Either.isLeft(decoded)) return [];

  const rows: NyFedRow[] = [];

  for (const raw of decoded.right.refRates) {
    // SAFETY: entries come from `JSON.parse`, so each is JSON-compatible by
    // construction — exactly the `JsonValue` domain; the row schema drops
    // anything outside its shape.
    const row = parseNyFedRow(raw as JsonValue);

    if (row !== null) rows.push(row);
  }

  return rows;
};

export interface FredPoint {
  readonly date: string;
  readonly value: number;
}

/**
 * Parse a FRED public CSV (`DATE,VALUE`, missing = `.`) into date-ordered
 * pairs. Skips the header, blanks and `.` observations.
 */
export const parseFredCsv = (csv: string): ReadonlyArray<FredPoint> => {
  const out: FredPoint[] = [];

  const lines = csv.split("\n");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();

    if (line === undefined || line === "") continue;

    const comma = line.indexOf(",");

    if (comma < 0) continue;

    const date = line.slice(0, comma).trim();

    const raw = line.slice(comma + 1).trim();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;

    if (raw === "" || raw === ".") continue;

    const value = Number(raw);

    if (!Number.isFinite(value)) continue;

    out.push({ date, value });
  }

  return out;
};

/** `MM/DD/YYYY` start param the NY Fed search endpoints expect. */
export const nyFedStartParam = (daysBack: number, now = Date.now()): string => {
  const d = new Date(now - daysBack * 24 * 60 * 60 * 1000);

  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");

  const dd = String(d.getUTCDate()).padStart(2, "0");

  return `${mm}/${dd}/${d.getUTCFullYear()}`;
};

const fetchText = (
  url: string,
  accept: string,
): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: async () => {
      const res = await fetch(url, {
        headers: { accept, "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

      return await res.text();
    },
    catch: (cause) =>
      cause instanceof Error ? cause : new Error(String(cause)),
  });

const fetchNyFed = (
  url: string,
): Effect.Effect<ReadonlyArray<NyFedRow>, Error> =>
  Effect.map(
    fetchText(
      `${url}?startDate=${nyFedStartParam(HISTORY_DAYS)}`,
      "application/json",
    ),
    // SAFETY: the body comes from `JSON.parse`, so it is JSON-compatible by
    // construction — exactly the `JsonValue` domain the search parser takes.
    (text) => parseNyFedSearch(JSON.parse(text) as JsonValue),
  );

const fetchFredSeries = (id: string): Effect.Effect<ReadonlyArray<FredPoint>, Error> =>
  Effect.map(
    fetchText(`${FRED_CSV_BASE}?id=${id}`, "text/csv"),
    (text) => parseFredCsv(text),
  );

const byDateAsc = (rows: ReadonlyArray<FredPoint>): FredPoint[] =>
  [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

/** Join EFFR + target + SOFR NY Fed rows into daily points (oldest first). */
export const joinNyFedHistory = (
  effr: ReadonlyArray<NyFedRow>,
  sofr: ReadonlyArray<NyFedRow>,
): FedRatePoint[] => {
  const sofrByDate = new Map<string, number>();

  for (const row of sofr) {
    if (row.percentRate !== undefined) sofrByDate.set(row.effectiveDate, row.percentRate);
  }

  const points: FedRatePoint[] = [];

  for (const row of effr) {
    if (row.percentRate === undefined) continue;

    points.push({
      date: row.effectiveDate,
      effective: row.percentRate,
      targetLower: row.targetRateFrom,
      targetUpper: row.targetRateTo,
      sofr: sofrByDate.get(row.effectiveDate),
    });
  }

  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return points.slice(-HISTORY_CAP);
};

const lastFredPoint = (
  rows: ReadonlyArray<FredPoint>,
): FredPoint | undefined => {
  if (rows.length === 0) return undefined;

  const ordered = byDateAsc(rows);

  return ordered[ordered.length - 1];
};

const runScrape = (): Effect.Effect<typeof FedRateResponse.Type, Error> =>
  Effect.gen(function* () {
    // Primary: NY Fed EFFR/SOFR/OBFR in parallel — each tolerates failure
    // so one down endpoint degrades to FRED instead of failing the widget.
    const legs = yield* Effect.all(
      [
        fetchNyFed(NYFED_EFFR_URL).pipe(Effect.orElseSucceed(() => [])),
        fetchNyFed(NYFED_SOFR_URL).pipe(Effect.orElseSucceed(() => [])),
        fetchNyFed(NYFED_OBFR_URL).pipe(Effect.orElseSucceed(() => [])),
      ],
      { concurrency: 3 },
    );

    const effr = legs[0] ?? [];

    const sofr = legs[1] ?? [];

    const obfr = legs[2] ?? [];

    const nyfedOk = effr.length > 0;

    let history = joinNyFedHistory(effr, sofr);

    let obfrRate: number | undefined;

    for (let i = obfr.length - 1; i >= 0; i--) {
      const rate = obfr[i]?.percentRate;

      if (rate !== undefined) {
        obfrRate = rate;
        break;
      }
    }

    let fredOk = false;

    if (!nyfedOk || history.length === 0) {
      // Fallback: FRED public CSVs (DFF + target bounds + SOFR/OBFR).
      const fred = yield* Effect.all(
        [
          fetchFredSeries("DFF").pipe(Effect.orElseSucceed(() => [])),
          fetchFredSeries("DFEDTARU").pipe(Effect.orElseSucceed(() => [])),
          fetchFredSeries("DFEDTARL").pipe(Effect.orElseSucceed(() => [])),
          fetchFredSeries("SOFR").pipe(Effect.orElseSucceed(() => [])),
          fetchFredSeries("OBFR").pipe(Effect.orElseSucceed(() => [])),
        ],
        { concurrency: 5 },
      );

      const dff = fred[0] ?? [];

      const taru = fred[1] ?? [];

      const tarl = fred[2] ?? [];

      const fredSofr = fred[3] ?? [];

      const fredObfr = fred[4] ?? [];

      if (dff.length > 0) {
        fredOk = true;

        const upperByDate = new Map<string, number>();

        for (const p of taru) upperByDate.set(p.date, p.value);

        const lowerByDate = new Map<string, number>();

        for (const p of tarl) lowerByDate.set(p.date, p.value);

        const sofrByDate = new Map<string, number>();

        for (const p of fredSofr) sofrByDate.set(p.date, p.value);

        const fredHistory: FedRatePoint[] = [];

        for (const p of byDateAsc(dff).slice(-HISTORY_CAP)) {
          fredHistory.push({
            date: p.date,
            effective: p.value,
            targetLower: lowerByDate.get(p.date),
            targetUpper: upperByDate.get(p.date),
            sofr: sofrByDate.get(p.date),
          });
        }

        // Prefer whichever history is fresher (FRED backfills weekends the
        // same way; a gap on either side must not blank the headline).
        const fredLatest = fredHistory[fredHistory.length - 1];

        const nyfedLatest = history[history.length - 1];

        if (
          history.length === 0 ||
          (fredLatest !== undefined &&
            (nyfedLatest === undefined || fredLatest.date > nyfedLatest.date))
        ) {
          history = fredHistory;
        }

        if (obfrRate === undefined) {
          const last = lastFredPoint(fredObfr);

          if (last !== undefined) obfrRate = last.value;
        }
      }
    }

    if (history.length === 0) {
      return yield* Effect.fail(
        new Error("NY Fed and FRED scrapes both returned no observations"),
      );
    }

    const latest = history[history.length - 1];

    if (latest === undefined) {
      return yield* Effect.fail(new Error("scraped history is empty"));
    }

    const prev = history.length > 1 ? history[history.length - 2] : undefined;

    // Current target bounds: latest point carrying them, else scan back
    // (weekend rows repeat the last business-day range on NY Fed; FRED
    // forward-fills daily, but a gap must not blank the headline).
    let targetLower = latest.targetLower;

    let targetUpper = latest.targetUpper;

    for (let i = history.length - 1; i >= 0; i--) {
      targetLower ??= history[i]?.targetLower;
      targetUpper ??= history[i]?.targetUpper;

      if (targetLower !== undefined && targetUpper !== undefined) break;
    }

    if (targetLower === undefined || targetUpper === undefined) {
      return yield* Effect.fail(
        new Error("scraped history carries no FOMC target range"),
      );
    }

    let sofrLatest = latest.sofr;

    for (let i = sofr.length - 1; i >= 0; i--) {
      const rate = sofr[i]?.percentRate;

      if (rate !== undefined) {
        sofrLatest = rate;
        break;
      }
    }

    let volumeBillions: number | undefined;

    for (let i = effr.length - 1; i >= 0; i--) {
      const volume = effr[i]?.volumeInBillions;

      if (volume !== undefined) {
        volumeBillions = volume;
        break;
      }
    }

    return {
      targetLower,
      targetUpper,
      effective: latest.effective,
      effectiveDate: latest.date,
      sofr: sofrLatest,
      obfr: obfrRate,
      volumeBillions,
      effectiveChange:
        latest.effective !== undefined && prev?.effective !== undefined
          ? Math.round((latest.effective - prev.effective) * 100) / 100
          : undefined,
      history,
      sources: [
        {
          name: "NY Fed Markets API",
          href: "https://markets.newyorkfed.org/api/rates/all/search.json",
          ok: nyfedOk,
        },
        {
          name: "FRED public CSV",
          href: "https://fred.stlouisfed.org/graph/fredgraph.csv",
          // Standby when NY Fed fed the snapshot (never fetched): report
          // ok so the widget shows a healthy fallback, not a failure.
          ok: nyfedOk && !fredOk ? true : fredOk,
        },
      ],
      updatedAt: new Date().toISOString(),
    };
  });

/** `macro.fed-rate` — Fed funds target range + EFFR/SOFR, scraped live. */
export const MacroFedRateCapability = defineCapability({
  name: "macro.fed-rate",
  optionsSchema: NoOptions,
  resultSchema: FedRateResponse,
  description:
    "Federal Reserve policy rate: FOMC target range, effective rate (EFFR), SOFR/OBFR and recent history — scraped from NY Fed + FRED (no key).",
  streamable: true,
  pollMs: 3_600_000,
  exposes: ["market-data"],
  run: () =>
    runScrape().pipe(
      Effect.mapError((cause) => toBackendError("macro fed-rate", cause)),
    ),
});
