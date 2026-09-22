// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  Config,
  ConfigError,
  Context,
  Effect,
  Layer,
  Redacted,
  Ref,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest } from "@effect/platform";
import type {
  AvailablePairsResponse,
  BalanceResponse,
  BlacklistResponse,
  BotConfigSummary,
  BotStatus,
  Candle,
  CandlesResponse,
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
}

export class FreqtradeClient extends Context.Tag("nfi/FreqtradeClient")<
  FreqtradeClient,
  FreqtradeClientService
>() {}

interface LoginResponse {
  readonly access_token: string;
}

const toFreqtradeError = (
  operation: string,
  error: unknown,
): FreqtradeError => {
  if (error instanceof FreqtradeError) return error;
  return new FreqtradeError({
    operation,
    reason: error instanceof Error ? error.message : String(error),
  });
};

/** Normalize possibly-null freqtrade numerics to finite numbers. */
const num = (value: unknown): number => {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

const optNum = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const optStr = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

/** Unix-ms from freqtrade timestamps (ms numbers, s numbers, or ISO strings). */
const toUnixMs = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value))
    return value < 1e12 ? value * 1000 : value;
  if (typeof value === "string" && value.trim().length > 0) {
    const t = Date.parse(value);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
};

const pickNum = (
  obj: Record<string, unknown>,
  ...keys: string[]
): number | undefined => {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)))
      return Number(v);
  }
  return undefined;
};

/**
 * Normalize one OHLCV row into a `Candle`. Accepts array rows (positional
 * `[t,o,h,l,c,v]` or mapped through split-orient `columns`) and object rows
 * (`date/open/high/low/close/volume` or short `t/o/h/l/c/v` keys) — freqtrade
 * serializes dataframes differently across versions/endpoints.
 */
const normalizeCandleRow = (
  row: unknown,
  columns?: ReadonlyArray<string>,
): Candle | null => {
  let obj: Record<string, unknown>;
  if (Array.isArray(row)) {
    if (columns !== undefined && columns.length > 0) {
      const lower = columns.map((c) => c.toLowerCase());
      obj = {};
      for (const [index, value] of (row as Array<unknown>).entries()) {
        const key = lower[index];
        if (key) obj[key] = value;
      }
    } else {
      const [t, o, h, l, c, v] = row as Array<unknown>;
      obj = { date: t, open: o, high: h, low: l, close: c, volume: v };
    }
  } else if (typeof row === "object" && row !== null) {
    obj = row as Record<string, unknown>;
  } else {
    return null;
  }
  const time = toUnixMs(
    obj["date"] ??
      obj["time"] ??
      obj["timestamp"] ??
      obj["t"] ??
      obj["open_time"],
  );
  const open = pickNum(obj, "open", "o");
  const high = pickNum(obj, "high", "h");
  const low = pickNum(obj, "low", "l");
  const close = pickNum(obj, "close", "c");
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
    volume: pickNum(obj, "volume", "vol", "v") ?? 0,
  };
};

