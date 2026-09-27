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
import { InstancesBlacklistAllCapability } from "./instances-blacklist-all.js";
import { InstancesClosedAllCapability } from "./instances-closed-all.js";
import { InstancesConfigCapability } from "./instances-config.js";
import { InstancesLocksCapability } from "./instances-locks.js";
import { InstancesLocksAllCapability } from "./instances-locks-all.js";
import { InstancesOverviewCapability } from "./instances-overview.js";
import { InstancesPositionsAllCapability } from "./instances-positions-all.js";
import { InstancesProfitDailyAllCapability } from "./instances-profit-daily-all.js";
import { InstancesProfitDailyCapability } from "./instances-profit-daily.js";
import { InstancesProfitHistoryCapability } from "./instances-profit-history.js";
import { InstancesProfitHistoryAllCapability } from "./instances-profit-history-all.js";
import { InstancesProfitHistoryAllRelativeCapability } from "./instances-profit-history-all-relative.js";
import { InstancesTradeCountCapability } from "./instances-trade-count.js";
import { InstancesWhitelistCapability } from "./instances-whitelist.js";
import { InstancesWhitelistAllCapability } from "./instances-whitelist-all.js";
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
import { InstancesTagPerformanceAllCapability } from "./instances-tag-performance-all.js";
import { InstancesTagPerformanceRelativeCapability } from "./instances-tag-performance-relative.js";
import { InstancesUpdateCapability } from "./instances-update.js";
import { SystemBackendConfigCapability } from "./system-backend-config.js";
import { SystemHealthCapability } from "./system-health.js";
import { SystemPageDefaultsCapability } from "./system-page-defaults.js";
import { SystemPageDefaultsUpdateCapability } from "./system-page-defaults-update.js";
import { MacroFedRateCapability } from "./macro-fed-rate.js";
import { WorkspaceCreateCapability } from "./workspace-create.js";
import { WorkspaceListCapability } from "./workspace-list.js";
import { WorkspaceLoadCapability } from "./workspace-load.js";
import { WorkspaceRemoveCapability } from "./workspace-remove.js";
import { WorkspaceSaveCapability } from "./workspace-save.js";
import { toBackendError } from "./errors.js";
import {
  decodeJsonValue,
  type CapabilityContext,
  type CapabilityDef,
  type CapabilityError,
  isJsonObject,
  type JsonValue,
  type Principal,
  principalCanUse,
} from "./definition.js";

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
  "system.page-defaults": SystemPageDefaultsCapability,
  "system.page-defaults.update": SystemPageDefaultsUpdateCapability,
  "macro.fed-rate": MacroFedRateCapability,
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
  "instances.tag-performance-all": InstancesTagPerformanceAllCapability,
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
  "instances.locks-all": InstancesLocksAllCapability,
  "instances.blacklist-all": InstancesBlacklistAllCapability,
  "instances.whitelist-all": InstancesWhitelistAllCapability,
  "instances.trade-count": InstancesTradeCountCapability,
  "instances.profit-daily": InstancesProfitDailyCapability,
  "instances.profit-history": InstancesProfitHistoryCapability,
  "instances.profit-history-all": InstancesProfitHistoryAllCapability,
  "instances.overview": InstancesOverviewCapability,
  "instances.positions-all": InstancesPositionsAllCapability,
  "instances.closed-all": InstancesClosedAllCapability,
  "instances.profit-daily-all": InstancesProfitDailyAllCapability,
  "instances.balance-history": InstancesBalanceHistoryAllCapability,
  "instances.balance-history.relative":
    InstancesBalanceHistoryAllRelativeCapability,
  "instances.profit-history-all.relative":
    InstancesProfitHistoryAllRelativeCapability,
  "users.list": UsersListCapability,
  "users.create": UsersCreateCapability,
  "users.update": UsersUpdateCapability,
  "users.remove": UsersRemoveCapability,
  "auth.capabilities": AuthCapabilitiesCapability,
} as const satisfies Record<Capability, ErasedCapabilityDef>;

/**
 * The erasure every registry entry is satisfies-checked against: option and
 * result types reduced to their widest form so heterogeneous `CapabilityDef`s
 * sit in one Record. `defFor` re-narrows an entry to its exact per-id type.
 */
