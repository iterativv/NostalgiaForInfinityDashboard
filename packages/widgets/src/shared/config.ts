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

import { Schema } from "effect"

/** Config schema for widgets without settings (e.g. Bot Status). */
export const EmptyConfigSchema = Schema.Struct({})
export type EmptyConfig = typeof EmptyConfigSchema.Type

/** Optional boolean that decodes to `fallback` when absent. */
export const booleanWithDefault = (fallback: boolean) =>
  Schema.optionalWith(Schema.Boolean, { default: (): boolean => fallback })

/** Optional number that decodes to `fallback` when absent. */
export const numberWithDefault = (fallback: number) =>
  Schema.optionalWith(Schema.Number, { default: (): number => fallback })

/** Optional string that decodes to `fallback` when absent. */
export const stringWithDefault = (fallback: string) =>
  Schema.optionalWith(Schema.String, { default: (): string => fallback })

/**
 * Shared freqtrade-instance picker field for per-instance widget configs.
 * `default` is the implicit env-backed connection (`FREQTRADE_*`).
 */
export const InstanceIdField = stringWithDefault("default")
