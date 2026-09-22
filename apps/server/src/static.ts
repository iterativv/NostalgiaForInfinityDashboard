// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  HttpLayerRouter,
  HttpPlatform,
  HttpServerRequest,
  HttpServerResponse,
} from "@effect/platform"
import { Effect, Layer } from "effect"
import { existsSync, statSync } from "node:fs"
import { join, resolve, sep } from "node:path"

/**
 * Static web shell for production: a lowest-priority `GET /*` route that
 * serves the built `apps/web` bundle from the SAME port as the API, so one
 * process (or container, or single-binary release) runs the whole terminal
 * without a separate web server and without any CORS configuration.
 *
 * Two asset sources, picked by the entry point:
 *
 * - `StaticSource.dir` — a web dist on disk (`apps/web/dist`). Used by dev
 *   boots and the Docker image; `STATIC_DIR` overrides the default
 *   `../web/dist` resolved against the server CWD.
 * - `StaticSource.embedded` — the web dist baked into the compiled
 *   single-file binary (see `scripts/embed-web-dist.mjs`), served from
 *   memory; no filesystem needed at runtime.
 *
 * Behavior shared by both:
 *
 * - Unknown `/api/*` paths stay JSON 404s — they must never receive the SPA
 *   fallback HTML.
 * - Vite emits content-hashed files under `/assets/`, so those get immutable
 *   year-long caching; everything else (including `index.html`, which
 *   references the hashed assets) is served `no-cache`.
 * - Dir paths resolve inside the web root only — `..` segments and encoded
 *   traversal attempts are rejected before touching the filesystem.
 * - SPA fallback: the shell uses browser-history routing (`/`, `/login`,
 *   `/public`, …), so any non-file GET falls back to `index.html` and the
 *   client router renders the right page.
 */

const ASSET_PREFIX = "/assets/"
const INDEX_PATH = "/index.html"
const CACHE_IMMUTABLE = "public, max-age=31536000, immutable"
const CACHE_NO_CACHE = "no-cache"

// Extensions occurring in a Vite build; anything else falls back to
// octet-stream (embedded assets have no filesystem mime lookup).
const CONTENT_TYPES: Record<string, string> = {
  css: "text/css; charset=utf-8",
  html: "text/html; charset=utf-8",
  ico: "image/x-icon",
  js: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  woff: "font/woff",
  woff2: "font/woff2",
}

const contentTypeFor = (pathname: string): string =>
  CONTENT_TYPES[pathname.slice(pathname.lastIndexOf(".") + 1)] ?? "application/octet-stream"

/** One file baked into the binary: raw UTF-8 text or base64 bytes. */
export interface EmbeddedAsset {
  readonly body: string
  readonly base64: boolean
}

/** Where the static handler reads web shell files from. */
export type StaticSource =
  | { readonly kind: "dir"; readonly root?: string }
  | { readonly kind: "embedded"; readonly files: ReadonlyMap<string, EmbeddedAsset> }

/** A `StaticSource` with the serving directory resolved (default: web dist). */
type ResolvedSource =
  | { readonly kind: "dir"; readonly root: string }
  | { readonly kind: "embedded"; readonly files: ReadonlyMap<string, EmbeddedAsset> }

/** Resolve the web dist to serve: `STATIC_DIR` or the repo-layout default. */
export const readStaticDir = (): string =>
  process.env["STATIC_DIR"] ?? resolve(process.cwd(), "../web/dist")

const apiNotFound = HttpServerResponse.json(
  { error: "not found" },
  { status: 404 },
).pipe(Effect.orDie)

const decodePathname = (url: string): string | null => {
  try {
    const { pathname } = new URL(url, "http://nfi-desk.local")
    const decoded = decodeURIComponent(pathname)
    return decoded.includes("\0") ? null : decoded
  } catch {
    return null
  }
}

const cacheControlFor = (pathname: string, servedFallback: boolean): string =>
  !servedFallback && pathname.startsWith(ASSET_PREFIX) ? CACHE_IMMUTABLE : CACHE_NO_CACHE

// ---------------------------------------------------------------------------
// Embedded source (compiled binary)
// ---------------------------------------------------------------------------

