# Multi-stage build for the UniFi Dashboard.
# Stage 1: build the React frontend.
# Stage 2: install server deps (incl. native better-sqlite3) and run.

FROM node:22-alpine AS frontend
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json bun.lock ./
# bun is faster but isn't in node:alpine — use npm which respects the lockfile fallback.
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine AS server
WORKDIR /app
# wget is used by the HEALTHCHECK; sqlite for ad-hoc debugging from `docker exec`.
RUN apk add --no-cache python3 make g++ sqlite wget tini
COPY server/package.json server/package.json
RUN cd server && npm install --no-audit --no-fund
COPY server ./server
COPY --from=frontend /app/dist/client ./dist

ENV NODE_ENV=production \
    HTTP_PORT=8095 \
    SYSLOG_UDP_PORT=514 \
    DB_PATH=/data/unifi.db \
    CONFIG_PATH=/data/config.json
# All other settings (UniFi creds, retention policy, session secret) live in
# /data/config.json and are managed from the Settings page in the UI.


VOLUME ["/data"]
EXPOSE 8095/tcp
EXPOSE 514/udp

# Healthcheck hits the unauthenticated /api/health endpoint; returns DB stats too.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${HTTP_PORT}/api/health" >/dev/null || exit 1

WORKDIR /app/server
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["npm", "start"]
