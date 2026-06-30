// Wraps a UnifiClient with hot-reload: when settings change, stop the current
// poller and start a new one. Also exposes a one-shot test method.

import type Database from "better-sqlite3";

import { UnifiClient, UnifiRateLimitError, type UnifiConfig } from "./client.ts";
import { setSnapshot, upsertClientName } from "../db/queries.ts";

type Status = {
  enabled: boolean;
  configured: boolean;
  lastPollAt: number | null;
  lastError: string | null;
  lastOk: boolean;
  optionalErrors?: Record<string, string>;
  backoffUntil?: number | null;
  consecutiveFailures?: number;
};

export class UnifiManager {
  private timer: NodeJS.Timeout | null = null;
  private client: UnifiClient | null = null;
  private catalogLastFetch = 0;
  private status: Status = {
    enabled: false,
    configured: false,
    lastPollAt: null,
    lastError: null,
    lastOk: false,
    optionalErrors: {},
  };

  constructor(private db: Database.Database, private intervalMs = 10_000) {}

  getStatus(): Status { return this.status; }

  async diagnostics() {
    if (!this.client) {
      return { ok: false, error: "UniFi poller is not running. Check Settings → UniFi and make sure it is enabled." };
    }
    return { ok: true, ...(await this.client.diagnostics()) };
  }

  async catalogProbe() {
    if (!this.client) return { ok: false, error: "poller not running" };
    return { ok: true, ...(await this.client.dpiCatalog()) };
  }

  async speedtestProbe() {
    if (!this.client) return { ok: false, error: "poller not running" };
    return { ok: true, ...(await this.client.speedtest()) };
  }

  apply(cfg: { enabled: boolean; host: string; user: string; password: string; site: string }) {
    this.stop();
    const configured = !!(cfg.host && cfg.user && cfg.password);
    this.status = { ...this.status, enabled: cfg.enabled, configured };
    if (!cfg.enabled || !configured) {
      console.log("[unifi] poller idle — disabled or incomplete config");
      return;
    }
    this.client = new UnifiClient({
      host: cfg.host,
      user: cfg.user,
      password: cfg.password,
      site: cfg.site || "default",
    });
    this.catalogLastFetch = 0;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.client = null;
  }

