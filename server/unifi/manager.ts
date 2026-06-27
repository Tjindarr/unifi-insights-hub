// Wraps a UnifiClient with hot-reload: when settings change, stop the current
// poller and start a new one. Also exposes a one-shot test method.

import type Database from "better-sqlite3";

import { UnifiClient, type UnifiConfig } from "./client.ts";
import { setSnapshot } from "../db/queries.ts";

type Status = {
  enabled: boolean;
  configured: boolean;
  lastPollAt: number | null;
  lastError: string | null;
  lastOk: boolean;
  optionalErrors?: Record<string, string>;
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
    const unwrap = (x: unknown) =>
      x && typeof x === "object" && "data" in (x as Record<string, unknown>)
        ? (x as { data: unknown }).data
        : x;
    const optionalErrors: Record<string, string> = {};
    const tryCall = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
      try { return await fn(); }
      catch (err) {
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
      setSnapshot(this.db, "unifi_clients_snapshot", unwrap(clients));
      setSnapshot(this.db, "unifi_devices_snapshot", unwrap(devices));
      setSnapshot(this.db, "unifi_health_snapshot", unwrap(health));

      const [events, dpi, speedtest] = await Promise.all([
        tryCall("events", () => this.client!.events()),
        tryCall("dpi", () => this.client!.dpi()),
        tryCall("speedtest", () => this.client!.speedtest()),
      ]);
      if (events) setSnapshot(this.db, "unifi_events_snapshot", unwrap(events));
      if (dpi) setSnapshot(this.db, "unifi_dpi_snapshot", unwrap(dpi));
      if (speedtest && Array.isArray(speedtest.data)) {
        // Always store (even empty array) so the UI doesn't keep stale rows,
        // and so /api/_debug/raw-speedtest reflects current state.
        setSnapshot(this.db, "unifi_speedtest_snapshot", speedtest.data);
      }

      // Refresh DPI catalog (id → name) at most once per hour.
      if (Date.now() - this.catalogLastFetch > 60 * 60 * 1000) {
        const cat = await tryCall("dpi-catalog", () => this.client!.dpiCatalog());
        if (cat && (Object.keys(cat.apps).length > 0 || Object.keys(cat.categories).length > 0)) {
          setSnapshot(this.db, "unifi_dpi_catalog_snapshot", cat);
          this.catalogLastFetch = Date.now();
        }
      }

      this.status = { ...this.status, lastPollAt: Date.now(), lastOk: true, lastError: null, optionalErrors };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.status = { ...this.status, lastPollAt: Date.now(), lastOk: false, lastError: msg, optionalErrors };
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
