// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Shared widget-config schema primitives.
 *
 * Widget configs are validated Effect Schemas (see `defineWidget` in
 * `@nfi/widget-sdk`): persisted panel configs may be partial (older
 * versions), so every field carries a decoding default via
 * `Schema.optionalWith`. After `decodeConfig`, components always receive a
 * fully-resolved config — no manual `resolve*` merging, no `Partial` types.
 */

import { Schema } from "effect";

/** Config schema for widgets without settings (e.g. Bot Status). */
export const EmptyConfigSchema = Schema.Struct({});

export type EmptyConfig = typeof EmptyConfigSchema.Type;

/** Optional boolean that decodes to `fallback` when absent. */
export const booleanWithDefault = (fallback: boolean) =>
  Schema.optionalWith(Schema.Boolean, { default: (): boolean => fallback });

/** Optional number that decodes to `fallback` when absent. */
export const numberWithDefault = (fallback: number) =>
  Schema.optionalWith(Schema.Number, { default: (): number => fallback });

/** Optional string that decodes to `fallback` when absent. */
export const stringWithDefault = (fallback: string) =>
  Schema.optionalWith(Schema.String, { default: (): string => fallback });

/** Schema-decoded guard for raw numeric setting values (configs, inputs). */
export const isConfigNumber = Schema.is(Schema.Number);

/**
 * Single-key settings patch for a computed config key. TypeScript widens
 * computed-key object literals (`{ [key]: value }`) to a string index and
 * cannot express that the result is exactly `Pick<C, K>`; this helper owns
 * that contract once for every settings-form toggle loop.
 */
export const settingPatch = <C extends object, K extends keyof C & string>(
  key: K,
  value: C[K],
): Pick<C, K> => {
  // SAFETY: `{ [key]: value }` with `key: K` and `value: C[K]` is, at
  // runtime, precisely the single-property `Pick<C, K>` object — the
  // assertion only restores the computed-key type TypeScript cannot spell.
  return { [key]: value } as Pick<C, K>;
};

/**
 * Shared freqtrade-instance picker field for per-instance widget configs.
 * `default` is the implicit env-backed connection (`FREQTRADE_*`).
 */
export const InstanceIdField = stringWithDefault("default");
