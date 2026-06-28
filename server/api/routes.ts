import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import {
  dbStats,
  firewallBuckets,
  getSnapshot,
  internalEventBuckets,
  recentFirewall,
  recentSyslog,
  syslogBuckets,
  syslogCountSince,
} from "../db/queries.ts";
import { clientDetails } from "../syslog/enrichers.ts";
import type { makeAuth } from "../auth.ts";
import type { ConfigStore } from "../config.ts";
import { UnifiManager } from "../unifi/manager.ts";
import type { ThreatFeedManager } from "../threat/feeds.ts";

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
  threatFeeds: ThreatFeedManager;
};

export async function registerApi(
  app: FastifyInstance,
  { db, auth, config, unifi, retention, threatFeeds }: Deps,
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
      threatIntel?: Partial<{
        abuseIpdbKey: string;
        feeds: Record<string, boolean>;
        checkOnMiss: boolean;
      }>;
      syslog?: Partial<{ tzOffsetMinutes: number; useArrivalTime: boolean }>;
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
    if (body.threatIntel) {
      // Empty string clears the key; undefined means "leave saved value".
      const incoming = body.threatIntel.abuseIpdbKey;
      const ti = {
        ...current.threatIntel,
        abuseIpdbKey:
          incoming === undefined
            ? current.threatIntel.abuseIpdbKey
            : String(incoming).trim().slice(0, 256),
        feeds: { ...current.threatIntel.feeds },
        checkOnMiss: current.threatIntel.checkOnMiss,
      };
      if (body.threatIntel.feeds && typeof body.threatIntel.feeds === "object") {
        for (const [k, v] of Object.entries(body.threatIntel.feeds)) {
          ti.feeds[String(k)] = !!v;
        }
      }
      if (typeof body.threatIntel.checkOnMiss === "boolean") {
        ti.checkOnMiss = body.threatIntel.checkOnMiss;
      }
      patch.threatIntel = ti;
    }
    if (body.syslog) {
      const s = { ...current.syslog, ...body.syslog };
      const n = Math.floor(Number(s.tzOffsetMinutes) || 0);
      s.tzOffsetMinutes = Math.min(840, Math.max(-840, n));
      s.useArrivalTime = !!s.useArrivalTime;
      patch.syslog = s;
    }
    if (!patch.unifi && !patch.retention && !patch.noiseFilter && !patch.threatIntel && !patch.syslog) {
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

  app.get("/api/overview", async () => {
    // Always return a real (possibly empty) object — the dashboard is
    // syslog-driven and must never fall back to mock client data just because
    // the UniFi controller poll is momentarily offline.
    if (!requireLive()) {
      return {
        totalClients: 0,
        wired: 0,
        wireless: 0,
        avgSatisfaction: 0,
        currentRx: 0,
        currentTx: 0,
        topTalkers: [],
      };
    }
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
    const msgWindowMs = 60_000;
    const msgCount = syslogCountSince(db, Date.now() - msgWindowMs);
    return {
      msgsPerSec: Math.round((msgCount / (msgWindowMs / 1000)) * 10) / 10,
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

  // Parsing health — rolling per-minute counters from the syslog ingester.
  app.get<{ Querystring: { windowMin?: string } }>("/api/parse-health", async (req) => {
    const { parseHealthSnapshot } = await import("../syslog/parse-health.ts");
    const windowMin = Math.max(5, Math.min(120, Number(req.query.windowMin) || 60));
    return parseHealthSnapshot(windowMin * 60_000);
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
    Querystring: { q?: string; action?: string; mac?: string; limit?: string; since?: string; kind?: string };
  }>("/api/firewall", async (req) => {
    const { q, action, mac, limit, since, kind } = req.query;
    return recentFirewall(db, {
      q: q || undefined,
      action: action || undefined,
      clientMac: mac || undefined,
      limit: limit ? Number(limit) : 500,
      since: since ? Number(since) : undefined,
      kind: kind === "internal" || kind === "firewall" ? kind : undefined,
    });
  });

  // Aggregated time buckets for the firewall "events per minute" chart.
  app.get<{
    Querystring: { since?: string; rangeMs?: string; bucketMs?: string; kind?: string };
  }>("/api/firewall/buckets", async (req) => {
    const since = req.query.since ? Number(req.query.since) : Date.now() - 60 * 60_000;
    const rangeMs = req.query.rangeMs ? Number(req.query.rangeMs) : undefined;
    const bucketMs = req.query.bucketMs ? Number(req.query.bucketMs) : 60_000;
    const kind = req.query.kind === "internal" || req.query.kind === "firewall" ? req.query.kind : undefined;
    return firewallBuckets(db, { since, rangeMs, bucketMs, kind });
  });

  // Aggregated category buckets for the Internal events chart. This endpoint is
  // intentionally separate from /api/firewall rows so the chart is controlled
  // only by the global time range, never by the table's Last-N selector.
  app.get<{
    Querystring: { rangeMs?: string; bucketMs?: string };
  }>("/api/internal/buckets", async (req) => {
    const rangeMs = req.query.rangeMs ? Number(req.query.rangeMs) : undefined;
    const bucketMs = req.query.bucketMs ? Number(req.query.bucketMs) : 60_000;
    return internalEventBuckets(db, { rangeMs, bucketMs });
  });

  // ---- IP enrichment (GeoIP via ip-api.com; threat via AbuseIPDB if key set) ----
  // Persistent cache in SQLite so restarts do not re-spend API quota.
  // TTLs: GeoIP 7 days, AbuseIPDB 7 days (per user request).
  type IpInfoEntry = {
    country?: string; cc?: string; city?: string; isp?: string;
    abuseScore?: number; abuseReports?: number;
    threatFeeds?: string[];
  };
  const GEO_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const ABUSE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  const selectIp = db.prepare(
    "SELECT country, cc, city, isp, geo_fetched_at, abuse_score, abuse_reports, abuse_fetched_at FROM ip_enrichment WHERE ip = ?",
  );
  const upsertGeo = db.prepare(`
    INSERT INTO ip_enrichment (ip, country, cc, city, isp, geo_fetched_at)
    VALUES (@ip, @country, @cc, @city, @isp, @at)
    ON CONFLICT(ip) DO UPDATE SET
      country = excluded.country, cc = excluded.cc, city = excluded.city,
      isp = excluded.isp, geo_fetched_at = excluded.geo_fetched_at
  `);
  const upsertAbuse = db.prepare(`
    INSERT INTO ip_enrichment (ip, abuse_score, abuse_reports, abuse_fetched_at)
    VALUES (@ip, @score, @reports, @at)
    ON CONFLICT(ip) DO UPDATE SET
      abuse_score = excluded.abuse_score,
      abuse_reports = excluded.abuse_reports,
      abuse_fetched_at = excluded.abuse_fetched_at
  `);

  type IpRow = {
    country: string | null; cc: string | null; city: string | null; isp: string | null;
    geo_fetched_at: number | null;
    abuse_score: number | null; abuse_reports: number | null; abuse_fetched_at: number | null;
  };
  function rowToEntry(row: IpRow | undefined): IpInfoEntry {
    if (!row) return {};
    return {
      country: row.country ?? undefined,
      cc: row.cc ?? undefined,
      city: row.city ?? undefined,
      isp: row.isp ?? undefined,
      abuseScore: row.abuse_score ?? undefined,
      abuseReports: row.abuse_reports ?? undefined,
    };
  }

  app.get<{ Querystring: { ips?: string } }>("/api/ipinfo", async (req) => {
    const raw = String(req.query.ips ?? "");
    const ips = Array.from(new Set(
      raw.split(",").map((s) => s.trim()).filter(Boolean),
    )).slice(0, 100);
    const now = Date.now();
    const out: Record<string, IpInfoEntry> = {};
    const needGeo: string[] = [];
    const needAbuseCandidates: string[] = [];

    for (const ip of ips) {
      const row = selectIp.get(ip) as IpRow | undefined;
      out[ip] = rowToEntry(row);
      const geoAt = row?.geo_fetched_at ?? 0;
      const abAt = row?.abuse_fetched_at ?? 0;
      if (now - geoAt > GEO_TTL_MS) needGeo.push(ip);

      // Local threat-feed match takes precedence over the API. If the IP is
      // in any blocklist we mark it as high-confidence and skip the /check
      // call entirely, which protects the AbuseIPDB free-tier quota.
      const feeds = threatFeeds.lookup(ip);
      if (feeds && feeds.length) {
        out[ip] = {
          ...out[ip],
          threatFeeds: feeds,
          abuseScore: Math.max(out[ip].abuseScore ?? 0, 100),
        };
        // Persist as a cache hit so future requests don't re-spend lookups.
        upsertAbuse.run({
          ip,
          score: Math.max(row?.abuse_score ?? 0, 100),
          reports: row?.abuse_reports ?? null,
          at: now,
        });
        continue;
      }

      if (now - abAt > ABUSE_TTL_MS) needAbuseCandidates.push(ip);
    }

    if (needGeo.length) {
      try {
        const r = await fetch(
          "http://ip-api.com/batch?fields=status,country,countryCode,city,isp,query",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(needGeo.map((q) => ({ query: q }))),
          },
        );
        if (r.ok) {
          const arr = (await r.json()) as Array<Record<string, unknown>>;
          for (const it of arr) {
            const q = it?.query as string | undefined;
            if (!q) continue;
            const entry: IpInfoEntry = {
              country: it.country as string | undefined,
              cc: it.countryCode as string | undefined,
              city: it.city as string | undefined,
              isp: it.isp as string | undefined,
            };
            upsertGeo.run({
              ip: q,
              country: entry.country ?? null,
              cc: entry.cc ?? null,
              city: entry.city ?? null,
              isp: entry.isp ?? null,
              at: now,
            });
            out[q] = { ...out[q], ...entry };
          }
        }
      } catch (err) {
        app.log.warn({ err }, "ip-api lookup failed");
      }
    }

    const ti = config.get().threatIntel;
    const abuseKey =
      ti.abuseIpdbKey ||
      process.env.ABUSEIPDB_KEY ||
      process.env.ABUSEIPDB_API_KEY;

    // Only spend /check quota when explicitly enabled AND a key is configured.
    const needAbuse = ti.checkOnMiss !== false ? needAbuseCandidates : [];
    if (abuseKey && needAbuse.length) {
      // Hard cap per request to protect the free-tier 1000/day quota.
      await Promise.all(needAbuse.slice(0, 25).map(async (ip) => {
        try {
          const r = await fetch(
            `https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`,
            { headers: { Key: abuseKey, Accept: "application/json" } },
          );
          if (!r.ok) return;
          const j = (await r.json()) as { data?: { abuseConfidenceScore?: number; totalReports?: number } };
          const score = j.data?.abuseConfidenceScore ?? null;
          const reports = j.data?.totalReports ?? null;
          upsertAbuse.run({ ip, score, reports, at: now });
          out[ip] = {
            ...out[ip],
            abuseScore: score ?? undefined,
            abuseReports: reports ?? undefined,
          };
        } catch {
          /* swallow */
        }
      }));
    }

    return {
      ok: true,
      data: out,
      abuseEnabled: !!abuseKey,
      checkOnMiss: ti.checkOnMiss !== false,
      cached: ips.length - needGeo.length,
      geoFetched: needGeo.length,
      abuseFetched: abuseKey ? Math.min(needAbuse.length, 25) : 0,
    };
  });

  // ---- Threat feed management ---------------------------------------------
  app.get("/api/threat-feeds", async () => ({
    ok: true,
    feeds: threatFeeds.status(),
  }));

  app.post("/api/threat-feeds/refresh", async () => {
    const result = await threatFeeds.refreshDue();
    return { ok: true, ...result, feeds: threatFeeds.status() };
  });

  app.post<{ Params: { source: string } }>(
    "/api/threat-feeds/refresh/:source",
    async (req, reply) => {
      try {
        const r = await threatFeeds.refreshOne(req.params.source);
        return { ok: true, ...r, feeds: threatFeeds.status() };
      } catch (err) {
        return reply.code(400).send({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          feeds: threatFeeds.status(),
        });
      }
    },
  );
}


