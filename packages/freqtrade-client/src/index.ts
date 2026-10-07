// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  Config,
  ConfigError,
  Context,
  Effect,
  Either,
  Layer,
  Redacted,
  Ref,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest } from "@effect/platform";
import { Candle } from "@nfi/api-contract";
import type {
  AvailablePairsResponse,
  BalanceResponse,
  BlacklistResponse,
  BlacklistedPair,
  BotConfigSummary,
  BotStatus,
  CandlesResponse,
  ClosedPosition,
  ClosedPositionsResponse,
  LocksResponse,
  OpenPositionsResponse,
  OpenTradesResponse,
  PlotConfigResponse,
  ProfitBucketKind,
  ProfitBucketsResponse,
  ProfitSummary,
  TagGroupBy,
  TagPerformanceResponse,
  TradeCountResponse,
  TradeOrder,
} from "@nfi/api-contract";

/**
 * @nfi/freqtrade-client
 *
 * SERVER-ONLY Effect service wrapping the freqtrade REST API.
 * Must never be imported by `apps/web` (or the future desktop shell):
 * all freqtrade traffic stays inside `apps/server`.
 *
 * Auth model (freqtrade `api_server` with username/password):
 * login once via `POST /api/v1/token/login` with HTTP Basic Auth
 * (`curl -X POST --user <user> .../token/login`), cache the JWT in a
 * `Ref`, transparently refresh on 401 and retry once.
 */

// ---------------------------------------------------------------------------
// Config (env-driven, no secrets in code)
// ---------------------------------------------------------------------------

export interface FreqtradeConfig {
  readonly baseUrl: string;
  readonly username: Redacted.Redacted<string>;
  readonly password: Redacted.Redacted<string>;
  readonly requestTimeoutMs: number;
}

export class FreqtradeConfigTag extends Context.Tag("nfi/FreqtradeConfig")<
  FreqtradeConfigTag,
  FreqtradeConfig
>() {}

export const FreqtradeConfigLive: Layer.Layer<
  FreqtradeConfigTag,
  ConfigError.ConfigError
> = Layer.effect(
  FreqtradeConfigTag,
  Effect.gen(function* () {
    const baseUrl = yield* Config.string("FREQTRADE_URL").pipe(
      Config.withDefault("http://127.0.0.1:8080"),
    );

    const username = yield* Config.redacted("FREQTRADE_USERNAME").pipe(
      Config.withDefault(Redacted.make("freqtrader")),
    );

    const password = yield* Config.redacted("FREQTRADE_PASSWORD").pipe(
      Config.withDefault(Redacted.make("")),
    );

    const requestTimeoutMs = yield* Config.integer("FREQTRADE_TIMEOUT_MS").pipe(
      Config.withDefault(10_000),
    );

    const config: FreqtradeConfig = {
      baseUrl: baseUrl.replace(/\/$/, ""),
      username,
      password,
      requestTimeoutMs,
    };

    return config;
  }),
);

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class FreqtradeError extends Schema.TaggedError<FreqtradeError>()(
  "FreqtradeError",
  {
    operation: Schema.String,
    reason: Schema.String,
    status: Schema.optional(Schema.Number),
  },
) {}

/**
 * Internal 401 marker: `getJson` fails with it when freqtrade answers 401 so
 * `withAuth` can re-login and retry once. Never escapes the client — it is
 * either consumed by the retry or enriched into a `FreqtradeError`.
 */
class FreqtradeAuthChallenge extends Schema.TaggedError<FreqtradeAuthChallenge>()(
  "FreqtradeAuthChallenge",
  { operation: Schema.String },
) {}

// ---------------------------------------------------------------------------
// Client service
// ---------------------------------------------------------------------------

/**
 * A closed-trades page annotated with how many OPEN rows the fetched
 * freqtrade `/trades` window contained: 0 on builds whose `/trades` lists
 * (and counts) closed trades only; the open-book size on builds that fold
 * open trades into the list and `total_trades`.
 */
export interface ClosedTailPage extends ClosedPositionsResponse {
  readonly openSeen: number;
}

export interface FreqtradeClientService {
  readonly ping: () => Effect.Effect<{ status: string }, FreqtradeError>;
  readonly getVersion: () => Effect.Effect<{ version: string }, FreqtradeError>;
  readonly getStatus: () => Effect.Effect<BotStatus, FreqtradeError>;
  readonly getBalance: () => Effect.Effect<BalanceResponse, FreqtradeError>;
  readonly getProfit: () => Effect.Effect<ProfitSummary, FreqtradeError>;
  readonly getOpenTrades: () => Effect.Effect<
    OpenTradesResponse,
    FreqtradeError
  >;
  readonly getOpenPositions: () => Effect.Effect<
    OpenPositionsResponse,
    FreqtradeError
  >;
  readonly getClosedPositions: (
    limit?: number,
    offset?: number,
  ) => Effect.Effect<ClosedTailPage, FreqtradeError>;
  readonly getTagPerformance: (
    limit?: number,
    groupBy?: TagGroupBy,
  ) => Effect.Effect<TagPerformanceResponse, FreqtradeError>;
  readonly getConfig: () => Effect.Effect<BotConfigSummary, FreqtradeError>;
  readonly getCandles: (
    pair: string,
    timeframe?: string,
    limit?: number,
  ) => Effect.Effect<CandlesResponse, FreqtradeError>;
  /**
   * Public exchange market candles for a timeframe the bot never analyzed.
   *
   * Freqtrade's `pair_candles` (above) only ever serves the strategy's
   * analyzed timeframe — every other timeframe comes back empty on a
   * running bot, so `getCandles` alone can never power a timeframe
   * switcher. This reads the exchange's public klines endpoint directly
   * (no API keys): same OHLCV, any timeframe, tagged `source: "exchange"`
   * so the UI can distinguish bot analysis from raw market data.
   * Unsupported exchanges fail with a clear reason — callers keep the
   * analyzed result then.
   *
   * `beforeMs` pages BACKWARD: klines strictly older than that epoch-ms
   * instant (binance `endTime`), enabling the charts' infinite scroll into
   * past data — the exchange is the only source that reaches years back
   * (freqtrade's analyzed dataframe is a bounded rolling window).
   */
  readonly getMarketCandles: (
    pair: string,
    timeframe: string,
    limit?: number,
    beforeMs?: number,
  ) => Effect.Effect<CandlesResponse, FreqtradeError>;
  readonly getAvailablePairs: (
    timeframe?: string,
    stakeCurrency?: string,
  ) => Effect.Effect<AvailablePairsResponse, FreqtradeError>;
  /**
   * Bot whitelist (`GET /api/v1/whitelist`): the pairs the strategy
   * actually analyzes — the reliable pair source when `available_pairs`
   * is gated (freqtrade 503s it on some setups while the bot runs fine).
   */
  readonly getWhitelist: () => Effect.Effect<
    { pairs: string[] },
    FreqtradeError
  >;
  readonly getPlotConfig: (
    strategy?: string,
  ) => Effect.Effect<PlotConfigResponse, FreqtradeError>;
  /** Pair locks (`GET /api/v1/locks`) — pairs temporarily blocked from trading. */
  readonly getLocks: () => Effect.Effect<LocksResponse, FreqtradeError>;
  /** Blacklist (`GET /api/v1/blacklist`) with per-entry reasons. */
  readonly getBlacklist: () => Effect.Effect<BlacklistResponse, FreqtradeError>;
  /** Open-trade capacity (`GET /api/v1/count`). `max` is omitted when unlimited. */
  readonly getTradeCount: () => Effect.Effect<
    TradeCountResponse,
    FreqtradeError
  >;
  /**
   * Profit buckets (`GET /api/v1/{daily,weekly,monthly}?timescale=<n>`):
   * absolute/relative profit per day/week/month bucket.
   */
  readonly getProfitBuckets: (
    bucket?: ProfitBucketKind,
    timescale?: number,
  ) => Effect.Effect<ProfitBucketsResponse, FreqtradeError>;
  /**
   * Recent bot logs (`GET /api/v1/logs?limit=<n>`).
   * Used as a fallback source for the strategy version: older bots omit
   * `strategy_version` from `show_config`, but every bot periodically logs
   * `Bot heartbeat. PID=…, version='…, strategy_version: …', state='…'`.
   */
  readonly getLogs: (
    limit?: number,
  ) => Effect.Effect<FreqtradeLogs, FreqtradeError>;
}

export class FreqtradeClient extends Context.Tag("nfi/FreqtradeClient")<
  FreqtradeClient,
  FreqtradeClientService
>() {}

// ---------------------------------------------------------------------------
// Payload decoding
//
// Every freqtrade response body is decoded with an Effect Schema. Field
// schemas mirror the semantics this file's old hand-rolled `typeof` ladders
// had: a strict member lets well-typed values through, a total fallback
// member maps anything else (missing, null, wrong type) to the ladder's
// fallback. Freqtrade payloads vary across versions and carry excess
// properties — struct schemas ignore those by default.
// ---------------------------------------------------------------------------

/** Any JSON value freqtrade can send — the `response.json` domain. */
type FreqtradeJson =
  | string
  | number
  | boolean
  | null
  | readonly FreqtradeJson[]
  | { readonly [key: string]: FreqtradeJson };

const freqtradeJson: Schema.Schema<FreqtradeJson, FreqtradeJson> = Schema.Union(
  Schema.String,
  Schema.Number,
  Schema.Boolean,
  Schema.Null,
  Schema.Array(
    Schema.suspend(
      (): Schema.Schema<FreqtradeJson, FreqtradeJson> => freqtradeJson,
    ),
  ),
  Schema.Record({
    key: Schema.String,
    value: Schema.suspend(
      (): Schema.Schema<FreqtradeJson, FreqtradeJson> => freqtradeJson,
    ),
  }),
);

