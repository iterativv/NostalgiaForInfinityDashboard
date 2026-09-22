// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { SqlClient, SqlError } from "@effect/sql";
import { Context, Effect, Layer } from "effect";

/**
 * Durable app settings (key → JSON value).
 *
 * Schema (see `migrateSettings`):
 *
 * ```text
 * app_settings
 * ------------
 * key         TEXT PRIMARY KEY
 * value       TEXT NOT NULL   -- JSON document
 * updated_at  TEXT NOT NULL
 * ```
 *
 * Today this stores the root-configured sensitivity criteria
 * (`sensitive-info-kinds`, an array of `InfoKind`). Values are opaque JSON
 * strings here — the server decodes through the contract schema at the
 * trust boundary, exactly like every other stored document.
 */

export const migrateSettings: Effect.Effect<
  void,
  SqlError.SqlError,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `;
}).pipe(Effect.asVoid);

export interface SettingsRepoService {
  /** Stored JSON document for the key, or null when never saved. */
  readonly getSetting: (
    key: string,
  ) => Effect.Effect<string | null, SqlError.SqlError>;
  /** Upsert the JSON document for the key. */
  readonly saveSetting: (
    key: string,
    value: string,
  ) => Effect.Effect<void, SqlError.SqlError>;
}

export class SettingsRepo extends Context.Tag("nfi/SettingsRepo")<
  SettingsRepo,
  SettingsRepoService
>() {}

export const SettingsRepoLive: Layer.Layer<
  SettingsRepo,
  never,
  SqlClient.SqlClient
> = Layer.effect(
  SettingsRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return {
      getSetting: (key) =>
        Effect.gen(function* () {
          const rows =
            yield* sql`SELECT value FROM app_settings WHERE key = ${key}`;
          const row = (rows as ReadonlyArray<{ value: string }>)[0];
          return row?.value ?? null;
        }),
      saveSetting: (key, value) =>
        Effect.gen(function* () {
          const now = new Date().toISOString();
          yield* sql`
            INSERT INTO app_settings (key, value, updated_at)
            VALUES (${key}, ${value}, ${now})
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
          `;
        }).pipe(Effect.asVoid),
    } satisfies SettingsRepoService;
  }),
);