const respondEmbedded = (
  files: ReadonlyMap<string, EmbeddedAsset>,
  pathname: string,
  servedFallback: boolean,
): HttpServerResponse.HttpServerResponse => {
  const asset = files.get(pathname)
  if (asset === undefined) {
    return HttpServerResponse.empty({ status: 404 })
  }
  const headers = {
    "content-type": contentTypeFor(pathname),
    "cache-control": cacheControlFor(pathname, servedFallback),
  }
  return asset.base64
    ? HttpServerResponse.uint8Array(Buffer.from(asset.body, "base64"), { headers })
    : HttpServerResponse.text(asset.body, { headers })
}

const serveEmbedded = (
  files: ReadonlyMap<string, EmbeddedAsset>,
  pathname: string,
): Effect.Effect<HttpServerResponse.HttpServerResponse> => {
  // Nested routes are flattened by Vite; assets are keyed by exact path.
  const normalized = pathname.replace(/^\/+/, "")
  const key = normalized === "" ? INDEX_PATH : `/${normalized}`
  return Effect.succeed(
    files.has(key)
      ? respondEmbedded(files, key, false)
      : files.has(INDEX_PATH)
        ? respondEmbedded(files, INDEX_PATH, true)
        : HttpServerResponse.empty({ status: 404 }),
  )
}

// ---------------------------------------------------------------------------
// Directory source (dev boots, Docker image)
// ---------------------------------------------------------------------------

/** `true` only for an existing regular file — directories fall through. */
const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

const respondFile = (path: string, cacheControl: string) =>
  HttpServerResponse.file(path, {
    headers: { "cache-control": cacheControl },
  })

const serveFromDir = (
  root: string,
  pathname: string,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, HttpPlatform.HttpPlatform> => {
  const relative = pathname.replace(/^\/+/, "")
  const candidate =
    relative === "" || relative.endsWith("/")
      ? join(root, relative, "index.html")
      : resolve(root, relative)
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    return Effect.succeed(HttpServerResponse.empty({ status: 404 }))
  }
  // Resolve BEFORE streaming so directories (and missing files) deterministically
  // take the SPA fallback on every runtime — streaming a directory behaves
  // differently between Node and Bun.
  const target = isFile(candidate) ? candidate : join(root, INDEX_PATH)
  const servedFallback = target !== candidate
  return respondFile(target, cacheControlFor(pathname, servedFallback)).pipe(
    Effect.catchAll(() => Effect.succeed(HttpServerResponse.empty({ status: 404 }))),
  )
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

const staticSiteHandler =
  (source: ResolvedSource) =>
  (request: HttpServerRequest.HttpServerRequest): Effect.Effect<
    HttpServerResponse.HttpServerResponse,
    never,
    HttpPlatform.HttpPlatform
  > => {
    const pathname = decodePathname(request.url)
    if (pathname === null) {
      return Effect.succeed(HttpServerResponse.empty({ status: 400 }))
    }
    if (pathname.startsWith("/api/") || pathname === "/api") {
      return apiNotFound
    }
    return source.kind === "embedded"
      ? serveEmbedded(source.files, pathname)
      : serveFromDir(source.root, pathname)
  }

const logStaticSource = (source: ResolvedSource): Effect.Effect<void> =>
  source.kind === "embedded"
    ? source.files.size > 0
      ? Effect.log(`serving embedded web shell (${source.files.size} files)`)
      : Effect.logWarning(
          "embedded web shell is EMPTY — rebuild with scripts/embed-web-dist.mjs",
        )
    : existsSync(join(source.root, INDEX_PATH))
      ? Effect.log(`serving web shell from ${source.root}`)
      : Effect.logWarning(
          `no web shell at ${source.root} — API-only mode (build apps/web or set STATIC_DIR)`,
        )

/**
 * The catch-all static route plus a boot log. find-my-way ranks static
 * contract paths above wildcards, so `GET /*` only ever sees requests no API
 * route matched. The dir source requires `NodeHttpPlatform.layer` (as
 * provided in boot.ts) for `HttpServerResponse.file`; its root resolves here
 * so `launchServer` has already normalized empty-string env vars (empty
 * `STATIC_DIR` means "use the default", not "").
 */
export const StaticSiteLive = (source: StaticSource) => {
  const resolved: ResolvedSource =
    source.kind === "dir"
      ? { kind: "dir", root: source.root ?? readStaticDir() }
      : source
  return Layer.mergeAll(
    HttpLayerRouter.add("GET", "/*", staticSiteHandler(resolved)),
    Layer.effectDiscard(logStaticSource(resolved)),
  )
}
