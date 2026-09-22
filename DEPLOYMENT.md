# Deploying nfi-desk (production)

nfi-desk ships as **one process that serves everything** — the web terminal, the REST + SSE API and the SQLite store — on a single port (default `4000`). No separate web server, no CORS setup, no database server. Pick one of the paths below; all of them end at the same first-run screen.

- [A. Docker Compose (recommended)](#a-docker-compose-recommended)
- [B. Single binary from the releases page](#b-single-binary-from-the-releases-page)
- [C. Plain `docker run`](#c-plain-docker-run)
- [D. From source with Node](#d-from-source-with-node)
- [First-run setup](#first-run-setup)
- [Connecting freqtrade](#connecting-freqtrade)
- [Environment reference](#environment-reference)
- [HTTPS / reverse proxy](#https--reverse-proxy)
- [Data, backups, upgrades](#data-backups-upgrades)
- [Security notes](#security-notes)

---

## A. Docker Compose (recommended)

Requirements: Docker with the Compose plugin.

1. Clone and configure:

   ```sh
   git clone https://github.com/lamualfa/NostalgiaForInfinityDashboard.git
   cd NostalgiaForInfinityDashboard
   cp apps/server/.env.example .env   # then edit — at minimum the values below
   ```

   Minimal `.env` (everything is optional — you can also do it all in the UI after boot):

   ```sh
   ROOT_USERNAME=admin
   ROOT_PASSWORD=a-long-random-password
   FREQTRADE_URL=http://freqtrade:8080      # or see "Connecting freqtrade"
   FREQTRADE_USERNAME=freqtrader
   FREQTRADE_PASSWORD=your-freqtrade-api-password
   ```

2. Start:

   ```sh
   docker compose up -d --build
   ```

3. Open `http://your-server:4000` and sign in as the root user you configured.

The SQLite database (snapshots, users, instances, workspaces) lives in the `nfi-desk-data` volume at `/data/nfi-desk.db` — it survives container rebuilds. Logs: `docker compose logs -f nfi-desk`.

## B. Single binary from the releases page

Every [release](https://github.com/lamualfa/NostalgiaForInfinityDashboard/releases) ships self-contained binaries for Linux (x64, arm64), macOS (x64, arm64) and Windows (x64). One file, ~100 MB, no runtime to install — the server, the API and the web terminal are all inside. Downloads are public — no token needed.

```sh
# Linux/macOS — one line: newest release, right architecture, running.
curl -fsSL -o nfi-desk "https://github.com/lamualfa/NostalgiaForInfinityDashboard/releases/latest/download/nfi-desk-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/aarch64/arm64/;s/x86_64/x64/')" && chmod +x nfi-desk && ./nfi-desk
```

```sh
# or pin a version explicitly (swap the latest/download path segment for
# download/<tag>):
curl -fsSL -o nfi-desk \
  https://github.com/lamualfa/NostalgiaForInfinityDashboard/releases/download/v0.2.0/nfi-desk-linux-x64
chmod +x nfi-desk
./nfi-desk                        # → http://localhost:4000
```

Useful defaults for the binary: the database is `./nfi-desk.db` in the working directory (override with `SQLITE_PATH`), the port is `4000` (override with `PORT`), it listens on loopback only (open it up to your network with `HOST=0.0.0.0`), and on boot it prints the local URL and opens it in your browser (`OPEN_BROWSER=0` to disable — headless servers). Options come from environment variables or a `.env` file next to the binary — see the [reference](#environment-reference).

Run it as a service with systemd (Linux):

```ini
# /etc/systemd/system/nfi-desk.service
[Unit]
Description=nfi-desk freqtrade terminal
After=network-online.target

[Service]
User=nfi-desk
WorkingDirectory=/opt/nfi-desk
Environment=PORT=4000
Environment=ROOT_USERNAME=admin
EnvironmentFile=/opt/nfi-desk/.env    # optional
ExecStart=/opt/nfi-desk/nfi-desk-linux-x64
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl enable --now nfi-desk
```

## C. Plain `docker run`

```sh
docker build -t nfi-desk .
docker run -d --name nfi-desk \
  -p 4000:4000 \
  -e ROOT_USERNAME=admin -e ROOT_PASSWORD=a-long-random-password \
  -e FREQTRADE_URL=http://host.docker.internal:8080 \
  -e FREQTRADE_USERNAME=freqtrader -e FREQTRADE_PASSWORD=secret \
  -v nfi-desk-data:/data \
  --restart unless-stopped \
  nfi-desk
```

On Linux, `host.docker.internal` needs `--add-host=host.docker.internal:host-gateway` (or use the host's IP / a shared Docker network).

## D. From source with Node

Requirements: Node 24+, pnpm 11 (`corepack enable`).

```sh
pnpm install
pnpm build                                   # builds the web shell (and server types)
cd apps/server
cp .env.example .env                         # optional — edit as needed
node --import tsx src/index.ts               # serves web + API on :4000
```

This is the same code path as `pnpm dev`, minus the dev servers: the built web shell is served from `../web/dist` by the backend itself. Running `node dist/index.js` directly is NOT supported — workspace packages ship as TypeScript and need `tsx` (or a bundler) to run.

## First-run setup

1. Open `http://your-server:4000`.
2. If you did **not** set `ROOT_USERNAME`/`ROOT_PASSWORD`, the setup screen asks you to create the root admin (stored server-side; you can reset it by deleting the `root` row from the `users` table — see [Data](#data-backups-upgrades)).
3. Connect your first freqtrade instance — via env (the implicit `default` instance) or the **Instances** widget (as many as you like, stored server-side).
4. Build your terminal. Everything else (users, capabilities, the public read-only share) is managed from the UI.

## Connecting freqtrade

The server talks to freqtrade's REST API (`api_server`); the browser never does. From the freqtrade side, enable the API server with a password and (for the Docker paths) listen on `0.0.0.0`.

Where `FREQTRADE_URL` should point, depending on where freqtrade runs:

| freqtrade location                        | URL from the container / binary                 |
| ----------------------------------------- | ----------------------------------------------- |
| Same compose file (a `freqtrade` service) | `http://freqtrade:8080`                         |
| On the Docker host                        | `http://host.docker.internal:8080` (see note C) |
| Another machine                           | `http://<ip-or-host>:8080`                      |
| Plain binary on the same machine          | `http://127.0.0.1:8080`                         |

**HTTPS between nfi-desk and freqtrade is recommended whenever they cross machines** — use an `https://` URL with a certificate the server trusts.

Additional instances never touch env: add them in the **Instances** widget (URL + credentials, stored in SQLite, never returned to the browser) and every widget gains an instance picker plus **All instances (fleet)**.

## Environment reference

All optional; empty means unset.

| Var                                         | Default (Docker / binary)                     | Purpose                                                                             |
| ------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `PORT`                                      | `4000`                                        | Listen port (web + API on the same port)                                            |
| `HOST`                                      | `0.0.0.0` (Docker) / `127.0.0.1` (binary)     | Bind address — the binary is loopback-only by default; set `0.0.0.0` for LAN/remote |
| `SQLITE_PATH`                               | `/data/nfi-desk.db` (binary: `./nfi-desk.db`) | SQLite file — put it on a persistent volume                                         |
| `ROOT_USERNAME` / `ROOT_PASSWORD`           | —                                             | Virtual root admin; skip the first-run setup screen                                 |
| `FREQTRADE_URL`                             | `http://127.0.0.1:8080`                       | Implicit `default` instance (server-side only)                                      |
| `FREQTRADE_USERNAME` / `FREQTRADE_PASSWORD` | —                                             | Credentials for the `default` instance                                              |
| `FREQTRADE_TIMEOUT_MS`                      | `10000`                                       | freqtrade request timeout                                                           |
| `CORS_ORIGINS`                              | `http://localhost:3000`                       | Only needed if the browser loads the shell from a DIFFERENT origin than this server |
| `SNAPSHOT_INTERVAL_MS`                      | `60000`                                       | SQLite snapshot throttle                                                            |
| `STATIC_DIR`                                | `../web/dist` (Node boots)                    | Web shell directory; the compiled binary ignores it (shell is embedded)             |
| `OPEN_BROWSER`                              | `1` (binary)                                  | Auto-open the terminal in the browser on boot; set `0` for headless servers         |

## HTTPS / reverse proxy

Terminate TLS in front of nfi-desk and keep SSE unbuffered. The whole app is one origin — no special headers beyond pass-through.

Caddy (recommended — automatic certificates):

```caddyfile
desk.example.com {
    reverse_proxy 127.0.0.1:4000
}
```

nginx:

```nginx
server {
    listen 443 ssl;
    server_name desk.example.com;
    ssl_certificate     /etc/letsencrypt/live/desk.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/desk.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE (/api/stream): one multiplexed long-lived connection per browser
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
    }
}
```

If the shell is served cross-origin (advanced setups), set `CORS_ORIGINS` to the shell's origin.

## Data, backups, upgrades

- **What's stored**: one SQLite file — profit/balance snapshots (history charts), users + grants, freqtrade instance credentials, workspaces. Browser-side layout prefs live in the browser's localStorage, not the server.
- **Backup**: copy the SQLite file (hot copy is fine for a dashboard; `sqlite3 <file> ".backup '<dest>'"` for a consistent snapshot). For Docker: `docker run --rm -v nfi-desk-data:/data -v "$PWD":/backup alpine cp /data/nfi-desk.db /backup/`.
- **Upgrades**: replace the binary / `docker compose up -d --build`. Schema migrations run on boot and are idempotent; the database is backward-compatible within a minor version. Sessions are in-memory — a restart logs everyone out.
- **Reset a lost setup-created root**: delete the `root` row from the `users` table (`sqlite3 /data/nfi-desk.db 'DELETE FROM users WHERE id = "root"'` — check your file's exact schema) and the first-run setup screen returns.

## Security notes

- **Network exposure is opt-in.** The single binary and Node boots listen on `127.0.0.1` only — nothing on your network can reach the panel until you set `HOST=0.0.0.0` (or put it behind a reverse proxy). The Docker image binds `0.0.0.0` inside the container because port mapping requires it; prefer publishing on loopback (`-p 127.0.0.1:4000:4000`) and terminating TLS in front for anything reachable from the internet.
- Serve over HTTPS in production (reverse proxy above); session cookies are `HttpOnly` `SameSite=Lax`, plus `Secure` when the login arrives over TLS (directly or via `X-Forwarded-Proto`).
- Repeated failed logins temporarily lock the username (5 failures within 15 minutes → 15-minute lockout, in-memory per server instance).
- The public share (`/public`) exposes only the relative-only capability set — percentages and indices, never absolute balances. Audit what the `anonymous` grant includes on the **Manage users** page.
- freqtrade credentials are stored server-side only and never returned by any API.
- Keep `ROOT_PASSWORD` out of shell history: use an `.env` file, Docker secrets, or your platform's secret store.

---

## License

nfi-desk is licensed under the **Server Side Public License v1** (SSPL-1.0) — see [`LICENSE`](./LICENSE). Running it for yourself or your team is fine; if you offer it (or a modified version) as a service to third parties, the SSPL requires you to make the complete corresponding source of the service available under the SSPL.
