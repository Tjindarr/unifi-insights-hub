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
import { UnifiClient } from "./unifi/client.ts";
import { makeAuth } from "./auth.ts";
import { registerApi } from "./api/routes.ts";

const here = dirname(fileURLToPath(import.meta.url));
const env = (k: string, fallback?: string) => process.env[k] ?? fallback;
const req = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing required env var ${k}`);
  return v;
};

const HTTP_PORT = Number(env("HTTP_PORT", "3000"));
const SYSLOG_UDP_PORT = Number(env("SYSLOG_UDP_PORT", "514"));
const DB_PATH = env("DB_PATH", "/data/unifi.db")!;
const RETENTION_DAYS = Number(env("RETENTION_DAYS", "30"));

const db = openDb(DB_PATH);
const insertSyslog = makeSyslogInsert(db);
const insertFirewall = makeFirewallInsert(db);

// ---- UDP syslog listener ----

const wsClients = new Set<{ send: (msg: string) => void }>();

const udp = createSocket("udp4");
udp.on("message", (buf, rinfo) => {
  const line = buf.toString("utf8");
  try {
    const parsed = parseSyslog(line, rinfo.address);
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

// ---- UniFi poller ----

const unifiHost = env("UNIFI_HOST");
if (unifiHost) {
  const unifi = new UnifiClient({
    host: unifiHost,
    user: req("UNIFI_USER"),
    password: req("UNIFI_PASSWORD"),
    site: env("UNIFI_SITE", "default")!,
  });
  const poll = async () => {
    try {
      const [clients, devices, health] = await Promise.all([
        unifi.clients(),
        unifi.devices(),
        unifi.health(),
      ]);
      // UniFi wraps in { data: [...] }
      const unwrap = (x: unknown) =>
        x && typeof x === "object" && "data" in (x as Record<string, unknown>)
          ? (x as { data: unknown }).data
          : x;
      setSnapshot(db, "unifi_clients_snapshot", unwrap(clients));
      setSnapshot(db, "unifi_devices_snapshot", unwrap(devices));
      setSnapshot(db, "unifi_health_snapshot", unwrap(health));
    } catch (err) {
      console.error("[unifi] poll failed", err);
    }
  };
  poll();
  setInterval(poll, 10_000);
} else {
  console.warn("[unifi] UNIFI_HOST not set — API polling disabled");
}

// ---- Retention ----

setInterval(() => {
  try {
    const removed = pruneOlderThan(db, RETENTION_DAYS);
    if (removed) console.log(`[prune] removed ${removed} rows older than ${RETENTION_DAYS}d`);
  } catch (err) {
    console.error("[prune] failed", err);
  }
}, 6 * 3600_000);

// ---- HTTP server ----

const auth = makeAuth({
  db,
  secret: req("SESSION_SECRET"),
  // Optional first-run seed override; defaults to admin / admin and forces
  // a password change on first successful login.
  seedUser: env("DASH_USER"),
  seedPassword: env("DASH_PASSWORD"),
});

const app = Fastify({ logger: { level: "info" } });
await app.register(cookie);
await app.register(websocket);

await registerApi(app, { db, auth });

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
