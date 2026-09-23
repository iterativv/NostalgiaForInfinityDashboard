// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  Headers,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform";
import { toServerResponse } from "@effect/platform-node/NodeHttpServerRequest";
import { Duration, Effect, Stream } from "effect";
import {
  CAPABILITY_REGISTRY,
  parseStreamRequests,
  principalCanUse,
} from "@nfi/capabilities";
import { liveHub } from "./hub.js";
import { resolvePrincipalForRequest } from "../auth/session.js";

/**
 * `GET /api/stream?capability=<id>&options=<base64url-json>` — the continuous
 * stream every capability supports next to its unary REST call. The pair may
 * repeat any number of times: one connection multiplexes every requested
 * subscription (dense terminal pages otherwise blow past the browser's ~6
 * connections per host).
 *
 * - AUTHORIZATION: the caller (root | user | anonymous, resolved from the
 *   session cookie) must hold EVERY requested capability — one ungranted id
 *   rejects the whole subscription with 403. This is the SSE twin of
 *   `runCapabilityForHttp`; a REST grant check alone would leak data here.
 * - Every capability id is validated against the hard-coded registry
 *   (`isCapabilityName`); options are decoded through the capability's own
 *   schema. Anything else is a 400 and the connection closes — no
 *   unvalidated string ever reaches `run`. An invalid pair rejects the whole
 *   request so clients can rely on all-or-nothing delivery.
 * - Non-streamable capabilities (mutations, static config) are rejected: use
 *   their REST endpoint via `callCapability`.
 * - Events are `event: snapshot` with `{ capability, key, result, updatedAt
 *   }` JSON (one per subscribed key), plus `: ping` heartbeats. Keys stay
 *   tracked so the live poller (the only interval, backend <-> freqtrade)
 *   refreshes them; the frontend seeds first paint over REST and renders
 *   pushes from a TanStack Store — no frontend interval exists.
 */

const encoder = new TextEncoder();

const snapshotEvent = (
  capability: string,
  key: string,
  result: unknown,
  updatedAt: string,
): Uint8Array =>
  encoder.encode(
    `event: snapshot\ndata: ${JSON.stringify({ capability, key, result, updatedAt })}\n\n`,
  );

const HEARTBEAT = encoder.encode(": ping\n\n");
const HEARTBEAT_MS = 25_000;

/** Responses already wrapped by `hardenSseResponse` (idempotence). */
const hardenedResponses = new WeakSet<object>();

/**
 * Harden the raw node response against client-disconnect races (issue #3).
 *
 * An SSE response stays open for hours, and the platform's stream drain
 * (`NodeHttpServer.handleResponse`) keeps calling `write()` on it until the
 * abort interrupt lands. Between the TCP socket dying and that interrupt
 * there is a window where a `write()` (or the error-response `writeHead()`
 * the platform emits after a failed drain) hits a dead response. Bun then
 * throws `Cannot writeHead headers after they are sent to the client` —
 * its `end()` also fails to set `writableEnded` on a dead handle
 * (oven-sh/bun#25632), which defeats the platform's only double-write guard
 * — wedging connections until restart.
 *
 * The wrappers close both halves of that race for THIS route only, and are
 * no-ops for any healthy response:
 * - `write` after the response is ended/destroyed reports "flushed" instead
 *   of throwing, so the drain never fails on a client that already left and
 *   the platform's 500-error-response path never runs for a live stream.
 * - `writeHead` after headers were sent returns instead of throwing, so even
 *   an unrelated mid-stream failure cannot crash the request fiber.
 */
const hardenSseResponse = (
  request: HttpServerRequest.HttpServerRequest,
): void => {
  const raw = toServerResponse(request);
  if (hardenedResponses.has(raw)) return;

  // "Writes into this response can only throw": the socket died (client
  // disconnect) or the response finished. Node marks `destroyed` only after
  // the socket detaches, so the socket check is what actually covers the
  // disconnect-to-interrupt window.
  const writeWouldThrow = (): boolean =>
    raw.writableEnded ||
    raw.destroyed ||
    raw.socket === null ||
    raw.socket === undefined ||
    raw.socket.destroyed;

  const originalWrite = raw.write.bind(raw);
  const originalWriteHead = raw.writeHead.bind(raw);

  // SAFETY: the wrapper forwards the spread arguments verbatim to the bound
  // original, so it satisfies the overloaded `write` method shape.
  raw.write = ((...args: Parameters<typeof originalWrite>) =>
    writeWouldThrow() ? true : originalWrite(...args)) as typeof raw.write;

  // SAFETY: same verbatim forwarding as the `write` wrapper above; returns
  // the response itself (as `writeHead` does) when headers already went out.
  raw.writeHead = ((...args: Parameters<typeof originalWriteHead>) =>
    raw.headersSent
      ? raw
      : originalWriteHead(...args)) as typeof raw.writeHead;

  hardenedResponses.add(raw);
};

