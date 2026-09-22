# SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
# SPDX-License-Identifier: SSPL-1.0

# nfi-desk — single-container image.
#
# The builder compiles the SAME single-file binary that the GitHub release
# workflow ships (bun build --compile: server + API + SSE + embedded web
# shell, sqlite via bun:sqlite), so the runtime image needs nothing but
# glibc + CA certificates. See DEPLOYMENT.md for the full production guide.
#
#   docker build -t nfi-desk .
#   docker run -p 4000:4000 -v nfi-desk-data:/data nfi-desk
#
# Cross-compile for another host arch on the same machine:
#
#   docker build --build-arg TARGETPLATFORM=linux/arm64 -t nfi-desk:arm64 .

# ---------------------------------------------------------------------------
# Builder: install workspace, build the web shell, compile the binary
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS builder

RUN corepack enable && npm install -g bun

WORKDIR /app

# Workspace manifests first so `pnpm install` layer-caches independently of
# source changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/api-contract/package.json packages/api-contract/
COPY packages/capabilities/package.json packages/capabilities/
COPY packages/db/package.json packages/db/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/freqtrade-client/package.json packages/freqtrade-client/
COPY packages/typescript-config/package.json packages/typescript-config/
COPY packages/ui/package.json packages/ui/
COPY packages/widget-sdk/package.json packages/widget-sdk/
COPY packages/widgets/package.json packages/widgets/
RUN pnpm install --frozen-lockfile

# Sources (node_modules etc. are excluded by .dockerignore, keeping the
# installed tree from the step above intact).
COPY . .

# Map the automatic TARGETPLATFORM arg onto bun's compile targets.
ARG TARGETPLATFORM=linux/amd64
RUN pnpm --filter @nfi/web build \
  && node scripts/embed-web-dist.mjs \
  && case "$TARGETPLATFORM" in \
       linux/arm64) BUN_TARGET="bun-linux-arm64" ;; \
       *) BUN_TARGET="bun-linux-x64" ;; \
     esac \
  && bun build --compile --target="$BUN_TARGET" --outfile=/out/nfi-desk apps/server/src/binary.ts

# ---------------------------------------------------------------------------
# Runtime: just the binary
# ---------------------------------------------------------------------------
FROM debian:bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --home-dir /data nfi

COPY --from=builder /out/nfi-desk /usr/local/bin/nfi-desk

USER nfi
WORKDIR /data
# HOST=0.0.0.0: port mapping needs the bind inside the container to cover
# every interface (the binary's own default is loopback-only).
ENV PORT=4000 \
    HOST=0.0.0.0 \
    SQLITE_PATH=/data/nfi-desk.db
VOLUME /data
EXPOSE 4000

ENTRYPOINT ["/usr/local/bin/nfi-desk"]
