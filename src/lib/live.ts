// Centralized live-data layer for the dashboard.
//
// Every page calls one of the named hooks here. Each hook tries `/api/*` and
// transparently falls back to the deterministic mock data when the UniFi
// controller hasn't been connected yet (or returned 204 / empty). All hooks
// also expose `isLive` so pages can show a "Demo data" badge.

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  clients as mockClients,
  firewallEvents as mockFw,
  overview as mockOverview,
  syslog as mockSyslog,
  wanThroughput as mockWanThroughput,
  accessPoints as mockAps,
  siteHealth as mockSiteHealth,
  type Client,
  type FirewallEvent,
  type Severity,
  type SyslogEntry,
} from "./mock-data";
import {
  collector as mockCollector,
  dpiByCategory as mockDpiByCategory,
  dpiTopApps as mockDpiTopApps,
  firewallByMinute as mockFwByMin,
  firmware as mockFirmware,
  ports as mockPorts,
  siteEvents as mockEvents,
  ssids as mockSsids,
  syslogByMinute as mockSyslogByMin,
  topology as mockTopology,
  wan as mockWan,
  type DpiApp,
  type FirmwareRow,
  type Port,
  type SiteEvent,
  type Ssid,
} from "./mock-extra";

// ---------------------------------------------------------------------------
// Generic fetcher / wrapper
// ---------------------------------------------------------------------------

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { credentials: "include" });
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  // Some endpoints might return empty body
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text) as T;
}

export type Live<T> = { data: T; isLive: boolean; loading: boolean };

function useLive<T>(
  key: string,
  fetcher: () => Promise<T | null>,
  fallback: T,
  refetchMs: number | false = 10_000,
): Live<T> {
  const { data, isLoading } = useQuery({
    queryKey: [key],
    queryFn: fetcher,
    refetchInterval: refetchMs === false ? false : refetchMs,
    refetchOnWindowFocus: refetchMs !== false,
    staleTime: refetchMs === false ? Infinity : refetchMs / 2,
  });
  // Treat any non-null response as live, even if the array is empty — that
  // just means UniFi is connected but has nothing to report right now.
  const isLive = data != null;
  return { data: isLive ? (data as T) : fallback, isLive, loading: isLoading };
}


// ---------------------------------------------------------------------------
// Collector / status
// ---------------------------------------------------------------------------

export type CollectorStatus = {
  msgsPerSec: number;
  syslogQueueDepth: number;
  unifiPollMs: number;
  unifiPollAgeSec: number;
  unifiOk: boolean;
  unifiConfigured: boolean;
  dbSizeBytes: number;
  retentionDays: number;
  oldestEntryDays: number;
  fts5Indexed: number;
  abuseQuotaExhausted?: boolean;
  abuseQuotaRetryAt?: number | null;
  abuseQuotaError?: string | null;
};

const mockCollectorFull: CollectorStatus = {
  ...mockCollector,
  unifiOk: false,
  unifiConfigured: false,
};

export function useCollector(): Live<CollectorStatus> {
  return useLive("collector", () => getJson<CollectorStatus>("/api/collector"), mockCollectorFull, 5_000);
}

// ---------------------------------------------------------------------------
// Parsing health — rolling per-minute counters from the syslog ingester.
// ---------------------------------------------------------------------------

export type ParseHealthBucket = {
  t: number;
  accepted: number;
  rejected: number;
  tzSkewed: number;
  cefFailures: number;
};

export type ParseHealth = {
  buckets: ParseHealthBucket[];
  windowTotals: Omit<ParseHealthBucket, "t">;
  totals: Omit<ParseHealthBucket, "t">;
};

const EMPTY_PARSE_HEALTH: ParseHealth = {
  buckets: [],
  windowTotals: { accepted: 0, rejected: 0, tzSkewed: 0, cefFailures: 0 },
  totals: { accepted: 0, rejected: 0, tzSkewed: 0, cefFailures: 0 },
};

export function useParseHealth(windowMin = 60, opts: { paused?: boolean } = {}): Live<ParseHealth> {
  return useLive(
    `parse-health:${windowMin}`,
    () => getJson<ParseHealth>(`/api/parse-health?windowMin=${windowMin}`),
    EMPTY_PARSE_HEALTH,
    opts.paused ? false : 15_000,
  );
}