type ErasedCapabilityDef = CapabilityDef<string, any, any>;

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
// SAFETY: `Object.keys` types its result as `string[]`, but the registry
// literal is `satisfies Record<Capability, ...>` (with the vocabulary proof
// above), so its keys are exactly the `CapabilityName` union.
export const ALL_CAPABILITY_NAMES: ReadonlyArray<CapabilityName> = Object.keys(
  CAPABILITY_REGISTRY,
) as ReadonlyArray<CapabilityName>;

/** Runtime guard — never trust a capability string from the wire. */
export const isCapabilityName = (
  value: string | undefined,
): value is CapabilityName =>
  value !== undefined && value in CAPABILITY_REGISTRY;

/**
 * Authorization check for a RAW (unvalidated) capability id from the wire:
 * unknown ids are never grantable, so they fail closed — root/system keep
 * passing only for ids the registry actually knows.
 */
export const principalCanUseId = (principal: Principal, id: string): boolean =>
  isCapabilityName(id) ? principalCanUse(principal, id) : false;

/**
 * The registry entry for a generic id, viewed as its per-id def type.
 *
 * One central, documented lookup so the generic accessors below
 * (`decodeCapabilityOptions`, `decodeCapabilityResult`, `runCapability`)
 * stay assertion-free.
 */
const defFor = <N extends CapabilityName>(
  name: N,
): CapabilityDef<N, CapabilityOptions<N>, CapabilityResult<N>> => {
  const entry: ErasedCapabilityDef = CAPABILITY_REGISTRY[name];

  // SAFETY: the registry literal is `satisfies Record<Capability,
  // ErasedCapabilityDef>` and the compile-time vocabulary proof above
  // guarantees the entry at `N` is exactly `CapabilityDef<N,
  // CapabilityOptions<N>, CapabilityResult<N>>` — TypeScript cannot verify
  // this conditional-type correspondence for a generic `N`.
  return entry as CapabilityDef<N, CapabilityOptions<N>, CapabilityResult<N>>;
};

/** Strictly decode options for one capability (throws on invalid input). */
export const decodeCapabilityOptions = <N extends CapabilityName>(
  name: N,
  value: JsonValue,
): CapabilityOptions<N> =>
  Schema.decodeUnknownSync(defFor(name).optionsSchema)(value);

/** Strictly decode a result for one capability (throws on contract drift). */
export const decodeCapabilityResult = <N extends CapabilityName, V>(
  name: N,
  value: V,
): CapabilityResult<N> =>
  Schema.decodeUnknownSync(defFor(name).resultSchema)(value);

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
): Effect.Effect<CapabilityResult<N>, CapabilityError> =>
  defFor(name).run(options, ctx);

// ---------------------------------------------------------------------------
// Stream addressing (shared by the SSE server and the web client)
// ---------------------------------------------------------------------------

const stableStringify = <V>(value: V): string => {
  if (value === null || value === undefined) return "null";

  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

  if (isJsonObject(value)) {
    const entries = Object.entries(value)
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
export const encodeStreamOptions = <N extends CapabilityName>(
  name: N,
  options: CapabilityOptions<N>,
): string => textToB64Url(JSON.stringify(options ?? {}));

/** Path (same-origin) for subscribing to one capability over SSE. */
export const streamPath = <N extends CapabilityName>(
  name: N,
  options: CapabilityOptions<N>,
): string =>
  `/api/stream?capability=${encodeURIComponent(name)}&options=${encodeStreamOptions(name, options)}`;

export interface ParsedStreamRequest {
  readonly name: CapabilityName;
  readonly options: JsonValue;
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

    let json: JsonValue = {};

    if (optionsRaw !== undefined && optionsRaw.length > 0) {
      try {
        json = decodeJsonValue(b64UrlToText(optionsRaw));
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

    // SAFETY: decodeCapabilityOptions just validated the options against
    // the capability's own schema, so the decoded value is a JsonValue.
    return {
      name: capability,
      options: options as JsonValue,
    } satisfies ParsedStreamRequest;
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
