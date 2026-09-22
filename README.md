# nfi-desk

Custom freqtrade dashboard — a Bloomberg-terminal-style web panel. Every panel is a **widget**: highly customizable, reorderable, resizable, persisted per browser.

## Architecture

```
apps/
  web/        React terminal (Vite + TanStack Router/Store + IBM Carbon)
  server/     Effect-TS backend — the ONLY process that talks to freqtrade
packages/
  api-contract      Shared DTOs + Effect Schemas (frontend ↔ backend contract)
  capabilities      One file per capability: option/result schemas, cadence, server run
  freqtrade-client  SERVER-ONLY Effect service wrapping the freqtrade REST API
  db                SQLite persistence via Effect (@effect/sql): snapshot repo + freqtrade instances
  widget-sdk        Framework-agnostic widget catalog + dashboard layout store
  ui                Shared React + Carbon building blocks
```

### Ground rules

- **Frontend never touches freqtrade.** All freqtrade traffic happens inside `apps/server`, which normalizes responses into `@nfi/api-contract` DTOs. No freqtrade URL is ever exposed to the browser and no freqtrade CORS configuration is needed. (`apps/web` must never import `@nfi/freqtrade-client`.)
- **Contract-first, Effect-baked comms.** `NfiApi` (`@nfi/api-contract`, Effect `HttpApi`) is the single source of truth for the wire protocol: the server implements it with `HttpApiBuilder`, the web shell consumes it with `HttpApiClient` over `fetch`. Paths, methods, schemas and error mapping are shared — drift is a compile error. Live updates ride SSE (`GET /api/stream`), not polling.
- **One file per capability, type-safe end to end.** A capability is a server-side function (options in, result out); auth limits which ids each user may use. Every id is hard-coded in `packages/capabilities/src/*.ts` (schemas, streaming cadence, implementation) and registered in a `Record<Capability, …>` map, so missing/extra files and typo'd call sites (`callCapability` / `useCapability` / `runCapability`) are compile errors.
- **No absolute leaks on public pages.** Every balance/PnL capability has a `.relative` mirror carrying only percentages, weights and indices rebased to 100 — no option combination can reveal absolute balances or PnL. Grant only `PUBLIC_CAPABILITIES` for shareable pages (`/public`).
- **Everything is a widget.** New panels = new widget definition in `@nfi/widget-sdk` + component in `apps/web/src/widgets.tsx`. Pages never hardcode panels.
- **Shared core, swappable shells.** `@nfi/api-contract`, `@nfi/widget-sdk` and `@nfi/ui` are platform-agnostic so the future desktop app reuses them as-is. The Effect backend is runtime-agnostic too (Node today via `@effect/platform-node`, Bun later by swapping two layers).

### Tech stack

Frontend (`apps/web`): React 19, TanStack Router (code-based routes in `src/router.tsx`), TanStack Store (`dashboardStore` from `@nfi/widget-sdk`, persisted `prefsStore` in `src/store.ts`, per-capability `liveStore` in `src/capabilities/live.ts` fed by SSE `EventSource` and subscribed via `@tanstack/react-store`), TanStack Query (provider + one-shot/mutation transport only — no polling intervals anywhere), TanStack Form (`src/pages/SettingsPage.tsx`), IBM Carbon (`@carbon/react`, dark `g100` terminal theme), IBM Plex Sans + Plex Mono fonts, `@carbon/charts-react` (`Balance` allocation donut, `PnL Chart` bars, `Equity Curve` line from sqlite history), `@carbon/icons-react` throughout.

Backend (`apps/server`): Effect-TS on `@effect/platform` + `@effect/platform-node` (`HttpLayerRouter`: contract REST via `addHttpApi` plus the `GET /api/stream` SSE route on the same port), freqtrade auth via HTTP Basic Auth login with cached JWT + transparent refresh-on-401 (`packages/freqtrade-client`), capability implementations in `@nfi/capabilities` (one file per id, run through a type-safe registry), one live poller refreshing tracked capability snapshots on per-capability `pollMs` cadences and fanning out over SSE (the ONLY interval in the system), SQLite snapshots via `@nfi/db` (throttled 60s writes from the same poller, served as history for the Equity Curve).

