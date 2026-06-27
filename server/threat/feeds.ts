// Local threat-feed cache. Downloads public IP/CIDR blocklists on a 24h
// schedule and stores them in SQLite. /api/ipinfo queries this cache before
// spending AbuseIPDB /check quota, so the free tier (1000 lookups/day) is
// only used for IPs that aren't in any feed.

import type Database from "better-sqlite3";
import type { ConfigStore } from "../config.ts";

export type FeedDef = {
  id: string;
  name: string;
  description: string;
  requiresKey?: boolean;
  defaultEnabled: boolean;
  intervalHours: number;
  /** Fetch raw text body. Throws on non-OK. */
  fetch: (cfg: { abuseIpdbKey?: string }) => Promise<string>;
};

const UA = "unifi-insights-hub/1.0 (+threat-feed-refresher)";

async function getText(url: string, headers: Record<string, string> = {}): Promise<string> {
  const r = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/plain, */*", ...headers },
    // 60s feed download cap
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
  return await r.text();
}

export const FEEDS: FeedDef[] = [
  {
    id: "abuseipdb_blacklist",
    name: "AbuseIPDB Blacklist",
    description: "Top reported IPs from AbuseIPDB (1 request/day, separate from /check quota). Requires an API key.",
    requiresKey: true,
    defaultEnabled: true,
    intervalHours: 24,
    fetch: async ({ abuseIpdbKey }) => {
      if (!abuseIpdbKey) throw new Error("AbuseIPDB key not configured");
      return getText(
        "https://api.abuseipdb.com/api/v2/blacklist?confidenceMinimum=90&plaintext",
        { Key: abuseIpdbKey, Accept: "text/plain" },
      );
    },
  },
  {
    id: "firehol_level1",
    name: "FireHOL Level 1",
    description: "Aggregated low-false-positive blocklist (Spamhaus DROP, dshield, fullbogons, …). Updated hourly.",
    defaultEnabled: true,
    intervalHours: 24,
    fetch: () => getText("https://iplists.firehol.org/files/firehol_level1.netset"),
  },
  {
    id: "spamhaus_drop",
    name: "Spamhaus DROP",
    description: "Hijacked / leased-for-crime netblocks. Very high confidence.",
    defaultEnabled: true,
    intervalHours: 24,
    fetch: () => getText("https://www.spamhaus.org/drop/drop.txt"),
  },
  {
    id: "spamhaus_edrop",
    name: "Spamhaus EDROP",
    description: "Extended DROP — additional hijacked netblocks.",
    defaultEnabled: false,
    intervalHours: 24,
    fetch: () => getText("https://www.spamhaus.org/drop/edrop.txt"),
  },
  {
    id: "et_compromised",
    name: "Emerging Threats Compromised",
    description: "Hosts known to be compromised and serving malware.",
    defaultEnabled: false,
    intervalHours: 24,
    fetch: () => getText("https://rules.emergingthreats.net/blockrules/compromised-ips.txt"),
  },
  {
    id: "blocklist_de",
    name: "blocklist.de — all attackers",
    description: "All IPs reported attacking customer servers in the last 48h. Higher volume.",
    defaultEnabled: false,
    intervalHours: 24,
    fetch: () => getText("https://lists.blocklist.de/lists/all.txt"),
  },
  {
    id: "cins_army",
    name: "CINS Army",
    description: "Sentinel-IPS rogue IPs scoring poorly on the CINS reputation index.",
    defaultEnabled: false,
    intervalHours: 24,
    fetch: () => getText("https://cinsscore.com/list/ci-badguys.txt"),
  },
];

export function feedDefaults(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const f of FEEDS) out[f.id] = f.defaultEnabled;
  return out;
}

// ---- parsing -------------------------------------------------------------

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const a = +m[1], b = +m[2], c = +m[3], d = +m[4];
  if ([a, b, c, d].some((n) => n < 0 || n > 255)) return null;
  // unsigned 32-bit
  return ((a * 256 + b) * 256 + c) * 256 + d;
}

export function parseFeed(body: string): { ips: string[]; cidrs: Array<{ cidr: string; start: number; end: number }> } {
  const ips: string[] = [];
  const cidrs: Array<{ cidr: string; start: number; end: number }> = [];
  const seen = new Set<string>();
  for (const rawLine of body.split(/\r?\n/)) {
    // strip inline comments after ; or #
    let line = rawLine;
    const semi = line.indexOf(";");
    if (semi >= 0) line = line.slice(0, semi);
    const hash = line.indexOf("#");
    if (hash >= 0) line = line.slice(0, hash);
    line = line.trim();
    if (!line) continue;
    // some feeds prefix with "Domain:" or have extra columns – take first token
    const tok = line.split(/\s+/)[0];
    if (!tok) continue;
    const slash = tok.indexOf("/");
    if (slash >= 0) {
      const base = tok.slice(0, slash);
      const bits = Number(tok.slice(slash + 1));
      const baseInt = ipv4ToInt(base);
      if (baseInt == null || !Number.isFinite(bits) || bits < 0 || bits > 32) continue;
      if (bits === 32) {
        if (!seen.has(base)) { seen.add(base); ips.push(base); }
        continue;
      }
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      const start = (baseInt & mask) >>> 0;
      const end = (start | (~mask >>> 0)) >>> 0;
      cidrs.push({ cidr: `${base}/${bits}`, start, end });
    } else {
      const v = ipv4ToInt(tok);
      if (v == null) continue;
      if (!seen.has(tok)) { seen.add(tok); ips.push(tok); }
    }
  }
  return { ips, cidrs };
}

// ---- manager -------------------------------------------------------------

export type FeedStatus = {
  id: string;
  name: string;
  description: string;
  requiresKey: boolean;
  enabled: boolean;
  intervalHours: number;
  lastUpdatedAt: number | null;
  lastAttemptAt: number | null;
  lastError: string | null;
  ipCount: number;
  cidrCount: number;
};

export class ThreatFeedManager {
  private timer: NodeJS.Timeout | null = null;
  private running = new Set<string>();

  constructor(private db: Database.Database, private config: ConfigStore) {}

  start() {
    // Kick off a refresh shortly after boot, then every hour check which
    // feeds are due (24h cycle by default).
    setTimeout(() => this.refreshDue().catch(() => {}), 15_000);
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.refreshDue().catch(() => {}), 60 * 60 * 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  status(): FeedStatus[] {
    const cfg = this.config.get().threatIntel;
    const rows = this.db
      .prepare(`SELECT source, last_updated_at, last_attempt_at, last_error, ip_count, cidr_count FROM threat_feed_meta`)
      .all() as Array<{
        source: string; last_updated_at: number | null; last_attempt_at: number | null;
        last_error: string | null; ip_count: number; cidr_count: number;
      }>;
    const byId = new Map(rows.map((r) => [r.source, r] as const));
    return FEEDS.map((f) => {
      const m = byId.get(f.id);
      return {
        id: f.id,
        name: f.name,
        description: f.description,
        requiresKey: !!f.requiresKey,
        enabled: cfg.feeds[f.id] ?? f.defaultEnabled,
        intervalHours: f.intervalHours,
        lastUpdatedAt: m?.last_updated_at ?? null,
        lastAttemptAt: m?.last_attempt_at ?? null,
        lastError: m?.last_error ?? null,
        ipCount: m?.ip_count ?? 0,
        cidrCount: m?.cidr_count ?? 0,
      };
    });
  }

  async refreshDue(): Promise<{ refreshed: string[]; skipped: string[] }> {
    const cfg = this.config.get().threatIntel;
    const now = Date.now();
    const refreshed: string[] = [];
    const skipped: string[] = [];
    for (const f of FEEDS) {
      const enabled = cfg.feeds[f.id] ?? f.defaultEnabled;
      if (!enabled) { skipped.push(f.id); continue; }
      if (f.requiresKey && !cfg.abuseIpdbKey) { skipped.push(f.id); continue; }
      const m = this.db
        .prepare(`SELECT last_updated_at FROM threat_feed_meta WHERE source = ?`)
        .get(f.id) as { last_updated_at: number | null } | undefined;
      const last = m?.last_updated_at ?? 0;
      if (now - last < f.intervalHours * 3600_000) { skipped.push(f.id); continue; }
      try {
        await this.refreshOne(f.id);
        refreshed.push(f.id);
      } catch (err) {
        console.error("[threat-feed] refresh failed", f.id, err);
      }
    }
    return { refreshed, skipped };
  }

  async refreshOne(id: string): Promise<{ ipCount: number; cidrCount: number }> {
    if (this.running.has(id)) throw new Error("refresh already in progress");
    const f = FEEDS.find((x) => x.id === id);
    if (!f) throw new Error(`unknown feed: ${id}`);
    this.running.add(id);
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO threat_feed_meta (source, last_attempt_at)
      VALUES (?, ?)
      ON CONFLICT(source) DO UPDATE SET last_attempt_at = excluded.last_attempt_at
    `).run(id, now);
    try {
      const body = await f.fetch({ abuseIpdbKey: this.config.get().threatIntel.abuseIpdbKey });
      const { ips, cidrs } = parseFeed(body);
      const insertIp = this.db.prepare(
        `INSERT OR REPLACE INTO threat_feed_ip (ip, source, added_at) VALUES (?, ?, ?)`,
      );
      const insertCidr = this.db.prepare(
        `INSERT INTO threat_feed_cidr (cidr, start_int, end_int, source, added_at) VALUES (?, ?, ?, ?, ?)`,
      );
      const tx = this.db.transaction(() => {
        this.db.prepare(`DELETE FROM threat_feed_ip   WHERE source = ?`).run(id);
        this.db.prepare(`DELETE FROM threat_feed_cidr WHERE source = ?`).run(id);
        for (const ip of ips) insertIp.run(ip, id, now);
        for (const c of cidrs) insertCidr.run(c.cidr, c.start, c.end, id, now);
        this.db.prepare(`
          INSERT INTO threat_feed_meta (source, last_updated_at, last_attempt_at, last_error, ip_count, cidr_count)
          VALUES (?, ?, ?, NULL, ?, ?)
          ON CONFLICT(source) DO UPDATE SET
            last_updated_at = excluded.last_updated_at,
            last_attempt_at = excluded.last_attempt_at,
            last_error = NULL,
            ip_count = excluded.ip_count,
            cidr_count = excluded.cidr_count
        `).run(id, now, now, ips.length, cidrs.length);
      });
      tx();
      console.log(`[threat-feed] refreshed ${id}: ${ips.length} ips, ${cidrs.length} cidrs`);
      return { ipCount: ips.length, cidrCount: cidrs.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.db.prepare(`
        INSERT INTO threat_feed_meta (source, last_attempt_at, last_error)
        VALUES (?, ?, ?)
        ON CONFLICT(source) DO UPDATE SET last_attempt_at = excluded.last_attempt_at, last_error = excluded.last_error
      `).run(id, now, msg);
      throw err;
    } finally {
      this.running.delete(id);
    }
  }

  /** Returns the source name(s) that flag this IP, or null if none. */
  lookup(ip: string): string[] | null {
    const v = ipv4ToInt(ip);
    if (v == null) return null;
    const direct = this.db
      .prepare(`SELECT source FROM threat_feed_ip WHERE ip = ?`)
      .all(ip) as Array<{ source: string }>;
    const cidr = this.db
      .prepare(`SELECT source FROM threat_feed_cidr WHERE ? BETWEEN start_int AND end_int LIMIT 5`)
      .all(v) as Array<{ source: string }>;
    const all = [...direct.map((r) => r.source), ...cidr.map((r) => r.source)];
    if (!all.length) return null;
    return Array.from(new Set(all));
  }
}