// ---------------------------------------------------------------------------
// Overview / clients
// ---------------------------------------------------------------------------

type Overview = ReturnType<typeof mockOverview>;

export function useOverview(opts: { paused?: boolean } = {}): Live<Overview> {
  return useLive("overview", () => getJson<Overview>("/api/overview"), mockOverview(), opts.paused ? false : 10_000);
}

export function useClients(opts: { paused?: boolean } = {}): Live<Client[]> {
  return useLive("clients", () => getJson<Client[]>("/api/clients"), mockClients, opts.paused ? false : 10_000);
}

// Persistent MAC → name cache that survives device offline / UniFi outages.
// Populated server-side from UniFi polls and DHCP syslog enrichment.
export type ClientNamesResponse = { count: number; names: Record<string, { name: string; source: string }> };
const EMPTY_CLIENT_NAMES: ClientNamesResponse = { count: 0, names: {} };
export function useClientNames(opts: { paused?: boolean } = {}): Live<ClientNamesResponse> {
  return useLive(
    "client-names",
    () => getJson<ClientNamesResponse>("/api/client-names"),
    EMPTY_CLIENT_NAMES,
    opts.paused ? false : 30_000,
  );
}

// ---------------------------------------------------------------------------
// Firewall (server returns SQL rows — normalize to FirewallEvent shape)
// ---------------------------------------------------------------------------

type FwRow = {
  id: number; time: number; rule: string; action: string;
  event_type: string; message_type: string; client_mac: string | null;
  src_ip: string | null; src_port: number | null; dst_ip: string | null; dst_port: number | null;
  proto: string | null; vap: string | null; rssi: number | null; reason: string | null;
  raw_json: string | null;
};

function normFw(rows: FwRow[], macToName: Map<string, string>): FirewallEvent[] {
  return rows.map((r) => {
    let raw: Record<string, unknown> = {};
    try { raw = r.raw_json ? JSON.parse(r.raw_json) : {}; } catch { /* */ }
    const severity: Severity = r.action === "failure" ? "warn" : ["drop", "deny", "block", "reject"].includes(r.action ?? "") ? "error" : "info";
    const macKey = r.client_mac?.toLowerCase();
    return {
      id: `fw${r.id}`,
      time: new Date(r.time).toISOString(),
      rule: r.rule ?? "",
      action: (r.action ?? "info") as FirewallEvent["action"],
      eventType: r.event_type ?? "",
      messageType: r.message_type ?? "",
      clientMac: r.client_mac ?? undefined,
      clientName: macKey ? macToName.get(macKey) : undefined,
      srcIp: r.src_ip ?? undefined,
      srcPort: r.src_port ?? undefined,
      dstIp: r.dst_ip ?? undefined,
      dstPort: r.dst_port ?? undefined,
      proto: r.proto ?? undefined,
      vap: r.vap ?? undefined,
      rssi: r.rssi ?? undefined,
      reason: r.reason ?? undefined,
      severity,
      raw,
    };
  });
}

export function useFirewall(opts: { kind?: "internal" | "firewall"; limit?: number; since?: number; until?: number; paused?: boolean } = {}): Live<FirewallEvent[]> {
  const { data: clients } = useClients({ paused: opts.paused });
  const { data: cachedNames } = useClientNames({ paused: opts.paused });
  const limit = opts.limit ?? 500;
  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  if (opts.kind) qs.set("kind", opts.kind);
  if (opts.since != null) qs.set("since", String(opts.since));
  if (opts.until != null) qs.set("until", String(opts.until));
  const key = `firewall?${qs.toString()}`;
  const { data, isLive, loading } = useLive<FwRow[] | FirewallEvent[]>(
    key,
    () => getJson<FwRow[]>(`/api/firewall?${qs.toString()}`),
    mockFw as unknown as FwRow[],
    opts.paused ? false : 10_000,
  );

  const macToName = useMemo(() => {
    const m = new Map<string, string>();
    // Seed with persistent cache first — these are the names that survive
    // devices going offline or disappearing from the live client list.
    for (const [mac, info] of Object.entries(cachedNames.names)) {
      if (mac && info?.name) m.set(mac.toLowerCase(), info.name);
    }
    // Live UniFi client list overrides with the freshest names.
    for (const c of clients) {
      if (!c.mac) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyC = c as any;
      const name =
        anyC.alias ||
        anyC.name ||
        anyC.hostname ||
        anyC.dhcp_hostname ||
        anyC.dhcpHostname ||
        anyC.dns ||
        anyC.fingerprint?.name ||
        null;
      if (name) m.set(String(c.mac).toLowerCase(), String(name));
    }
    return m;
  }, [clients, cachedNames]);
  const normalized = isLive ? normFw(data as FwRow[], macToName) : (data as FirewallEvent[]);
  return { data: normalized, isLive, loading };
}