## Develop

```sh
pnpm install
pnpm dev           # backend (http://localhost:4000) + web (http://localhost:3000) in one command
```

That's it — no `.env` required. Without configuration the server uses safe
defaults and the web app proxies `/api` to it. On first visit the web walks
you through setup: create the root admin (when `ROOT_USERNAME`/`ROOT_PASSWORD`
are not configured), then connect your first freqtrade instance.

To customize, copy the examples and restart `pnpm dev`:

```sh
cp apps/server/.env.example apps/server/.env   # FREQTRADE_* , ROOT_*, SQLITE_PATH, …
```

Without a live freqtrade, the terminal still boots: widgets show the backend error state and `Connection` reports `freqtrade unreachable`.

## Production

One process serves the web shell, the REST + SSE API and SQLite on a single port. Pick one of these (full guide in [DEPLOYMENT.md](./DEPLOYMENT.md)):

### Which release file for my machine?

Releases live on GitHub: **[github.com/lamualfa/NostalgiaForInfinityDashboard/releases](https://github.com/lamualfa/NostalgiaForInfinityDashboard/releases)**. Downloads are public — no token needed.

Not sure about your architecture? Run `uname -m`: `x86_64` means **x64**, `aarch64`/`arm64` means **arm64**.

| Your machine                             | File                       |
| ---------------------------------------- | -------------------------- |
| Linux x64 — most servers, Intel/AMD      | `nfi-desk-linux-x64`       |
| Linux arm64 — Graviton/Oracle ARM, RPi 5 | `nfi-desk-linux-arm64`     |
| macOS Apple Silicon (M1–M4)              | `nfi-desk-darwin-arm64`    |
| macOS Intel                              | `nfi-desk-darwin-x64`      |
| Windows x64                              | `nfi-desk-windows-x64.exe` |

Every file is self-contained (~100 MB, no runtime) — server, API and web terminal in one executable. Verify against `checksums.txt` from the same release if you like.

### One line: download and run (Linux / macOS)

Paste this single line — it resolves the newest release, picks the right file for your architecture, and starts the server:

```sh
curl -fsSL -o nfi-desk "https://github.com/lamualfa/NostalgiaForInfinityDashboard/releases/latest/download/nfi-desk-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/aarch64/arm64/;s/x86_64/x64/')" && chmod +x nfi-desk && ./nfi-desk
```

→ open **http://localhost:4000** — the web walks you through first-run setup (create the root admin, connect your first freqtrade instance). No env vars, no database, no web server needed.

Windows PowerShell equivalent:

```powershell
Invoke-WebRequest -OutFile nfi-desk.exe "https://github.com/lamualfa/NostalgiaForInfinityDashboard/releases/latest/download/nfi-desk-windows-x64.exe"; .\nfi-desk.exe
```

```sh
# Docker Compose (recommended for long-running deployments)
cp apps/server/.env.example .env    # edit: ROOT_*, FREQTRADE_*
docker compose up -d --build        # → http://localhost:4000
```

The release workflow (`.github/workflows/release.yml`) compiles that binary per platform on every `v*` tag; the Dockerfile builds the same binary into a minimal image.

## Scripts

```sh
pnpm dev          # turbo: backend + web dev servers together
pnpm build        # turbo: build server + web
pnpm lint         # turbo: eslint every workspace (@repo/eslint-config)
pnpm check-types  # turbo: typecheck all workspaces
```

## Environment

| Var                                         | Where  | Default                   | Purpose                                                                                                                                                                                                                                                                 |
| ------------------------------------------- | ------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                                      | server | `4000`                    | Backend listen port                                                                                                                                                                                                                                                     |
| `HOST`                                      | server | `127.0.0.1`               | Bind address — loopback-only by default; set `0.0.0.0` to expose the panel to your network (the Docker image does this for you)                                                                                                                                         |
| `CORS_ORIGINS`                              | server | `http://localhost:3000`   | Allowed browser origins (credentials enabled for the session cookie)                                                                                                                                                                                                    |
| `ROOT_USERNAME` / `ROOT_PASSWORD`           | server | — (**optional**)          | Root admin account. When set, root is virtual (env-only). When unset, the web shows a first-run screen that creates the root account (stored server-side); the setup endpoint refuses once root exists. Root always holds every capability and is immutable from the UI |
| `FREQTRADE_URL`                             | server | `http://127.0.0.1:8080`   | Freqtrade REST base for the implicit `default` instance (server-side only)                                                                                                                                                                                              |
| `FREQTRADE_USERNAME` / `FREQTRADE_PASSWORD` | server | —                         | Freqtrade `api_server` credentials for the `default` instance (server-side only; extra instances are stored in SQLite via the Instances widget)                                                                                                                         |
| `SQLITE_PATH`                               | server | `../../.data/nfi-desk.db` | Snapshot database file, inside the gitignored repo-root `.data/` folder (server CWD is `apps/server`)                                                                                                                                                                   |
| `SNAPSHOT_INTERVAL_MS`                      | server | `60000`                   | Throttle for sqlite snapshot writes from the live poller                                                                                                                                                                                                                |
| `STATIC_DIR`                                | server | `../web/dist`             | Web shell directory for Node boots; the compiled single binary ignores it (its shell is embedded)                                                                                                                                                                       |
| `OPEN_BROWSER`                              | server | `1` in the binary         | Auto-open the terminal URL in the browser on boot; set `0` for headless servers (dev/Node boots default off, `1` opts in)                                                                                                                                               |
| `VITE_API_URL`                              | web    | `""` (same-origin)        | Backend base URL; empty uses the Vite `/api` proxy in dev                                                                                                                                                                                                               |

## API (backend → frontend)

Contract-first via `NfiApi` in `@nfi/api-contract`: `System.health`, `System.backendConfig` (masked host only), `Bot.status|balance|profit|trades|config`, `Bot.profitHistory|balanceHistory` (sqlite snapshots, last 500 points), plus `.relative` mirrors for every balance/PnL read (`Bot.balanceRelative|profitRelative|tradesRelative|profitHistoryRelative|balanceHistoryRelative` and the five `Instances.*Relative` counterparts). Every endpoint can fail with the typed `BackendError` (HTTP 502). Use the type-safe `callCapability(name, options)` (`apps/web/src/capabilities/client.ts`) or the live `useCapability(name, options)` hook (SSE stream + TanStack Store) — never hand-roll `fetch` calls.

### Multiple freqtrade instances (and fleet aggregates)

`Instances.list|create|update|remove` manages named connections in SQLite (`freqtrade_instances`); `Instances.health|status|balance|profit|openPositions|closedPositions|config|locks|blacklist|whitelist|tradeCount|profitDaily` queries one instance by id. The `default` id is the `FREQTRADE_*` env connection (read-only); passwords are stored server-side and never returned (list shows `hasPassword` only). `Instances.tagPerformance` aggregates closed-trade stats per tag (`enter_tag` for NFI entries, or `exit_reason`).

**Fleet capabilities** fan out over every configured instance server-side (one wire call, per-instance error tolerance — one unreachable bot degrades to an error row, never a failed widget): `Instances.overview` (health + status + capacity + profit + balance per instance, plus totals), `Instances.positionsAll` / `Instances.closedAll` (open/closed positions across the fleet, tagged with their source instance) and `Instances.profitDailyAll` (daily/weekly/monthly profit buckets merged by date). Every data widget's ⚙ settings therefore offers **All instances (fleet)** next to each connection — one terminal screen can watch the whole fleet. `InstancesTableWidget` remains the management table; the `Fleet Overview` widget renders the aggregate wall.

### Widget ↔ backend authorization (capabilities, login-gated)

A capability is a server-side function: it receives an option object and responds with a result. Auth limits which capability ids are available to a specific user. Each id is hard-coded in exactly one file (`packages/capabilities/src/*.ts`, owning the option schema, result schema, streaming cadence and server implementation) and registered in `CAPABILITY_REGISTRY` (`Record<Capability, …>`); call sites are generic (`runCapability` on the server, `callCapability` / `useCapability` in the web shell), so definition and usage are type-safe — unknown ids or mismatched options/results are compile errors, never runtime surprises.

Every widget declares what it needs via `capabilities` in its `defineWidget` definition (`@nfi/widget-sdk`, typed as `Capability[]`). `Auth.capabilities` serves the caller's granted set; the shell (`capabilitiesStore`, the `openWidgetPanel` guard and the `Panel` forbidden placeholder) mirrors that grant so a user missing a capability cannot enable — or keep rendering — widgets that need it (they show the standardized **Not authorized** state instead). The widget picker and command palette keep ungranted widgets VISIBLE but dim them with a **not permitted** badge — discoverability over a shorter list; picking one is a no-op. The backend is the enforcement point: every REST capability dispatch (`runCapabilityForHttp`) and every SSE stream subscription resolves the caller and rejects ungranted ids with a typed `ForbiddenError` (HTTP 403).

### Auth: root, users, sessions, anonymous grant

- **Root** — provisioned one of two ways: `ROOT_USERNAME` / `ROOT_PASSWORD` from env (virtual, never stored), or the first-run web setup screen (`/setup`, offered only while no root exists — `Auth.setupRoot` refuses afterwards; the created account lives in a fixed sqlite row that the user-management endpoints treat as exactly as immutable as the env variant). Root always holds every capability, and no endpoint can modify, narrow or delete it. To reset a lost setup-created root password, delete the `root` row from the sqlite `users` table — the setup screen then returns. Sign in via `/login`.
- **Users** — created/edited by anyone holding the `users.*` capabilities (root by default) on the **Manage users** page (`/users`): granted capability set (checkboxes per sensitivity-tagged id), password reset, delete. Passwords are scrypt-hashed (`@nfi/db`, server-only); sessions are in-memory 7-day HttpOnly `SameSite=Lax` cookies (plus `Secure` when served over TLS; a restart logs everyone out). Grants are re-read per request, so edits apply immediately without re-login. Repeated failed logins lock the username out temporarily.
- **No privilege escalation** — `users.create` / `users.update` may only grant a subset of the caller's own grant, and a non-root manager may only touch accounts whose current grant they fully hold (a bare password reset must not reach a more privileged account); root trivially passes both. The root username cannot be taken.
- **Anonymous** — everyone not signed in, including the public share. Their grant is the special `anonymous` row (seeded with `PUBLIC_CAPABILITIES`, the relative-only safe set) edited like a user on `/users` (capabilities only — it can never have a password). This is how you share the dashboard publicly without exposing absolute balances/PnL.

### Real-time, not polling (one multiplexed stream)

Every streamable capability supports a continuous stream next to its unary REST call: `GET /api/stream?capability=<id>&options=<base64url-json>` — and the pair may repeat, so **one connection multiplexes every subscription** (dense terminal pages would otherwise blow the browser's ~6-connections-per-host limit). A single backend poller refreshes tracked capability snapshots on per-capability `pollMs` cadences (the ONLY interval in the system, between the backend and freqtrade — see `apps/server/src/capabilities/feed.ts` for the websocket seam) and fans out over SSE. The frontend seeds first paint with one `callCapability`, then all live widgets join a shared refcounted SSE pool that reopens (debounced) as the subscription set changes, rendering pushes from the `liveStore` TanStack Store (`useCapability`); `refetchInterval`/`setInterval` do not exist in the web shell.

### Public sharing without absolute leaks

Options passed to a capability cannot be restricted (any instance id, limit, offset, …), so the `.relative` mirrors are safe by construction: `bot.balance.relative`, `bot.profit.relative`, `bot.trades.relative`, `bot.profit-history.relative`, `bot.balance-history.relative` and their `instances.*` counterparts carry only percentages, allocation weights and histories rebased to an index starting at exactly 100. Absolute coin/fiat amounts, stake sizes and order prices never appear, so no option combination can be used to calculate, derive or track down the freqtrade absolute balance or PnL. The `/public` route renders a fixed read-only dashboard of relative widgets; the anonymous grant (seeded from `PUBLIC_CAPABILITIES`, editable on `/users`) keeps every not-signed-in visitor inside that safe subset.

### Grid layout system (CSS-grid model, nested mosaics)

Workspaces are **grid** trees: each `grid` node declares track fractions (`columns: [1,2,1]` = 25/50/25%) and places items by 1-based `col`/`row` with spans; cells host tab groups, bare panels or **nested grids** — so splitting a cell (⌘K → “Split Active Cell Right/Down” or drag between grids) wraps its content in a fresh 2-track grid and arbitrarily deep mosaics compose naturally. Closing panels prunes empty cells, closes unused tracks and unwraps single-item grids (`normalizeGridLayout`), keeping the tree minimal without manual rebalancing. The Layouts dialog offers 14 one-click grid presets (symmetric lattices, asymmetric mosaics, spanning heroes, full-width strips) scoped to any grid on the page.

Rendering is CSS grid with interleaved gutter tracks, so every interior track boundary is a real draggable divider that moves fraction between the two adjacent tracks only, clamped to the content minimums of the widgets inside (`gridColumnMinWidths` from each widget's `minWidth`). Narrow containers auto-stack columns vertically (render-only; persisted tracks are untouched). Legacy pre-grid documents (binary `split` trees) migrate to flattened grids at the decode boundary (`migrateLegacyLayout`) — chained same-direction splits collapse into one flat track list, fixing the old nested-ratio skew — and the next save persists the grid.

### Responsive smart layout

Every widget declares a `minWidth` (minimum readable px). Splits derive drag minimums from the widgets they contain (`getLayoutMinWidth`), clamp drags via `clampRatioForMinWidths`, and automatically stack a `horizontal` split vertically when the container cannot fit both sides (render-only — the persisted direction/ratio is untouched, so widening restores side-by-side). New splits pick a readable direction for the current viewport (`chooseSplitDirection`). Tables scroll horizontally (`.nfi-table-scroll` with sticky headers), stat grids reflow (`.nfi-stat-grid`), and narrow viewports get compact shell rules.

### Terminal widgets (Bloomberg-style)

Beyond the bot/instance basics: `Fleet Overview` (every instance's health, capacity, profit and balance in one table plus totals), `Daily Profit` (profit bars per day/week/month, one instance or fleet-merged), `Pair Summary` (closed-trade attribution per pair), `Pair Locks` (locked pairs with reason and expiry), `Pair Universe` (filterable whitelist + blacklist with reasons), `Drawdown` (underwater curve from recorded profit history), `Ticker Tape` (live position strip), `Watchlist` (tracked pairs joined with live state), `Market Movers` (top gainers/losers by PnL%), `Exposure` (deployed-stake allocation donut + concentration), `Performance Stats` (winrate, profit factor, expectancy, averages), `Strategy Breakdown` (profit attribution per strategy), `Trade Tape` (chronological opens/closes feed), `Risk Monitor` (exposure/leverage/concentration guardrails with warn/critical thresholds), `Session Clock` (UTC + Asia/London/New York indicators, no backend needed), `Candle Chart` (OHLCV candlesticks with indicator overlays — see below). Preset pages (Overview, Trading, Markets, Performance, Risk, System) are dense grids — one widget per cell, mixed spans, nothing hidden behind tabs.

### Candles + indicators (TradingView libraries)

Market data flows `freqtrade → backend → widget` through new contract endpoints: `Instances.pairs` (`available_pairs`, needs `market:read`), `Instances.candles` (`pair_candles` normalized to `{ time, open, high, low, close, volume }`, needs `market:read`), and `Instances.plotConfig` (strategy indicator metadata, needs `market.indicators:read`). Rendering is TradingView's `lightweight-charts` (canvas candles, volume histogram, crosshair, pan/zoom, synced RSI/MACD subplot); indicator math is `lightweight-charts-indicators` (PineScript-compatible SMA/EMA/Bollinger/RSI/MACD). The `Candle Chart` widget splits capabilities per feature: `market:read` unlocks candles, `market.indicators:read` unlocks overlays — a user with only the former still gets the chart with indicators locked.

## License

Copyright (C) 2026 Laode Muhammad Al Fatih (<lamualfa@gmail.com>)

Licensed under the **[Server Side Public License v1](./LICENSE)** (SSPL-1.0).

You may run, study, and modify nfi-desk freely, including for internal use. If you make the program (or a modified version) available as a service to third parties, the SSPL requires you to open-source the complete service stack — see [LICENSE](./LICENSE) §13 for the exact terms.
