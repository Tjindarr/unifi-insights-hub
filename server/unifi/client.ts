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
  for (const key of ["data", "events", "items", "results", "by_app", "by_cat", "client_usage_by_app", "usage_by_app"]) {
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
    const end = Date.now();
    const start = end - 24 * 60 * 60 * 1000;
    const slCats = ["next-ai-alerts", "triggers", "device-events", "client-events", "admin-activity", "threats", "updates", "vpn"];
    const events: ProbeResult[] = [];
    for (const cat of slCats) {
      events.push(
        await this.probe(
          `system-log-${cat}`,
          `/proxy/network/v2/api/site/${site}/system-log/${cat}`,
          { pageNumber: 0, pageSize: 50, timeframeFilter: { timeframe: "24h" } },
        ),
      );
    }
    events.push(
      await this.probe("events-v2", `/proxy/network/v2/api/site/${site}/events?within=168&limit=100`),
      await this.probe("events-v1-post", `/proxy/network/api/s/${site}/stat/event`, { _limit: 100, within: 168 }),
      await this.probe("events-v1-get", `/proxy/network/api/s/${site}/stat/event?_limit=100`),
      await this.probe("events-rest", `/proxy/network/api/s/${site}/rest/event?_limit=100`),
    );
    const dpi = await Promise.all([
      this.probe("traffic-v2-24h", `/proxy/network/v2/api/site/${site}/traffic?start=${start}&end=${end}&includeUnidentified=true`),
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
    // Modern UniFi Network (8.x+) on UDR7 exposes events through system-log,
    // not /stat/event. Query the most useful categories and merge them.
    const site = this.cfg.site;
    const cats = ["device-events", "client-events", "admin-activity", "triggers", "next-ai-alerts", "threats", "updates", "vpn"];
    const merged: any[] = [];
    for (const cat of cats) {
      try {
        const r: any = await this.call(
          `/proxy/network/v2/api/site/${site}/system-log/${cat}`,
          { pageNumber: 0, pageSize: 50, timeframeFilter: { timeframe: "24h" } },
        );
        const list: any[] = Array.isArray(r?.data) ? r.data
          : Array.isArray(r?.data?.data) ? r.data.data
          : Array.isArray(r) ? r : [];
        for (const it of list) merged.push({ ...it, __category: cat });
      } catch {
        // Try the legacy event endpoint as a last resort
      }
    }
    if (merged.length > 0) return { data: merged };
    // Legacy fallback for older controllers
    const attempts: Array<() => Promise<unknown>> = [
      () => this.call(`/proxy/network/v2/api/site/${site}/events?within=168&limit=100`),
      () => this.call(`/proxy/network/api/s/${site}/stat/event`, { _limit: 100, within: 168 }),
      () => this.call(`/proxy/network/api/s/${site}/stat/event?_limit=100`),
    ];
    for (const fn of attempts) { try { return await fn(); } catch {} }
    return { data: [] };
  }
  async dpi() {
    const site = this.cfg.site;
    const end = Date.now();
    const start = end - 24 * 60 * 60 * 1000;
    const attempts: Array<() => Promise<unknown>> = [
      () => this.call(`/proxy/network/v2/api/site/${site}/traffic?start=${start}&end=${end}&includeUnidentified=true`),
      () => this.call(`/proxy/network/api/s/${site}/stat/sitedpi`, { type: "by_app" }),
      () => this.call(`/proxy/network/api/s/${site}/stat/sitedpi`, { type: "by_cat" }),
      () => this.call(`/proxy/network/api/s/${site}/stat/stadpi`, { type: "by_app" }),
      () => this.call(`/proxy/network/api/s/${site}/stat/stadpi`),
    ];
    let lastErr: unknown = null;
    for (const fn of attempts) {
      try {
        const r: any = await fn();
        const data = r?.data ?? r;
        const clientTraffic = data?.client_usage_by_app ?? r?.client_usage_by_app;
        if (Array.isArray(clientTraffic) && clientTraffic.some((x) => Array.isArray(x?.usage_by_app) && x.usage_by_app.length > 0)) return r;
        if (Array.isArray(clientTraffic)) continue;
        if (Array.isArray(data) && data.some((x) => x && Object.keys(x).length > 0)) return r;
        if (!Array.isArray(data) && data && Object.keys(data).length > 0) return r;
      } catch (e) { lastErr = e; }
    }
    if (lastErr) throw lastErr;
    return { data: [] };
  }

  /**
   * Try several known UniFi endpoints that expose the DPI app & category
   * catalog (id → name). Returns whatever the first one that works gives us.
   * Different firmwares expose different paths; we collect what's available.
   */
  async dpiCatalog(): Promise<{ apps: Record<string, { name: string; category?: string | number }>; categories: Record<string, string>; sources: string[] }> {
    const site = this.cfg.site;
    const apps: Record<string, { name: string; category?: string | number }> = {};
    const categories: Record<string, string> = {};
    const sources: string[] = [];
    const tryGet = async (label: string, path: string) => {
      try {
        const r: any = await this.call(path);
        sources.push(`${label}:ok`);
        return r;
      } catch (e) {
        sources.push(`${label}:err`);
        return null;
      }
    };
    const ingestAppRow = (a: any) => {
      const id = a?.app_id ?? a?.application ?? a?.id ?? a?.appId;
      const name = a?.app_name ?? a?.name ?? a?.application_name;
      if (id == null || !name) return;
      apps[String(id)] = { name: String(name), category: a?.cat_id ?? a?.category ?? a?.cat ?? a?.category_id };
    };
    const ingestCatRow = (c: any) => {
      const id = c?.cat_id ?? c?.id ?? c?.category;
      const name = c?.cat_name ?? c?.name ?? c?.category_name;
      if (id == null || !name) return;
      categories[String(id)] = String(name);
    };
    const walk = (root: any) => {
      const arr: any[] = Array.isArray(root) ? root
        : Array.isArray(root?.data) ? root.data
        : Array.isArray(root?.applications) ? root.applications
        : Array.isArray(root?.apps) ? root.apps
        : Array.isArray(root?.categories) ? root.categories
        : [];
      for (const x of arr) {
        ingestAppRow(x);
        ingestCatRow(x);
        if (Array.isArray(x?.apps)) for (const a of x.apps) ingestAppRow({ ...a, category: a?.category ?? x?.id ?? x?.cat_id });
        if (Array.isArray(x?.applications)) for (const a of x.applications) ingestAppRow({ ...a, category: a?.category ?? x?.id ?? x?.cat_id });
      }
    };
    const candidates: Array<[string, string]> = [
      ["traffic-apps-v2", `/proxy/network/v2/api/site/${site}/trafficroutes/applications`],
      ["traffic-cats-v2", `/proxy/network/v2/api/site/${site}/trafficroutes/categories`],
      ["traffic-rules-apps", `/proxy/network/v2/api/site/${site}/trafficrules/applications`],
      ["traffic-rules-cats", `/proxy/network/v2/api/site/${site}/trafficrules/categories`],
      ["dpi-apps-v2", `/proxy/network/v2/api/site/${site}/dpi/applications`],
      ["dpi-cats-v2", `/proxy/network/v2/api/site/${site}/dpi/categories`],
      ["dpi-app-v1", `/proxy/network/api/s/${site}/stat/dpi/application`],
      ["dpi-cat-v1", `/proxy/network/api/s/${site}/stat/dpi/category`],
    ];
    for (const [label, path] of candidates) {
      const r = await tryGet(label, path);
      if (r) walk(r);
    }
    return { apps, categories, sources };
  }
}