// Bucket sizing for time-range driven charts.
import type { TimeRangeKey } from "./ui-store";

export function bucketSpecForRange(range: TimeRangeKey): { windowMs: number; bucketMs: number; label: string } {
  switch (range) {
    case "15m": return { windowMs: 15 * 60_000,        bucketMs:        60_000, label: "per minute" };
    case "1h":  return { windowMs: 60 * 60_000,        bucketMs:        60_000, label: "per minute" };
    case "24h": return { windowMs: 24 * 60 * 60_000,   bucketMs:   15 * 60_000, label: "per 15 min" };
    case "7d":  return { windowMs: 7 * 24 * 60 * 60_000, bucketMs: 60 * 60_000, label: "per hour" };
    case "30d": return { windowMs: 30 * 24 * 60 * 60_000, bucketMs: 6 * 60 * 60_000, label: "per 6 hours" };
  }
}

function bucketEvents<T extends string>(
  events: { time: string; key: T }[],
  range: TimeRangeKey,
  keys: readonly T[],
): { t: string; [k: string]: number | string }[] {
  const { windowMs, bucketMs } = bucketSpecForRange(range);
  // Anchor "now" to whichever is later: wall-clock or the newest event time.
  // This avoids dropping fresh events when the source device's clock is ahead
  // of the browser's clock (common with UDR vs laptop drift).
  let latest = Date.now();
  for (const e of events) {
    const ms = new Date(e.time).getTime();
    if (Number.isFinite(ms) && ms > latest) latest = ms;
  }
  const now = latest;
  const start = now - windowMs;
  const emptyRow = () => Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;
  const buckets = new Map<number, Record<T, number>>();
  // Seed empty buckets so the chart spans the full window even when sparse.
  const first = Math.floor(start / bucketMs) * bucketMs;
  for (let t = first; t <= now; t += bucketMs) buckets.set(t, emptyRow());
  for (const e of events) {
    const ms = new Date(e.time).getTime();
    if (!Number.isFinite(ms) || ms < start) continue;
    const slot = Math.floor(ms / bucketMs) * bucketMs;
    const row = buckets.get(slot) ?? emptyRow();
    row[e.key] = (row[e.key] ?? 0) + 1;
    buckets.set(slot, row);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, row]) => ({ t: new Date(t).toISOString(), ...row }));
}

