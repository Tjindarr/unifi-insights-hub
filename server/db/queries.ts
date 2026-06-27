import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export type DB = ReturnType<typeof openDb>;

export function openDb(path: string) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const schema = readFileSync(join(here, "schema.sql"), "utf8");
  db.exec(schema);
  return db;
}

export function pruneOlderThan(db: Database.Database, days: number) {
  const cutoff = Date.now() - days * 86400_000;
  const info = db.prepare("DELETE FROM syslog WHERE time < ?").run(cutoff);
  // firewall_events cascade via FK
  return info.changes;
}

// ---- Syslog inserts ----

export function makeSyslogInsert(db: Database.Database) {
  return db.prepare(
    `INSERT INTO syslog (time, host, appname, facility, severity, message, raw, is_firewall)
     VALUES (@time, @host, @appname, @facility, @severity, @message, @raw, @is_firewall)`,
  );
}

export function makeFirewallInsert(db: Database.Database) {
  return db.prepare(
    `INSERT INTO firewall_events
      (syslog_id, time, rule, action, event_type, message_type, client_mac,
       src_ip, src_port, dst_ip, dst_port, proto, vap, rssi, reason, raw_json)
     VALUES
      (@syslog_id, @time, @rule, @action, @event_type, @message_type, @client_mac,
       @src_ip, @src_port, @dst_ip, @dst_port, @proto, @vap, @rssi, @reason, @raw_json)`,
  );
}

// ---- Reads ----

export function recentSyslog(
  db: Database.Database,
  opts: { q?: string; severity?: string[]; host?: string; firewallOnly?: boolean; limit?: number },
) {
  const limit = Math.min(opts.limit ?? 500, 5000);
  const where: string[] = [];
  const params: Record<string, unknown> = {};

  if (opts.firewallOnly) where.push("s.is_firewall = 1");
  if (opts.severity?.length) {
    where.push(`s.severity IN (${opts.severity.map((_, i) => `@sev${i}`).join(",")})`);
    opts.severity.forEach((v, i) => (params[`sev${i}`] = v));
  }
  if (opts.host) {
    where.push("s.host = @host");
    params.host = opts.host;
  }

  if (opts.q) {
    // FTS5 path
    params.q = opts.q;
    const sql = `
      SELECT s.* FROM syslog_fts f
      JOIN syslog s ON s.id = f.rowid
      WHERE f.syslog_fts MATCH @q ${where.length ? "AND " + where.join(" AND ") : ""}
      ORDER BY s.time DESC LIMIT ${limit}`;
    return db.prepare(sql).all(params);
  }

  const sql = `
    SELECT s.* FROM syslog s
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY s.time DESC LIMIT ${limit}`;
  return db.prepare(sql).all(params);
}

export function recentFirewall(
  db: Database.Database,
  opts: { action?: string; clientMac?: string; q?: string; limit?: number },
) {
  const limit = Math.min(opts.limit ?? 500, 5000);
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (opts.action) {
    where.push("action = @action");
    params.action = opts.action;
  }
  if (opts.clientMac) {
    where.push("client_mac = @mac");
    params.mac = opts.clientMac;
  }
  if (opts.q) {
    where.push("(rule LIKE @like OR client_mac LIKE @like OR vap LIKE @like OR raw_json LIKE @like)");
    params.like = `%${opts.q}%`;
  }
  const sql = `
    SELECT * FROM firewall_events
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY time DESC LIMIT ${limit}`;
  return db.prepare(sql).all(params);
}

export function setSnapshot(db: Database.Database, table: string, json: unknown) {
  db.prepare(`DELETE FROM ${table}`).run();
  db.prepare(`INSERT INTO ${table} (ts, json) VALUES (?, ?)`).run(Date.now(), JSON.stringify(json));
}

export function getSnapshot<T = unknown>(db: Database.Database, table: string): T | null {
  const row = db.prepare(`SELECT json FROM ${table} ORDER BY ts DESC LIMIT 1`).get() as
    | { json: string }
    | undefined;
  return row ? (JSON.parse(row.json) as T) : null;
}
