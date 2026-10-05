// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { SqlClient, SqlError } from "@effect/sql";
import { Context, Effect, Layer } from "effect";

/**
 * Durable session storage (auth plane).
 *
 * ```text
 * sessions
 * -------------------
 * token_hash  TEXT PRIMARY KEY  -- sha256 hex of the opaque session token
 * user_id     TEXT NOT NULL       -- 'root' | 'usr-*' (never 'anonymous')
 * expires_at  INTEGER NOT NULL    -- unix epoch millis (sliding 7-day TTL)
 * ```
 *
 * Only the token HASH persists: a database dump never yields a live cookie,
 * and the raw token exists only in the browser's HttpOnly cookie and in
 * flight at mint time. Anonymous callers never mint rows — `resolveToken`
 * falls through to the anonymous grant without touching this table.
 *
 * Expiry is enforced on read; `sweepExpired` deletes dead rows
 * opportunistically at mint time so the table stays small without a timer.
 * A deleted user needs no explicit cleanup: resolution re-reads the user
 * row and unknown ids fall back to anonymous, while their orphaned rows
 * are swept once expired.
 */

export const migrateSessions: Effect.Effect<
  void,
  SqlError.SqlError,
  SqlClient.SqlClient
> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `;
  yield* sql`CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions (expires_at)`;
}).pipe(Effect.asVoid);

export interface StoredSession {
  readonly userId: string;
  readonly expiresAt: number;
}

export interface SessionRepoService {
  readonly createSession: (input: {
    readonly tokenHash: string;
    readonly userId: string;
    readonly expiresAt: number;
  }) => Effect.Effect<void, SqlError.SqlError>;
  readonly getSession: (
    tokenHash: string,
  ) => Effect.Effect<StoredSession | null, SqlError.SqlError>;
  /** Sliding-expiry extension (no-op when the row is already gone). */
  readonly touchSession: (
    tokenHash: string,
    expiresAt: number,
  ) => Effect.Effect<void, SqlError.SqlError>;
  /** Logout — deleting a missing token is a no-op. */
  readonly deleteSession: (
    tokenHash: string,
  ) => Effect.Effect<void, SqlError.SqlError>;
  readonly sweepExpired: (
    now: number,
  ) => Effect.Effect<void, SqlError.SqlError>;
}

export class SessionRepo extends Context.Tag("nfi/SessionRepo")<
  SessionRepo,
  SessionRepoService
>() {}

export const SessionRepoLive: Layer.Layer<
  SessionRepo,
  never,
  SqlClient.SqlClient
> = Layer.effect(
  SessionRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    return {
      createSession: (input) =>
        Effect.gen(function* () {
          yield* sql`
            INSERT INTO sessions (token_hash, user_id, expires_at)
            VALUES (${input.tokenHash}, ${input.userId}, ${input.expiresAt})
          `;
        }).pipe(Effect.asVoid),

      getSession: (tokenHash) =>
        Effect.gen(function* () {
          const rows =
            yield* sql`SELECT user_id AS userId, expires_at AS expiresAt FROM sessions WHERE token_hash = ${tokenHash} LIMIT 1`;

          const raw = rows[0];

          if (raw === undefined) return null;

          return {
            userId: String(raw["userId"] ?? ""),
            expiresAt: Number(raw["expiresAt"] ?? 0),
          } satisfies StoredSession;
        }),

      touchSession: (tokenHash, expiresAt) =>
        Effect.gen(function* () {
          yield* sql`UPDATE sessions SET expires_at = ${expiresAt} WHERE token_hash = ${tokenHash}`;
        }).pipe(Effect.asVoid),

      deleteSession: (tokenHash) =>
        Effect.gen(function* () {
          yield* sql`DELETE FROM sessions WHERE token_hash = ${tokenHash}`;
        }).pipe(Effect.asVoid),

      sweepExpired: (now) =>
        Effect.gen(function* () {
          yield* sql`DELETE FROM sessions WHERE expires_at <= ${now}`;
        }).pipe(Effect.asVoid),
    } satisfies SessionRepoService;
  }),
);
