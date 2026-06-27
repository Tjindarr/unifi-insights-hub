// Persistent runtime configuration, stored at /data/config.json so it survives
// container updates. Environment variables seed the file on first run only;
// after that the UI is the source of truth.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

export type UnifiSettings = {
  host: string;
  user: string;
  password: string;
  site: string;
  enabled: boolean;
};

export type RetentionSettings = {
  retentionDays: number;
  retentionFirewallDays: number;
  maxDbMb: number;
  intervalMin: number;
  vacuumHours: number;
};

export type NoiseFilterSettings = {
  enabled: boolean;
  action: "drop" | "downgrade";
  patterns: string[];
};

export type ThreatIntelSettings = {
  abuseIpdbKey: string;
  /** Map of feed id -> enabled. Missing keys fall back to the feed's default. */
  feeds: Record<string, boolean>;
  /** When true, fall back to AbuseIPDB /check for IPs not found in any feed. */
  checkOnMiss: boolean;
};

export type SyslogSettings = {
  /**
   * Offset in minutes that the router's clock is AHEAD of UTC.
   * UniFi RFC3164 timestamps have no timezone — set this to your router's
   * timezone offset (e.g. 120 for CEST, 60 for CET, -300 for EST).
   * Use 0 if your container TZ already matches the router.
   */
  tzOffsetMinutes: number;
  /** When true, ignore the router's timestamp and stamp on arrival. */
  useArrivalTime: boolean;
};


export type AppConfig = {
  unifi: UnifiSettings;
  retention: RetentionSettings;
  noiseFilter: NoiseFilterSettings;
  threatIntel: ThreatIntelSettings;
  syslog: SyslogSettings;
  sessionSecret: string;
};

const env = (k: string, fallback?: string) => process.env[k] ?? fallback;
const num = (k: string, fb: number) => {
  const v = process.env[k];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fb;
};

function defaults(): AppConfig {
  return {
    unifi: {
      host: env("UNIFI_HOST", "") ?? "",
      user: env("UNIFI_USER", "") ?? "",
      password: env("UNIFI_PASSWORD", "") ?? "",
      site: env("UNIFI_SITE", "default") ?? "default",
      enabled: !!env("UNIFI_HOST"),
    },
    retention: {
      retentionDays: num("RETENTION_DAYS", 30),
      retentionFirewallDays: num("RETENTION_FIREWALL_DAYS", 30),
      maxDbMb: num("RETENTION_MAX_DB_MB", 2048),
      intervalMin: num("RETENTION_INTERVAL_MIN", 60),
      vacuumHours: num("RETENTION_VACUUM_HOURS", 24),
    },
    noiseFilter: {
      enabled: (env("NOISE_FILTER", "true") ?? "true") !== "false",
      action: (env("NOISE_FILTER_ACTION", "drop") === "downgrade" ? "downgrade" : "drop"),
      patterns: [],
    },
    threatIntel: {
      abuseIpdbKey: env("ABUSEIPDB_KEY", env("ABUSEIPDB_API_KEY", "")) ?? "",
      // Defaults: AbuseIPDB blacklist (needs key), FireHOL L1, Spamhaus DROP.
      feeds: {
        abuseipdb_blacklist: true,
        firehol_level1: true,
        spamhaus_drop: true,
        spamhaus_edrop: false,
        et_compromised: false,
        blocklist_de: false,
        cins_army: false,
      },
      checkOnMiss: true,
    },
    syslog: {
      tzOffsetMinutes: num("SYSLOG_TZ_OFFSET_MIN", 0),
      useArrivalTime: (env("SYSLOG_USE_ARRIVAL_TIME", "false") ?? "false") === "true",
    },

    sessionSecret: env("SESSION_SECRET", "") ?? "",
  };
}

function merge(base: AppConfig, patch: Partial<AppConfig>): AppConfig {
  const pt = patch.threatIntel;
  return {
    unifi: { ...base.unifi, ...(patch.unifi ?? {}) },
    retention: { ...base.retention, ...(patch.retention ?? {}) },
    noiseFilter: { ...base.noiseFilter, ...(patch.noiseFilter ?? {}) },
    threatIntel: {
      ...base.threatIntel,
      ...(pt ?? {}),
      feeds: { ...base.threatIntel.feeds, ...(pt?.feeds ?? {}) },
    },
    syslog: { ...base.syslog, ...(patch.syslog ?? {}) },
    sessionSecret: patch.sessionSecret || base.sessionSecret,
  };
}


export class ConfigStore {
  private cfg: AppConfig;
  private listeners = new Set<(cfg: AppConfig) => void>();

  constructor(private path: string) {
    mkdirSync(dirname(path), { recursive: true });
    const base = defaults();
    let loaded: Partial<AppConfig> = {};
    if (existsSync(path)) {
      try {
        loaded = JSON.parse(readFileSync(path, "utf8")) as Partial<AppConfig>;
      } catch (err) {
        console.error("[config] failed to parse", path, err);
      }
    }
    this.cfg = merge(base, loaded);
    // Auto-generate a session secret on first launch if not provided.
    if (!this.cfg.sessionSecret || this.cfg.sessionSecret.length < 32) {
      this.cfg.sessionSecret = randomBytes(32).toString("hex");
    }
    this.persist();
  }

  get(): AppConfig {
    return this.cfg;
  }

  /** Public-safe view — never returns the UniFi password or session secret. */
  publicView() {
    return {
      unifi: {
        host: this.cfg.unifi.host,
        user: this.cfg.unifi.user,
        site: this.cfg.unifi.site,
        enabled: this.cfg.unifi.enabled,
        hasPassword: !!this.cfg.unifi.password,
      },
      retention: { ...this.cfg.retention },
      noiseFilter: { ...this.cfg.noiseFilter },
      threatIntel: {
        hasAbuseIpdbKey: !!this.cfg.threatIntel.abuseIpdbKey,
        feeds: { ...this.cfg.threatIntel.feeds },
        checkOnMiss: this.cfg.threatIntel.checkOnMiss,
      },
    };
  }

  update(patch: Partial<AppConfig>): AppConfig {
    this.cfg = merge(this.cfg, patch);
    this.persist();
    for (const l of this.listeners) {
      try { l(this.cfg); } catch (err) { console.error("[config] listener failed", err); }
    }
    return this.cfg;
  }

  onChange(fn: (cfg: AppConfig) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private persist() {
    const tmp = this.path + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.cfg, null, 2), "utf8");
    try { chmodSync(tmp, 0o600); } catch { /* non-fatal on some FS */ }
    renameSync(tmp, this.path);
  }
}
