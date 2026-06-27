# UniFi Dashboard

Self-hosted, single-container dashboard for a UniFi Dream Router (or any UniFi
controller). Acts as a **syslog server** for your UniFi devices, polls the
controller's local API for live client/device/health data, stores everything in
an embedded SQLite database with FTS5 full-text search, and serves a dark NOC-
style web UI.

Designed to run as a single Docker container on Unraid with no other moving
parts.

## What it shows

- **Overview** — total clients, wired vs wireless split, live WAN throughput,
  average client satisfaction, top talkers by RX/TX.
- **Clients** — sortable, searchable client table (hostname, MAC, IP, AP /
  switch port, signal, satisfaction, RX/TX rate + totals, last-seen).
- **Network** — WAN status, latency, gateway CPU/memory, per-AP airtime,
  channel utilization (2.4 / 5 / 6 GHz), client load.
- **Firewall** — parsed firewall + STA-tracker events with severity, reason
  decoding, client name lookup, raw JSON drill-down, filters by action and
  free-text.
- **Logs** — raw syslog from all UniFi devices, FTS5-backed search, severity
  and host facets.
- **Settings** — environment-variable reference and UniFi setup instructions.

## Architecture

One container does it all:

```
┌─────────────── unifi-dashboard ───────────────┐
│  UDP :514  → syslog parser → SQLite + FTS5    │
│  HTTP :3000 → REST + WS + static React UI     │
│  worker    → UniFi API poller (every 10s)     │
│  volume    → /data/unifi.db                   │
└───────────────────────────────────────────────┘
```

Frontend: React + TanStack Router + Tailwind v4 + Recharts.
Runtime: Node 22, Fastify, `better-sqlite3`, plain `dgram` UDP listener,
`undici` for UniFi API (self-signed cert tolerated).

## Quick start

```bash
git clone https://github.com/<you>/unifi-dashboard.git
cd unifi-dashboard
docker build -t unifi-dashboard .

# create your env, then:
docker run -d --name unifi-dashboard \
  -p 3000:3000 -p 514:514/udp \
  -v /mnt/user/appdata/unifi-dashboard:/data \
  -e UNIFI_HOST=192.168.1.1 \
  -e UNIFI_USER=readonly \
  -e UNIFI_PASSWORD=... \
  -e DASH_USER=admin \
  -e DASH_PASSWORD=... \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  unifi-dashboard
```

Or use the included `docker-compose.example.yml`.

Open <http://your-unraid-ip:3000>, sign in with `DASH_USER` / `DASH_PASSWORD`.

## Environment variables

| Variable                  | Required | Default          | Description                                                  |
|---------------------------|----------|------------------|--------------------------------------------------------------|
| `UNIFI_HOST`              | no¹      | —                | Controller IP/hostname (e.g. `192.168.1.1`)                  |
| `UNIFI_USER`              | yes¹     | —                | Read-only UniFi local user                                   |
| `UNIFI_PASSWORD`          | yes¹     | —                | Password for that user                                       |
| `UNIFI_SITE`              | no       | `default`        | UniFi site name                                              |
| `SYSLOG_UDP_PORT`         | no       | `514`            | UDP port the syslog listener binds to                        |
| `HTTP_PORT`               | no       | `3000`           | HTTP port for the dashboard                                  |
| `DB_PATH`                 | no       | `/data/unifi.db` | SQLite file path                                             |
| `RETENTION_DAYS`          | no       | `30`             | Drop syslog rows older than N days                           |
| `RETENTION_FIREWALL_DAYS` | no       | `RETENTION_DAYS` | Drop firewall events older than N days                       |
| `RETENTION_MAX_DB_MB`     | no       | `2048`           | Hard cap on DB size — oldest rows pruned to fit              |
| `RETENTION_INTERVAL_MIN`  | no       | `60`             | How often the cleanup job runs                               |
| `RETENTION_VACUUM_HOURS`  | no       | `24`             | How often to `VACUUM` to actually reclaim disk space         |
| `DASH_USER`               | no       | `admin`          | Dashboard login username                                     |
| `DASH_PASSWORD`           | no       | `admin`          | Dashboard login password (forced change on first login)      |
| `SESSION_SECRET`          | yes      | —                | 32+ random chars, encrypts the session cookie                |

¹ If `UNIFI_HOST` is unset, API polling is disabled — the syslog half still
works. If you set `UNIFI_HOST` you must also set `UNIFI_USER` / `UNIFI_PASSWORD`.

Generate `SESSION_SECRET` with `openssl rand -hex 32`.

## Retention & cleanup

Three layered policies keep the SQLite DB from growing unbounded on Unraid:

1. **Age — syslog** (`RETENTION_DAYS`): rows older than N days are deleted.
2. **Age — firewall** (`RETENTION_FIREWALL_DAYS`): parsed firewall events are
   pruned on their own schedule (useful if you want long firewall history but
   short noisy syslog history).
3. **Size cap** (`RETENTION_MAX_DB_MB`): a hard ceiling on on-disk DB size.
   When exceeded, the oldest syslog rows are deleted in batches until the file
   fits — protects you from a single noisy device filling the share.

Cleanup runs every `RETENTION_INTERVAL_MIN` minutes (default hourly) and
`VACUUM` runs every `RETENTION_VACUUM_HOURS` (default daily) to actually
return freed pages to the filesystem. Stats and a "Run cleanup now" button
are available under **Settings**, and the same data is exposed at
`GET /api/retention` / `POST /api/retention/run`.

## Health checks

The container ships with a built-in `HEALTHCHECK` that hits
`GET /api/health` every 30s. The endpoint returns uptime, DB size, row
counts, and the last retention run, so the same probe doubles as a sanity
check from `docker ps` or the Unraid UI.

## UniFi setup

1. **Create a read-only user.** In the UniFi console → Admins → invite a new
   local user with the `View Only` role.
2. **Point syslog at the container.** Settings → System → Remote Logging →
   enable forwarding to your Unraid IP, UDP port 514, all levels you want.
3. (Optional, recommended) Pin the container to your management network so
   the syslog stream isn't traversing VLAN boundaries.

## Unraid notes

- Persist `/data` on a share (`/mnt/user/appdata/unifi-dashboard` is the
  convention).
- Port 514 must not already be in use by another container.
- Easiest path is **host networking** — the syslog source IP then matches the
  real UniFi device IP, which the parser stores in the `host` field. On
  bridge mode, all messages appear to come from the Docker gateway.
- The included `docker-compose.example.yml` covers all of the above and can
  be dropped into Unraid's Compose Manager plugin verbatim.

## Development

The React UI is the Lovable preview's responsibility — it iterates against
mock data in `src/lib/mock-data.ts` so every screen is designable without a
real UniFi controller.

The `/server/` directory is the runtime that ships in the container. Lovable's
preview does **not** run it (no UDP/514, no native modules). To work on the
server locally:

```bash
cd server
npm install
DASH_USER=admin DASH_PASSWORD=admin SESSION_SECRET=$(openssl rand -hex 32) \
  npm start
```

The frontend talks to `/api/*` in production. In the Lovable preview the same
client code falls back to mock data so the UI is fully usable.

## License

MIT.