/** Normalize freqtrade dataframe payloads (split-orient, row arrays, objects). */
const normalizeCandles = (body: unknown): Candle[] => {
  let rows: unknown[] = [];
  let columns: string[] | undefined;
  if (Array.isArray(body)) {
    rows = body;
  } else if (typeof body === "object" && body !== null) {
    const raw = body as Record<string, unknown>;
    if (Array.isArray(raw["data"])) {
      rows = raw["data"] as unknown[];
      if (Array.isArray(raw["columns"]))
        columns = (raw["columns"] as unknown[]).map(String);
    } else if (Array.isArray(raw["candles"])) {
      rows = raw["candles"] as unknown[];
    }
  }
  const candles: Candle[] = [];
  for (const row of rows) {
    const candle = normalizeCandleRow(row, columns);
    if (candle) candles.push(candle);
  }
  candles.sort((a, b) => a.time - b.time);
  return candles;
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
      const body = (yield* response.json.pipe(
        Effect.mapError((cause) => toFreqtradeError("login", cause)),
      )) as LoginResponse | null;
      const token = body?.access_token;
      if (!token) {
        return yield* new FreqtradeError({
          operation: "login",
          reason: "freqtrade login returned no token",
        });
      }
      yield* Ref.set(tokenRef, token);
      return token;
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
              const status = (cause as { status?: number })?.status;
              if (status === 401) {
                return Effect.flatMap(login, (fresh) => run(fresh));
              }
              return Effect.fail(cause);
            }),
          );
        return yield* attempt(token);
      }).pipe(Effect.mapError((cause) => toFreqtradeError(operation, cause)));

    const getJson = (path: string, operation: string) =>
      withBreaker(
        operation,
        () =>
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
                return yield* Effect.fail({ status: 401, operation });
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
              return yield* response.json;
            }),
          ),
      );

    const normalizeOrder = (o: Record<string, unknown>) => ({
      orderId: String(o["order_id"] ?? ""),
      side: String(o["ft_order_side"] ?? o["side"] ?? ""),
      type: optStr(o["order_type"]),
      status: optStr(o["status"]),
      amount: optNum(o["amount"]),
      price: optNum(o["safe_price"] ?? o["price"] ?? o["average"]),
      cost: optNum(o["cost"]),
      filled: optNum(o["filled"]),
      remaining: optNum(o["remaining"]),
      isOpen:
        typeof o["is_open"] === "boolean"
          ? (o["is_open"] as boolean)
          : undefined,
      isEntry:
        typeof o["ft_is_entry"] === "boolean"
          ? (o["ft_is_entry"] as boolean)
          : undefined,
      tag: optStr(o["ft_order_tag"]),
      timestamp: optNum(o["order_timestamp"]),
      filledTimestamp: optNum(o["order_filled_timestamp"]),
    });

    const normalizeOrders = (raw: unknown) =>
      Array.isArray(raw)
        ? (raw as Array<Record<string, unknown>>).map(normalizeOrder)
        : [];

    const client: FreqtradeClientService = {
      ping: () =>
        getJson("/api/v1/ping", "ping").pipe(
          Effect.map((body) => ({
            status: (body as { status?: string })?.status ?? "pong",
          })),
        ),
      getVersion: () =>
        getJson("/api/v1/version", "version").pipe(
          Effect.map((body) => ({
            version: String(
              (body as { version?: unknown })?.version ?? "unknown",
            ),
          })),
        ),
      getStatus: () =>
        getJson("/api/v1/show_config", "status").pipe(
          Effect.map((body) => {
            const raw = (body ?? {}) as Record<string, unknown>;
            return {
              state:
                typeof raw["state"] === "string" ? raw["state"] : "unknown",
              strategy:
                typeof raw["strategy"] === "string"
                  ? raw["strategy"]
                  : undefined,
              exchange:
                typeof raw["exchange"] === "string"
                  ? raw["exchange"]
                  : undefined,
              stakeCurrency:
                typeof raw["stake_currency"] === "string"
                  ? raw["stake_currency"]
                  : undefined,
              dryRun:
                typeof raw["dry_run"] === "boolean"
                  ? raw["dry_run"]
                  : undefined,
              tradingMode:
                typeof raw["trading_mode"] === "string"
                  ? raw["trading_mode"]
                  : undefined,
            } satisfies BotStatus;
          }),
        ),
      getBalance: () =>
        getJson("/api/v1/balance", "balance").pipe(
          Effect.map((body) => {
            const raw = (body ?? {}) as Record<string, unknown>;
            const currencies = Array.isArray(raw["currencies"])
              ? (raw["currencies"] as Array<Record<string, unknown>>).map(
                  (c) => ({
                    currency: String(c["currency"] ?? c["code"] ?? "UNKNOWN"),
                    free: num(c["free"]),
                    used: num(c["used"] ?? c["used_balance"]),
                    total: num(c["balance"] ?? c["total"]),
                  }),
                )
              : [];
            return {
              stakeCurrency:
                typeof raw["stake"] === "string" ? raw["stake"] : "USDT",
              totalStake: num(raw["total"] ?? raw["value"]),
              startingCapital: optNum(raw["starting_capital"]),
              currencies,
              note: typeof raw["note"] === "string" ? raw["note"] : undefined,
            } satisfies BalanceResponse;
          }),
        ),
      getProfit: () =>
        getJson("/api/v1/profit", "profit").pipe(
          Effect.map((body) => {
            const raw = (body ?? {}) as Record<string, unknown>;
            return {
              profitClosedCoin: num(raw["profit_closed_coin"]),
              profitClosedPercent:
                num(
                  raw["profit_closed_ratio"] ?? raw["profit_closed_percent"],
                ) * 100,
              profitClosedFiat: num(raw["profit_closed_fiat"]),
              profitAllCoin: num(raw["profit_all_coin"]),
              profitAllPercent:
                num(raw["profit_all_ratio"] ?? raw["profit_all_percent"]) * 100,
              profitAllFiat: num(raw["profit_all_fiat"]),
              tradeCount: num(raw["trade_count"]),
              closedTradeCount: num(raw["closed_trade_count"]),
              winningTrades: num(raw["winning_trades"]),
              losingTrades: num(raw["losing_trades"]),
              stakeCurrency:
                typeof raw["stake_currency"] === "string"
                  ? raw["stake_currency"]
                  : "USDT",
              fiatCurrency:
                typeof raw["fiat_display_currency"] === "string"
                  ? raw["fiat_display_currency"]
                  : "USD",
            } satisfies ProfitSummary;
          }),
        ),
      getOpenTrades: () =>
        getJson("/api/v1/status", "trades").pipe(
          Effect.map((body) => {
            const list = Array.isArray(body) ? body : [];
            return {
              trades: (list as Array<Record<string, unknown>>).map(
                (t, index) => ({
                  tradeId:
                    typeof t["trade_id"] === "number" ? t["trade_id"] : index,
                  pair: typeof t["pair"] === "string" ? t["pair"] : "UNKNOWN",
                  isOpen: t["is_open"] !== false,
                  exchange:
                    typeof t["exchange"] === "string"
                      ? t["exchange"]
                      : undefined,
                  amount: num(t["amount"]),
                  stakeAmount: num(t["stake_amount"]),
                  openRate: num(t["open_rate"]),
                  currentRate:
                    typeof t["current_rate"] === "number"
                      ? t["current_rate"]
                      : undefined,
                  profitAbs:
                    typeof t["profit_abs"] === "number"
                      ? t["profit_abs"]
                      : undefined,
                  profitPct:
                    typeof t["profit_ratio"] === "number"
                      ? t["profit_ratio"] * 100
                      : typeof t["profit_pct"] === "number"
                        ? t["profit_pct"]
                        : undefined,
                  openDate:
                    typeof t["open_date"] === "string"
                      ? t["open_date"]
                      : new Date().toISOString(),
                  strategy:
                    typeof t["strategy"] === "string"
                      ? t["strategy"]
                      : undefined,
                  timeframe:
                    typeof t["timeframe"] === "string"
                      ? t["timeframe"]
                      : String(t["timeframe"] ?? ""),
                }),
              ),
            } satisfies OpenTradesResponse;
          }),
        ),
      getOpenPositions: () =>
        getJson("/api/v1/status", "open-positions").pipe(
          Effect.map((body) => {
            const list = Array.isArray(body) ? body : [];
            return {
              positions: (list as Array<Record<string, unknown>>).map(
                (t, index) => ({
                  tradeId:
                    typeof t["trade_id"] === "number" ? t["trade_id"] : index,
                  pair: typeof t["pair"] === "string" ? t["pair"] : "UNKNOWN",
                  isOpen: t["is_open"] !== false,
                  isShort:
                    typeof t["is_short"] === "boolean"
                      ? t["is_short"]
                      : undefined,
                  exchange: optStr(t["exchange"]),
                  amount: num(t["amount"]),
                  stakeAmount: num(t["stake_amount"]),
                  maxStakeAmount: optNum(t["max_stake_amount"]),
                  openRate: num(t["open_rate"]),
                  currentRate: optNum(t["current_rate"]),
                  profitAbs: optNum(t["profit_abs"]),
                  profitPct:
                    typeof t["profit_ratio"] === "number"
                      ? t["profit_ratio"] * 100
                      : optNum(t["profit_pct"]),
                  profitFiat: optNum(t["profit_fiat"]),
                  realizedProfit: optNum(t["realized_profit"]),
                  openDate: optStr(t["open_date"]) ?? new Date().toISOString(),
                  strategy: optStr(t["strategy"]),
                  timeframe:
                    t["timeframe"] !== undefined
                      ? String(t["timeframe"])
                      : undefined,
                  enterTag: optStr(t["enter_tag"]),
                  exitReason: optStr(t["exit_reason"]),
                  leverage: optNum(t["leverage"]),
                  liquidationPrice: optNum(t["liquidation_price"]),
                  fundingFees: optNum(t["funding_fees"]),
                  nrOfEntries: optNum(t["nr_of_successful_entries"]),
                  nrOfExits: optNum(t["nr_of_successful_exits"]),
                  hasOpenOrders:
                    typeof t["has_open_orders"] === "boolean"
                      ? t["has_open_orders"]
                      : undefined,
                  orders: normalizeOrders(t["orders"]),
                }),
              ),
            } satisfies OpenPositionsResponse;
          }),
        ),
      getClosedPositions: (limit = 50, offset = 0) =>
        getJson(
          `/api/v1/trades?limit=${limit}&offset=${offset}`,
          "closed-positions",
        ).pipe(
          Effect.map((body) => {
            const raw = (body ?? {}) as Record<string, unknown>;
            const list = Array.isArray(raw["trades"])
              ? (raw["trades"] as Array<Record<string, unknown>>)
              : [];
            return {
              positions: list
                .filter((t) => t["is_open"] === false)
                .map((t, index) => ({
                  tradeId:
                    typeof t["trade_id"] === "number" ? t["trade_id"] : index,
                  pair: typeof t["pair"] === "string" ? t["pair"] : "UNKNOWN",
                  isOpen: false,
                  isShort:
                    typeof t["is_short"] === "boolean"
                      ? t["is_short"]
                      : undefined,
                  exchange: optStr(t["exchange"]),
                  amount: num(t["amount"]),
                  stakeAmount: num(t["stake_amount"]),
                  openRate: num(t["open_rate"]),
                  closeRate: optNum(t["close_rate"]),
                  profitAbs: optNum(t["profit_abs"]),
                  profitPct: optNum(t["profit_pct"]),
                  closeProfitAbs: optNum(
                    t["close_profit_abs"] ?? t["profit_abs"],
                  ),
                  closeProfitPct: optNum(
                    t["close_profit_pct"] ?? t["profit_pct"],
                  ),
                  realizedProfit: optNum(t["realized_profit"]),
                  openDate: optStr(t["open_date"]) ?? new Date().toISOString(),
                  closeDate: optStr(t["close_date"]),
                  tradeDurationSeconds: optNum(t["trade_duration_s"]),
                  strategy: optStr(t["strategy"]),
                  timeframe:
                    t["timeframe"] !== undefined
                      ? String(t["timeframe"])
                      : undefined,
                  enterTag: optStr(t["enter_tag"]),
                  exitReason: optStr(t["exit_reason"]),
                  leverage: optNum(t["leverage"]),
                  fundingFees: optNum(t["funding_fees"]),
                  nrOfEntries: optNum(t["nr_of_successful_entries"]),
                  nrOfExits: optNum(t["nr_of_successful_exits"]),
                  orders: normalizeOrders(t["orders"]),
                })),
              tradesCount: optNum(raw["trades_count"]),
              totalTrades: optNum(raw["total_trades"]),
              offset: optNum(raw["offset"]) ?? offset,
            } satisfies ClosedPositionsResponse;
          }),
        ),
      getTagPerformance: (limit = 200, groupBy: TagGroupBy = "enter") =>
        getJson(`/api/v1/trades?limit=${limit}`, "tag-performance").pipe(
          Effect.map((body) => {
            const raw = (body ?? {}) as Record<string, unknown>;
            const list = Array.isArray(raw["trades"])
              ? (raw["trades"] as Array<Record<string, unknown>>)
              : [];
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
            for (const t of list) {
              if (t["is_open"] !== false) continue;
              const source =
                groupBy === "exit" ? t["exit_reason"] : t["enter_tag"];
              const tag =
                typeof source === "string" && source.trim().length > 0
                  ? source.trim()
                  : "unknown";
              const profitAbs =
                typeof t["close_profit_abs"] === "number"
                  ? t["close_profit_abs"]
                  : num(t["profit_abs"]);
              const profitPct =
                typeof t["close_profit_pct"] === "number"
                  ? t["close_profit_pct"]
                  : num(t["profit_pct"]);
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
              totalTrades: optNum(raw["total_trades"]),
            } satisfies TagPerformanceResponse;
          }),
        ),
      getCandles: (pair, timeframe = "15m", limit = 200) =>
        getJson(
          `/api/v1/pair_candles?pair=${encodeURIComponent(pair)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`,
          "candles",
        ).pipe(
          Effect.map(
            (body) =>
              ({
                pair,
                timeframe,
                candles: normalizeCandles(body),
              }) satisfies CandlesResponse,
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
        ).pipe(
          Effect.map((body) => {
            const raw = (body ?? {}) as Record<string, unknown>;
            const list = Array.isArray(raw["pairs"])
              ? raw["pairs"]
              : Array.isArray(body)
                ? body
                : [];
            const pairs = (list as unknown[]).filter(
              (p): p is string => typeof p === "string",
            );
            return {
              pairs,
              length: optNum(raw["length"]) ?? pairs.length,
              stakeCurrency: optStr(raw["stake_currency"]) ?? stakeCurrency,
            } satisfies AvailablePairsResponse;
          }),
        );
      },
      getWhitelist: () =>
        getJson("/api/v1/whitelist", "whitelist").pipe(
          Effect.map((body) => {
            const raw = (body ?? {}) as Record<string, unknown>;
            const list = raw["whitelist"];
            const pairs = Array.isArray(list)
              ? list.filter((p): p is string => typeof p === "string")
              : [];
            return { pairs };
          }),
        ),
      getPlotConfig: (strategy) => {
        const suffix = strategy
          ? `?strategy=${encodeURIComponent(strategy)}`
          : "";
        return getJson(`/api/v1/plot_config${suffix}`, "plot_config").pipe(
          Effect.map((body) => {
            const raw = (body ?? {}) as Record<string, unknown>;
            const main = raw["main_plot"];
            const mainPlot =
              typeof main === "object" && main !== null
                ? Object.keys(main as Record<string, unknown>)
                : [];
            const subs = raw["subplots"];
            const subplots: Record<string, string[]> = {};
            if (typeof subs === "object" && subs !== null) {
              for (const [name, config] of Object.entries(
                subs as Record<string, unknown>,
              )) {
                subplots[name] =
                  typeof config === "object" && config !== null
                    ? Object.keys(config as Record<string, unknown>)
                    : [];
              }
            }
            return {
              strategy,
              mainPlot,
              subplots,
            } satisfies PlotConfigResponse;
          }),
        );
      },
      getConfig: () =>
        getJson("/api/v1/show_config", "show_config").pipe(
          Effect.map((body) => {
            const raw = (body ?? {}) as Record<string, unknown>;
            return {
              strategy:
                typeof raw["strategy"] === "string"
                  ? raw["strategy"]
                  : undefined,
              exchange:
                typeof raw["exchange"] === "string"
                  ? raw["exchange"]
                  : typeof (
                        raw["exchange"] as Record<string, unknown> | undefined
                      )?.["name"] === "string"
                    ? String(
                        (raw["exchange"] as Record<string, unknown>)["name"],
                      )
                    : undefined,
              stakeCurrency:
                typeof raw["stake_currency"] === "string"
                  ? raw["stake_currency"]
                  : undefined,
              stakeAmount: raw["stake_amount"],
              maxOpenTrades: raw["max_open_trades"],
              dryRun:
                typeof raw["dry_run"] === "boolean"
                  ? raw["dry_run"]
                  : undefined,
              tradingMode:
                typeof raw["trading_mode"] === "string"
                  ? raw["trading_mode"]
                  : undefined,
            } satisfies BotConfigSummary;
          }),
        ),
      getLocks: () =>
        getJson("/api/v1/locks", "locks").pipe(
          Effect.map((body) => {
            const list = Array.isArray(body)
              ? body
              : Array.isArray(
                    (body as Record<string, unknown> | undefined)?.["locks"],
                  )
                ? ((body as Record<string, unknown>)["locks"] as unknown[])
                : [];
            const locks = list
              .filter(
                (l): l is Record<string, unknown> =>
                  typeof l === "object" && l !== null,
              )
              .map((l, index) => ({
                id: typeof l["id"] === "number" ? l["id"] : index,
                pair: typeof l["pair"] === "string" ? l["pair"] : "UNKNOWN",
                lockTime: optStr(l["lock_time"]) ?? new Date().toISOString(),
                lockEndTime:
                  optStr(l["lock_end_time"]) ?? new Date().toISOString(),
                reason: optStr(l["reason"]) ?? "",
                active: l["active"] !== false,
                side: optStr(l["side"]),
              }));
            return { locks } satisfies LocksResponse;
          }),
        ),
      getBlacklist: () =>
        getJson("/api/v1/blacklist", "blacklist").pipe(
          Effect.map((body) => {
            const raw = (body ?? {}) as Record<string, unknown>;
            const list = Array.isArray(raw["blacklist"])
              ? (raw["blacklist"] as unknown[])
              : [];
            const pairs = list
              .map((entry): { pair: string; reason?: string } => {
                if (typeof entry === "string") return { pair: entry };
                if (typeof entry === "object" && entry !== null) {
                  const record = entry as Record<string, unknown>;
                  const pair =
                    typeof record["pair"] === "string"
                      ? record["pair"]
                      : String(entry);
                  const reason = optStr(record["reason"]);
                  return reason !== undefined ? { pair, reason } : { pair };
                }
                return { pair: String(entry) };
              })
              .filter((entry) => entry.pair.length > 0);
            return {
              pairs,
              length: optNum(raw["length"]) ?? pairs.length,
            } satisfies BlacklistResponse;
          }),
        ),
      getTradeCount: () =>
        getJson("/api/v1/count", "count").pipe(
          Effect.map((body) => {
            const raw = (body ?? {}) as Record<string, unknown>;
            const max = optNum(raw["max"]);
            return {
              current: num(raw["current"]),
              ...(max !== undefined ? { max } : {}),
            } satisfies TradeCountResponse;
          }),
        ),
      getProfitBuckets: (bucket: ProfitBucketKind = "daily", timescale = 30) =>
        getJson(
          `/api/v1/${bucket}?timescale=${timescale}`,
          `${bucket}-profit`,
        ).pipe(
          Effect.map((body) => {
            const raw = (body ?? {}) as Record<string, unknown>;
            const list = Array.isArray(raw["data"])
              ? (raw["data"] as Array<Record<string, unknown>>)
              : [];
            const buckets = list.map((entry) => ({
              date: optStr(entry["date"]) ?? "",
              profitAbs: num(entry["abs_profit"]),
              // freqtrade rel_profit is a fraction (0.01 = 1%).
              profitRel: num(entry["rel_profit"]),
              profitFiat: num(entry["fiat_value"]),
              trades: num(entry["trade_count"]),
            }));
            return { bucket, buckets } satisfies ProfitBucketsResponse;
          }),
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
