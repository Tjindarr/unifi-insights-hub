// Extracts MAC↔IP mappings, DHCP leases, and Wi‑Fi auth events from parsed
// UniFi syslog lines, and applies an optional noise filter.

import type Database from "better-sqlite3";
import type { ParsedSyslog } from "./parser.ts";
import { upsertClientName } from "../db/queries.ts";

const DEAUTH_REASONS: Record<string, string> = {
  "1": "Unspecified",
  "2": "Previous auth no longer valid",
  "3": "Station leaving",
  "4": "Disassociated due to inactivity",
  "6": "Class 2 frame from non-auth STA",
  "7": "Class 3 frame from non-assoc STA",
  "8": "Station leaving",
  "15": "4-way handshake timeout",
  "23": "802.1X auth failed",
};

// Default chatty patterns we drop or downgrade when the noise filter is on.
export const DEFAULT_NOISE_PATTERNS = [
  "udapi-cfg._udapi_lu_set_inform_interval",
  "smp-affinity-monitor",
  "Check and correct WiFi IRQ affinity",
  "stahtd_dump_event\\(\\): \\{\"op\":\"stat\"", // periodic stats dumps
];

export type NoiseFilter = {
  enabled: boolean;
  action: "drop" | "downgrade";
  patterns: string[]; // user patterns are appended to the defaults
};

export type NoiseDecision = { drop: boolean; downgradeTo?: string };

export function applyNoiseFilter(
  parsed: ParsedSyslog,
  cfg: NoiseFilter,
): NoiseDecision {
  if (!cfg.enabled) return { drop: false };
  const all = [...DEFAULT_NOISE_PATTERNS, ...(cfg.patterns ?? [])];
  for (const p of all) {
    if (!p) continue;
    try {
      if (new RegExp(p).test(parsed.message)) {
        return cfg.action === "drop" ? { drop: true } : { drop: false, downgradeTo: "debug" };
      }
    } catch {
      // bad regex — ignore
    }
  }
  return { drop: false };
}

export type Enrichments = {
  staIp?: { mac: string; ip: string; vap: string | null };
  dhcp?: { mac: string; ip: string; hostname: string | null; op: string };
  wifiAuth?: {
    mac: string;
    vap: string | null;
    event_type: string | null;
    message_type: string | null;
    assoc_status: number | null;
    auth_failures: number | null;
    rssi: number | null;
    reason_code: string | null;
    reason: string | null;
  };
};

const MAC_RE = "([0-9a-f]{2}(?::[0-9a-f]{2}){5})";
const IP_RE = "(\\d{1,3}(?:\\.\\d{1,3}){3})";

const RE_STA_IP = new RegExp(
  `EVENT_STA_IP\\s+(\\S+):\\s+${MAC_RE}\\s*/\\s*${IP_RE}`,
  "i",
);

// dnsmasq-dhcp[pid]: DHCPACK(br0) 172.16.10.42 aa:bb:cc:dd:ee:ff client-name
const RE_DHCP = new RegExp(
  `(DHCPACK|DHCPOFFER|DHCPREQUEST|DHCPNAK)\\([^)]*\\)\\s+${IP_RE}\\s+${MAC_RE}(?:\\s+(\\S+))?`,
  "i",
);

export function extract(parsed: ParsedSyslog): Enrichments {
  const out: Enrichments = {};
  const m = parsed.message;

  // 1) Wevent EVENT_STA_IP → MAC ↔ IP mapping
  const sta = m.match(RE_STA_IP);
  if (sta) {
    out.staIp = { vap: sta[1] || null, mac: sta[2].toLowerCase(), ip: sta[3] };
  }

  // 2) dnsmasq-dhcp DHCPACK → authoritative lease
  if (/dnsmasq-dhcp|dhcpd/.test(parsed.appname) || /DHCPACK|DHCPNAK/.test(m)) {
    const d = m.match(RE_DHCP);
    if (d) {
      out.dhcp = {
        op: d[1].toUpperCase(),
        ip: d[2],
        mac: d[3].toLowerCase(),
        hostname: d[4] ?? null,
      };
    }
  }

  // 3) STA-TRACKER JSON blob
  if (parsed.appname.includes("stahtd") || /STA[-_]TRACKER|STA_ASSOC/.test(m)) {
    const start = m.indexOf("{");
    if (start >= 0) {
      try {
        const j = JSON.parse(m.slice(start)) as Record<string, unknown>;
        const mac = (j.mac as string) || "";
        if (mac) {
          const dr = j.deauth_reason as string | undefined;
          out.wifiAuth = {
            mac: mac.toLowerCase(),
            vap: (j.vap as string) ?? null,
            event_type: (j.event_type as string) ?? null,
            message_type: (j.message_type as string) ?? null,
            assoc_status: j.assoc_status != null ? Number(j.assoc_status) : null,
            auth_failures: j.wpa_auth_failures != null ? Number(j.wpa_auth_failures) : null,
            rssi: j.auth_rssi != null ? Number(j.auth_rssi) : null,
            reason_code: dr ?? null,
            reason: dr ? (DEAUTH_REASONS[dr] ?? `reason=${dr}`) : null,
          };
        }
      } catch {
        /* ignore */
      }
    }
  }

  return out;
}

