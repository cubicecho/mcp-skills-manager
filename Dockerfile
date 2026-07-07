# syntax=docker/dockerfile:1

# ── Stage 1: build ────────────────────────────────────────────────────────────
# Full node image (matches engines >=22.18); builds shared/server/app workspaces.
FROM node:26-slim AS builder

WORKDIR /app

# Copy workspace manifests first so the dependency layer caches independently
# of source changes.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY app/package.json ./app/

RUN npm ci

# Copy the rest of the source (.dockerignore excludes node_modules, data, dist, .git)
COPY . .

# shared typecheck → server tsc (server/dist) → app vite build (app/dist)
RUN npm run build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
# Unlike a proxy/gateway, this server never spawns child processes or installs
# packages at runtime — it only reads flat files from /data and serves markdown.
# A slim node image is all it needs.
FROM node:26-slim

WORKDIR /app

# Workspace manifests + production dependencies. `npm ci --omit=dev` also
# creates the node_modules/@mcp-skills/shared → ../../shared workspace symlink
# that the server needs at runtime (see below).
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY app/package.json ./app/

RUN npm ci --omit=dev && npm cache clean --force

# NOTE: @mcp-skills/shared is a source-only TS package — its package.json
# exports point at ./src/index.ts, and server's tsc build compiles only
# server/src, leaving `import ... from '@mcp-skills/shared'` in server/dist as
# a bare specifier. At runtime Node resolves it through the workspace symlink
# to /app/shared/src/index.ts (outside node_modules after realpath), which
# Node >=23.6 (and thus 26) type-strips natively — so `node server/dist/index.js`
# works with no flags as long as shared/ source is present.
COPY shared ./shared

COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/app/dist ./app/dist

ENV NODE_ENV=production
# Skills, profiles, and settings all live under /data — mount a volume here to
# persist them (and to hand-edit skill markdown on the host).
ENV DATA_DIR=/data

RUN mkdir -p /data

VOLUME /data

EXPOSE 3000

# /api/status answers 200 when auth is off and 401 when auth is on — both mean
# the server is up, so treat anything below 500 as healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e 'fetch("http://localhost:" + (process.env.PORT || 3000) + "/api/status").then((r) => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))'

CMD ["node", "server/dist/index.js"]