  private async poll() {
    if (!this.client) return;
    // Honor active backoff window — skip the poll entirely.
    const backoffUntil = this.status.backoffUntil ?? 0;
    if (backoffUntil && Date.now() < backoffUntil) return;

    const unwrap = (x: unknown) =>
      x && typeof x === "object" && "data" in (x as Record<string, unknown>)
        ? (x as { data: unknown }).data
        : x;
    const optionalErrors: Record<string, string> = {};
    let rateLimited: UnifiRateLimitError | null = null;
    const tryCall = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
      if (rateLimited) {
        optionalErrors[label] = "skipped (rate limited)";
        return null;
      }
      try { return await fn(); }
      catch (err) {
        if (err instanceof UnifiRateLimitError) {
          rateLimited = err;
          optionalErrors[label] = err.message;
          return null;
        }
        const msg = err instanceof Error ? err.message : String(err);
        optionalErrors[label] = msg;
        console.warn(`[unifi] ${label} failed:`, msg);
        return null;
      }
    };
    try {
      const [clients, devices, health] = await Promise.all([
        this.client.clients(),
        this.client.devices(),
        this.client.health(),
      ]);
      const clientsData = unwrap(clients);
      setSnapshot(this.db, "unifi_clients_snapshot", clientsData);
      setSnapshot(this.db, "unifi_devices_snapshot", unwrap(devices));
      setSnapshot(this.db, "unifi_health_snapshot", unwrap(health));

      // Persist MAC → name into the durable cache so historical log rows can
      // still resolve the device even after it disappears from the live list.
      try {
        const list = Array.isArray(clientsData) ? clientsData : [];
        const now = Date.now();
        const tx = this.db.transaction((rows: unknown[]) => {
          for (const raw of rows) {
            const c = raw as Record<string, unknown>;
            const mac = typeof c.mac === "string" ? c.mac : null;
            if (!mac) continue;
            const alias = typeof c.name === "string" && c.name ? c.name : null;
            const note = typeof c.note === "string" && c.note ? c.note : null;
            const hostname = typeof c.hostname === "string" && c.hostname ? c.hostname : null;
            const dhcpHostname = typeof c.dhcp_hostname === "string" && c.dhcp_hostname ? c.dhcp_hostname : null;
            if (alias) upsertClientName(this.db, mac, alias, "unifi_alias", now);
            else if (note) upsertClientName(this.db, mac, note, "unifi_alias", now);
            else if (hostname) upsertClientName(this.db, mac, hostname, "unifi_hostname", now);
            else if (dhcpHostname) upsertClientName(this.db, mac, dhcpHostname, "unifi_hostname", now);
          }
        });
        tx(list);
      } catch (err) {
        console.warn("[unifi] client-name cache update failed:", err instanceof Error ? err.message : err);
      }

      const [events, dpi, speedtest] = await Promise.all([
        tryCall("events", () => this.client!.events()),
        tryCall("dpi", () => this.client!.dpi()),
        tryCall("speedtest", () => this.client!.speedtest()),
      ]);
      if (events) setSnapshot(this.db, "unifi_events_snapshot", unwrap(events));
      if (dpi) setSnapshot(this.db, "unifi_dpi_snapshot", unwrap(dpi));
      if (speedtest && Array.isArray(speedtest.data)) {
        setSnapshot(this.db, "unifi_speedtest_snapshot", speedtest.data);
      }

      if (!rateLimited && Date.now() - this.catalogLastFetch > 60 * 60 * 1000) {
        const cat = await tryCall("dpi-catalog", () => this.client!.dpiCatalog());
        if (cat && (Object.keys(cat.apps).length > 0 || Object.keys(cat.categories).length > 0)) {
          setSnapshot(this.db, "unifi_dpi_catalog_snapshot", cat);
          this.catalogLastFetch = Date.now();
        }
      }

      if (rateLimited) {
        const err = rateLimited as UnifiRateLimitError;
        const until = Date.now() + err.retryAfterMs;
        const fails = (this.status.consecutiveFailures ?? 0) + 1;
        this.status = {
          ...this.status,
          lastPollAt: Date.now(),
          lastOk: false,
          lastError: err.message,
          optionalErrors,
          backoffUntil: until,
          consecutiveFailures: fails,
        };
        console.warn(`[unifi] rate limited — backing off ${Math.round(err.retryAfterMs / 1000)}s until ${new Date(until).toISOString()}`);
        return;
      }

      this.status = {
        ...this.status,
        lastPollAt: Date.now(),
        lastOk: true,
        lastError: null,
        optionalErrors,
        backoffUntil: null,
        consecutiveFailures: 0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const fails = (this.status.consecutiveFailures ?? 0) + 1;
      let until: number | null = null;
      if (err instanceof UnifiRateLimitError) {
        until = Date.now() + err.retryAfterMs;
        console.warn(`[unifi] rate limited on auth — backing off ${Math.round(err.retryAfterMs / 1000)}s`);
      } else {
        // Exponential backoff on repeated hard failures: 30s, 1m, 2m, 5m max.
        if (fails >= 3) {
          const delay = Math.min(5 * 60_000, 30_000 * 2 ** Math.min(fails - 3, 4));
          until = Date.now() + delay;
        }
      }
      this.status = {
        ...this.status,
        lastPollAt: Date.now(),
        lastOk: false,
        lastError: msg,
        optionalErrors,
        backoffUntil: until,
        consecutiveFailures: fails,
      };
      console.error("[unifi] poll failed", msg);
    }
  }



  /** One-shot connectivity check using arbitrary (unsaved) credentials. */
  static async test(cfg: UnifiConfig): Promise<{ ok: boolean; error?: string }> {
    try {
      const c = new UnifiClient(cfg);
      await c.health();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
