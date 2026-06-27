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
};

export class UnifiManager {
  private timer: NodeJS.Timeout | null = null;
  private client: UnifiClient | null = null;
  private status: Status = {
    enabled: false,
    configured: false,
    lastPollAt: null,
    lastError: null,
    lastOk: false,
  };

  constructor(private db: Database.Database, private intervalMs = 10_000) {}

  getStatus(): Status { return this.status; }

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
    try {
      const [clients, devices, health] = await Promise.all([
        this.client.clients(),
        this.client.devices(),
        this.client.health(),
      ]);
      const unwrap = (x: unknown) =>
        x && typeof x === "object" && "data" in (x as Record<string, unknown>)
          ? (x as { data: unknown }).data
          : x;
      setSnapshot(this.db, "unifi_clients_snapshot", unwrap(clients));
      setSnapshot(this.db, "unifi_devices_snapshot", unwrap(devices));
      setSnapshot(this.db, "unifi_health_snapshot", unwrap(health));
      this.status = { ...this.status, lastPollAt: Date.now(), lastOk: true, lastError: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.status = { ...this.status, lastPollAt: Date.now(), lastOk: false, lastError: msg };
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
