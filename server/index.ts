// UniFi Dashboard — single-container runtime.
// Listens on UDP/514 for syslog, polls the UniFi controller, serves the
// built React bundle + REST API + WebSocket on HTTP_PORT.

import { createSocket } from "node:dgram";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

import Fastify from "fastify";
import cookie from "@fastify/cookie";
import staticFiles from "@fastify/static";
import websocket from "@fastify/websocket";

import {
  openDb,
  makeSyslogInsert,
  makeFirewallInsert,
  pruneOlderThan,
  pruneFirewallOlderThan,
  pruneToMaxSize,
  vacuum,
  dbStats,
  setSnapshot,
} from "./db/queries.ts";
import { parseSyslog } from "./syslog/parser.ts";
import { extractFirewall } from "./syslog/unifi-firewall.ts";
import { recordParse } from "./syslog/parse-health.ts";
import {
  applyNoiseFilter,
  extract as extractEnrichments,
  makeEnricherInserts,
  pruneEnrichmentsOlderThan,
} from "./syslog/enrichers.ts";
import { UnifiManager } from "./unifi/manager.ts";
import { makeAuth } from "./auth.ts";
import { registerApi } from "./api/routes.ts";
import { ConfigStore } from "./config.ts";
import { ThreatFeedManager } from "./threat/feeds.ts";

const here = dirname(fileURLToPath(import.meta.url));
const env = (k: string, fallback?: string) => process.env[k] ?? fallback;

const HTTP_PORT = Number(env("HTTP_PORT", "8095"));
const SYSLOG_UDP_PORT = Number(env("SYSLOG_UDP_PORT", "514"));
const DB_PATH = env("DB_PATH", "/data/unifi.db")!;
const CONFIG_PATH = env("CONFIG_PATH", "/data/config.json")!;

// Persistent config in /data — survives container updates. Env vars only seed
// the file on first launch; the UI is the source of truth thereafter.
const config = new ConfigStore(CONFIG_PATH);

const db = openDb(DB_PATH);
const insertSyslog = makeSyslogInsert(db);
const insertFirewall = makeFirewallInsert(db);
const enrichers = makeEnricherInserts(db);

// counters for /api/collector
const counters = { dropped: 0, downgraded: 0, enriched: 0 };
export { counters as syslogCounters };


// ---- UDP syslog listener ----

const wsClients = new Set<{ send: (msg: string) => void }>();

const udp = createSocket("udp4");
udp.on("message", (buf, rinfo) => {
  const line = buf.toString("utf8");
  try {
    const parsed = parseSyslog(line, rinfo.address, config.get().syslog);

    // Noise filter — drop or downgrade chatty patterns before they hit the DB.
    const decision = applyNoiseFilter(parsed, config.get().noiseFilter);
    if (decision.drop) {
      counters.dropped++;
      return;
    }
    if (decision.downgradeTo) {
      parsed.severity = decision.downgradeTo;
      counters.downgraded++;
    }

    const info = insertSyslog.run({
      time: parsed.time,
      host: parsed.host,
      appname: parsed.appname,
      facility: parsed.facility,
      severity: parsed.severity,
      message: parsed.message,
      raw: parsed.raw,
      is_firewall: parsed.isFirewall ? 1 : 0,
    });

    if (parsed.isFirewall) {
      const fw = extractFirewall(parsed.message, parsed.appname);
      insertFirewall.run({
        syslog_id: info.lastInsertRowid,
        time: parsed.time,
        rule: fw.rule,
        action: fw.action,
        event_type: fw.event_type,
        message_type: fw.message_type,
        client_mac: fw.client_mac,
        src_ip: fw.src_ip,
        src_port: fw.src_port,
        dst_ip: fw.dst_ip,
        dst_port: fw.dst_port,
        proto: fw.proto,
        vap: fw.vap,
        rssi: fw.rssi,
        reason: fw.reason,
        raw_json: fw.raw_json,
      });
    }

    // Enrichments: MAC↔IP, DHCP leases, Wi-Fi auth events
    const enr = extractEnrichments(parsed);
    if (enr.staIp || enr.dhcp || enr.wifiAuth) {
      enrichers.apply(parsed, enr);
      counters.enriched++;
    }

    if (wsClients.size) {
      const msg = JSON.stringify({ type: "syslog", entry: { ...parsed, id: info.lastInsertRowid } });
      for (const c of wsClients) {
        try { c.send(msg); } catch { /* drop */ }
      }
    }
  } catch (err) {
    console.error("syslog parse error", err);
  }
});
udp.on("listening", () => {
  const a = udp.address();
  console.log(`[syslog] listening on udp://${a.address}:${a.port}`);
});
udp.bind(SYSLOG_UDP_PORT);

