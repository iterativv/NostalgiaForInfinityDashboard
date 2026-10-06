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
  ) => Effect.Effect<ClosedPositionsResponse, FreqtradeError>;
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

/** Narrow freqtrade's opaque ft_order_side to real side text at the boundary. */
const isSideText = (value: unknown): value is string =>
  Either.isRight(Schema.decodeUnknownEither(Schema.String)(value));

/** Map a decoded freqtrade order payload to a `TradeOrder`. */
const toTradeOrder = (order: FreqtradeOrder, isShort?: boolean): TradeOrder => ({
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
        profit_pct: optAnyNumber,
        open_date: stringOrElse(() => new Date().toISOString()),
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
        profit_pct: optNumber,
        profit_fiat: optNumber,
        realized_profit: optNumber,
        open_date: stringOrElse(() => new Date().toISOString()),
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
            open_date: stringOrElse(() => new Date().toISOString()),
            close_date: optString,
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
  lock_time: stringOrElse(() => new Date().toISOString()),
  lock_end_time: stringOrElse(() => new Date().toISOString()),
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
}

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

export const makeFreqtradeService = (
  resolved: ResolvedFreqtradeConfig,
  http: HttpClient.HttpClient,
): Effect.Effect<FreqtradeClientService, never, never> =>
  Effect.gen(function* () {
    const baseUrl = resolved.baseUrl.replace(/\/$/, "");
    const tokenRef = yield* Ref.make<string | null>(null);

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
    ): Effect.Effect<A, FreqtradeError> =>
      withBreaker(operation, () =>
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
      );

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
      tradeDurationSeconds: t.trade_duration_s,
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
    ): Effect.Effect<ClosedPositionsResponse, FreqtradeError> =>
      Effect.gen(function* () {
        const total = yield* closedTradesTotal();
        const { start, end } = tradesTailBounds(total, limit, offset);
        const ascending: ClosedPosition[] = [];
        let seen = 0;

        for (let at = start; at < end; at += TRADES_CHUNK) {
          const raw = yield* getJson(
            `/api/v1/trades?limit=${Math.min(TRADES_CHUNK, end - at)}&offset=${at}`,
            "closed-positions",
            TradesListPayload,
          );

          for (const t of raw.trades) {
            if (t.is_open !== false) continue;
            ascending.push(toClosedPosition(t, start + seen));
            seen += 1;
          }
        }

        ascending.reverse();

        return {
          positions: ascending,
          tradesCount: ascending.length,
          totalTrades: total,
          offset,
        } satisfies ClosedPositionsResponse;
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
                  profitAbs: t.profit_abs,
                  profitPct:
                    t.profit_ratio !== undefined
                      ? t.profit_ratio * 100
                      : t.profit_pct,
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
                  profitAbs: t.profit_abs,
                  profitPct:
                    t.profit_ratio !== undefined
                      ? t.profit_ratio * 100
                      : t.profit_pct,
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
        ).pipe(
          Effect.map(
            (candles) =>
              ({ pair, timeframe, candles }) satisfies CandlesResponse,
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
        getJson(
          `/api/v1/logs?limit=${limit}`,
          "logs",
          LogsPayload,
        ).pipe(
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
      },
      http,
    );
  }),
);