// Derived: firewall events bucketed for the active time range (success vs failure).
// Backed by a dedicated SQL aggregation endpoint so the chart spans the whole
// window even when the table only fetched the most recent 500 rows.
export function useFirewallByMinute(
  range: TimeRangeKey = "1h",
  opts: { paused?: boolean; sinceMs?: number; untilMs?: number } = {},
) {
  type BucketRow = { t: number; success: number; failure: number };
  const custom = opts.sinceMs != null && opts.untilMs != null && opts.untilMs > opts.sinceMs;
  const spec = custom
    ? pickBucketSpec(opts.untilMs! - opts.sinceMs!)
    : bucketSpecForRange(range);
  const sinceKey = custom ? opts.sinceMs! : "default";
  const untilKey = custom ? opts.untilMs! : "now";
  const { data, isLive } = useLive<BucketRow[]>(
    `firewall-buckets:${range}:${sinceKey}:${untilKey}`,
    () => {
      const sinceNow = custom
        ? Math.floor(opts.sinceMs! / spec.bucketMs) * spec.bucketMs
        : Math.floor((Date.now() - spec.windowMs) / spec.bucketMs) * spec.bucketMs;
      const qs = new URLSearchParams();
      qs.set("kind", "firewall");
      qs.set("since", String(sinceNow));
      qs.set("rangeMs", String(spec.windowMs));
      qs.set("bucketMs", String(spec.bucketMs));
      if (custom) qs.set("until", String(opts.untilMs!));
      return getJson<BucketRow[]>(`/api/firewall/buckets?${qs.toString()}`);
    },
    [],
    opts.paused ? false : 15_000,
  );
  if (!isLive) return { data: mockFwByMin, isLive: false, label: "per minute" };

  // Anchor the chart end to whichever is later: wall-clock or the newest
  // bucket returned by the server. UDR event timestamps are frequently ahead
  // of the browser clock, and without this the future buckets would be
  // silently dropped and the chart would render all zeros.
  const wallNow = Date.now();
  let latest = custom ? opts.untilMs! : wallNow;
  for (const r of data) if (r.t > latest) latest = r.t + spec.bucketMs - 1;
  const start = custom ? opts.sinceMs! : latest - spec.windowMs;
  const first = Math.floor(start / spec.bucketMs) * spec.bucketMs;
  const rowByT = new Map<number, BucketRow>();
  for (const r of data) rowByT.set(r.t, r);
  const out: { t: string; success: number; failure: number }[] = [];
  for (let t = first; t <= latest; t += spec.bucketMs) {
    const r = rowByT.get(t);
    out.push({ t: new Date(t).toISOString(), success: r?.success ?? 0, failure: r?.failure ?? 0 });
  }
  return { data: out, isLive: true, label: spec.label };
}

// Choose a sensible bucket size for an arbitrary window length.
function pickBucketSpec(windowMs: number): { windowMs: number; bucketMs: number; label: string } {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  if (windowMs <= 60 * MIN)         return { windowMs, bucketMs: MIN,            label: "per minute" };
  if (windowMs <= 24 * HOUR)        return { windowMs, bucketMs: 15 * MIN,       label: "per 15 min" };
  if (windowMs <= 7 * 24 * HOUR)    return { windowMs, bucketMs: HOUR,           label: "per hour" };
  return                                   { windowMs, bucketMs: 6 * HOUR,       label: "per 6 hours" };
}



// Internal events bucketed for the active time range, by category.
// Uses a dedicated SQL aggregation endpoint, so it is controlled only by the
// global time range and never by the page's "Last N" table limit.
export function useInternalByBucket(
  categorise: (e: FirewallEvent) => string,
  categories: readonly string[],
  range: TimeRangeKey = "1h",
  opts: { paused?: boolean; sinceMs?: number; untilMs?: number } = {},
) {
  const custom = opts.sinceMs != null && opts.untilMs != null && opts.untilMs > opts.sinceMs;
  const spec = custom
    ? pickBucketSpec(opts.untilMs! - opts.sinceMs!)
    : bucketSpecForRange(range);
  const sinceKey = custom ? opts.sinceMs! : "default";
  const untilKey = custom ? opts.untilMs! : "now";
  type InternalBucketRow = {
    t: number;
    connect: number;
    disconnect: number;
    authSuccess: number;
    authFailure: number;
    roam: number;
    other: number;
  };
  const { data: chartRows, isLive } = useLive<InternalBucketRow[]>(
    `internal-buckets:${range}:${sinceKey}:${untilKey}`,
    () => {
      const qs = new URLSearchParams();
      qs.set("rangeMs", String(spec.windowMs));
      qs.set("bucketMs", String(spec.bucketMs));
      if (custom) {
        qs.set("since", String(opts.sinceMs!));
        qs.set("until", String(opts.untilMs!));
      }
      return getJson<InternalBucketRow[]>(`/api/internal/buckets?${qs.toString()}`);
    },
    [],
    opts.paused ? false : 15_000,
  );
  if (!isLive) {
    const mapped = (mockFw as FirewallEvent[]).map((e) => ({ time: e.time, key: categorise(e) }));
    return {
      data: bucketEvents(mapped, range, categories),
      label: spec.label,
    };
  }

  const wallNow = Date.now();
  let latest = custom ? opts.untilMs! : wallNow;
  for (const r of chartRows) if (r.t > latest) latest = r.t + spec.bucketMs - 1;
  const start = custom ? opts.sinceMs! : latest - spec.windowMs;
  const first = Math.floor(start / spec.bucketMs) * spec.bucketMs;
  const rowByT = new Map<number, InternalBucketRow>();
  for (const r of chartRows) rowByT.set(r.t, r);
  const out: { t: string; [k: string]: number | string }[] = [];
  for (let t = first; t <= latest; t += spec.bucketMs) {
    const r = rowByT.get(t);
    out.push({
      t: new Date(t).toISOString(),
      connect: r?.connect ?? 0,
      disconnect: r?.disconnect ?? 0,
      "auth-success": r?.authSuccess ?? 0,
      "auth-failure": r?.authFailure ?? 0,
      roam: r?.roam ?? 0,
      other: r?.other ?? 0,
    });
  }
  return {
    data: out,
    label: spec.label,
  };
}

