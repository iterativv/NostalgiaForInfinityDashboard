// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { HttpLayerRouter } from "@effect/platform"
import { NodeContext, NodeHttpClient, NodeHttpPlatform, NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Duration, Effect, Layer } from "effect"
import { spawn } from "node:child_process"
import { createServer } from "node:http"
import { FreqtradeClientLive, FreqtradeConfigLive } from "@nfi/freqtrade-client"
import { NfiApi } from "@nfi/api-contract"
import { BotGroupLive, SystemGroupLive } from "./routes.js"
import { WorkspaceGroupLive } from "./workspaces.js"
import { InstancesGroupLive } from "./instances.js"
import { UsersGroupLive } from "./users.js"
import { AuthGroupLive } from "./auth.js"
import { DbLive, MigrateLive } from "./snapshots.js"
import { LivePollerLive } from "./capabilities/poller.js"
import { streamRouteHandler } from "./capabilities/stream.js"
import { readCorsOrigins } from "./config.js"
import { SessionAuthLive } from "./auth/session.js"
import { StaticSiteLive, type StaticSource } from "./static.js"

/**
 * Shared layer composition for every entry point (`index.ts` for dev/Node
 * boots, `binary.ts` for the compiled single-file release).
 *
 * Runtime-agnostic by design: Node today via `NodeHttpServer` /
 * `NodeHttpClient` / `@effect/sql` (better-sqlite3 under Node, bun:sqlite
 * under Bun — see `@nfi/db`), Bun tomorrow by swapping just those layers —
 * `NfiApi`, its groups, `FreqtradeClientLive`, `SnapshotRepoLive` and
 * `@nfi/api-contract` stay untouched.
 *
 * `DbLive` (sqlite) is provided once at the top so HTTP handlers, the
 * migration and the live poller share a single connection.
 *
 * Transport: contract REST (`NfiApi` via `HttpLayerRouter.addHttpApi`) plus
 * the continuous capability stream (`GET /api/stream`, one SSE subscription
 * per capability+options) on the SAME port, plus the lowest-priority static
 * web shell catch-all. The only polling in the system is the live poller
 * between this backend and freqtrade; browsers only receive pushes.
 */

export interface BootOptions {
  readonly static: StaticSource
}

// Docker/compose deployments pass optional settings through as empty strings
// (`${VAR:-}`); for this server empty means unset — drop them so Effect
// Config falls back to the documented defaults instead of "".
const EMPTY_MEANS_UNSET = [
  "PORT",
  "HOST",
  "CORS_ORIGINS",
  "FREQTRADE_URL",
  "FREQTRADE_USERNAME",
  "FREQTRADE_PASSWORD",
  "ROOT_USERNAME",
  "ROOT_PASSWORD",
  "NFI_SETUP_TOKEN",
  "SQLITE_PATH",
  "SNAPSHOT_INTERVAL_MS",
  "STATIC_DIR",
  "OPEN_BROWSER",
] as const

const normalizeEmptyEnv = (): void => {
  for (const key of EMPTY_MEANS_UNSET) {
    if (process.env[key] === "") delete process.env[key]
  }
}

/**
 * Best-effort browser open for local boots — a headless server has no
 * `xdg-open` (or no display): the spawn failure is swallowed silently.
 */
const openInBrowser = (url: string): void => {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open"
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url]
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true })
    child.on("error", () => {}) // missing command / no display — ignore
    child.unref()
  } catch {
    // best effort only
  }
}

export const launchServer = (options: BootOptions): void => {
  normalizeEmptyEnv()
  // The root user is OPTIONAL at boot: set `ROOT_USERNAME`/`ROOT_PASSWORD` for
  // a virtual env root, or leave them unset and provision root interactively
  // through `Auth.setupRoot` (the web first-run setup screen). Either way the
  // always-privileged account exists before anything privileged is served.
  const port = Number(process.env["PORT"] ?? 4000)
  // Default to loopback so a laptop/server boot is not silently exposed to
  // the LAN (first-run setup is reachable by ANYONE until root exists).
  // Docker/the container image sets HOST=0.0.0.0 explicitly; LAN/remote
  // deployments opt in via HOST (see DEPLOYMENT.md).
  const host = process.env["HOST"] ?? "127.0.0.1"

  const GroupsLive = Layer.mergeAll(
    BotGroupLive,
    SystemGroupLive,
    WorkspaceGroupLive,
    InstancesGroupLive,
    UsersGroupLive,
    AuthGroupLive,
  )

  // SessionAuthLive appears once here but backs BOTH the REST groups and the
  // SSE stream route — Effect memoizes layers by reference inside a single
  // launch, so all of them share one session store and one root identity.
  // StaticSiteLive is the lowest-priority `GET /*` catch-all serving the web
  // shell (SPA fallback) — contract paths always outrank the wildcard.
  const AppLive = Layer.mergeAll(
    HttpLayerRouter.addHttpApi(NfiApi),
    HttpLayerRouter.add("GET", "/api/stream", streamRouteHandler),
    StaticSiteLive(options.static),
  ).pipe(
    Layer.provide(GroupsLive),
    Layer.provide(SessionAuthLive),
    // `HttpServerResponse.file` (static shell from a directory) streams
    // through the platform.
    Layer.provide(NodeHttpPlatform.layer),
    // `credentials: true`: the session cookie must survive the cross-origin
    // case (browser shell pointed at a remote backend URL).
    Layer.provide(
      HttpLayerRouter.cors({ allowedOrigins: readCorsOrigins(), credentials: true }),
    ),
  )

  // Local URL banner + browser auto-open. `OPEN_BROWSER` defaults ON for
  // the compiled binary (set `OPEN_BROWSER=0` to disable) and OFF for dev
  // / Node boots (`OPEN_BROWSER=1` to enable) — watch-mode restarts would
  // otherwise open a new tab on every file save, and servers are headless.
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1"
  const localUrl = `http://${isLoopback ? "localhost" : host}:${port}`
  const BannerLive = Layer.effectDiscard(
    Effect.gen(function* () {
      // Give the bind + first-boot migrations a moment before announcing.
      yield* Effect.sleep(Duration.seconds(1))
      yield* Effect.log(`nfi-desk is running → ${localUrl}`)
      if (!isLoopback) {
        yield* Effect.log(
          `listening on ${host} — reachable beyond this machine (HOST=127.0.0.1 to restrict)`,
        )
      }
      if (process.env["OPEN_BROWSER"] === "1") openInBrowser(localUrl)
    }),
  )

  const MainLive = Layer.mergeAll(
    BannerLive,
    Layer.mergeAll(HttpLayerRouter.serve(AppLive), MigrateLive, LivePollerLive).pipe(
      Layer.provide(NodeHttpServer.layer(createServer, { port, host })),
      Layer.provide(NodeHttpPlatform.layer),
      Layer.provide(NodeContext.layer),
      Layer.provide(DbLive),
      Layer.provide(FreqtradeClientLive),
      Layer.provide(FreqtradeConfigLive),
      Layer.provide(NodeHttpClient.layer),
    ),
  )

  Layer.launch(MainLive).pipe(NodeRuntime.runMain)
}