// ---- UniFi poller (hot-reloads when settings change) ----

const unifi = new UnifiManager(db);
unifi.apply(config.get().unifi);
config.onChange((cfg) => unifi.apply(cfg.unifi));

// ---- Threat feed manager (offline IP/CIDR blocklists) ----
const threatFeeds = new ThreatFeedManager(db, config);
threatFeeds.start();

// ---- Retention / cleanup ----
// Three layered policies, all set in the UI and stored in /data/config.json:
//   1. retentionDays         — drop syslog rows older than N days
//   2. retentionFirewallDays — drop firewall_events older than N days
//   3. maxDbMb               — hard cap on on-disk DB size; oldest rows pruned to fit
// VACUUM runs every vacuumHours to actually return space to disk.

let lastVacuum = 0;
let retentionTimer: NodeJS.Timeout | null = null;

export const retention = {
  last: null as null | {
    at: number;
    bySyslogAge: number;
    byFirewallAge: number;
    bySize: number;
    sizeBytesBefore: number;
    sizeBytesAfter: number;
    vacuumed: boolean;
  },
};

function runRetention() {
  const r = config.get().retention;
  const before = dbStats(db).sizeBytes;
  const bySyslogAge = pruneOlderThan(db, r.retentionDays);
  const byFirewallAge = pruneFirewallOlderThan(db, r.retentionFirewallDays);
  const bySize = pruneToMaxSize(db, r.maxDbMb * 1024 * 1024);
  // Enrichment tables share the syslog retention window.
  pruneEnrichmentsOlderThan(db, r.retentionDays);
  const now = Date.now();
  let vacuumed = false;
  if (now - lastVacuum > r.vacuumHours * 3600_000) {
    vacuum(db);
    lastVacuum = now;
    vacuumed = true;
  }
  const after = dbStats(db).sizeBytes;
  retention.last = {
    at: now, bySyslogAge, byFirewallAge, bySize,
    sizeBytesBefore: before, sizeBytesAfter: after, vacuumed,
  };
  if (bySyslogAge || byFirewallAge || bySize || vacuumed) {
    console.log(
      `[retention] syslog=${bySyslogAge} fw=${byFirewallAge} size=${bySize} ` +
        `before=${before} after=${after} vacuum=${vacuumed}`,
    );
  }
}

function scheduleRetention() {
  if (retentionTimer) clearInterval(retentionTimer);
  const min = Math.max(1, config.get().retention.intervalMin);
  retentionTimer = setInterval(() => {
    try { runRetention(); } catch (err) { console.error("[retention] failed", err); }
  }, min * 60_000);
}

try { runRetention(); } catch (err) { console.error("[retention] failed", err); }
scheduleRetention();
config.onChange(scheduleRetention);

// ---- HTTP server ----

const auth = makeAuth({
  db,
  secret: config.get().sessionSecret,
  seedUser: env("DASH_USER"),
  seedPassword: env("DASH_PASSWORD"),
});

const app = Fastify({ logger: { level: "info" } });
await app.register(cookie);
await app.register(websocket);

await registerApi(app, {
  db,
  auth,
  config,
  unifi,
  retention: { state: retention, run: runRetention },
  threatFeeds,
});



app.get("/ws", { websocket: true }, (conn, req) => {
  const cookies = (req.headers.cookie ?? "")
    .split(";")
    .map((s) => s.trim().split("="))
    .reduce<Record<string, string>>((a, [k, v]) => ((a[k] = v), a), {});
  if (!auth.verifyCookie(cookies[auth.cookieName])) {
    conn.socket.close(4401, "unauthorized");
    return;
  }
  const handle = { send: (m: string) => conn.socket.send(m) };
  wsClients.add(handle);
  conn.socket.on("close", () => wsClients.delete(handle));
});

// Static UI (built by `vite build`)
const uiRoot = join(here, "..", "dist");
if (existsSync(uiRoot)) {
  await app.register(staticFiles, { root: uiRoot, prefix: "/", wildcard: false });
  // SPA fallback — serve index.html for any non-API GET that isn't a file
  app.setNotFoundHandler((req, reply) => {
    if (req.method !== "GET" || req.url.startsWith("/api/")) return reply.code(404).send({ ok: false });
    return reply.sendFile("index.html");
  });
} else {
  console.warn(`[ui] ${uiRoot} not found — UI bundle missing, API only`);
}

await app.listen({ host: "0.0.0.0", port: HTTP_PORT });
console.log(`[http] listening on :${HTTP_PORT}`);
