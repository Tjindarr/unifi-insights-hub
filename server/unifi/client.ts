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

type ProbeResult = {
  label: string;
  path: string;
  method: "GET" | "POST";
  ok: boolean;
  status?: number;
  error?: string;
  shape?: unknown;
};

function shapeOf(value: any): unknown {
  const root = value && typeof value === "object" && "data" in value ? value.data : value;
  const describeArray = (arr: any[]) => ({
    kind: "array",
    length: arr.length,
    firstKeys: arr[0] && typeof arr[0] === "object" ? Object.keys(arr[0]).slice(0, 30) : [],
    first: arr[0] && typeof arr[0] === "object" ? Object.fromEntries(Object.entries(arr[0]).slice(0, 12)) : arr[0],
  });
  if (Array.isArray(root)) return describeArray(root);
  if (!root || typeof root !== "object") return { kind: typeof root, value: root };
  const out: Record<string, unknown> = { kind: "object", keys: Object.keys(root).slice(0, 40) };
  for (const key of ["data", "events", "items", "results", "by_app", "by_cat"]) {
    const child = root[key];
    if (Array.isArray(child)) out[key] = describeArray(child);
  }
  return out;
}

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
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`UniFi ${path} → ${res.status}${text ? ` ${text.slice(0, 180)}` : ""}`);
    }
    return (await res.json()) as T;
  }

  private async probe(label: string, path: string, body?: unknown): Promise<ProbeResult> {
    try {
      const data = await this.call(path, body);
      return {
        label,
        path,
        method: body !== undefined ? "POST" : "GET",
        ok: true,
        status: 200,
        shape: shapeOf(data),
      };
    } catch (err) {
      return {
        label,
        path,
        method: body !== undefined ? "POST" : "GET",
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async diagnostics(): Promise<{ events: ProbeResult[]; dpi: ProbeResult[] }> {
    const site = this.cfg.site;
    const events = await Promise.all([
      this.probe("events-v2", `/proxy/network/v2/api/site/${site}/events?within=168&limit=100`),
      this.probe("events-v1-post", `/proxy/network/api/s/${site}/stat/event`, { _limit: 100, within: 168 }),
      this.probe("events-v1-get", `/proxy/network/api/s/${site}/stat/event?_limit=100`),
      this.probe("events-rest", `/proxy/network/api/s/${site}/rest/event?_limit=100`),
    ]);
    const dpi = await Promise.all([
      this.probe("sitedpi-by-app", `/proxy/network/api/s/${site}/stat/sitedpi`, { type: "by_app" }),
      this.probe("sitedpi-by-cat", `/proxy/network/api/s/${site}/stat/sitedpi`, { type: "by_cat" }),
      this.probe("stadpi-by-app", `/proxy/network/api/s/${site}/stat/stadpi`, { type: "by_app" }),
      this.probe("stadpi-default", `/proxy/network/api/s/${site}/stat/stadpi`),
      this.probe("dpi-apps-rest", `/proxy/network/api/s/${site}/rest/dpiapp`),
    ]);
    return { events, dpi };
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
  async events() {
    // UDR / UniFi OS firmwares differ. Try v2 first (current Network app),
    // then v1 POST, then v1 GET. Whichever responds is returned.
    const site = this.cfg.site;
    const attempts: Array<() => Promise<unknown>> = [
      () => this.call(`/proxy/network/v2/api/site/${site}/events?within=168&limit=100`),
      () => this.call(`/proxy/network/api/s/${site}/stat/event`, { _limit: 100, within: 168 }),
      () => this.call(`/proxy/network/api/s/${site}/stat/event?_limit=100`),
      () => this.call(`/proxy/network/api/s/${site}/rest/event?_limit=100`),
    ];
    let lastErr: unknown = null;
    for (const fn of attempts) {
      try { return await fn(); } catch (e) { lastErr = e; }
    }
    throw lastErr ?? new Error("events: all endpoints failed");
  }
  async dpi() {
    const site = this.cfg.site;
    // Site-wide DPI aggregated by app + category. UniFi expects POST with body.
    const attempts: Array<() => Promise<unknown>> = [
      () => this.call(`/proxy/network/api/s/${site}/stat/sitedpi`, { type: "by_app" }),
      () => this.call(`/proxy/network/api/s/${site}/stat/sitedpi`, { type: "by_cat" }),
      () => this.call(`/proxy/network/api/s/${site}/stat/stadpi`, { type: "by_app" }),
      () => this.call(`/proxy/network/api/s/${site}/stat/stadpi`),
    ];
    let lastErr: unknown = null;
    for (const fn of attempts) {
      try {
        const r: any = await fn();
        // Skip empty arrays so we keep trying, but keep objects because some
        // UniFi builds return { by_app: [...] } or { events: [...] } directly.
        const data = r?.data ?? r;
        if (Array.isArray(data) && data.length > 0) return r;
        if (!Array.isArray(data) && data && Object.keys(data).length > 0) return r;
      } catch (e) { lastErr = e; }
    }
    if (lastErr) throw lastErr;
    return { data: [] };
  }
}