/** A freqtrade payload object: arbitrary JSON values under string keys. */
type FreqtradeObject = { readonly [key: string]: FreqtradeJson };

/** Plain-object view of a candle row (arrays and primitives fail to decode). */
const freqtradeObject = Schema.Record({
  key: Schema.String,
  value: freqtradeJson,
});

/** Anything a strict member rejects (missing/null/foreign) → `undefined`. */
const toUndefined = Schema.Unknown.pipe(
  Schema.transform(Schema.Undefined, {
    decode: (): undefined => undefined,
    encode: (decoded) => decoded,
  }),
);

/** String passthrough; `fallback` for missing/non-string values. */
const stringOr = (fallback: string): Schema.Schema<string, unknown> =>
  Schema.Union(
    Schema.String,
    Schema.Unknown.pipe(
      Schema.transform(Schema.Literal(fallback), {
        decode: (): string => fallback,
        encode: (decoded) => decoded,
      }),
    ),
  );

/** String passthrough; `fallback()` re-evaluated per decode (time stamps). */
const stringOrElse = (fallback: () => string): Schema.Schema<string, unknown> =>
  Schema.Union(
    Schema.String,
    Schema.Unknown.pipe(
      Schema.transform(Schema.String, {
        decode: (): string => fallback(),
        encode: (decoded) => decoded,
      }),
    ),
  );

/** String passthrough; `undefined` for missing/non-string values. */
const optString: Schema.Schema<string | undefined, unknown> = Schema.Union(
  Schema.String,
  toUndefined,
);

/**
 * Trade duration input as the raw `/trades` row sees it (subset).
 */
export interface TradeDurationInput {
  readonly trade_duration_s?: number | undefined;
  readonly open_timestamp?: number | undefined;
  readonly close_timestamp?: number | undefined;
  readonly open_date: string;
  readonly close_date?: string | undefined;
}

/**
 * Trade duration in seconds, derived client-side. The REST `/trades` schema
 * carries NO duration field (verified against freqtrade's `TradeSchema` —
 * FreqUI derives it the same way, as `close_timestamp - open_timestamp`).
 * Preference: an explicit `trade_duration_s` (forks/newer builds), then the
 * epoch-ms timestamps, then the (UTC-normalized) date strings; `undefined`
 * only when the trade has not closed.
 */
export const deriveTradeDurationSeconds = (
  t: TradeDurationInput,
): number | undefined => {
  if (t.trade_duration_s !== undefined) return t.trade_duration_s;

  if (t.close_timestamp !== undefined && t.open_timestamp !== undefined)
    return (t.close_timestamp - t.open_timestamp) / 1000;

  if (t.close_date === undefined) return undefined;

  const openMs = Date.parse(t.open_date);
  const closeMs = Date.parse(t.close_date);

  return Number.isNaN(openMs) || Number.isNaN(closeMs)
    ? undefined
    : (closeMs - openMs) / 1000;
};

/**
 * Freqtrade serializes every trade date as a NAIVE UTC string
 * (`"2026-10-06 13:43:00"` — `DATETIME_PRINT_FORMAT` on UTC datetimes, no
 * zone marker). JavaScript parses such strings as browser-LOCAL time, which
 * shifted every age, duration and timestamp display by the machine's UTC
 * offset. Annotate the zone at this boundary (`…T13:43:00Z`): strings that
 * already carry `T`/`Z`/an explicit offset pass through untouched.
 */
export const toUtcIso = (value: string): string => {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(value)) return value;

  const iso = value.includes("T") ? value : value.replace(" ", "T");

  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
};

/** Trade-date string, normalized to ISO UTC (see `toUtcIso`). */
const utcDateString: Schema.Schema<string, unknown> = Schema.Unknown.pipe(
  Schema.transform(Schema.String, {
    decode: (value) => toUtcIso(String(value)),
    encode: (decoded) => decoded,
  }),
);

/** Trade-date field: normalized to ISO UTC; missing values take `fallback()`. */
const utcDateOrElse = (
  fallback: () => string,
): Schema.Schema<string, unknown> =>
  Schema.Union(utcDateString, stringOrElse(fallback));

/** Trade-date field: normalized to ISO UTC; `undefined` when absent. */
const optUtcDate: Schema.Schema<string | undefined, unknown> = Schema.Union(
  utcDateString,
  toUndefined,
);

/** Finite-number passthrough; `undefined` otherwise (strict optional numeric). */
const optNumber: Schema.Schema<number | undefined, unknown> = Schema.Union(
  Schema.Number.pipe(Schema.filter(Number.isFinite)),
  toUndefined,
);

/** Any number, NaN/Infinity included (fields the old ladders only typeof-checked). */
const optAnyNumber: Schema.Schema<number | undefined, unknown> = Schema.Union(
  Schema.Number,
  toUndefined,
);

/** Boolean passthrough; `undefined` otherwise. */
const optBoolean: Schema.Schema<boolean | undefined, unknown> = Schema.Union(
  Schema.Boolean,
  toUndefined,
);

/** Freqtrade numeric with coercion: finite numbers pass, anything else goes through `Number` (0 when unparsable). */
const numberOrZero: Schema.Schema<number, unknown> = Schema.Unknown.pipe(
  Schema.transform(Schema.Number, {
    decode: (value) => {
      const n = Number(value);

      return Number.isFinite(n) ? n : 0;
    },
    encode: (decoded) => decoded,
  }),
);

/** `String(value ?? "")` — stringified passthrough for IDs freqtrade may send as numbers. */
const stringOrEmpty: Schema.Schema<string, unknown> = Schema.Unknown.pipe(
  Schema.transform(Schema.String, {
    decode: (value) => String(value ?? ""),
    encode: (decoded) => decoded,
  }),
);

/** `value !== undefined ? String(value) : undefined` — stringify only when present. */
const stringWhenPresent: Schema.Schema<string | undefined, unknown> =
  Schema.Unknown.pipe(
    Schema.transform(Schema.UndefinedOr(Schema.String), {
      decode: (value) => (value === undefined ? undefined : String(value)),
      encode: (decoded) => decoded,
    }),
  );

/** Value-level twins of the field schemas, for cross-field `??` chains. */
const num = Schema.decodeUnknownSync(numberOrZero);

const optNum = Schema.decodeUnknownSync(optNumber);

/**
 * Oldest-anchored `/trades` coordinates for a NEWEST-anchored closed-trades
 * window: a half-open `[start, end)` range over the closed-trade list.
 */
export interface TradesTailBounds {
  readonly start: number;
  readonly end: number;
}

/**
 * Translate a NEWEST-anchored closed-trades window (offset = trades back
 * from the newest) into freqtrade's OLDEST-anchored `/trades` coordinates.
 * Pure — unit-tested against the live API's semantics.
 */
export const tradesTailBounds = (
  total: number,
  limit: number,
  offset: number,
): TradesTailBounds => {
  const end = Math.max(0, total - Math.max(0, offset));
  const start = Math.max(0, end - Math.max(0, limit));

  return { start, end };
};

/**
 * Make a payload schema total: any body the struct rejects (non-object
 * responses) decodes as the struct decodes `{}` — every field's fallback —
 * exactly like the old `(body ?? {})` prologue.
 */
const payload = <A, I>(
  fields: Schema.Schema<A, I>,
): Schema.Schema<A, unknown> =>
  Schema.Union(
    fields,
    Schema.Unknown.pipe(
      Schema.transform(Schema.typeSchema(fields), {
        // Re-decode `{}` per fallback so per-decode fallbacks (e.g. current
        // time stamps) stay fresh, exactly like the old per-row ladders.
        decode: (): A => Schema.decodeUnknownSync(fields)({}),
        encode: (decoded) => decoded,
      }),
    ),
  );

/** Strict array schema, or `[]` when the value is missing/not an array. */
const arrayOrEmpty = <A, I>(
  strict: Schema.Schema<ReadonlyArray<A>, I>,
): Schema.Schema<ReadonlyArray<A>, unknown> =>
  Schema.Union(
    strict,
    Schema.Unknown.pipe(
      Schema.transform(Schema.typeSchema(strict), {
        decode: (): ReadonlyArray<A> => [],
        encode: (decoded) => decoded,
      }),
    ),
  );

/** Keep only the string elements of a mixed array (order preserved). */
const stringArray = Schema.Array(Schema.Union(Schema.String, toUndefined)).pipe(
  Schema.transform(Schema.typeSchema(Schema.Array(Schema.String)), {
    decode: (values) =>
      values.filter((value): value is string => value !== undefined),
    encode: (values) => values,
  }),
);

// --- Candles (OHLCV dataframes) ----------------------------------------------

/** OHLCV timestamps: finite numbers (seconds below 1e12, milliseconds above) or non-empty date strings. */
const freqtradeTimestamp = Schema.Union(
  Schema.Number.pipe(
    Schema.filter(Number.isFinite),
    Schema.transform(Schema.Number, {
      decode: (value) => (value < 1e12 ? value * 1000 : value),
      encode: (value) => value,
    }),
  ),
  Schema.String.pipe(
    Schema.filter((s) => s.trim() !== ""),
    Schema.transform(Schema.Number, {
      decode: (s) => Date.parse(s),
      encode: (ms) => new Date(ms).toISOString(),
    }),
    Schema.filter((parsed) => !Number.isNaN(parsed)),
  ),
);

/** Unix-ms for a freqtrade timestamp; `undefined` when unparsable. */
const toUnixMs = (value: FreqtradeJson | undefined): number | undefined =>
  Either.getOrUndefined(Schema.decodeUnknownEither(freqtradeTimestamp)(value));