// ---------------------------------------------------------------------------
// Syslog
// ---------------------------------------------------------------------------

type SysRow = {
  id: number; time: number; host: string; appname: string;
  facility: string; severity: string; message: string; raw: string; is_firewall: number;
};

function normSyslog(rows: SysRow[]): SyslogEntry[] {
  return rows.map((r) => ({
    id: `s${r.id}`,
    time: new Date(r.time).toISOString(),
    host: r.host,
    appname: r.appname ?? "",
    facility: r.facility ?? "",
    severity: (r.severity ?? "info") as Severity,
    message: r.message,
    raw: r.raw,
    isFirewall: !!r.is_firewall,
  }));
}

export function useSyslog(
  params: { q?: string; host?: string; severity?: string; since?: number; until?: number; limit?: number; paused?: boolean } = {},
): Live<SyslogEntry[]> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.host) qs.set("host", params.host);
  if (params.severity) qs.set("severity", params.severity);
  if (params.since != null) qs.set("since", String(params.since));
  if (params.until != null) qs.set("until", String(params.until));
  qs.set("limit", String(params.limit ?? 500));
  const key = `syslog?${qs.toString()}`;
  const { data, isLive, loading } = useLive<SysRow[] | SyslogEntry[]>(
    key,
    () => getJson<SysRow[]>(`/api/logs?${qs.toString()}`),
    mockSyslog as unknown as SysRow[],
    params.paused ? false : 10_000,
  );
  const normalized = isLive ? normSyslog(data as SysRow[]) : (data as SyslogEntry[]);
  return { data: normalized, isLive, loading };
}


// Syslog severity buckets driven only by the global time range — same
// pattern as useFirewallByMinute, so the chart is independent of the table's
// row limit and active filters.
export function useSyslogByMinute(range: TimeRangeKey = "1h", opts: { paused?: boolean } = {}) {
  const spec = bucketSpecForRange(range);
  type BucketRow = { t: number; info: number; warn: number; error: number };
  const { data, isLive } = useLive<BucketRow[]>(
    `syslog-buckets:${range}`,
    () => getJson<BucketRow[]>(`/api/syslog/buckets?rangeMs=${spec.windowMs}&bucketMs=${spec.bucketMs}`),
    [],
    opts.paused ? false : 15_000,
  );
  if (!isLive) return { data: mockSyslogByMin, isLive: false, label: "per minute" };

  const wallNow = Date.now();
  let latest = wallNow;
  for (const r of data) if (r.t > latest) latest = r.t + spec.bucketMs - 1;
  const start = latest - spec.windowMs;
  const first = Math.floor(start / spec.bucketMs) * spec.bucketMs;
  const rowByT = new Map<number, BucketRow>();
  for (const r of data) rowByT.set(r.t, r);
  const out: { t: string; info: number; warn: number; error: number }[] = [];
  for (let t = first; t <= latest; t += spec.bucketMs) {
    const r = rowByT.get(t);
    out.push({
      t: new Date(t).toISOString(),
      info: r?.info ?? 0,
      warn: r?.warn ?? 0,
      error: r?.error ?? 0,
    });
  }
  return { data: out, isLive: true, label: spec.label };
}

