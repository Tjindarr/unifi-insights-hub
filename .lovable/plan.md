
# UniFi Dashboard — Plan

## Architecture note (read first)

Lovable's runtime is Cloudflare Workers (edge). It **cannot** bind UDP/TCP port 514, run native modules like `better-sqlite3`, or ship as a self-contained Unraid Docker image. To meet "single container on Unraid, syslog server, very fast search", the GitHub repo will contain two cooperating pieces that ship as **one Docker image**:

1. **Frontend dashboard** — React + TanStack Router + Tailwind. Built and iterated in Lovable preview against mock data.
2. **Runtime server** — hand-authored Node.js process in `/server/` (not run by Lovable preview). Listens on UDP/514, writes SQLite+FTS5, polls UniFi API, serves the built UI + REST/WS on port 3000.

The Lovable preview uses mock UniFi data so every screen is designable here. Real ingestion only runs when you `docker build` and deploy on Unraid.

If that split is a dealbreaker, stop here — Lovable isn't the right tool for the runtime half.

## Container shape

```text
unifi-dashboard (one image, Node 22 alpine)
├── UDP :514   → syslog listener → parser → SQLite
├── HTTP :3000 → REST + WS + static React bundle (+ login)
├── Worker     → UniFi API poller (every 10s)
└── /data/unifi.db  (SQLite WAL + FTS5, mounted volume)
```

Retention: 30 days, nightly prune. FTS5 keeps search <50ms on millions of rows.

## Auth

Single shared user + password login (your decision). Credentials from env (`DASH_USER`, `DASH_PASSWORD`). Server-side timing-safe compare, encrypted session cookie (`SESSION_SECRET`). One unlock screen, no signup, no roles.

## Dashboard surfaces

- `/` **Overview** — total clients, wireless vs wired split, current WAN up/down sparkline, avg client satisfaction, top 10 talkers (RX/TX).
- `/clients` — sortable table: hostname, MAC, IP, AP/switch port, signal, satisfaction, RX/TX rate + totals. Row → client detail with traffic history.
- `/network` — WAN/LAN throughput, per-AP airtime, channel utilization, site health tiles.
- `/firewall` — parsed firewall + STA-tracker event stream (details below).
- `/logs` — raw syslog search across all devices (FTS5), facets: severity, facility, host, time range, saved queries.
- `/settings` — UniFi controller URL, credentials status, retention.

## Firewall log presentation

Parser handles your UniFi format:
1. Strip syslog envelope (`<14>Jun 27 …`).
2. Detect `is_firewall: true` or embedded JSON in `log_message`.
3. Extract `message_type`, `event_type`, `mac`, `vap`, `assoc_status`, `deauth_reason`, `auth_rssi`, `firewall_rule`, src/dst IP/port, action.
4. Join MAC → client name from UniFi API.

UI: timeline grouped by event type, color-coded severity, expandable row reveals raw JSON. Filters: rule, action, client, src/dst IP, time range. Saved searches. No alerting (your decision — can be added later).

## Design

Dark, clean NOC-style theme (your decision). High-density data tables, monospace for IPs/MACs, restrained color (one accent for live activity, semantic red/amber/green for severity). Tailwind v4 tokens defined in `src/styles.css`. Charts via Recharts.

## Tech

- **Frontend**: React 19, TanStack Router, TanStack Query, Tailwind v4, shadcn/ui, Recharts, WebSocket for live tiles.
- **Runtime** (`/server/`, hand-authored): Node 22, `dgram` UDP, `better-sqlite3` + FTS5, `ws`, `undici` for UniFi API (accepts self-signed cert).
- **Build**: `vite build` → `dist/`; Dockerfile copies `dist/` next to compiled server.

## Repo layout

```text
/Dockerfile
/docker-compose.example.yml
/README.md                # build + Unraid + UniFi setup steps
/server/                  # Node runtime — NOT touched by Lovable preview
  index.ts                # boot UDP + HTTP + poller + auth
  auth.ts                 # session + login
  syslog/parser.ts
  syslog/unifi-firewall.ts
  db/schema.sql           # tables + FTS5
  db/queries.ts
  unifi/client.ts         # API poller
  api/routes.ts
/src/                     # React app — Lovable iterates here
  routes/...
  lib/api.ts              # talks to /api/* (real in prod, mock in dev)
  lib/mock-data.ts
```

## Container env

```text
UNIFI_HOST=192.168.1.1
UNIFI_USER=readonly
UNIFI_PASSWORD=...
UNIFI_SITE=default
SYSLOG_UDP_PORT=514
HTTP_PORT=3000
RETENTION_DAYS=30
DB_PATH=/data/unifi.db
DASH_USER=admin
DASH_PASSWORD=...
SESSION_SECRET=...        # 32+ random chars
```

## Build phases

1. **Scaffold UI + mock data** — dark theme tokens, layout shell, navigation, login screen, all routes rendering against mock data.
2. **Overview + Clients + Network** pages with charts.
3. **Firewall + raw log search** UI driven by the mock dataset.
4. **`/server/` + Dockerfile** — UDP syslog listener, SQLite+FTS5 schema, UniFi poller, REST/WS API matching the mock shape, login + session.
5. **README** — `docker build`, Unraid template hints, UniFi read-only user creation, syslog forwarding setup.
