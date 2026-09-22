// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect, Schema } from "effect";
import type { BackendError, Capability } from "@nfi/api-contract";
import { AuthCapabilitiesCapability } from "./auth-capabilities.js";
import { UsersCreateCapability } from "./users-create.js";
import { UsersListCapability } from "./users-list.js";
import { UsersRemoveCapability } from "./users-remove.js";
import { UsersUpdateCapability } from "./users-update.js";
import { BotBalanceHistoryCapability } from "./bot-balance-history.js";
import { BotBalanceHistoryRelativeCapability } from "./bot-balance-history-relative.js";
import { BotBalanceCapability } from "./bot-balance.js";
import { BotBalanceRelativeCapability } from "./bot-balance-relative.js";
import { BotConfigCapability } from "./bot-config.js";
import { BotProfitHistoryCapability } from "./bot-profit-history.js";
import { BotProfitHistoryRelativeCapability } from "./bot-profit-history-relative.js";
import { BotProfitCapability } from "./bot-profit.js";
import { BotProfitRelativeCapability } from "./bot-profit-relative.js";
import { BotStatusCapability } from "./bot-status.js";
import { BotTradesCapability } from "./bot-trades.js";
import { BotTradesRelativeCapability } from "./bot-trades-relative.js";
import { InstancesBalanceCapability } from "./instances-balance.js";
import { InstancesBalanceRelativeCapability } from "./instances-balance-relative.js";
import { InstancesBalanceHistoryAllCapability } from "./instances-balance-history-all.js";
import { InstancesBalanceHistoryAllRelativeCapability } from "./instances-balance-history-all-relative.js";
import { InstancesBlacklistCapability } from "./instances-blacklist.js";
import { InstancesClosedAllCapability } from "./instances-closed-all.js";
import { InstancesConfigCapability } from "./instances-config.js";
import { InstancesLocksCapability } from "./instances-locks.js";
import { InstancesOverviewCapability } from "./instances-overview.js";
import { InstancesPositionsAllCapability } from "./instances-positions-all.js";
import { InstancesProfitDailyAllCapability } from "./instances-profit-daily-all.js";
import { InstancesProfitDailyCapability } from "./instances-profit-daily.js";
import { InstancesProfitHistoryCapability } from "./instances-profit-history.js";
import { InstancesTradeCountCapability } from "./instances-trade-count.js";
import { InstancesWhitelistCapability } from "./instances-whitelist.js";
import { InstancesCandlesCapability } from "./instances-candles.js";
import { InstancesClosedPositionsCapability } from "./instances-closed-positions.js";
import { InstancesClosedPositionsRelativeCapability } from "./instances-closed-positions-relative.js";
import { InstancesCreateCapability } from "./instances-create.js";
import { InstancesHealthCapability } from "./instances-health.js";
import { InstancesListCapability } from "./instances-list.js";
import { InstancesOpenPositionsCapability } from "./instances-open-positions.js";
import { InstancesOpenPositionsRelativeCapability } from "./instances-open-positions-relative.js";
import { InstancesPairsCapability } from "./instances-pairs.js";
import { InstancesPlotConfigCapability } from "./instances-plot-config.js";
import { InstancesProfitCapability } from "./instances-profit.js";
import { InstancesProfitRelativeCapability } from "./instances-profit-relative.js";
import { InstancesRemoveCapability } from "./instances-remove.js";
import { InstancesStatusCapability } from "./instances-status.js";
import { InstancesTagPerformanceCapability } from "./instances-tag-performance.js";
import { InstancesTagPerformanceRelativeCapability } from "./instances-tag-performance-relative.js";
import { InstancesUpdateCapability } from "./instances-update.js";
import { SystemBackendConfigCapability } from "./system-backend-config.js";
import { SystemHealthCapability } from "./system-health.js";
import { WorkspaceCreateCapability } from "./workspace-create.js";
import { WorkspaceListCapability } from "./workspace-list.js";
import { WorkspaceLoadCapability } from "./workspace-load.js";
import { WorkspaceRemoveCapability } from "./workspace-remove.js";
import { WorkspaceSaveCapability } from "./workspace-save.js";
import { toBackendError } from "./errors.js";
import { type CapabilityContext, type CapabilityDef, type CapabilityError } from "./definition.js";

/**
 * Capability registry — the single hard-coded map from id to definition.
 *
 * Typed `Record<Capability, ...>` against the `@nfi/api-contract` vocabulary:
 * adding an id to the union without its file (or vice versa) is a compile
 * error. This is what makes capability definition AND usage type-safe:
 * `callCapability` / `useCapability` / `runCapability` are generic over
 * `CapabilityName`, so options and results are inferred per id.
 */