export const streamRouteHandler = (
  request: HttpServerRequest.HttpServerRequest,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, never> =>
  Effect.gen(function* () {
    const url = new URL(request.url, "http://localhost");

    // Authorization first: an ungranted capability must never be tracked,
    // streamed or refreshed for this caller. The principal comes from the
    // session bridge (see auth/session.ts) — same identity plane as REST.
    const principal = yield* resolvePrincipalForRequest(request);
    const missing = url.searchParams
      .getAll("capability")
      .filter((id) => !principalCanUse(principal, id as never));
    if (missing.length > 0) {
      return HttpServerResponse.text(
        `stream subscribe forbidden: missing capability ${missing.join(", ")}`,
        { status: 403 },
      );
    }

    const outcome = yield* Effect.either(
      parseStreamRequests(
        url.searchParams.getAll("capability"),
        url.searchParams.getAll("options"),
      ),
    );
    if (outcome._tag === "Left") {
      const cause = outcome.left;
      return HttpServerResponse.text(
        `stream subscribe failed: ${cause.error}${cause.detail ? `: ${cause.detail}` : ""}`,
        { status: 400 },
      );
    }
    const subscriptions = outcome.right;
    for (const { name } of subscriptions) {
      if (!CAPABILITY_REGISTRY[name].streamable) {
        return HttpServerResponse.text(
          `stream subscribe failed: ${name} is not streamable, use its REST endpoint`,
          { status: 400 },
        );
      }
    }
    const tracked = subscriptions.map(({ name, options }) => ({
      name,
      key: liveHub.track(name, options),
    }))
    // Pin every subscribed key for this connection's lifetime; the last
    // release untracks it so the poller stops refreshing (and caching)
    // options combinations nobody watches anymore.
    for (const { key } of tracked) liveHub.retain(key)

    // Before the stream starts: make late writes into a gone client (and the
    // platform's post-failure error response) no-ops instead of throws —
    // see `hardenSseResponse`. Must run before any byte is flushed.
    hardenSseResponse(request)

    const body = Stream.asyncScoped<Uint8Array>((emit) => {
      // `emit.single` returns a promise that rejects when the stream's queue
      // shuts down while an emit is still backed up (client gone mid-
      // backpressure). A dropped frame on a dead connection is fine; an
      // unhandled rejection kills the process (Node) or spams the log (Bun).
      const safeEmit = (frame: Uint8Array): void => {
        void Promise.resolve(emit.single(frame)).catch(() => {})
      }

      return Effect.gen(function* () {
        const unsubscribes: Array<() => void> = []
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            for (const { name, key } of tracked) {
              unsubscribes.push(
                liveHub.subscribe(key, (snapshot) => {
                  safeEmit(
                    snapshotEvent(
                      name,
                      key,
                      snapshot.result,
                      snapshot.updatedAt,
                    ),
                  );
                }),
              );
            }
          }),
          () =>
            Effect.sync(() => {
              for (const unsubscribe of unsubscribes) unsubscribe();
              for (const { key } of tracked) liveHub.release(key);
            }),
        );
        for (const { name, key } of tracked) {
          const cached = liveHub.get(key);
          if (cached)
            safeEmit(
              snapshotEvent(name, key, cached.result, cached.updatedAt),
            );
        }
        yield* Effect.forever(
          Effect.andThen(
            Effect.sync(() => safeEmit(HEARTBEAT)),
            Effect.sleep(Duration.millis(HEARTBEAT_MS)),
          ),
        ).pipe(Effect.forkScoped);
      });
    });
    return HttpServerResponse.stream(body, {
      status: 200,
      contentType: "text/event-stream",
      headers: Headers.fromInput({
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      }),
    });
  });
