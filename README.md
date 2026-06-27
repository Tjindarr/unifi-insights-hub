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

| Variable           | Required | Default            | Description                                       |
|--------------------|----------|--------------------|---------------------------------------------------|
| `UNIFI_HOST`       | no¹      | —                  | Controller IP/hostname (e.g. `192.168.1.1`)        |
| `UNIFI_USER`       | yes¹     | —                  | Read-only UniFi local user                         |
| `UNIFI_PASSWORD`   | yes¹     | —                  | Password for that user                             |
| `UNIFI_SITE`       | no       | `default`          | UniFi site name                                    |
| `SYSLOG_UDP_PORT`  | no       | `514`              | UDP port the syslog listener binds to              |
| `HTTP_PORT`        | no       | `3000`             | HTTP port for the dashboard                        |
| `DB_PATH`          | no       | `/data/unifi.db`   | SQLite file path                                   |
| `RETENTION_DAYS`   | no       | `30`               | Rolling retention for syslog history               |
| `DASH_USER`        | yes      | —                  | Dashboard login username                           |
| `DASH_PASSWORD`    | yes      | —                  | Dashboard login password                           |
| `SESSION_SECRET`   | yes      | —                  | 32+ random chars, encrypts the session cookie      |

¹ If `UNIFI_HOST` is unset, API polling is disabled — the syslog half still
works. If you set `UNIFI_HOST` you must also set `UNIFI_USER` / `UNIFI_PASSWORD`.

Generate `SESSION_SECRET` with `openssl rand -hex 32`.

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
- If you're on the `bridge` Docker network, the container's IP is what you
  put in the UniFi syslog target — easier to set the network mode to
  `host` so the syslog source IP shows the real device IP in the parsed
  `host` field.

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