export const CAPABILITY_REGISTRY = {
  "system.health": SystemHealthCapability,
  "system.backend-config": SystemBackendConfigCapability,
  "bot.status": BotStatusCapability,
  "bot.balance": BotBalanceCapability,
  "bot.profit": BotProfitCapability,
  "bot.trades": BotTradesCapability,
  "bot.config": BotConfigCapability,
  "bot.profit-history": BotProfitHistoryCapability,
  "bot.balance-history": BotBalanceHistoryCapability,
  "bot.balance.relative": BotBalanceRelativeCapability,
  "bot.profit.relative": BotProfitRelativeCapability,
  "bot.trades.relative": BotTradesRelativeCapability,
  "bot.profit-history.relative": BotProfitHistoryRelativeCapability,
  "bot.balance-history.relative": BotBalanceHistoryRelativeCapability,
  "workspace.list": WorkspaceListCapability,
  "workspace.load": WorkspaceLoadCapability,
  "workspace.save": WorkspaceSaveCapability,
  "workspace.create": WorkspaceCreateCapability,
  "workspace.remove": WorkspaceRemoveCapability,
  "instances.list": InstancesListCapability,
  "instances.create": InstancesCreateCapability,
  "instances.update": InstancesUpdateCapability,
  "instances.remove": InstancesRemoveCapability,
  "instances.health": InstancesHealthCapability,
  "instances.status": InstancesStatusCapability,
  "instances.balance": InstancesBalanceCapability,
  "instances.profit": InstancesProfitCapability,
  "instances.open-positions": InstancesOpenPositionsCapability,
  "instances.closed-positions": InstancesClosedPositionsCapability,
  "instances.tag-performance": InstancesTagPerformanceCapability,
  "instances.pairs": InstancesPairsCapability,
  "instances.candles": InstancesCandlesCapability,
  "instances.plot-config": InstancesPlotConfigCapability,
  "instances.balance.relative": InstancesBalanceRelativeCapability,
  "instances.profit.relative": InstancesProfitRelativeCapability,
  "instances.open-positions.relative": InstancesOpenPositionsRelativeCapability,
  "instances.closed-positions.relative":
    InstancesClosedPositionsRelativeCapability,
  "instances.tag-performance.relative":
    InstancesTagPerformanceRelativeCapability,
  "instances.config": InstancesConfigCapability,
  "instances.locks": InstancesLocksCapability,
  "instances.blacklist": InstancesBlacklistCapability,
  "instances.whitelist": InstancesWhitelistCapability,
  "instances.trade-count": InstancesTradeCountCapability,
  "instances.profit-daily": InstancesProfitDailyCapability,
  "instances.profit-history": InstancesProfitHistoryCapability,
  "instances.overview": InstancesOverviewCapability,
  "instances.positions-all": InstancesPositionsAllCapability,
  "instances.closed-all": InstancesClosedAllCapability,
  "instances.profit-daily-all": InstancesProfitDailyAllCapability,
  "instances.balance-history": InstancesBalanceHistoryAllCapability,
  "instances.balance-history.relative":
    InstancesBalanceHistoryAllRelativeCapability,
  "users.list": UsersListCapability,
  "users.create": UsersCreateCapability,
  "users.update": UsersUpdateCapability,
  "users.remove": UsersRemoveCapability,
  "auth.capabilities": AuthCapabilitiesCapability,
} as const satisfies Record<Capability, CapabilityDef<string, any, any>>;

export type CapabilityName = keyof typeof CAPABILITY_REGISTRY;

// Compile-time proof that the registry covers the wire vocabulary exactly.
type _RegistryCoversVocabulary = [Capability] extends [CapabilityName]
  ? [CapabilityName] extends [Capability]
    ? true
    : never
  : never;
const _registryCoversVocabulary: _RegistryCoversVocabulary = true;
void _registryCoversVocabulary;

/** Options for one capability id (inferred from its option schema). */
export type CapabilityOptions<N extends CapabilityName> =
  (typeof CAPABILITY_REGISTRY)[N] extends {
    optionsSchema: Schema.Schema<infer O, any, any>;
  }
    ? O
    : never;

/** Result for one capability id (inferred from its result schema). */
export type CapabilityResult<N extends CapabilityName> =
  (typeof CAPABILITY_REGISTRY)[N] extends {
    resultSchema: Schema.Schema<infer R, any, any>;
  }
    ? R
    : never;

/** Every known capability id (open-mode grant). */
export const ALL_CAPABILITY_NAMES: ReadonlyArray<CapabilityName> = Object.keys(
  CAPABILITY_REGISTRY,
) as ReadonlyArray<CapabilityName>;

/** Runtime guard — never trust a capability string from the wire. */
export const isCapabilityName = (value: unknown): value is CapabilityName =>
  typeof value === "string" && (value as string) in CAPABILITY_REGISTRY;

/** Strictly decode options for one capability (throws on invalid input). */
export const decodeCapabilityOptions = <N extends CapabilityName>(
  name: N,
  value: unknown,
): CapabilityOptions<N> =>
  Schema.decodeUnknownSync(
    CAPABILITY_REGISTRY[name].optionsSchema as unknown as Schema.Schema<
      CapabilityOptions<N>,
      any
    >,
  )(value);