/** Row numerics: finite numbers or non-empty numeric strings. */
const freqtradeRowNumber = Schema.Union(
  Schema.Number.pipe(Schema.filter(Number.isFinite)),
  Schema.String.pipe(
    Schema.filter((s) => s.trim() !== "" && Number.isFinite(Number(s))),
    Schema.transform(Schema.Number, {
      decode: (s) => Number(s),
      encode: (n) => String(n),
    }),
  ),
  toUndefined,
);

/** First key holding a finite number or numeric string — the old probe loop. */
const pickNum = (
  row: FreqtradeObject,
  ...keys: string[]
): number | undefined => {
  for (const key of keys) {
    const value = Either.getOrUndefined(
      Schema.decodeUnknownEither(freqtradeRowNumber)(row[key]),
    );

    if (value !== undefined) return value;
  }

  return undefined;
};

/**
 * Row → key/value view: object rows pass through, array rows map through
 * split-orient `columns` (or positionally as `[t,o,h,l,c,v]`); junk rows
 * yield `undefined`.
 */
const candleRowFields = (
  row: FreqtradeJson,
  columns?: ReadonlyArray<string>,
): FreqtradeObject | undefined => {
  if (Array.isArray(row)) {
    if (columns !== undefined && columns.length > 0) {
      const lower = columns.map((column) => column.toLowerCase());
      const mapped: { [key: string]: FreqtradeJson } = {};

      for (const [index, value] of row.entries()) {
        const key = lower[index];

        if (key) mapped[key] = value;
      }

      return mapped;
    }

    const [t, o, h, l, c, v] = row;

    return {
      date: t ?? null,
      open: o ?? null,
      high: h ?? null,
      low: l ?? null,
      close: c ?? null,
      volume: v ?? null,
    };
  }

  return Either.getOrUndefined(
    Schema.decodeUnknownEither(freqtradeObject)(row),
  );
};

/**
 * Normalize one OHLCV row into a `Candle`. Accepts array rows (positional
 * `[t,o,h,l,c,v]` or mapped through split-orient `columns`) and object rows
 * (`date/open/high/low/close/volume` or short `t/o/h/l/c/v` keys) — freqtrade
 * serializes dataframes differently across versions/endpoints.
 */
const normalizeCandleRow = (
  row: FreqtradeJson,
  columns?: ReadonlyArray<string>,
): Candle | null => {
  const fields = candleRowFields(row, columns);

  if (fields === undefined) return null;

  const time = toUnixMs(
    fields["date"] ??
      fields["time"] ??
      fields["timestamp"] ??
      fields["t"] ??
      fields["open_time"],
  );

  const open = pickNum(fields, "open", "o");
  const high = pickNum(fields, "high", "h");
  const low = pickNum(fields, "low", "l");
  const close = pickNum(fields, "close", "c");

  if (
    time === undefined ||
    open === undefined ||
    high === undefined ||
    low === undefined ||
    close === undefined
  ) {
    return null;
  }

  return {
    time,
    open,
    high,
    low,
    close,
    volume: pickNum(fields, "volume", "vol", "v") ?? 0,
  };
};

/** Decode rows to candles, dropping unparsable rows and sorting by time. */
const candlesFromRows = (
  rows: ReadonlyArray<FreqtradeJson>,
  columns?: ReadonlyArray<string>,
): Candle[] => {
  const candles: Candle[] = [];

  for (const row of rows) {
    const candle = normalizeCandleRow(row, columns);

    if (candle !== null) candles.push(candle);
  }

  candles.sort((a, b) => a.time - b.time);

  return candles;
};

/** Split-orient `columns`: stringified passthrough of array values. */
const stringColumns = Schema.Array(freqtradeJson).pipe(
  Schema.transform(Schema.Array(Schema.String), {
    decode: (columns) => columns.map((column) => String(column)),
    encode: (columns) => columns,
  }),
);

/** Intermediate candle frame: rows plus optional split-orient column names. */
const CandleFrame = Schema.typeSchema(
  Schema.Struct({
    rows: Schema.Array(freqtradeJson),
    columns: Schema.UndefinedOr(Schema.Array(Schema.String)),
  }),
);

type CandleFrame = typeof CandleFrame.Type;

/** Candle payloads: `{data, columns}` split-orient, `{candles}`, or a bare row array. */
const CandlesPayload = payload(
  Schema.Union(
    Schema.Array(freqtradeJson).pipe(
      Schema.transform(CandleFrame, {
        decode: (rows): CandleFrame => ({ rows, columns: undefined }),
        encode: () => [],
      }),
    ),
    Schema.Struct({
      data: Schema.Array(freqtradeJson),
      columns: Schema.Union(stringColumns, toUndefined),
    }).pipe(
      Schema.transform(CandleFrame, {
        decode: (frame): CandleFrame => ({
          rows: frame.data,
          columns: frame.columns,
        }),
        encode: () => ({ data: [], columns: undefined }),
      }),
    ),
    Schema.Struct({
      candles: arrayOrEmpty(Schema.Array(freqtradeJson)),
    }).pipe(
      Schema.transform(CandleFrame, {
        decode: (frame): CandleFrame => ({
          rows: frame.candles,
          columns: undefined,
        }),
        encode: () => ({ candles: [] }),
      }),
    ),
  ).pipe(
    Schema.transform(Schema.typeSchema(Schema.Array(Candle)), {
      decode: (frame) => candlesFromRows(frame.rows, frame.columns),
      encode: () => ({ rows: [], columns: undefined }),
    }),
  ),
);

// --- Endpoint payload schemas -------------------------------------------------

/** `POST /token/login` body; an empty access token counts as no token. */
const LoginPayload = payload(
  Schema.Struct({
    access_token: Schema.Union(
      Schema.String.pipe(Schema.filter((token) => token.length > 0)),
      toUndefined,
    ),
  }),
);

const PingPayload = payload(
  Schema.Struct({
    status: Schema.Unknown.pipe(
      Schema.transform(Schema.String, {
        decode: (value) => String(value ?? "pong"),
        encode: (decoded) => decoded,
      }),
    ),
  }),
);

const VersionPayload = payload(
  Schema.Struct({
    version: Schema.Unknown.pipe(
      Schema.transform(Schema.String, {
        decode: (value) => String(value ?? "unknown"),
        encode: (decoded) => decoded,
      }),
    ),
  }),
);

/** `GET /show_config` fields shared by `getStatus` and `getConfig`. */
const ShowConfigFields = {
  state: stringOr("unknown"),
  strategy: optString,
  strategy_version: optString,
  exchange: optString,
  stake_currency: optString,
  dry_run: optBoolean,
  trading_mode: optString,
};

const StatusPayload = payload(Schema.Struct(ShowConfigFields));

const ConfigPayload = payload(
  Schema.Struct({
    ...ShowConfigFields,
    exchange: Schema.Union(
      Schema.String,
      Schema.Struct({ name: Schema.String }).pipe(
        Schema.transform(Schema.String, {
          decode: (exchange) => exchange.name,
          encode: (name) => ({ name }),
        }),
      ),
      toUndefined,
    ),
    stake_amount: Schema.Unknown,
    max_open_trades: Schema.Unknown,
  }),
);

/**
 * `GET /strategy/<name>` subset: only the timeframe is read (strategy live
 * data exists solely for it). Total like every payload — foreign bodies
 * decode to all-`undefined`.
 */
const StrategyDetailPayload = payload(
  Schema.Struct({
    strategy: optString,
    timeframe: optString,
  }),
);

const BalanceCurrencyPayload = payload(
  Schema.Struct({
    currency: Schema.Unknown,
    code: Schema.Unknown,
    free: numberOrZero,
    used: Schema.Unknown,
    used_balance: Schema.Unknown,
    balance: Schema.Unknown,
    total: Schema.Unknown,
  }),
);

const BalancePayload = payload(
  Schema.Struct({
    stake: stringOr("USDT"),
    total: Schema.Unknown,
    value: Schema.Unknown,
    starting_capital: optNumber,
    currencies: arrayOrEmpty(Schema.Array(BalanceCurrencyPayload)),
    note: optString,
  }),
);

const ProfitPayload = payload(
  Schema.Struct({
    profit_closed_coin: numberOrZero,
    profit_closed_ratio: Schema.Unknown,
    profit_closed_percent: Schema.Unknown,
    profit_closed_fiat: numberOrZero,
    profit_all_coin: numberOrZero,
    profit_all_ratio: Schema.Unknown,
    profit_all_percent: Schema.Unknown,
    profit_all_fiat: numberOrZero,
    trade_count: numberOrZero,
    closed_trade_count: numberOrZero,
    winning_trades: numberOrZero,
    losing_trades: numberOrZero,
    stake_currency: stringOr("USDT"),
    fiat_display_currency: stringOr("USD"),
  }),
);

/** Trade sub-orders attached to `/status` and `/trades` rows. */
const OrderPayload = payload(
  Schema.Struct({
    order_id: stringOrEmpty,
    ft_order_side: Schema.Unknown,
    side: Schema.Unknown,
    order_type: optString,
    status: optString,
    amount: optNumber,
    safe_price: Schema.Unknown,
    price: Schema.Unknown,
    average: Schema.Unknown,
    cost: optNumber,
    filled: optNumber,
    remaining: optNumber,
    is_open: optBoolean,
    ft_is_entry: optBoolean,
    ft_order_tag: optString,
    order_timestamp: optNumber,
    order_filled_timestamp: optNumber,
  }),
);

type FreqtradeOrder = typeof OrderPayload.Type;

