import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export type DB = ReturnType<typeof openDb>;

export function openDb(path: string) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("temp_store = MEMORY");
  db.pragma("mmap_size = 268435456");
  db.pragma("cache_size = -65536"); // ~64 MiB page cache
  db.pragma("foreign_keys = ON");
  const schema = readFileSync(join(here, "schema.sql"), "utf8");
  db.exec(schema);
  // Backfill the firewall FTS mirror the first time it appears (for DBs that
  // pre-date the FTS index). One-shot: cheap once, no-op afterwards.
  try {
    const ftsCount = (db.prepare("SELECT COUNT(*) AS n FROM firewall_events_fts").get() as { n: number }).n;
    const fwCount = (db.prepare("SELECT COUNT(*) AS n FROM firewall_events").get() as { n: number }).n;
    if (fwCount > 0 && ftsCount === 0) {
      db.exec("INSERT INTO firewall_events_fts(firewall_events_fts) VALUES('rebuild')");
    }
  } catch { /* best-effort */ }
  // Refresh planner stats so partial / composite indexes are picked up.
  try { db.exec("ANALYZE"); } catch { /* best-effort */ }
  return db;
}

// Translate a free-text search box into a safe FTS5 MATCH expression.
// - Splits on whitespace into terms
// - Strips FTS5 syntax characters from each term
// - Wraps each term in double quotes and adds the prefix `*` operator so
//   typing "192.168" or "deny" matches as you type without surprising the
//   user with FTS5 boolean parsing of dots / dashes / colons.
export function toFtsQuery(input: string): string | null {
  const tokens = input
    .split(/\s+/)
    .map((t) => t.replace(/["()*:^]/g, "").trim())
    .filter((t) => t.length >= 2);
  if (!tokens.length) return null;
  return tokens.map((t) => `"${t}"*`).join(" AND ");
}


// ---- Bucket aggregation cache --------------------------------------------
// Charts on the dashboard refetch every 15s across multiple clients. The
// aggregation itself is cheap with indexes, but caching the last result for a
// few seconds collapses N concurrent requests into a single SQL pass.

type BucketRow = { t: number; success: number; failure: number };
type InternalBucketRow = {
  t: number;
  connect: number;
  disconnect: number;
  authSuccess: number;
  authFailure: number;
  roam: number;
  other: number;
};
const bucketCache = new Map<string, { at: number; rows: Array<BucketRow | InternalBucketRow> }>();
const BUCKET_CACHE_TTL_MS = 5_000;
let bucketCacheVersion = 0;

/** Call after every batch of firewall_events inserts so the next bucket
 *  request recomputes instead of serving a stale cached aggregation. */
export function invalidateBucketCache() {
  bucketCacheVersion++;
  if (bucketCache.size > 32) bucketCache.clear();
}

export function pruneOlderThan(db: Database.Database, days: number) {
  if (!days || days <= 0) return 0;
  const cutoff = Date.now() - days * 86400_000;
  const info = db.prepare("DELETE FROM syslog WHERE time < ?").run(cutoff);
  // firewall_events cascade via FK
  return info.changes;
}

export function pruneFirewallOlderThan(db: Database.Database, days: number) {
  if (!days || days <= 0) return 0;
  const cutoff = Date.now() - days * 86400_000;
  const info = db.prepare("DELETE FROM firewall_events WHERE time < ?").run(cutoff);
  return info.changes;
}

/**
 * Trim the oldest syslog rows until the on-disk DB size is at or below
 * `maxBytes`. Deletes in batches then re-checks. Returns rows removed.
 * firewall_events cascade via FK.
 */
export function pruneToMaxSize(db: Database.Database, maxBytes: number) {
  if (!maxBytes || maxBytes <= 0) return 0;
  let removed = 0;
  for (let i = 0; i < 50; i++) {
    if (dbSizeBytes(db) <= maxBytes) break;
    const info = db
      .prepare(
        "DELETE FROM syslog WHERE id IN (SELECT id FROM syslog ORDER BY time ASC LIMIT 10000)",
      )
      .run();
    if (info.changes === 0) break;
    removed += info.changes;
  }
  return removed;
}

export function dbSizeBytes(db: Database.Database): number {
  const page = db.pragma("page_size", { simple: true }) as number;
  const count = db.pragma("page_count", { simple: true }) as number;
  return page * count;
}

export function dbStats(db: Database.Database) {
  const syslogCount = (db.prepare("SELECT COUNT(*) AS n FROM syslog").get() as { n: number }).n;
  const fwCount = (db.prepare("SELECT COUNT(*) AS n FROM firewall_events").get() as { n: number }).n;
  const oldest = (db.prepare("SELECT MIN(time) AS t FROM syslog").get() as { t: number | null }).t;
  const newest = (db.prepare("SELECT MAX(time) AS t FROM syslog").get() as { t: number | null }).t;
  return {
    sizeBytes: dbSizeBytes(db),
    syslogCount,
    firewallCount: fwCount,
    oldestTime: oldest,
    newestTime: newest,
  };
}

export function syslogCountSince(db: Database.Database, since: number): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM syslog WHERE time >= ?").get(since) as { n: number };
  return row.n;
}

export type SyslogBucketRow = { t: number; info: number; warn: number; error: number };

// Aggregate syslog entries into time buckets, classified by severity. Mirrors
// firewallBuckets / internalEventBuckets so the Logs page's "messages per
// minute" chart is driven only by the global time range, never by the table's
// row limit or active filters.
export function syslogBuckets(
  db: Database.Database,
  opts: { rangeMs: number; bucketMs: number },
): SyslogBucketRow[] {
  const now = Date.now();
  const newest = (db.prepare("SELECT MAX(time) AS newest FROM syslog").get() as { newest: number | null }).newest;
  if (newest == null) return [];
  const end = Math.max(now, newest);
  const since = Math.floor((end - opts.rangeMs) / opts.bucketMs) * opts.bucketMs;
  return db.prepare(`
    SELECT
      (time / CAST(@bucket AS INTEGER)) * CAST(@bucket AS INTEGER) AS t,
      SUM(CASE WHEN lower(coalesce(severity,'')) IN ('warn','warning','notice') THEN 1 ELSE 0 END) AS warn,
      SUM(CASE WHEN lower(coalesce(severity,'')) IN ('err','error','crit','critical','alert','emerg','emergency') THEN 1 ELSE 0 END) AS error,
      SUM(CASE WHEN lower(coalesce(severity,'')) NOT IN ('warn','warning','notice','err','error','crit','critical','alert','emerg','emergency') THEN 1 ELSE 0 END) AS info
    FROM syslog
    WHERE time >= @since
    GROUP BY t
    ORDER BY t ASC
  `).all({ bucket: opts.bucketMs, since }) as SyslogBucketRow[];
}

export function vacuum(db: Database.Database) {
  // VACUUM cannot run inside a transaction.
  db.exec("VACUUM");
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
  opts: {
    q?: string;
    severity?: string[];
    host?: string;
    firewallOnly?: boolean;
    limit?: number;
    since?: number;
  },
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
  if (opts.since != null) {
    where.push("s.time >= @since");
    params.since = opts.since;
  }

  if (opts.q) {
    const ftsQuery = toFtsQuery(opts.q);
    if (ftsQuery) {
      // FTS5 path — millisecond response across millions of rows.
      params.q = ftsQuery;
      const sql = `
        SELECT s.* FROM syslog_fts f
        JOIN syslog s ON s.id = f.rowid
        WHERE f.syslog_fts MATCH @q ${where.length ? "AND " + where.join(" AND ") : ""}
        ORDER BY s.time DESC LIMIT ${limit}`;
      return db.prepare(sql).all(params);
    }
  }

  const sql = `
    SELECT s.* FROM syslog s
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY s.time DESC LIMIT ${limit}`;
  return db.prepare(sql).all(params);
}


// SQL fragment that mirrors `isInternalEvent` on the frontend.
// Matches STA-tracker, Wi-Fi auth / assoc / roam, and UniFi system events
// that lack both IPs and a LAN_/WAN_/GUEST_ rule prefix.
const INTERNAL_WHERE = `(
  message_type LIKE 'STA\\_%' ESCAPE '\\'
  OR lower(coalesce(event_type,'')) GLOB '*assoc*'
  OR lower(coalesce(event_type,'')) GLOB '*leave*'
  OR lower(coalesce(event_type,'')) GLOB '*deauth*'
  OR lower(coalesce(event_type,'')) GLOB '*auth*'
  OR lower(coalesce(event_type,'')) GLOB '*roam*'
  OR lower(coalesce(event_type,'')) GLOB '*connect*'
  OR lower(coalesce(event_type,'')) GLOB '*disconnect*'
  OR (
    src_ip IS NULL AND dst_ip IS NULL
    AND (rule IS NULL OR (
      rule NOT LIKE 'LAN\\_%' ESCAPE '\\'
      AND rule NOT LIKE 'WAN\\_%' ESCAPE '\\'
      AND rule NOT LIKE 'GUEST\\_%' ESCAPE '\\'
    ))
  )
)`;

const FIREWALL_WHERE = `(
  src_ip IS NOT NULL
  OR dst_ip IS NOT NULL
  OR rule LIKE 'LAN\\_%' ESCAPE '\\'
  OR rule LIKE 'WAN\\_%' ESCAPE '\\'
  OR rule LIKE 'GUEST\\_%' ESCAPE '\\'
  OR rule IN ('UFW','UBNT','FW')
)`;

// SQL fragment matching isBlockedAction on the frontend: any action that is a
// blocked / denied / dropped firewall decision should count as a failure.
const BLOCKED_ACTION_SQL = `lower(action) IN ('block','deny','drop','reject','failure')`;

function kindWhere(kind?: "internal" | "firewall") {
  if (kind === "internal") return INTERNAL_WHERE;
  if (kind === "firewall") return FIREWALL_WHERE;
  return null;
}

export function recentFirewall(
  db: Database.Database,
  opts: {
    action?: string;
    clientMac?: string;
    q?: string;
    limit?: number;
    since?: number;
    kind?: "internal" | "firewall";
  },
) {
  const limit = Math.min(opts.limit ?? 500, 200000);
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  const kindPredicate = kindWhere(opts.kind);
  if (kindPredicate) {
    // Positive predicate: rows that actually look like an iptables / UniFi
    // firewall-rule hit. Using the complement of INTERNAL_WHERE turned out to
    // be too aggressive — events whose `rule` is the friendly DESCR name
    // ("Allow Established") were filtered out incorrectly. A firewall row has
    // either SRC/DST IPs or a recognisable rule tag prefix.
    where.push(kindPredicate);
  }
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
  if (opts.since != null) {
    where.push("f.time >= @since");
    params.since = opts.since;
  }

  // When a free-text search is present, hit the FTS5 mirror instead of
  // LIKE %q% which was forcing a full-table scan. Falls back to LIKE only
  // for very short queries the FTS tokenizer would reject.
  if (opts.q) {
    const ftsQuery = toFtsQuery(opts.q);
    if (ftsQuery) {
      params.q = ftsQuery;
      const sql = `
        SELECT f.* FROM firewall_events_fts x
        JOIN firewall_events f ON f.id = x.rowid
        WHERE x.firewall_events_fts MATCH @q
        ${where.length ? "AND " + where.join(" AND ").replace(/\bf\./g, "f.") : ""}
        ORDER BY f.time DESC LIMIT ${limit}`;
      return db.prepare(sql).all(params);
    }
    where.push("(f.rule LIKE @like OR f.client_mac LIKE @like OR f.vap LIKE @like OR f.raw_json LIKE @like)");
    params.like = `%${opts.q}%`;
  }

  const sql = `
    SELECT f.* FROM firewall_events f
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY f.time DESC LIMIT ${limit}`;
  return db.prepare(sql).all(params);
}


// Aggregate firewall events into time buckets — used by the chart so the
// "events per minute" view spans the entire selected window, regardless of
// how many rows the table fetches.
export function firewallBuckets(
  db: Database.Database,
  opts: { since?: number; rangeMs?: number; bucketMs: number; kind?: "internal" | "firewall" },
): BucketRow[] {
  const cacheKey = `actions:${opts.kind ?? "all"}:${opts.bucketMs}:${opts.rangeMs ?? ""}:${bucketCacheVersion}`;
  const cached = bucketCache.get(cacheKey) as { at: number; rows: BucketRow[] } | undefined;
  const now = Date.now();
  if (cached && now - cached.at < BUCKET_CACHE_TTL_MS) return cached.rows;

  const where: string[] = [];
  const params: Record<string, unknown> = { bucket: opts.bucketMs };
  const kindPredicate = kindWhere(opts.kind);
  if (kindPredicate) where.push(kindPredicate);

  const newestSql = `
    SELECT MAX(time) AS newest FROM firewall_events
    ${where.length ? "WHERE " + where.join(" AND ") : ""}`;
  const newest = (db.prepare(newestSql).get(params) as { newest: number | null }).newest;
  if (newest == null) {
    bucketCache.set(cacheKey, { at: now, rows: [] });
    return [];
  }

  const wallSince = opts.since ?? now - (opts.rangeMs ?? 60 * 60_000);
  const rangeMs = opts.rangeMs ?? Math.max(opts.bucketMs, now - wallSince);
  const end = Math.max(now, newest);
  params.since = Math.floor((end - rangeMs) / opts.bucketMs) * opts.bucketMs;
  where.push("time >= @since");

  const rows = db.prepare(`
    SELECT
      (time / CAST(@bucket AS INTEGER)) * CAST(@bucket AS INTEGER) AS t,
      SUM(CASE WHEN ${BLOCKED_ACTION_SQL} THEN 1 ELSE 0 END) AS failure,
      SUM(CASE WHEN ${BLOCKED_ACTION_SQL} THEN 0 ELSE 1 END) AS success
    FROM firewall_events
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    GROUP BY t
    ORDER BY t ASC
  `).all(params) as BucketRow[];

  bucketCache.set(cacheKey, { at: now, rows });
  return rows;
}

// Aggregate internal events by the same categories used in the UI. This keeps
// the chart independent from the visible table limit and avoids fetching tens
// of thousands of rows just to count them in the browser.
export function internalEventBuckets(
  db: Database.Database,
  opts: { rangeMs?: number; bucketMs: number },
): InternalBucketRow[] {
  const cacheKey = `internal-categories:${opts.bucketMs}:${opts.rangeMs ?? ""}:${bucketCacheVersion}`;
  const cached = bucketCache.get(cacheKey) as { at: number; rows: InternalBucketRow[] } | undefined;
  const now = Date.now();
  if (cached && now - cached.at < BUCKET_CACHE_TTL_MS) return cached.rows;

  const params: Record<string, unknown> = { bucket: opts.bucketMs };
  const newest = (db.prepare(`
    SELECT MAX(time) AS newest FROM firewall_events
    WHERE ${INTERNAL_WHERE}
  `).get(params) as { newest: number | null }).newest;
  if (newest == null) {
    bucketCache.set(cacheKey, { at: now, rows: [] });
    return [];
  }

  const rangeMs = opts.rangeMs ?? 60 * 60_000;
  const end = Math.max(now, newest);
  params.since = Math.floor((end - rangeMs) / opts.bucketMs) * opts.bucketMs;

  const rows = db.prepare(`
    WITH categorised AS (
      SELECT
        time,
        CASE
          WHEN action = 'failure' OR lower(coalesce(event_type,'')) GLOB '*fail*' THEN 'authFailure'
          WHEN lower(coalesce(event_type,'')) IN ('success', 'sta_auth_success') THEN 'authSuccess'
          WHEN lower(coalesce(event_type,'')) GLOB '*roam*' THEN 'roam'
          WHEN lower(coalesce(event_type,'')) GLOB '*assoc*' OR lower(coalesce(message_type,'')) GLOB '*assoc*' THEN 'connect'
          WHEN lower(coalesce(event_type,'')) GLOB '*leave*'
            OR lower(coalesce(event_type,'')) GLOB '*disconnect*'
            OR lower(coalesce(event_type,'')) GLOB '*deauth*'
            OR lower(coalesce(message_type,'')) GLOB '*leave*' THEN 'disconnect'
          ELSE 'other'
        END AS category
      FROM firewall_events
      WHERE ${INTERNAL_WHERE}
        AND time >= @since
    )
    SELECT
      (time / CAST(@bucket AS INTEGER)) * CAST(@bucket AS INTEGER) AS t,
      SUM(CASE WHEN category = 'connect' THEN 1 ELSE 0 END) AS connect,
      SUM(CASE WHEN category = 'disconnect' THEN 1 ELSE 0 END) AS disconnect,
      SUM(CASE WHEN category = 'authSuccess' THEN 1 ELSE 0 END) AS authSuccess,
      SUM(CASE WHEN category = 'authFailure' THEN 1 ELSE 0 END) AS authFailure,
      SUM(CASE WHEN category = 'roam' THEN 1 ELSE 0 END) AS roam,
      SUM(CASE WHEN category = 'other' THEN 1 ELSE 0 END) AS other
    FROM categorised
    GROUP BY t
    ORDER BY t ASC
  `).all(params) as InternalBucketRow[];

  bucketCache.set(cacheKey, { at: now, rows });
  return rows;
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