/** Strictly decode a result for one capability (throws on contract drift). */
export const decodeCapabilityResult = <N extends CapabilityName>(
  name: N,
  value: unknown,
): CapabilityResult<N> =>
  Schema.decodeUnknownSync(
    CAPABILITY_REGISTRY[name].resultSchema as unknown as Schema.Schema<
      CapabilityResult<N>,
      any
    >,
  )(value);

/**
 * Type-safe server dispatch: runs the capability for `name` with options
 * inferred for that id. Unknown ids cannot reach here (`isCapabilityName`
 * guards the stream + REST boundaries first). Authorization happens BEFORE
 * this at the HTTP boundary (`runCapabilityForHttp` in `apps/server`).
 */
export const runCapability = <N extends CapabilityName>(
  name: N,
  options: CapabilityOptions<N>,
  ctx: CapabilityContext,
): Effect.Effect<CapabilityResult<N>, CapabilityError> => {
  const def = CAPABILITY_REGISTRY[name] as unknown as CapabilityDef<
    N,
    CapabilityOptions<N>,
    CapabilityResult<N>
  >;
  return def.run(options, ctx);
};

// ---------------------------------------------------------------------------
// Stream addressing (shared by the SSE server and the web client)
// ---------------------------------------------------------------------------

const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

/** Stable cache/subscription key: `name + canonical options JSON`. */
export const capabilityKey = <N extends CapabilityName>(
  name: N,
  options: CapabilityOptions<N>,
): string => `${name}:${stableStringify(options)}`;

const textToB64Url = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
};

const b64UrlToText = (raw: string): string => {
  const padded = raw.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

/** Encode options for the `?options=` stream query parameter. */
export const encodeStreamOptions = (options: unknown): string =>
  textToB64Url(JSON.stringify(options ?? {}));

/** Path (same-origin) for subscribing to one capability over SSE. */
export const streamPath = <N extends CapabilityName>(
  name: N,
  options: CapabilityOptions<N>,
): string =>
  `/api/stream?capability=${encodeURIComponent(name)}&options=${encodeStreamOptions(options)}`;

export interface ParsedStreamRequest {
  readonly name: CapabilityName;
  readonly options: unknown;
}

const decodeOneStreamRequest = (
  capability: string | undefined,
  optionsRaw: string | undefined,
): Effect.Effect<ParsedStreamRequest, BackendError> =>
  Effect.gen(function* () {
    if (!isCapabilityName(capability)) {
      return yield* Effect.fail(
        toBackendError(
          "stream subscribe",
          `unknown capability: ${String(capability)}`,
        ),
      );
    }
    let json: unknown = {};
    if (optionsRaw !== undefined && optionsRaw.length > 0) {
      try {
        json = JSON.parse(b64UrlToText(optionsRaw)) as unknown;
      } catch {
        return yield* Effect.fail(
          toBackendError("stream subscribe", "undecodable options"),
        );
      }
    }
    const options = yield* Effect.try({
      try: () => decodeCapabilityOptions(capability, json),
      catch: (cause) => toBackendError("stream subscribe", cause),
    });
    return { name: capability, options } satisfies ParsedStreamRequest;
  });

/**
 * Validate a single stream subscription query (`?capability=<id>&options=<b64>`):
 * unknown capability or undecodable options fail with `BackendError` (the
 * SSE route maps this to 400/403 and closes the connection — no unvalidated
 * string ever reaches `run`).
 */
export const parseStreamRequest = (
  capability: string | undefined,
  optionsRaw: string | undefined,
): Effect.Effect<ParsedStreamRequest, BackendError> =>
  decodeOneStreamRequest(capability, optionsRaw);

/**
 * Validate a multiplexed stream subscription: repeated
 * `?capability=<id>&options=<b64>` pairs (paired by index). One connection
 * may carry any number of subscriptions; the empty list fails like an
 * unknown capability. Any invalid pair rejects the whole request — streams
 * are all-or-nothing so the client can rely on every requested key arriving.
 */
export const parseStreamRequests = (
  capabilities: ReadonlyArray<string | undefined>,
  optionsRaw: ReadonlyArray<string | undefined>,
): Effect.Effect<ReadonlyArray<ParsedStreamRequest>, BackendError> =>
  Effect.gen(function* () {
    if (capabilities.length === 0) {
      return yield* Effect.fail(
        toBackendError("stream subscribe", "no capability requested"),
      );
    }
    const parsed: ParsedStreamRequest[] = [];
    for (let i = 0; i < capabilities.length; i++) {
      parsed.push(
        yield* decodeOneStreamRequest(
          capabilities[i],
          optionsRaw[i] ?? undefined,
        ),
      );
    }
    return parsed;
  });