/**
 * Entry/exit role of an order.
 *
 * Freqtrade's `/status` + `/trades` order objects (`OrderSchema`) carry
 * `ft_order_side` but no `ft_is_entry` — that flag only exists on the
 * internal `Order.to_json()` shape. Derive it the same way freqtrade does
 * (`ft_order_side == entry_side`): an explicit backend flag always wins,
 * otherwise a known side decides, unknown sides stay unknown.
 */
/** ft_order_side as freqtrade JSON may hold it: side text, or junk/null. */
export type FtOrderSideRaw = string | number | boolean | null | undefined;

export const deriveOrderIsEntry = (
  ftOrderSide: FtOrderSideRaw,
  isShort: boolean | undefined,
  explicit?: boolean,
): boolean | undefined => {
  if (explicit !== undefined) return explicit;

  // Junk values (numbers, flags, null) stringify to text that never
  // matches a known side, so they read as "unknown" exactly as before.
  const side =
    ftOrderSide === null || ftOrderSide === undefined
      ? undefined
      : String(ftOrderSide).toLowerCase();

  if (side !== "buy" && side !== "sell" && side !== "stoploss")
    return undefined;

  return side === (isShort === true ? "sell" : "buy");
};

/**
 * Whole-stake profit percent for an open trade.
 *
 * Freqtrade's `/status` `profit_ratio` / `profit_pct` cover only the
 * REMAINING position after partial exits: NFI's de-risks and grind exits
 * realize P/L that the field never sees, so it stops matching what the
 * strategy acts on (`calc_total_profit()`) and what Freqi/telegram report —
 * "open rate"-style math is not accurate for grind-exit/de-risk trades.
 * `total_profit_ratio` is that whole-stake view: realized exits plus the
 * remaining position over the whole stake used, funding fees included —
 * the same convention as the closed side's `close_profit`. Prefer it and
 * fall back to the raw fields for builds that predate it.
 */
export const openProfitPct = (t: {
  total_profit_ratio?: number;
  profit_ratio?: number;
  profit_pct?: number;
}): number | undefined => {
  const total = optNum(t.total_profit_ratio);

  if (total !== undefined) return total * 100;

  const ratio = optNum(t.profit_ratio);

  if (ratio !== undefined) return ratio * 100;

  return optNum(t.profit_pct);
};

/**
 * Whole-stake absolute profit for an open trade — `total_profit_abs`
 * includes the realized part of partial exits (`profit_abs` does not);
 * falls back for builds that predate the field.
 */
export const openProfitAbs = (t: {
  total_profit_abs?: number;
  profit_abs?: number;
}): number | undefined => optNum(t.total_profit_abs) ?? optNum(t.profit_abs);

/** Narrow freqtrade's opaque ft_order_side to real side text at the boundary. */
const isSideText = (value: unknown): value is string =>
  Either.isRight(Schema.decodeUnknownEither(Schema.String)(value));

/** Map a decoded freqtrade order payload to a `TradeOrder`. */
const toTradeOrder = (
  order: FreqtradeOrder,
  isShort?: boolean,
): TradeOrder => ({
  orderId: order.order_id,
  side: String(order.ft_order_side ?? order.side ?? ""),
  type: order.order_type,
  status: order.status,
  amount: order.amount,
  price: optNum(order.safe_price ?? order.price ?? order.average),
  cost: order.cost,
  filled: order.filled,
  remaining: order.remaining,
  isOpen: order.is_open,
  isEntry: deriveOrderIsEntry(
    isSideText(order.ft_order_side) ? order.ft_order_side : null,
    isShort,
    order.ft_is_entry,
  ),
  tag: order.ft_order_tag,
  timestamp: order.order_timestamp,
  filledTimestamp: order.order_filled_timestamp,
});

/** `GET /status` trades — the open-trades list (one row per open trade). */
const OpenTradesPayload = arrayOrEmpty(
  Schema.Array(
    payload(
      Schema.Struct({
        trade_id: optAnyNumber,
        pair: stringOr("UNKNOWN"),
        is_open: Schema.Unknown,
        exchange: optString,
        amount: numberOrZero,
        stake_amount: numberOrZero,
        open_rate: numberOrZero,
        current_rate: optAnyNumber,
        profit_abs: optAnyNumber,
        profit_ratio: optAnyNumber,
        total_profit_abs: optAnyNumber,
        total_profit_ratio: optAnyNumber,
        profit_pct: optAnyNumber,
        open_date: utcDateOrElse(() => new Date().toISOString()),
        strategy: optString,
        timeframe: Schema.Union(Schema.String, stringOrEmpty),
      }),
    ),
  ),
);

/** `GET /status` trades — the open-positions detail (orders, leverage, funding). */
const OpenPositionsPayload = arrayOrEmpty(
  Schema.Array(
    payload(
      Schema.Struct({
        trade_id: optAnyNumber,
        pair: stringOr("UNKNOWN"),
        is_open: Schema.Unknown,
        is_short: optBoolean,
        exchange: optString,
        amount: numberOrZero,
        stake_amount: numberOrZero,
        max_stake_amount: optNumber,
        open_rate: numberOrZero,
        current_rate: optNumber,
        profit_abs: optNumber,
        profit_ratio: optAnyNumber,
        total_profit_abs: optNumber,
        total_profit_ratio: optNumber,
        profit_pct: optNumber,
        profit_fiat: optNumber,
        realized_profit: optNumber,
        open_date: utcDateOrElse(() => new Date().toISOString()),
        strategy: optString,
        timeframe: stringWhenPresent,
        enter_tag: optString,
        exit_reason: optString,
        leverage: optNumber,
        liquidation_price: optNumber,
        funding_fees: optNumber,
        nr_of_successful_entries: optNumber,
        nr_of_successful_exits: optNumber,
        has_open_orders: optBoolean,
        orders: arrayOrEmpty(Schema.Array(OrderPayload)),
      }),
    ),
  ),
);

/** `GET /trades` — closed-trade rows plus pagination metadata. */
const TradesListPayload = payload(
  Schema.Struct({
    trades: arrayOrEmpty(
      Schema.Array(
        payload(
          Schema.Struct({
            trade_id: optAnyNumber,
            pair: stringOr("UNKNOWN"),
            is_open: Schema.Unknown,
            is_short: optBoolean,
            exchange: optString,
            amount: numberOrZero,
            stake_amount: numberOrZero,
            open_rate: numberOrZero,
            close_rate: optNumber,
            profit_abs: Schema.Unknown,
            profit_pct: Schema.Unknown,
            close_profit_abs: Schema.Unknown,
            close_profit_pct: Schema.Unknown,
            realized_profit: optNumber,
            open_date: utcDateOrElse(() => new Date().toISOString()),
            open_timestamp: optAnyNumber,
            close_date: optUtcDate,
            close_timestamp: optAnyNumber,
            // Freqtrade forks/newer builds may include an explicit duration;
            // the REST schema never has, so `toClosedPosition` derives it.
            trade_duration_s: optNumber,
            strategy: optString,
            timeframe: stringWhenPresent,
            enter_tag: optString,
            exit_reason: optString,
            leverage: optNumber,
            funding_fees: optNumber,
            nr_of_successful_entries: optNumber,
            nr_of_successful_exits: optNumber,
            orders: arrayOrEmpty(Schema.Array(OrderPayload)),
          }),
        ),
      ),
    ),
    trades_count: optNumber,
    total_trades: optNumber,
    offset: optNumber,
  }),
);

const WhitelistPayload = payload(
  Schema.Struct({ whitelist: arrayOrEmpty(stringArray) }),
);

/** `GET /available_pairs`: a `{pairs, ...}` object or a bare pair array. */
const AvailablePairsPayload = payload(
  Schema.Union(
    Schema.Array(freqtradeJson).pipe(
      Schema.transform(
        Schema.typeSchema(
          Schema.Struct({
            pairs: Schema.Array(Schema.String),
            length: optNumber,
            stakeCurrency: optString,
          }),
        ),
        {
          decode: (pairs) => ({
            pairs: Schema.decodeUnknownSync(stringArray)(pairs),
            length: pairs.length,
            stakeCurrency: undefined,
          }),
          encode: (body) => body.pairs,
        },
      ),
    ),
    Schema.Struct({
      pairs: arrayOrEmpty(stringArray),
      length: optNumber,
      stake_currency: optString,
    }).pipe(
      Schema.transform(
        Schema.typeSchema(
          Schema.Struct({
            pairs: Schema.Array(Schema.String),
            length: optNumber,
            stakeCurrency: optString,
          }),
        ),
        {
          decode: (body) => ({
            pairs: body.pairs,
            length: body.length,
            stakeCurrency: body.stake_currency,
          }),
          encode: (body) => ({
            pairs: body.pairs,
            length: body.length,
            stake_currency: body.stakeCurrency,
          }),
        },
      ),
    ),
  ),
);

/** Indicator names of a plot-config section (its object keys). */
const plotKeyNames = Schema.Record({
  key: Schema.String,
  value: freqtradeJson,
}).pipe(
  Schema.transform(Schema.typeSchema(Schema.Array(Schema.String)), {
    decode: (section) => Object.keys(section),
    encode: () => ({}),
  }),
);

/** Subplot name → indicator names, the `PlotConfigResponse` shape. */
const PlotSubplots = Schema.typeSchema(
  Schema.Record({
    key: Schema.String,
    value: Schema.Array(Schema.String),
  }),
);

