import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import {
  dbStats,
  getSnapshot,
  recentFirewall,
  recentSyslog,
} from "./db/queries.ts";
import type { makeAuth } from "./auth.ts";

type RetentionConfig = {
  retentionDays: number;
  retentionFirewallDays: number;
  maxDbMb: number;
  intervalMin: number;
  vacuumHours: number;
};
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
  retention: { config: RetentionConfig; state: RetentionState; run: () => void };
};

export async function registerApi(app: FastifyInstance, { db, auth }: Deps) {
  // ---- auth ----
  app.post<{ Body: { username: string; password: string } }>("/api/login", async (req, reply) => {
    const { username, password } = req.body ?? ({} as Record<string, string>);
    if (!username || !password) return reply.code(400).send({ ok: false });
    const result = auth.checkCredentials(username, password);
    if (!result.ok) {
      return reply.code(401).send({ ok: false });
    }
    const cookie = auth.issueCookie();
    reply.setCookie(auth.cookieName, cookie, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
    });
    reply.setCookie("unifi_user", username, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
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
    if (req.url === "/api/login" || req.url === "/api/health" || req.url === "/api/change-password") return;
    const cookie = (req.cookies as Record<string, string | undefined>)[auth.cookieName];
    if (!auth.verifyCookie(cookie)) return reply.code(401).send({ ok: false, error: "unauthorized" });
  });

  app.get("/api/health", async () => ({ ok: true }));

  // ---- overview ----
  app.get("/api/overview", async () => {
    const clients = (getSnapshot<Array<Record<string, unknown>>>(db, "unifi_clients_snapshot") ?? []) as Array<
      Record<string, unknown>
    >;
    const wireless = clients.filter((c) => !c.is_wired).length;
    const wired = clients.length - wireless;
    const totalRx = clients.reduce((a, c) => a + Number(c.rx_rate ?? c["rx-rate"] ?? 0), 0);
    const totalTx = clients.reduce((a, c) => a + Number(c.tx_rate ?? c["tx-rate"] ?? 0), 0);
    const satAvg = clients.length
      ? Math.round(
          clients.reduce((a, c) => a + Number(c.satisfaction ?? 100), 0) / clients.length,
        )
      : 100;
    return {
      totalClients: clients.length,
      wired,
      wireless,
      avgSatisfaction: satAvg,
      currentRx: totalRx,
      currentTx: totalTx,
    };
  });

  app.get("/api/clients", async () => {
    return getSnapshot(db, "unifi_clients_snapshot") ?? [];
  });

  app.get("/api/devices", async () => {
    return getSnapshot(db, "unifi_devices_snapshot") ?? [];
  });

  app.get("/api/health-snapshot", async () => {
    return getSnapshot(db, "unifi_health_snapshot") ?? [];
  });

  // ---- logs ----
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
