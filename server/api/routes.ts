import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import {
  dbStats,
  getSnapshot,
  recentFirewall,
  recentSyslog,
} from "../db/queries.ts";
import { clientDetails } from "../syslog/enrichers.ts";
import type { makeAuth } from "../auth.ts";
import type { ConfigStore } from "../config.ts";
import { UnifiManager } from "../unifi/manager.ts";

type RetentionState = {
  last: null | {
    at: number;
    bySyslogAge: number;
    byFirewallAge: number;
    bySize: number;
    sizeBytesBefore: number;
    sizeBytesAfter: number;
    vacuumed: boolean;
  };
};

type Deps = {
  db: Database.Database;
  auth: ReturnType<typeof makeAuth>;
  config: ConfigStore;
  unifi: UnifiManager;
  retention: { state: RetentionState; run: () => void };
};

export async function registerApi(
  app: FastifyInstance,
  { db, auth, config, unifi, retention }: Deps,
) {
  // ---- auth ----
  app.post<{ Body: { username: string; password: string } }>("/api/login", async (req, reply) => {
    const { username, password } = req.body ?? ({} as Record<string, string>);
    if (!username || !password) return reply.code(400).send({ ok: false });
    const result = auth.checkCredentials(username, password);
    if (!result.ok) return reply.code(401).send({ ok: false });
    const cookie = auth.issueCookie();
    reply.setCookie(auth.cookieName, cookie, {
      path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 7,
    });
    reply.setCookie("unifi_user", username, {
      path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 24 * 7,
    });
    return { ok: true, mustChange: result.mustChange };
  });

  app.post<{ Body: { currentPassword: string; newPassword: string } }>(
    "/api/change-password",
    async (req, reply) => {
      const cookies = req.cookies as Record<string, string | undefined>;
      if (!auth.verifyCookie(cookies[auth.cookieName])) {
        return reply.code(401).send({ ok: false, error: "unauthorized" });
      }
      const username = cookies["unifi_user"];
      if (!username) return reply.code(401).send({ ok: false, error: "no session user" });
      const { currentPassword, newPassword } = req.body ?? ({} as Record<string, string>);
      if (!currentPassword || !newPassword) {
        return reply.code(400).send({ ok: false, error: "missing fields" });
      }
      const res = auth.changePassword(username, currentPassword, newPassword);
      if (!res.ok) return reply.code(400).send(res);
      return { ok: true };
    },
  );

  app.post("/api/logout", async (_req, reply) => {
    reply.clearCookie(auth.cookieName, { path: "/" });
    return { ok: true };
  });

  app.addHook("preHandler", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (
      req.url === "/api/login" ||
      req.url === "/api/health" ||
      req.url === "/api/change-password" ||
      req.url.startsWith("/api/_debug/")
    ) return;
    const cookie = (req.cookies as Record<string, string | undefined>)[auth.cookieName];
    if (!auth.verifyCookie(cookie)) return reply.code(401).send({ ok: false, error: "unauthorized" });
  });

  const summarize = (v: any): unknown => {
    const redactKey = (k: string) => /pass|token|secret|cookie|csrf|authorization/i.test(k);
    const scalar = (x: any) => {
      if (typeof x === "string") return x.length > 120 ? `${x.slice(0, 120)}…` : x;
      return x;
    };
    const sampleObject = (o: Record<string, any>) => Object.fromEntries(
      Object.entries(o)
        .filter(([k]) => !redactKey(k))
        .slice(0, 30)
        .map(([k, val]) => [k, Array.isArray(val) ? `[array:${val.length}]` : val && typeof val === "object" ? `[object:${Object.keys(val).slice(0, 12).join(",")}]` : scalar(val)]),
    );
    if (v == null) return { present: false };
    if (Array.isArray(v)) return {
      present: true,
      kind: "array",
      length: v.length,
      firstKeys: v[0] && typeof v[0] === "object" ? Object.keys(v[0]).slice(0, 50) : [],
      first: v[0] && typeof v[0] === "object" ? sampleObject(v[0]) : scalar(v[0]),
    };
    if (typeof v !== "object") return { present: true, kind: typeof v, value: scalar(v) };
    const out: Record<string, unknown> = { present: true, kind: "object", keys: Object.keys(v).slice(0, 60), sample: sampleObject(v) };
    for (const key of ["data", "events", "items", "results", "by_app", "by_cat", "applications", "categories"]) {
      if (Array.isArray(v[key])) out[key] = summarize(v[key]);
    }
    return out;
  };

  // Liveness probe — used by Docker HEALTHCHECK.
  app.get("/api/health", async () => {
    const stats = dbStats(db);
    return {
      ok: true,
      uptimeSec: Math.round(process.uptime()),
      db: stats,
      retention: { config: config.get().retention, last: retention.state.last },
      unifi: unifi.getStatus(),
    };
  });

  // ---- Settings (persistent config in /data/config.json) ----
  app.get("/api/settings", async () => ({
    ...config.publicView(),
    unifiStatus: unifi.getStatus(),
  }));

  app.put<{
    Body: {
      unifi?: Partial<{ host: string; user: string; password: string; site: string; enabled: boolean }>;
      retention?: Partial<{
        retentionDays: number; retentionFirewallDays: number;
        maxDbMb: number; intervalMin: number; vacuumHours: number;
      }>;
      noiseFilter?: Partial<{ enabled: boolean; action: "drop" | "downgrade"; patterns: string[] }>;
    };
  }>("/api/settings", async (req, reply) => {
    const body = req.body ?? {};
    const current = config.get();
    const patch: Parameters<typeof config.update>[0] = {};
    if (body.unifi) {
      patch.unifi = {
        ...current.unifi,
        ...body.unifi,
        // Empty-string password from the form means "leave existing password"
        password:
          body.unifi.password === undefined || body.unifi.password === ""
            ? current.unifi.password
            : body.unifi.password,
      };
    }
    if (body.retention) {
      const r = { ...current.retention, ...body.retention };
      const clamp = (n: number, min: number, max: number) =>
        Math.min(max, Math.max(min, Math.floor(Number(n) || 0)));
      r.retentionDays = clamp(r.retentionDays, 0, 3650);
      r.retentionFirewallDays = clamp(r.retentionFirewallDays, 0, 3650);
      r.maxDbMb = clamp(r.maxDbMb, 16, 1024 * 1024);
      r.intervalMin = clamp(r.intervalMin, 1, 1440);
      r.vacuumHours = clamp(r.vacuumHours, 1, 24 * 30);
      patch.retention = r;
    }
    if (body.noiseFilter) {
      const nf = { ...current.noiseFilter, ...body.noiseFilter };
      nf.action = nf.action === "downgrade" ? "downgrade" : "drop";
      nf.patterns = Array.isArray(nf.patterns)
        ? nf.patterns.map((s) => String(s)).filter(Boolean).slice(0, 100)
        : [];
      patch.noiseFilter = nf;
    }
    if (!patch.unifi && !patch.retention && !patch.noiseFilter) {
      return reply.code(400).send({ ok: false, error: "no changes" });
    }
    config.update(patch);
    return { ok: true, ...config.publicView(), unifiStatus: unifi.getStatus() };
  });

  // One-shot connection test (uses the form values, not the saved ones).
  app.post<{ Body: { host: string; user: string; password: string; site?: string } }>(
    "/api/settings/test-unifi",
    async (req) => {
      const { host, user, password, site } = req.body ?? ({} as Record<string, string>);
      if (!host || !user) return { ok: false, error: "host and user required" };
      // Empty password = use saved one
      const effective = password || config.get().unifi.password;
      if (!effective) return { ok: false, error: "password required" };
      return UnifiManager.test({ host, user, password: effective, site: site || "default" });
    },
  );

  // Read current retention policy + last run summary.
  app.get("/api/retention", async () => ({
    config: config.get().retention,
    last: retention.state.last,
    db: dbStats(db),
  }));

  // Force a retention pass immediately. Useful from the Settings page.
  app.post("/api/retention/run", async () => {
    retention.run();
    return { ok: true, last: retention.state.last, db: dbStats(db) };
  });

  // ---- UniFi-derived data (all live-mapped via server/unifi/mappers.ts) ----
  // Pages also have client-side mock fallback when unifi.lastOk = false.
  const snap = <T>(table: string) => getSnapshot<T>(db, table);

  const requireLive = () => unifi.getStatus().lastOk;

  app.get("/api/overview", async (_req, reply) => {
    if (!requireLive()) return reply.code(204).send();
    const clients = snap<unknown[]>("unifi_clients_snapshot") ?? [];
    const devices = snap<unknown[]>("unifi_devices_snapshot") ?? [];
    const health = snap<unknown[]>("unifi_health_snapshot") ?? [];
    const { mapOverview } = await import("../unifi/mappers.ts");
    return mapOverview(clients, devices, health);
  });

  app.get("/api/clients", async (_req, reply) => {
    if (!requireLive()) return reply.code(204).send();
    const { mapClients } = await import("../unifi/mappers.ts");
    return mapClients(snap<unknown[]>("unifi_clients_snapshot") ?? []);
  });

  // Per-client enrichment derived from syslog: MAC↔IP history, DHCP-known
  // hostname, and Wi-Fi auth-event timeline. Always live from the local DB.
  app.get<{ Params: { mac: string } }>("/api/clients/:mac/details", async (req) => {
    return clientDetails(db, req.params.mac);
  });

  app.get("/api/devices", async (_req, reply) => {
    if (!requireLive()) return reply.code(204).send();
    return snap("unifi_devices_snapshot") ?? [];
  });

  app.get("/api/ports", async (_req, reply) => {
    if (!requireLive()) return reply.code(204).send();
    const { mapPorts } = await import("../unifi/mappers.ts");
    return mapPorts(snap("unifi_devices_snapshot"), snap("unifi_clients_snapshot"));
  });

  app.get("/api/firmware", async (_req, reply) => {
    if (!requireLive()) return reply.code(204).send();
    const { mapFirmware } = await import("../unifi/mappers.ts");
    return mapFirmware(snap("unifi_devices_snapshot"));
  });

  app.get("/api/topology", async (_req, reply) => {
    if (!requireLive()) return reply.code(204).send();
    const { mapTopology } = await import("../unifi/mappers.ts");
    return mapTopology(snap("unifi_devices_snapshot"));
  });

  app.get("/api/ssids", async (_req, reply) => {
    if (!requireLive()) return reply.code(204).send();
    const { mapSsids } = await import("../unifi/mappers.ts");
    return mapSsids(snap("unifi_devices_snapshot"));
  });

  app.get("/api/wan", async (_req, reply) => {
    if (!requireLive()) return reply.code(204).send();
    const { mapWan } = await import("../unifi/mappers.ts");
    return mapWan(snap("unifi_health_snapshot"), snap("unifi_devices_snapshot"));
  });

  app.get("/api/speedtest", async (_req, reply) => {
    if (!requireLive()) return reply.code(204).send();
    const { mapSpeedtests } = await import("../unifi/mappers.ts");
    return mapSpeedtests(snap("unifi_speedtest_snapshot"));
  });

  app.get("/api/events", async (_req, reply) => {
    if (!requireLive()) return reply.code(204).send();
    const { mapEvents } = await import("../unifi/mappers.ts");
    return mapEvents(snap("unifi_events_snapshot"));
  });

  app.get("/api/dpi", async (_req, reply) => {
    if (!requireLive()) return reply.code(204).send();
    const { mapDpi } = await import("../unifi/mappers.ts");
    return mapDpi(snap("unifi_dpi_snapshot"), snap("unifi_dpi_catalog_snapshot") as any);
  });

  // Debug: returns shape + small sanitized sample of each UniFi snapshot so we
  // can diagnose mapping issues from `docker exec` without a browser cookie.
  app.get("/api/_debug/snapshots", async () => {
    const keys = [
      "unifi_clients_snapshot",
      "unifi_devices_snapshot",
      "unifi_health_snapshot",
      "unifi_events_snapshot",
      "unifi_dpi_snapshot",
      "unifi_dpi_catalog_snapshot",
      "unifi_speedtest_snapshot",
    ];
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k] = summarize(snap(k));
    }
    return { ok: true, unifiStatus: unifi.getStatus(), snapshots: out };
  });

  app.get("/api/_debug/unifi", async () => {
    return {
      ok: true,
      status: unifi.getStatus(),
      probes: await unifi.diagnostics(),
    };
  });

  // Dump the first 2 raw events so we can see exact field names UniFi sends.
  app.get("/api/_debug/raw-events", async () => {
    const raw = snap("unifi_events_snapshot") as any;
    const list = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
    return { ok: true, count: list.length, sample: list.slice(0, 2) };
  });

  // Dump the first port from each device so we can see PoE/LLDP/error field names.
  app.get("/api/_debug/raw-ports", async () => {
    const raw = snap("unifi_devices_snapshot") as any;
    const devs: any[] = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
    return {
      ok: true,
      devices: devs.map((d) => ({
        name: d?.name ?? d?.mac,
        type: d?.type,
        portCount: Array.isArray(d?.port_table) ? d.port_table.length : 0,
        firstActivePort:
          (Array.isArray(d?.port_table) ? d.port_table : []).find((p: any) => p?.up) ??
          d?.port_table?.[0] ??
          null,
      })),
    };
  });

  app.get("/api/_debug/raw-speedtest", async () => {
    const raw = snap("unifi_speedtest_snapshot") as any;
    const list = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
    const { mapSpeedtests } = await import("../unifi/mappers.ts");
    const probe = await unifi.speedtestProbe();
    return { ok: true, count: list.length, sample: list.slice(0, 3), mapped: mapSpeedtests(list).slice(0, 3), probe };
  });



  // Dump raw DPI/traffic snapshot and mapped output for diagnosing empty Apps/DPI.
  app.get("/api/_debug/raw-dpi", async () => {
    const raw = snap("unifi_dpi_snapshot") as any;
    const catalog = snap("unifi_dpi_catalog_snapshot") as any;
    const { mapDpi } = await import("../unifi/mappers.ts");
    const mapped = mapDpi(raw, catalog);
    const list = Array.isArray(raw?.client_usage_by_app) ? raw.client_usage_by_app
      : Array.isArray(raw?.data?.client_usage_by_app) ? raw.data.client_usage_by_app
      : Array.isArray(raw?.data) ? raw.data
      : Array.isArray(raw) ? raw
      : [];
    const totals = Array.isArray(raw?.total_usage_by_app) ? raw.total_usage_by_app
      : Array.isArray(raw?.data?.total_usage_by_app) ? raw.data.total_usage_by_app
      : [];
    return {
      ok: true,
      raw: summarize(raw),
      catalogSize: catalog ? { apps: Object.keys(catalog?.apps ?? {}).length, categories: Object.keys(catalog?.categories ?? {}).length, sources: catalog?.sources ?? [] } : null,
      mapped,
      clientSample: list.slice(0, 2),
      totalsSample: totals.slice(0, 5),
    };
  });

  // Force a catalog probe (id → name) and return what each endpoint returned.
  app.get("/api/_debug/dpi-catalog", async () => {
    return unifi.catalogProbe();
  });




  // Collector health for the header banner.
  app.get("/api/collector", async () => {
    const stats = dbStats(db);
    const u = unifi.getStatus();
    return {
      msgsPerSec: 0, // collector throughput meter could be added later
      syslogQueueDepth: 0,
      unifiPollMs: 0,
      unifiPollAgeSec: u.lastPollAt ? Math.round((Date.now() - u.lastPollAt) / 1000) : 9999,
      unifiOk: u.lastOk,
      unifiConfigured: u.configured,
      dbSizeBytes: stats.sizeBytes,
      retentionDays: config.get().retention.retentionDays,
      oldestEntryDays: stats.oldestTime ? Math.round((Date.now() - stats.oldestTime) / 86400_000) : 0,
      fts5Indexed: stats.syslogCount,
    };
  });

  // ---- logs (always real syslog DB; demo mode handled on client) ----
  app.get<{
    Querystring: { q?: string; host?: string; severity?: string; limit?: string };
  }>("/api/logs", async (req) => {
    const { q, host, severity, limit } = req.query;
    return recentSyslog(db, {
      q: q || undefined,
      host: host || undefined,
      severity: severity ? severity.split(",") : undefined,
      limit: limit ? Number(limit) : 500,
    });
  });

  // ---- firewall ----
  app.get<{
    Querystring: { q?: string; action?: string; mac?: string; limit?: string };
  }>("/api/firewall", async (req) => {
    const { q, action, mac, limit } = req.query;
    return recentFirewall(db, {
      q: q || undefined,
      action: action || undefined,
      clientMac: mac || undefined,
      limit: limit ? Number(limit) : 500,
    });
  });
}