const PlotConfigPayload = payload(
  Schema.Struct({
    main_plot: arrayOrEmpty(plotKeyNames),
    subplots: Schema.Union(
      Schema.Record({ key: Schema.String, value: freqtradeJson }).pipe(
        Schema.transform(PlotSubplots, {
          decode: (sections) => {
            const subplots: Record<string, readonly string[]> = {};

            for (const [name, config] of Object.entries(sections)) {
              subplots[name] = Either.getOrElse(
                Schema.decodeUnknownEither(plotKeyNames)(config),
                (): readonly string[] => [],
              );
            }

            return subplots;
          },
          encode: (subplots) => subplots,
        }),
      ),
      Schema.Unknown.pipe(
        Schema.transform(PlotSubplots, {
          decode: (): Record<string, readonly string[]> => ({}),
          encode: (decoded) => decoded,
        }),
      ),
    ),
  }),
);

/** `GET /locks` fields; junk rows decode to `undefined` and drop. */
const LockFields = Schema.Struct({
  id: optAnyNumber,
  pair: stringOr("UNKNOWN"),
  lock_time: utcDateOrElse(() => new Date().toISOString()),
  lock_end_time: utcDateOrElse(() => new Date().toISOString()),
  reason: stringOr(""),
  active: Schema.Unknown,
  side: optString,
});

type FreqtradeLock = typeof LockFields.Type;

/** `GET /locks`: a bare lock array or a `{locks: [...]}` object. */
const LocksPayload = payload(
  Schema.Union(
    Schema.Array(Schema.Union(LockFields, toUndefined)),
    Schema.Struct({
      locks: arrayOrEmpty(Schema.Array(Schema.Union(LockFields, toUndefined))),
    }).pipe(
      Schema.transform(
        Schema.typeSchema(Schema.Array(Schema.Union(LockFields, toUndefined))),
        {
          decode: (body) => body.locks,
          encode: (locks) => ({ locks }),
        },
      ),
    ),
  ),
);

/** Blacklist entries: plain pair strings, or `{pair, reason?}` objects. */
const BlacklistEntry = Schema.Union(
  Schema.String.pipe(
    Schema.transform(
      Schema.typeSchema(
        Schema.Struct({
          pair: Schema.String,
          reason: Schema.UndefinedOr(Schema.String),
        }),
      ),
      {
        decode: (pair) => ({ pair, reason: undefined }),
        encode: ({ pair }) => pair,
      },
    ),
  ),
  Schema.Struct({ pair: Schema.String, reason: optString }),
);

/** Stringified fallback for junk entries; object entries keep their `reason`. */
const blacklistFallback = (entry: FreqtradeJson): BlacklistedPair => {
  const objectEntry = Either.getOrUndefined(
    Schema.decodeUnknownEither(Schema.Struct({ reason: optString }))(entry),
  );

  if (objectEntry === undefined || objectEntry.reason === undefined) {
    return { pair: String(entry) };
  }

  return { pair: String(entry), reason: objectEntry.reason };
};

const BlacklistPayload = payload(
  Schema.Struct({
    blacklist: arrayOrEmpty(Schema.Array(freqtradeJson)),
    length: optNumber,
  }),
);

const CountPayload = payload(
  Schema.Struct({ current: numberOrZero, max: optNumber }),
);

const ProfitBucketsPayload = payload(
  Schema.Struct({
    data: arrayOrEmpty(
      Schema.Array(
        payload(
          Schema.Struct({
            date: stringOr(""),
            abs_profit: numberOrZero,
            rel_profit: numberOrZero,
            fiat_value: numberOrZero,
            trade_count: numberOrZero,
          }),
        ),
      ),
    ),
  }),
);

/** `GET /logs`: `{log_count, logs}` where each log row is a JSON array. */
const LogsPayload = payload(
  Schema.Struct({
    log_count: numberOrZero,
    logs: arrayOrEmpty(Schema.Array(freqtradeJson)),
  }),
);

/** Normalized recent-logs view returned by `getLogs`. */
export interface FreqtradeLogs {
  readonly logCount: number;
  readonly logs: ReadonlyArray<ReadonlyArray<FreqtradeJson>>;
}

/**
 * Extract a strategy version (`v18.0.119`, …) from a free-text fragment.
 *
 * Matches freqtrade's `strategy_version: <value>` rendering inside the bot
 * heartbeat (`Bot heartbeat. PID=1, version='2026.8, strategy_version:
 * v18.0.119', state='RUNNING'`) as well as a `/version` string that carries
 * the same suffix. Pure — unit-tested.
 */