export type EnricherInserts = ReturnType<typeof makeEnricherInserts>;

export function makeEnricherInserts(db: Database.Database) {
  const staIp = db.prepare(
    `INSERT INTO client_ip_history (time, mac, ip, vap, host)
     VALUES (@time, @mac, @ip, @vap, @host)`,
  );
  const dhcp = db.prepare(
    `INSERT INTO dhcp_leases (time, mac, ip, hostname, op)
     VALUES (@time, @mac, @ip, @hostname, @op)`,
  );
  const wifi = db.prepare(
    `INSERT INTO wifi_auth_events
      (time, mac, vap, event_type, message_type, assoc_status, auth_failures, rssi, reason_code, reason)
     VALUES (@time, @mac, @vap, @event_type, @message_type, @assoc_status, @auth_failures, @rssi, @reason_code, @reason)`,
  );
  return {
    apply(parsed: ParsedSyslog, e: Enrichments) {
      if (e.staIp) {
        staIp.run({
          time: parsed.time,
          mac: e.staIp.mac,
          ip: e.staIp.ip,
          vap: e.staIp.vap,
          host: parsed.host,
        });
      }
      if (e.dhcp) {
        dhcp.run({
          time: parsed.time,
          mac: e.dhcp.mac,
          ip: e.dhcp.ip,
          hostname: e.dhcp.hostname,
          op: e.dhcp.op,
        });
        // Persist DHCP-known hostnames so historical log rows can resolve the
        // MAC even when the device is no longer in the UniFi live list.
        if (e.dhcp.hostname && e.dhcp.op === "DHCPACK") {
          try { upsertClientName(db, e.dhcp.mac, e.dhcp.hostname, "dhcp", parsed.time); }
          catch { /* best-effort */ }
        }
      }
      if (e.wifiAuth) {
        wifi.run({ time: parsed.time, ...e.wifiAuth });
      }
    },
  };
}

// ---- Reads -----------------------------------------------------------------

export type ClientDetails = {
  mac: string;
  currentIp: string | null;
  dhcpHostname: string | null;
  ipHistory: { ip: string; firstSeen: number; lastSeen: number; count: number }[];
  wifiAuth: {
    total: number;
    failures: number;
    lastFailureAt: number | null;
    recent: {
      time: number;
      event_type: string | null;
      assoc_status: number | null;
      auth_failures: number | null;
      rssi: number | null;
      reason: string | null;
      vap: string | null;
    }[];
  };
};

export function clientDetails(db: Database.Database, mac: string): ClientDetails {
  const m = mac.toLowerCase();
  const ipHistory = db
    .prepare(
      `SELECT ip,
              MIN(time) AS firstSeen,
              MAX(time) AS lastSeen,
              COUNT(*)  AS count
         FROM client_ip_history
        WHERE mac = ?
        GROUP BY ip
        ORDER BY lastSeen DESC
        LIMIT 25`,
    )
    .all(m) as ClientDetails["ipHistory"];

  const lastDhcp = db
    .prepare(
      `SELECT ip, hostname FROM dhcp_leases
        WHERE mac = ? AND op = 'DHCPACK'
        ORDER BY time DESC LIMIT 1`,
    )
    .get(m) as { ip: string; hostname: string | null } | undefined;

  const recentAuth = db
    .prepare(
      `SELECT time, event_type, assoc_status, auth_failures, rssi, reason, vap
         FROM wifi_auth_events WHERE mac = ?
         ORDER BY time DESC LIMIT 20`,
    )
    .all(m) as ClientDetails["wifiAuth"]["recent"];

  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN event_type = 'failure' THEN 1 ELSE 0 END) AS failures,
              MAX(CASE WHEN event_type = 'failure' THEN time ELSE NULL END) AS lastFailureAt
         FROM wifi_auth_events WHERE mac = ?`,
    )
    .get(m) as { total: number; failures: number | null; lastFailureAt: number | null };

  return {
    mac: m,
    currentIp: lastDhcp?.ip ?? ipHistory[0]?.ip ?? null,
    dhcpHostname: lastDhcp?.hostname ?? null,
    ipHistory,
    wifiAuth: {
      total: counts.total ?? 0,
      failures: counts.failures ?? 0,
      lastFailureAt: counts.lastFailureAt ?? null,
      recent: recentAuth,
    },
  };
}

export function pruneEnrichmentsOlderThan(db: Database.Database, days: number) {
  if (!days || days <= 0) return 0;
  const cutoff = Date.now() - days * 86400_000;
  const a = db.prepare("DELETE FROM client_ip_history WHERE time < ?").run(cutoff);
  const b = db.prepare("DELETE FROM dhcp_leases WHERE time < ?").run(cutoff);
  const c = db.prepare("DELETE FROM wifi_auth_events WHERE time < ?").run(cutoff);
  return a.changes + b.changes + c.changes;
}
