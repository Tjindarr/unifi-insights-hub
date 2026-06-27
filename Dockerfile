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
RUN apk add --no-cache python3 make g++ sqlite
COPY server/package.json server/package.json
RUN cd server && npm install --no-audit --no-fund
COPY server ./server
COPY --from=frontend /app/dist ./dist

ENV NODE_ENV=production \
    HTTP_PORT=3000 \
    SYSLOG_UDP_PORT=514 \
    DB_PATH=/data/unifi.db \
    RETENTION_DAYS=30

VOLUME ["/data"]
EXPOSE 3000/tcp
EXPOSE 514/udp

WORKDIR /app/server
CMD ["npm", "start"]