// ---------------------------------------------------------------------------
// WAN / network / topology / ports / firmware / ssids / dpi / events
// ---------------------------------------------------------------------------

type WanResp = ReturnType<typeof mockWanShape>;
function mockWanShape() {
  return {
    isp: mockWan.isp,
    ipv4: mockWan.ipv4,
    ipv6: mockWan.ipv6,
    ddns: mockWan.ddns,
    uplink: mockWan.uplink,
    status: mockSiteHealth.wanStatus,
    latency: mockSiteHealth.wanLatency,
    loss: mockSiteHealth.wanLoss,
    uptime: mockSiteHealth.uptime,
    cpu: mockSiteHealth.cpu,
    memory: mockSiteHealth.memory,
    wlanClients: 0,
  };
}

export function useWan(): Live<WanResp> {
  return useLive("wan", () => getJson<WanResp>("/api/wan"), mockWanShape());
}

export type SpeedTestRow = { t: string; down: number; up: number; ping: number };
export function useSpeedtests(): Live<SpeedTestRow[]> {
  return useLive("speedtest", () => getJson<SpeedTestRow[]>("/api/speedtest"), mockWan.speedTests);
}

// Throughput history isn't in the UniFi snapshot — accumulate a rolling
// ring buffer client-side from successive /api/overview polls. Falls back to
// the deterministic mock series until the backend reports live data.
const wanThroughputBuffer: { t: string; rx: number; tx: number }[] = [];
const WAN_THROUGHPUT_MAX_POINTS = 120; // ~last 2h at 1min polling
let wanThroughputLastT = 0;

export function useWanThroughput() {
  const { data, isLive } = useOverview();
  if (isLive && data) {
    const now = Date.now();
    // Throttle so we don't push duplicate points within ~10s of each other.
    if (now - wanThroughputLastT > 10_000) {
      wanThroughputLastT = now;
      wanThroughputBuffer.push({
        t: new Date(now).toISOString(),
        rx: data.currentRx ?? 0,
        tx: data.currentTx ?? 0,
      });
      if (wanThroughputBuffer.length > WAN_THROUGHPUT_MAX_POINTS) {
        wanThroughputBuffer.splice(0, wanThroughputBuffer.length - WAN_THROUGHPUT_MAX_POINTS);
      }
    }
    // Need at least 2 points for the area chart to render meaningfully.
    if (wanThroughputBuffer.length >= 2) return wanThroughputBuffer.slice();
  }
  return mockWanThroughput;
}

// Access points (derived from topology mapper)
export function useAccessPoints() {
  const { data, isLive } = useLive("topology", () => getJson<typeof mockTopology>("/api/topology"), mockTopology);
  return { data: isLive ? data.aps : mockAps, isLive };
}

export function useTopology() {
  return useLive("topology", () => getJson<typeof mockTopology>("/api/topology"), mockTopology);
}

export function usePorts(): Live<Port[]> {
  return useLive("ports", () => getJson<Port[]>("/api/ports"), mockPorts);
}

export function useFirmware(): Live<FirmwareRow[]> {
  return useLive("firmware", () => getJson<FirmwareRow[]>("/api/firmware"), mockFirmware);
}

export function useSsids(): Live<Ssid[]> {
  return useLive("ssids", () => getJson<Ssid[]>("/api/ssids"), mockSsids);
}

export function useEvents(): Live<SiteEvent[]> {
  return useLive("events", () => getJson<SiteEvent[]>("/api/events"), mockEvents);
}

type DpiResp = { apps: DpiApp[]; byCategory: { category: string; total: number }[] };
export function useDpi(): Live<DpiResp> {
  return useLive("dpi", () => getJson<DpiResp>("/api/dpi"), {
    apps: mockDpiTopApps,
    byCategory: mockDpiByCategory,
  });
}
