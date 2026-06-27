// Minimal UniFi controller poller. Works with UniFi OS local accounts on a UDR
// or self-hosted controller. Tolerates self-signed certs.

import { Agent, fetch } from "undici";

const agent = new Agent({ connect: { rejectUnauthorized: false } });

export type UnifiConfig = {
  host: string;
  user: string;
  password: string;
  site: string;
};

type Cookies = { auth: string; csrf?: string };

export class UnifiClient {
  private cookies: Cookies | null = null;

  constructor(private cfg: UnifiConfig) {}

  private base() {
    return `https://${this.cfg.host}`;
  }

  private async login(): Promise<void> {
    const res = await fetch(`${this.base()}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: this.cfg.user, password: this.cfg.password }),
      dispatcher: agent,
    });
    if (!res.ok) throw new Error(`UniFi login failed: ${res.status} ${res.statusText}`);
    const setCookies = res.headers.getSetCookie?.() ?? [];
    const cookieStr = setCookies.map((c) => c.split(";")[0]).join("; ");
    const csrf = res.headers.get("x-csrf-token") ?? undefined;
    this.cookies = { auth: cookieStr, csrf };
  }

  private async call<T = unknown>(path: string, body?: unknown): Promise<T> {
    if (!this.cookies) await this.login();
    const doFetch = () =>
      fetch(`${this.base()}${path}`, {
        method: body !== undefined ? "POST" : "GET",
        headers: {
          cookie: this.cookies!.auth,
          ...(this.cookies!.csrf ? { "x-csrf-token": this.cookies!.csrf } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        dispatcher: agent,
      });
    let res = await doFetch();
    if (res.status === 401 || res.status === 403) {
      this.cookies = null;
      await this.login();
      res = await doFetch();
    }
    if (!res.ok) throw new Error(`UniFi ${path} → ${res.status}`);
    return (await res.json()) as T;
  }

  clients() {
    return this.call(`/proxy/network/api/s/${this.cfg.site}/stat/sta`);
  }
  devices() {
    return this.call(`/proxy/network/api/s/${this.cfg.site}/stat/device`);
  }
  health() {
    return this.call(`/proxy/network/api/s/${this.cfg.site}/stat/health`);
  }
  events() {
    return this.call(`/proxy/network/api/s/${this.cfg.site}/stat/event?_limit=100`);
  }
  async dpi() {
    // Site-wide DPI aggregated by app + category. UniFi expects POST with body.
    try {
      return await this.call(`/proxy/network/api/s/${this.cfg.site}/stat/sitedpi`, { type: "by_app" });
    } catch {
      // Per-station DPI fallback for firmwares that don't expose sitedpi.
      return await this.call(`/proxy/network/api/s/${this.cfg.site}/stat/stadpi`, { type: "by_app" });
    }
  }
}

