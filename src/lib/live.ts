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
  refetchMs = 10_000,
): Live<T> {
  const { data, isLoading } = useQuery({
    queryKey: [key],
    queryFn: fetcher,
    refetchInterval: refetchMs,
    staleTime: refetchMs / 2,
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
// Overview / clients
// ---------------------------------------------------------------------------

type Overview = ReturnType<typeof mockOverview>;

export function useOverview(): Live<Overview> {
  return useLive("overview", () => getJson<Overview>("/api/overview"), mockOverview());
}

export function useClients(): Live<Client[]> {
  return useLive("clients", () => getJson<Client[]>("/api/clients"), mockClients);
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
    const severity: Severity = r.action === "failure" ? "warn" : r.action === "drop" || r.action === "deny" ? "error" : "info";
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

export function useFirewall(): Live<FirewallEvent[]> {
  const { data: clients } = useClients();
  const { data, isLive, loading } = useLive<FwRow[] | FirewallEvent[]>(
    "firewall",
    () => getJson<FwRow[]>("/api/firewall?limit=500"),
    // Use marker so we know to skip normalize
    mockFw as unknown as FwRow[],
  );
  const macToName = useMemo(() => {
    const m = new Map<string, string>();
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
  }, [clients]);
  const normalized = isLive ? normFw(data as FwRow[], macToName) : (data as FirewallEvent[]);
  return { data: normalized, isLive, loading };
}

// Bucket sizing for time-range driven charts.
import type { TimeRangeKey } from "./ui-store";
import type { FirewallEvent } from "./mock-data";

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
  const now = Date.now();
  const start = now - windowMs;
  const emptyRow = () => Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>;
  const buckets = new Map<number, Record<T, number>>();
  // Seed empty buckets so the chart spans the full window even when sparse.
  const first = Math.floor(start / bucketMs) * bucketMs;
  for (let t = first; t <= now; t += bucketMs) buckets.set(t, emptyRow());
  for (const e of events) {
    const ms = new Date(e.time).getTime();
    if (ms < start || ms > now) continue;
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
export function useFirewallByMinute(range: TimeRangeKey = "1h") {
  const { data, isLive } = useFirewall();
  if (!isLive) return { data: mockFwByMin, isLive: false, label: "per minute" };
  const mapped = data.map((e) => ({ time: e.time, key: e.action === "failure" ? "failure" as const : "success" as const }));
  const rows = bucketEvents(mapped, range, ["success", "failure"] as const);
  return { data: rows, isLive: true, label: bucketSpecForRange(range).label };
}

// Internal events bucketed for the active time range, by category.
export function useInternalByBucket(
  events: FirewallEvent[],
  categorise: (e: FirewallEvent) => string,
  categories: readonly string[],
  range: TimeRangeKey = "1h",
) {
  const mapped = events.map((e) => ({ time: e.time, key: categorise(e) }));
  return {
    data: bucketEvents(mapped, range, categories),
    label: bucketSpecForRange(range).label,
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

export function useSyslog(params: { q?: string; host?: string; severity?: string } = {}): Live<SyslogEntry[]> {
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.host) qs.set("host", params.host);
  if (params.severity) qs.set("severity", params.severity);
  qs.set("limit", "1000");
  const key = `syslog?${qs.toString()}`;
  const { data, isLive, loading } = useLive<SysRow[] | SyslogEntry[]>(
    key,
    () => getJson<SysRow[]>(`/api/logs?${qs.toString()}`),
    mockSyslog as unknown as SysRow[],
  );
  const normalized = isLive ? normSyslog(data as SysRow[]) : (data as SyslogEntry[]);
  return { data: normalized, isLive, loading };
}

export function useSyslogByMinute(rows: SyslogEntry[], isLive: boolean) {
  if (!isLive) return mockSyslogByMin;
  const buckets: Record<string, { t: string; info: number; warn: number; error: number }> = {};
  for (const s of rows) {
    const d = new Date(s.time); d.setSeconds(0, 0);
    const t = d.toISOString();
    buckets[t] ??= { t, info: 0, warn: 0, error: 0 };
    if (s.severity === "warn" || s.severity === "notice") buckets[t].warn++;
    else if (s.severity === "error" || s.severity === "critical") buckets[t].error++;
    else buckets[t].info++;
  }
  return Object.values(buckets).sort((a, b) => a.t.localeCompare(b.t));
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

// Throughput history isn't in the UniFi snapshot — keep mock for now.
export function useWanThroughput() {
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
