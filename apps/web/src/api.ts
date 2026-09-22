// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { FetchHttpClient, HttpApiClient } from "@effect/platform"
import { QueryClient } from "@tanstack/react-query"
import { Effect, Layer } from "effect"
import { NfiApi, type NfiApiClient } from "@nfi/api-contract"
import { prefsStore } from "./store"

/**
 * Data-access layer for the web shell, baked by Effect-TS.
 *
 * Every reader below runs through `HttpApiClient` derived from the shared
 * `NfiApi` contract (`@nfi/api-contract`) over the browser `fetch` stack —
 * the same definition the server implements with `HttpApiBuilder`. Paths,
 * methods, success/error schemas and status codes are shared, so frontend
 * and backend drift is a compile error.
 *
 * Nothing here references freqtrade: `baseUrl` always points at OUR backend
 * (same-origin by default so the Vite `/api` proxy is used in dev).
 *
 * Live data flows through capabilities (`./capabilities/live.ts`):
 * `useCapability` seeds from `callCapability` and renders snapshots pushed
 * over SSE into a TanStack Store. There is intentionally NO polling helper
 * in this file — the only interval in the system ticks between the backend
 * and freqtrade. What remains here is the unary transport (`runApi`),
 * mutations, and the `QueryClient` provider instance.
 */

export function resolveApiBaseUrl(): string {
  return prefsStore.state.apiBaseUrl.trim().replace(/\/$/, "")
}

const makeClient = () =>
  HttpApiClient.make(NfiApi, {
    baseUrl: resolveApiBaseUrl() === "" ? undefined : resolveApiBaseUrl(),
  })

// Always send the session cookie, including when the backend lives on
// another origin (custom base URL) — the backend's CORS layer allows
// credentials for the configured origins.
const FetchWithCredentials = Layer.merge(
  FetchHttpClient.layer,
  Layer.succeed(FetchHttpClient.RequestInit, { credentials: "include" }),
)

/** Run one contract call against the backend and return a plain promise. */
export function runApi<A, E>(call: (client: NfiApiClient) => Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(
    Effect.flatMap(makeClient(), call).pipe(Effect.provide(FetchWithCredentials)),
  )
}

/**
 * Contract-error formatting lives in `@nfi/api-contract` now (the widgets
 * package needs it without depending on the app shell); re-exported here so
 * existing app imports keep working.
 */
export { formatQueryError } from "@nfi/api-contract";

export async function createInstance(input: { name: string; baseUrl: string; username: string; password: string }) {
  return runApi((client) => client.Instances.create({ payload: input }))
}

export async function updateInstance(
  id: string,
  input: { name?: string; baseUrl?: string; username?: string; password?: string },
) {
  return runApi((client) => client.Instances.update({ path: { id }, payload: input }))
}

export async function deleteInstance(id: string) {
  return runApi((client) => client.Instances.remove({ path: { id } }))
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})