export const parseStrategyVersion = (
  text: string | null | undefined,
): string | undefined => {
  if (text === null || text === undefined || text.length === 0)
    return undefined;

  const match = /strategy_version\s*[:=]\s*['"]?([^'"\s,\]]+)/i.exec(text);

  if (!match) return undefined;

  const version = match[1]?.trim().replace(/['"]+$/, "");

  return version && version.length > 0 ? version : undefined;
};

/**
 * Extract the newest strategy version from recent freqtrade logs.
 *
 * Log rows are JSON arrays (timestamp, level, logger, message, …); every
 * cell is stringified and scanned for `strategy_version: …`. Rows are
 * scanned newest-first (freqtrade appends chronologically), so the first
 * hit is the freshest heartbeat. Pure — unit-tested.
 */
export const parseStrategyVersionFromLogs = (
  logs: ReadonlyArray<ReadonlyArray<unknown>> | null | undefined,
): string | undefined => {
  if (!Array.isArray(logs) || logs.length === 0) return undefined;

  for (let i = logs.length - 1; i >= 0; i--) {
    const row = logs[i];

    if (!Array.isArray(row)) continue;

    for (const cell of row) {
      // Cells are stringified regardless of kind: parse only matches
      // strategy_version text, so non-string cells read as no match.
      const version = parseStrategyVersion(String(cell ?? ""));

      if (version !== undefined) return version;
    }
  }

  return undefined;
};

const toFreqtradeError = (
  operation: string,
  cause: unknown,
): FreqtradeError => {
  if (cause instanceof FreqtradeError) return cause;

  return new FreqtradeError({
    operation,
    reason: cause instanceof Error ? cause.message : String(cause),
  });
};

/** HTTP Basic Auth header for the freqtrade login endpoint. */
const basicAuthHeader = (username: string, password: string): string => {
  // Credentials are ASCII by convention (`api_server` user/pass); btoa keeps
  // this runtime-agnostic (Node/Bun/browsers) without `@types/node`.
  const encoded = btoa(`${username}:${password}`);

  return `Basic ${encoded}`;
};

export interface ResolvedFreqtradeConfig {
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
  /**
   * Hard ceiling for one HTTP round trip (login, request, body read).
   * Unset falls back to `DEFAULT_REQUEST_TIMEOUT_MS`.
   */
  readonly requestTimeoutMs?: number | undefined;
}

/** Default request budget when the caller leaves `requestTimeoutMs` unset. */
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/**
 * `pair_candles` computes and serializes the analyzed dataframe — by far
 * the bot's slowest endpoint (large limits, slow hardware, many pairs
 * routinely answer in 10-30s). It gets its own, longer budget so a slow
 * analysis never reads as an outage; `FREQTRADE_TIMEOUT_MS` stays the
 * budget for every snappy control endpoint.
 */
const CANDLES_REQUEST_TIMEOUT_MS = 30_000;

/** Build a client service for an arbitrary instance config (multi-instance). */
/** How long a service stops calling a freqtrade that is unreachable. */
const BREAKER_COOLDOWN_MS = 30_000;

/**
 * Circuit-breaker state, shared per base URL across service constructions
 * (services are built per request/tick, so state must outlive them): a
 * transport-level failure (no HTTP status — connection refused, timeout)
 * means the bot is unreachable. While open, calls fail fast with the
 * recorded outage instead of hammering a dead endpoint on every capability's
 * poll tick; the first success closes it. HTTP-level failures (401/500, …)
 * never open it: the bot answered, so polling must continue. Outages log
 * once per transition (open/close), not once per failing call.
 */
interface BreakerState {
  openUntilMs: number;
  reason: string | null;
}

const breakers = new Map<string, BreakerState>();

const breakerFor = (baseUrl: string): BreakerState => {
  let state = breakers.get(baseUrl);

  if (!state) {
    state = { openUntilMs: 0, reason: null };
    breakers.set(baseUrl, state);
  }

  return state;
};

// --- Public exchange market data (klines fallback) ----------------------------

/** Exchange identity of one freqtrade instance (`show_config` derived). */
interface ExchangeIdentity {
  readonly exchange: string;
  readonly tradingMode: string | undefined;
}

/**
 * Exchange identities per freqtrade base URL, TTL-cached. Services are
 * rebuilt per request/tick, so the cache must be module-level like the
 * breakers; the TTL keeps one `show_config` probe serving many candle
 * polls and lets market data survive short bot outages.
 */
const IDENTITY_TTL_MS = 10 * 60_000;

const identityCache = new Map<
  string,
  { identity: ExchangeIdentity; at: number }
>();

/**
 * Binance public klines hosts. Futures/margin settle on fapi; everything
 * else (spot) on the plain REST host. Both are unauthenticated endpoints.
 */
const binanceKlinesHost = (tradingMode: string | undefined): string =>
  tradingMode === "futures" || tradingMode === "margin"
    ? "https://fapi.binance.com/fapi/v1"
    : "https://api.binance.com/api/v3";

/**
 * freqtrade pair → exchange symbol: `BTC/USDT` and its settled futures
 * form `BTC/USDT:USDT` both map to `BTCUSDT` (the settle suffix carries
 * no extra letters on binance-style symbols).
 */
const exchangeSymbolOf = (pair: string): string =>
  pair.split(":")[0]!.replace("/", "").toUpperCase();

/**
 * One raw kline row as binance sends it:
 * `[openTime, "open", "high", "low", "close", "volume", …]` — numbers are
 * strings except the leading open time.
 */
type RawKlineRow = ReadonlyArray<unknown>;

/** Kline open times are epoch-millis numbers (strings/null fail). */
const isKlineTime = (value: unknown): value is number =>
  Number.isFinite(value);

/** One decoded kline row: `[openTime, open, high, low, close, volume, …]`. */
const klineRowToCandle = (row: RawKlineRow): Candle | null => {
  if (row.length < 6) return null;

  const time = row[0];
  const open = row[1];
  const high = row[2];
  const low = row[3];
  const close = row[4];
  const volume = row[5];
  const values = [open, high, low, close, volume].map(Number);

  if (!isKlineTime(time) || values.some((v) => !Number.isFinite(v))) {
    return null;
  }

  return {
    time,
    open: values[0]!,
    high: values[1]!,
    low: values[2]!,
    close: values[3]!,
    volume: values[4]!,
  };
};

/** Public-exchange request budget — snappy enough for the 30s candle poll. */
const MARKET_DATA_TIMEOUT_MS = 8_000;

/**
 * Fetch public klines for one pair/timeframe straight from the exchange
 * (no freqtrade auth, no breaker — a dead bot or a dead exchange are
 * separate outages and must not fail each other fast). `beforeMs` fetches
 * BACKWARD: klines whose open time is strictly before that epoch-ms
 * instant (binance `endTime`), one page of `limit` at a time.
 */
const fetchExchangeKlines = (
  http: HttpClient.HttpClient,
  identity: ExchangeIdentity,
  pair: string,
  timeframe: string,
  limit: number,
  beforeMs?: number,
): Effect.Effect<CandlesResponse, FreqtradeError> => {
  if (identity.exchange.toLowerCase() !== "binance") {
    return new FreqtradeError({
      operation: "market-candles",
      reason: `no public market-data fallback for exchange ${identity.exchange}`,
    });
  }

  const symbol = exchangeSymbolOf(pair);

  if (symbol.length === 0) {
    return new FreqtradeError({
      operation: "market-candles",
      reason: `cannot map pair ${pair} to an exchange symbol`,
    });
  }

  // Both hosts cap klines at 1000+ per call; the capability never asks for
  // more anyway (the UI limit ceiling is 1000).
  const capped = Math.min(Math.max(limit, 20), 1000);

  const paging =
    beforeMs !== undefined && Number.isFinite(beforeMs) && beforeMs > 0
      ? `&endTime=${Math.floor(beforeMs) - 1}`
      : "";

  return Effect.gen(function* () {
    const request = HttpClientRequest.get(
      `${binanceKlinesHost(identity.tradingMode)}/klines?symbol=${symbol}&interval=${encodeURIComponent(timeframe)}&limit=${capped}${paging}`,
    );

    const response = yield* http.execute(request).pipe(
      Effect.timeoutFail({
        duration: MARKET_DATA_TIMEOUT_MS,
        onTimeout: () =>
          new FreqtradeError({
            operation: "market-candles",
            reason: `exchange klines for ${symbol} ${timeframe} timed out`,
          }),
      }),
      Effect.mapError((cause) => toFreqtradeError("market-candles", cause)),
    );

    if (response.status >= 400) {
      return yield* new FreqtradeError({
        operation: "market-candles",
        reason: `exchange klines for ${symbol} ${timeframe} returned ${response.status}`,
        status: response.status,
      });
    }

    const body: unknown = yield* response.json.pipe(
      Effect.mapError((cause) => toFreqtradeError("market-candles", cause)),
    );

    if (!Array.isArray(body)) {
      return yield* new FreqtradeError({
        operation: "market-candles",
        reason: "exchange klines returned a non-array body",
      });
    }

    const candles = body
      .filter((row): row is RawKlineRow => Array.isArray(row))
      .map(klineRowToCandle)
      .filter((c): c is Candle => c !== null)
      .sort((a, b) => a.time - b.time);

    return {
      pair,
      timeframe,
      candles,
      source: "exchange",
    } satisfies CandlesResponse;
  });
};

export const makeFreqtradeService = (
  resolved: ResolvedFreqtradeConfig,
  http: HttpClient.HttpClient,
): Effect.Effect<FreqtradeClientService, never, never> =>
  Effect.gen(function* () {
    const baseUrl = resolved.baseUrl.replace(/\/$/, "");
    const tokenRef = yield* Ref.make<string | null>(null);

    // Without a ceiling, ONE hung socket (a keep-alive connection the server
    // silently dropped, a stalling proxy) parks the calling fiber forever —
    // the trades sync and the live poller freeze with it and the mirrors go
    // silently stale. A timeout fails transport-level (no `status`), so the
    // circuit breaker treats it as an outage and backs off.
    const requestTimeoutMs =
      resolved.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    const withRequestTimeout = <A>(
      operation: string,
      effect: Effect.Effect<A, FreqtradeError>,
      durationMs: number = requestTimeoutMs,
    ): Effect.Effect<A, FreqtradeError> =>
      effect.pipe(
        Effect.timeoutFail({
          duration: durationMs,
          onTimeout: () =>
            new FreqtradeError({
              operation,
              reason: `no response within ${Math.round(durationMs / 1000)}s`,
            }),
        }),
      );

    const withBreaker = <A>(
      operation: string,
      attempt: () => Effect.Effect<A, FreqtradeError>,
    ): Effect.Effect<A, FreqtradeError> =>
      Effect.gen(function* () {
        const breaker = breakerFor(baseUrl);
        const waitMs = breaker.openUntilMs - Date.now();

        if (waitMs > 0) {
          return yield* new FreqtradeError({
            operation,
            reason: `${breaker.reason} — retrying in ~${Math.ceil(waitMs / 1000)}s`,
          });
        }

        return yield* attempt().pipe(
          Effect.tapError((error) => {
            if (error.status !== undefined) return Effect.void;
            const first = breaker.reason === null;
            breaker.openUntilMs = Date.now() + BREAKER_COOLDOWN_MS;
            breaker.reason = error.reason;

            return first
              ? Effect.logWarning(
                  `freqtrade at ${baseUrl} unreachable (${error.reason}) — backing off for ${BREAKER_COOLDOWN_MS / 1000}s`,
                )
              : Effect.void;
          }),
          Effect.tap(() => {
            if (breaker.reason === null) return Effect.void;
            breaker.openUntilMs = 0;
            breaker.reason = null;

            return Effect.logInfo(`freqtrade at ${baseUrl} reachable again`);
          }),
        );
      });

    const login = Effect.gen(function* () {
      const request = HttpClientRequest.post(
        `${baseUrl}/api/v1/token/login`,
      ).pipe(
        HttpClientRequest.setHeaders({
          Authorization: basicAuthHeader(resolved.username, resolved.password),
        }),
      );

      const response = yield* http
        .execute(request)
        .pipe(Effect.mapError((cause) => toFreqtradeError("login", cause)));

      if (response.status !== 200) {
        return yield* new FreqtradeError({
          operation: "login",
          reason: `freqtrade login returned ${response.status}`,
          status: response.status,
        });
      }

      const body = yield* response.json.pipe(
        Effect.mapError((cause) => toFreqtradeError("login", cause)),
        Effect.map(Schema.decodeUnknownSync(LoginPayload)),
      );

      if (body.access_token === undefined) {
        return yield* new FreqtradeError({
          operation: "login",
          reason: "freqtrade login returned no token",
        });
      }

      yield* Ref.set(tokenRef, body.access_token);

      return body.access_token;
    });

    const withAuth = <A, E>(
      operation: string,
      run: (token: string) => Effect.Effect<A, E>,
    ) =>
      Effect.gen(function* () {
        let token = yield* Ref.get(tokenRef);

        if (!token) token = yield* login;

        const attempt = (t: string) =>
          run(t).pipe(
            Effect.catchAll((cause) => {
              // Only the internal 401 marker triggers a re-login + retry.
              if (cause instanceof FreqtradeAuthChallenge) {
                return Effect.flatMap(login, (fresh) => run(fresh));
              }

              return Effect.fail(cause);
            }),
          );

        return yield* attempt(token);
      }).pipe(Effect.mapError((cause) => toFreqtradeError(operation, cause)));

    /** GET a JSON path and decode it with `schema` (total: never rejects). */
    const getJson = <A, I>(
      path: string,
      operation: string,
      schema: Schema.Schema<A, I>,
      timeoutMs?: number,
    ): Effect.Effect<A, FreqtradeError> =>
      withBreaker(operation, () =>
        // The ceiling wraps auth too: a login that never answers must not
        // outlive the request budget either.
        withRequestTimeout(
          operation,
          withAuth(operation, (token) =>
            Effect.gen(function* () {
              const request = HttpClientRequest.get(`${baseUrl}${path}`).pipe(
                HttpClientRequest.setHeaders({
                  Authorization: `Bearer ${token}`,
                  "content-type": "application/json",
                }),
              );

              const response = yield* http.execute(request);

              if (response.status === 401) {
                return yield* Effect.fail(
                  new FreqtradeAuthChallenge({ operation }),
                );
              }

              if (response.status >= 400) {
                return yield* Effect.fail(
                  new FreqtradeError({
                    operation,
                    reason: `freqtrade ${path} returned ${response.status}`,
                    status: response.status,
                  }),
                );
              }

              const body = yield* response.json;

              return Either.getOrElse(
                Schema.decodeUnknownEither(schema)(body),
                // Total payload schemas only reach the left side on foreign
                // bodies (numbers, strings, null) — decode them as the
                // all-fallbacks `{}` the schemas produce for `{}`.
                () => Schema.decodeUnknownSync(schema)({}),
              );
            }),
          ),
          timeoutMs,
        ),
      );

    /**
     * Exchange identity for the market-data fallback (`getMarketCandles`),
     * TTL-cached module-level so the per-tick service rebuilds share one
     * `show_config` probe per bot. A stale entry still serves market data
     * while the bot itself is briefly unreachable.
     */
    const exchangeIdentity = (): Effect.Effect<
      ExchangeIdentity,
      FreqtradeError
    > => {
      const cached = identityCache.get(baseUrl);

      if (cached && Date.now() - cached.at < IDENTITY_TTL_MS) {
        return Effect.succeed(cached.identity);
      }

      return getJson("/api/v1/show_config", "show_config", ConfigPayload).pipe(
        Effect.flatMap((raw) => {
          const exchange = raw.exchange?.trim().toLowerCase();

          if (!exchange) {
            return new FreqtradeError({
              operation: "market-candles",
              reason: "bot config does not name an exchange",
            });
          }

          const identity: ExchangeIdentity = {
            exchange,
            tradingMode: raw.trading_mode,
          };

          identityCache.set(baseUrl, { identity, at: Date.now() });

          return Effect.succeed(identity);
        }),
      );
    };

    /**
     * Freqtrade's `GET /api/v1/trades` is OLDEST-anchored: `offset` skips the
     * first (oldest) trades and rows ascend by trade id, so a naive
     * `offset=0&limit=N` call returns the FIRST N trades of the entire
     * history — the exact opposite of the newest-first page this service
     * promises. Every closed-trade read therefore probes the closed-trade
     * total, maps the caller's newest-anchored window onto freqtrade's
     * oldest-anchored coordinates, fetches in `TRADES_CHUNK`-row chunks and
     * flips the result to newest-first. Here `offset` means "trades back
     * from the newest closed trade".
     */
    const TRADES_CHUNK = 500;

    /** Probe cache lifetime: multi-page scans reuse one total per run. */
    const TRADES_TOTAL_TTL_MS = 5_000;

    type RawTrade = (typeof TradesListPayload.Type)["trades"][number];

    let tradesTotalCache: { total: number; at: number } | null = null;

    const closedTradesTotal = (): Effect.Effect<number, FreqtradeError> =>
      Effect.gen(function* () {
        if (
          tradesTotalCache !== null &&
          Date.now() - tradesTotalCache.at < TRADES_TOTAL_TTL_MS
        ) {
          return tradesTotalCache.total;
        }

        const probe = yield* getJson(
          "/api/v1/trades?limit=1&offset=0",
          "closed-positions",
          TradesListPayload,
        );

        const total = probe.total_trades ?? probe.trades.length;

        tradesTotalCache = { total, at: Date.now() };

        return total;
      });

    // Closed-trade percentages are relayed, never recomputed: freqtrade's
    // `close_profit_pct` already IS the whole-stake-used ratio (Σ realized
    // exits / whole stake entered, leverage-scaled) — the same convention
    // as NFI's calc_total_profit() and the Freqi/telegram display. An
    // open-rate-based ((close-open)/open) recomputation would diverge for
    // trades with grind exits / de-risks.
    const toClosedPosition = (t: RawTrade, index: number): ClosedPosition => ({
      tradeId: t.trade_id ?? index,
      pair: t.pair,
      isOpen: false,
      isShort: t.is_short,
      exchange: t.exchange,
      amount: t.amount,
      stakeAmount: t.stake_amount,
      openRate: t.open_rate,
      closeRate: t.close_rate,
      profitAbs: optNum(t.profit_abs),
      profitPct: optNum(t.profit_pct),
      closeProfitAbs: optNum(t.close_profit_abs ?? t.profit_abs),
      closeProfitPct: optNum(t.close_profit_pct ?? t.profit_pct),
      realizedProfit: t.realized_profit,
      openDate: t.open_date,
      closeDate: t.close_date,
      tradeDurationSeconds: deriveTradeDurationSeconds(t),
      strategy: t.strategy,
      timeframe: t.timeframe,
      enterTag: t.enter_tag,
      exitReason: t.exit_reason,
      leverage: t.leverage,
      fundingFees: t.funding_fees,
      nrOfEntries: t.nr_of_successful_entries,
      nrOfExits: t.nr_of_successful_exits,
      orders: t.orders.map((o) => toTradeOrder(o, t.is_short)),
    });

    /** Newest-first window of closed trades, `offset` back from the newest. */
    const fetchClosedTail = (
      limit = 50,
      offset = 0,
    ): Effect.Effect<ClosedTailPage, FreqtradeError> =>
      Effect.gen(function* () {
        const total = yield* closedTradesTotal();
        const { start, end } = tradesTailBounds(total, limit, offset);
        const ascending: ClosedPosition[] = [];
        let seen = 0;
        let openSeen = 0;

        for (let at = start; at < end; at += TRADES_CHUNK) {
          const raw = yield* getJson(
            `/api/v1/trades?limit=${Math.min(TRADES_CHUNK, end - at)}&offset=${at}`,
            "closed-positions",
            TradesListPayload,
          );

          for (const t of raw.trades) {
            if (t.is_open !== false) {
              // Count instead of just skipping: builds whose `/trades`
              // includes open rows fold them into `total_trades`, and the
              // mirror's reconciliation needs to subtract exactly these.
              openSeen += 1;
              continue;
            }

            ascending.push(toClosedPosition(t, start + seen));
            seen += 1;
          }
        }

        ascending.reverse();

        return {
          positions: ascending,
          tradesCount: ascending.length,
          totalTrades: total,
          openSeen,
          offset,
        } satisfies ClosedTailPage;
      });

    /**
     * Strategy timeframe via `GET /strategy/<name>` (soft: `undefined`
     * when the endpoint is unreachable or the field is blank — the config
     * read must never fail for this enrichment).
     */
    const strategyTimeframe = (
      strategy: string,
    ): Effect.Effect<string | undefined, FreqtradeError> =>
      getJson(
        `/api/v1/strategy/${encodeURIComponent(strategy)}`,
        "strategy",
        StrategyDetailPayload,
      ).pipe(
        Effect.map((raw) => {
          const timeframe = raw.timeframe?.trim();

          return timeframe && timeframe.length > 0 ? timeframe : undefined;
        }),
      );

    const client: FreqtradeClientService = {
      ping: () => getJson("/api/v1/ping", "ping", PingPayload),
      getVersion: () => getJson("/api/v1/version", "version", VersionPayload),
      getStatus: () =>
        getJson("/api/v1/show_config", "status", StatusPayload).pipe(
          Effect.map(
            (raw) =>
              ({
                state: raw.state,
                strategy: raw.strategy,
                strategyVersion: raw.strategy_version?.trim()
                  ? raw.strategy_version.trim()
                  : undefined,
                exchange: raw.exchange,
                stakeCurrency: raw.stake_currency,
                dryRun: raw.dry_run,
                tradingMode: raw.trading_mode,
              }) satisfies BotStatus,
          ),
        ),
      getBalance: () =>
        getJson("/api/v1/balance", "balance", BalancePayload).pipe(
          Effect.map(
            (raw) =>
              ({
                stakeCurrency: raw.stake,
                totalStake: num(raw.total ?? raw.value),
                startingCapital: raw.starting_capital,
                currencies: raw.currencies.map((c) => ({
                  currency: String(c.currency ?? c.code ?? "UNKNOWN"),
                  free: c.free,
                  used: num(c.used ?? c.used_balance),
                  total: num(c.balance ?? c.total),
                })),
                note: raw.note,
              }) satisfies BalanceResponse,
          ),
        ),
      getProfit: () =>
        getJson("/api/v1/profit", "profit", ProfitPayload).pipe(
          Effect.map(
            (raw) =>
              ({
                profitClosedCoin: raw.profit_closed_coin,
                profitClosedPercent:
                  num(raw.profit_closed_ratio ?? raw.profit_closed_percent) *
                  100,
                profitClosedFiat: raw.profit_closed_fiat,
                profitAllCoin: raw.profit_all_coin,
                profitAllPercent:
                  num(raw.profit_all_ratio ?? raw.profit_all_percent) * 100,
                profitAllFiat: raw.profit_all_fiat,
                tradeCount: raw.trade_count,
                closedTradeCount: raw.closed_trade_count,
                winningTrades: raw.winning_trades,
                losingTrades: raw.losing_trades,
                stakeCurrency: raw.stake_currency,
                fiatCurrency: raw.fiat_display_currency,
              }) satisfies ProfitSummary,
          ),
        ),
      getOpenTrades: () =>
        getJson("/api/v1/status", "trades", OpenTradesPayload).pipe(
          Effect.map(
            (trades) =>
              ({
                trades: trades.map((t, index) => ({
                  tradeId: t.trade_id ?? index,
                  pair: t.pair,
                  isOpen: t.is_open !== false,
                  exchange: t.exchange,
                  amount: t.amount,
                  stakeAmount: t.stake_amount,
                  openRate: t.open_rate,
                  currentRate: t.current_rate,
                  profitAbs: openProfitAbs(t),
                  profitPct: openProfitPct(t),
                  openDate: t.open_date,
                  strategy: t.strategy,
                  timeframe: t.timeframe,
                })),
              }) satisfies OpenTradesResponse,
          ),
        ),
      getOpenPositions: () =>
        getJson("/api/v1/status", "open-positions", OpenPositionsPayload).pipe(
          Effect.map(
            (positions) =>
              ({
                positions: positions.map((t, index) => ({
                  tradeId: t.trade_id ?? index,
                  pair: t.pair,
                  isOpen: t.is_open !== false,
                  isShort: t.is_short,
                  exchange: t.exchange,
                  amount: t.amount,
                  stakeAmount: t.stake_amount,
                  maxStakeAmount: t.max_stake_amount,
                  openRate: t.open_rate,
                  currentRate: t.current_rate,
                  profitAbs: openProfitAbs(t),
                  profitPct: openProfitPct(t),
                  profitFiat: t.profit_fiat,
                  realizedProfit: t.realized_profit,
                  openDate: t.open_date,
                  strategy: t.strategy,
                  timeframe: t.timeframe,
                  enterTag: t.enter_tag,
                  exitReason: t.exit_reason,
                  leverage: t.leverage,
                  liquidationPrice: t.liquidation_price,
                  fundingFees: t.funding_fees,
                  nrOfEntries: t.nr_of_successful_entries,
                  nrOfExits: t.nr_of_successful_exits,
                  hasOpenOrders: t.has_open_orders,
                  orders: t.orders.map((o) => toTradeOrder(o, t.is_short)),
                })),
              }) satisfies OpenPositionsResponse,
          ),
        ),
      getClosedPositions: (limit = 50, offset = 0) =>
        fetchClosedTail(limit, offset),
      getTagPerformance: (limit = 200, groupBy: TagGroupBy = "enter") =>
        // Aggregate over the NEWEST `limit` closed trades (the same tail
        // window `getClosedPositions` reads) — freqtrade's oldest-anchored
        // offset would otherwise rank tags over the bot's first trades.
        fetchClosedTail(limit, 0).pipe(
          Effect.map((page) => {
            const groups = new Map<
              string,
              {
                trades: number;
                wins: number;
                losses: number;
                profitAbs: number;
                profitPctSum: number;
              }
            >();

            let aggregated = 0;

            for (const t of page.positions) {
              const source = groupBy === "exit" ? t.exitReason : t.enterTag;

              const tag =
                source !== undefined && source.trim().length > 0
                  ? source.trim()
                  : "unknown";

              const profitAbs = t.closeProfitAbs ?? t.profitAbs ?? 0;

              const profitPct = t.closeProfitPct ?? t.profitPct ?? 0;

              const entry = groups.get(tag) ?? {
                trades: 0,
                wins: 0,
                losses: 0,
                profitAbs: 0,
                profitPctSum: 0,
              };

              entry.trades += 1;

              if (profitAbs > 0) entry.wins += 1;
              else if (profitAbs < 0) entry.losses += 1;
              entry.profitAbs += profitAbs;
              entry.profitPctSum += profitPct;
              groups.set(tag, entry);
              aggregated += 1;
            }

            return {
              groupBy,
              rows: [...groups.entries()].map(([tag, g]) => ({
                tag,
                trades: g.trades,
                wins: g.wins,
                losses: g.losses,
                winrate: g.trades > 0 ? g.wins / g.trades : 0,
                profitAbs: g.profitAbs,
                profitPctAvg: g.trades > 0 ? g.profitPctSum / g.trades : 0,
              })),
              aggregatedTrades: aggregated,
              totalTrades: page.totalTrades,
            } satisfies TagPerformanceResponse;
          }),
        ),
      getCandles: (pair, timeframe = "15m", limit = 200) =>
        getJson(
          `/api/v1/pair_candles?pair=${encodeURIComponent(pair)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`,
          "candles",
          CandlesPayload,
          Math.max(requestTimeoutMs, CANDLES_REQUEST_TIMEOUT_MS),
        ).pipe(
          Effect.map(
            (candles) =>
              ({
                pair,
                timeframe,
                candles,
                source: "analyzed",
              }) satisfies CandlesResponse,
          ),
        ),
      getMarketCandles: (pair, timeframe, limit = 200, beforeMs) =>
        exchangeIdentity().pipe(
          Effect.flatMap((identity) =>
            fetchExchangeKlines(
              http,
              identity,
              pair,
              timeframe,
              limit,
              beforeMs,
            ),
          ),
        ),
      getAvailablePairs: (timeframe, stakeCurrency) => {
        const params = new URLSearchParams();

        if (timeframe) params.set("timeframe", timeframe);

        if (stakeCurrency) params.set("stake_currency", stakeCurrency);
        const suffix = params.size > 0 ? `?${params.toString()}` : "";

        return getJson(
          `/api/v1/available_pairs${suffix}`,
          "available_pairs",
          AvailablePairsPayload,
        ).pipe(
          Effect.map(
            (raw) =>
              ({
                pairs: raw.pairs,
                length: raw.length ?? raw.pairs.length,
                stakeCurrency: raw.stakeCurrency ?? stakeCurrency,
              }) satisfies AvailablePairsResponse,
          ),
        );
      },
      getWhitelist: () =>
        getJson("/api/v1/whitelist", "whitelist", WhitelistPayload).pipe(
          Effect.map((raw) => ({ pairs: [...raw.whitelist] })),
        ),
      getPlotConfig: (strategy) => {
        const suffix = strategy
          ? `?strategy=${encodeURIComponent(strategy)}`
          : "";

        return getJson(
          `/api/v1/plot_config${suffix}`,
          "plot_config",
          PlotConfigPayload,
        ).pipe(
          Effect.map(
            (raw) =>
              ({
                strategy,
                mainPlot: raw.main_plot,
                subplots: raw.subplots,
              }) satisfies PlotConfigResponse,
          ),
        );
      },
      getConfig: () =>
        getJson("/api/v1/show_config", "show_config", ConfigPayload).pipe(
          Effect.flatMap((raw) => {
            const base = {
              strategy: raw.strategy,
              exchange: raw.exchange,
              stakeCurrency: raw.stake_currency,
              stakeAmount: raw.stake_amount,
              maxOpenTrades: raw.max_open_trades,
              dryRun: raw.dry_run,
              tradingMode: raw.trading_mode,
            };

            const strategy = raw.strategy?.trim();

            if (!strategy) {
              return Effect.succeed({
                ...base,
                timeframe: undefined,
              } satisfies BotConfigSummary);
            }

            return strategyTimeframe(strategy).pipe(
              Effect.catchAll(() => Effect.succeed(undefined)),
              Effect.map(
                (timeframe) =>
                  ({
                    ...base,
                    timeframe,
                  }) satisfies BotConfigSummary,
              ),
            );
          }),
        ),
      getLocks: () =>
        getJson("/api/v1/locks", "locks", LocksPayload).pipe(
          Effect.map((rows) => {
            // Junk rows decoded to `undefined` drop, like the old row filter.
            const locks = rows
              .filter((lock): lock is FreqtradeLock => lock !== undefined)
              .map((lock, index) => ({
                id: lock.id ?? index,
                pair: lock.pair,
                lockTime: lock.lock_time,
                lockEndTime: lock.lock_end_time,
                reason: lock.reason,
                active: lock.active !== false,
                side: lock.side,
              }));

            return { locks } satisfies LocksResponse;
          }),
          // Older freqtrade builds have no `/locks` endpoint (404): report
          // "no locks" instead of failing the widget — every other widget
          // keeps working against those bots, locks must degrade the same
          // way. Other failures (auth, unreachable) still surface as errors.
          Effect.catchAll((cause) =>
            cause instanceof FreqtradeError && cause.status === 404
              ? Effect.succeed({ locks: [] } satisfies LocksResponse)
              : Effect.fail(cause),
          ),
        ),
      getBlacklist: () =>
        getJson("/api/v1/blacklist", "blacklist", BlacklistPayload).pipe(
          Effect.map((raw) => {
            const pairs = raw.blacklist
              .map((entry) =>
                Either.getOrElse(
                  Schema.decodeUnknownEither(BlacklistEntry)(entry),
                  () => blacklistFallback(entry),
                ),
              )
              .filter((entry) => entry.pair.length > 0);

            return {
              pairs,
              length: raw.length ?? pairs.length,
            } satisfies BlacklistResponse;
          }),
        ),
      getTradeCount: () =>
        getJson("/api/v1/count", "count", CountPayload).pipe(
          Effect.map((raw) => {
            // `max` stays omitted when unlimited — no conditional spread.
            if (raw.max === undefined) {
              return { current: raw.current } satisfies TradeCountResponse;
            }

            return {
              current: raw.current,
              max: raw.max,
            } satisfies TradeCountResponse;
          }),
        ),
      getProfitBuckets: (bucket: ProfitBucketKind = "daily", timescale = 30) =>
        getJson(
          `/api/v1/${bucket}?timescale=${timescale}`,
          `${bucket}-profit`,
          ProfitBucketsPayload,
        ).pipe(
          Effect.map(
            (raw) =>
              ({
                bucket,
                buckets: raw.data.map((entry) => ({
                  date: entry.date,
                  profitAbs: entry.abs_profit,
                  // freqtrade rel_profit is a fraction (0.01 = 1%).
                  profitRel: entry.rel_profit,
                  profitFiat: entry.fiat_value,
                  trades: entry.trade_count,
                })),
              }) satisfies ProfitBucketsResponse,
          ),
        ),
      getLogs: (limit = 200) =>
        getJson(`/api/v1/logs?limit=${limit}`, "logs", LogsPayload).pipe(
          Effect.map(
            (raw) =>
              ({
                logCount: raw.log_count,
                logs: raw.logs.flatMap((row) =>
                  Array.isArray(row) ? [[...row]] : [],
                ),
              }) satisfies FreqtradeLogs,
          ),
        ),
    };

    return client;
  });

export const FreqtradeClientLive: Layer.Layer<
  FreqtradeClient,
  never,
  HttpClient.HttpClient | FreqtradeConfigTag
> = Layer.effect(
  FreqtradeClient,
  Effect.gen(function* () {
    const config = yield* FreqtradeConfigTag;
    const http = yield* HttpClient.HttpClient;

    return yield* makeFreqtradeService(
      {
        baseUrl: config.baseUrl,
        username: Redacted.value(config.username),
        password: Redacted.value(config.password),
        requestTimeoutMs: config.requestTimeoutMs,
      },
      http,
    );
  }),
);
