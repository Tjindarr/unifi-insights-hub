// Extended mock data: per-client history, DPI, ports, events, firmware,
// SSIDs, WAN history, GeoIP, collector health, syslog rollups.
// All deterministic so the preview is stable.

import { clients, accessPoints, syslog, firewallEvents } from "./mock-data";

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = mulberry32(424242);

// ---- Per-client 60-min history ----

export type ClientSample = { t: string; rx: number; tx: number; signal: number };
export const clientHistory: Record<string, ClientSample[]> = Object.fromEntries(
  clients.map((c) => {
    const cr = mulberry32(parseInt(c.id.slice(1)) + 1000);
    return [
      c.id,
      Array.from({ length: 60 }, (_, i) => ({
        t: new Date(Date.now() - (59 - i) * 60_000).toISOString(),
        rx: Math.max(0, c.rxRate * (0.4 + cr() * 1.2)),
        tx: Math.max(0, c.txRate * (0.4 + cr() * 1.2)),
        signal: c.wired ? 0 : Math.min(-30, c.signal + Math.floor(cr() * 12 - 6)),
      })),
    ];
  }),
);

// ---- DPI top apps ----

export type DpiApp = { name: string; category: string; rx: number; tx: number };
const APPS = [
  ["Netflix", "Streaming"], ["YouTube", "Streaming"], ["Disney+", "Streaming"],
  ["Spotify", "Audio"], ["iCloud Backup", "Cloud"], ["Steam", "Gaming"],
  ["PlayStation Net", "Gaming"], ["Xbox Live", "Gaming"], ["WhatsApp", "Messaging"],
  ["Zoom", "Video Conf"], ["Microsoft Teams", "Video Conf"], ["Google Drive", "Cloud"],
  ["GitHub", "Dev"], ["Docker Hub", "Dev"], ["HTTP/HTTPS Web", "Web"],
  ["Apple Update", "System"], ["Time Machine", "Backup"], ["Plex", "Streaming"],
];
export const dpiTopApps: DpiApp[] = APPS.map(([name, category]) => ({
  name, category,
  rx: Math.floor(r() * 50_000_000_000) + 200_000_000,
  tx: Math.floor(r() * 8_000_000_000) + 50_000_000,
})).sort((a, b) => b.rx + b.tx - a.rx - a.tx);

export const dpiByCategory = Object.entries(
  dpiTopApps.reduce<Record<string, number>>((acc, a) => {
    acc[a.category] = (acc[a.category] ?? 0) + a.rx + a.tx;
    return acc;
  }, {}),
).map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);

// ---- Per-client DPI (top 3 apps per heavy client) ----
export const clientDpi: Record<string, DpiApp[]> = Object.fromEntries(
  clients.slice(0, 12).map((c, i) => {
    const cr = mulberry32(i + 50);
    return [
      c.id,
      Array.from({ length: 3 }, () => {
        const a = APPS[Math.floor(cr() * APPS.length)];
        return {
          name: a[0], category: a[1],
          rx: Math.floor(cr() * 20_000_000_000),
          tx: Math.floor(cr() * 2_000_000_000),
        };
      }).sort((x, y) => y.rx - x.rx),
    ];
  }),
);

// ---- Ports ----

export type Port = {
  id: number;
  device: string;
  name: string;
  link: "up" | "down" | "disabled";
  speed: 0 | 100 | 1000 | 2500 | 10000;
  duplex: "full" | "half" | "—";
  poe: number;        // watts
  poeMax: number;
  rxErr: number;
  txErr: number;
  neighbor?: string;
  clientCount: number;
};
const portDevices = ["UDR-7", "sw-rack-24", "sw-office-8"];
export const ports: Port[] = portDevices.flatMap((dev, di) =>
  Array.from({ length: dev === "sw-rack-24" ? 24 : dev === "sw-office-8" ? 8 : 8 }, (_, pi) => {
    const link: Port["link"] = r() < 0.7 ? "up" : r() < 0.6 ? "down" : "disabled";
    const speed: Port["speed"] = link === "up" ? ([1000, 2500, 10000, 1000, 1000][Math.floor(r() * 5)] as Port["speed"]) : 0;
    const poe = link === "up" && r() < 0.4 ? Math.floor(r() * 25) : 0;
    return {
      id: di * 100 + pi + 1,
      device: dev,
      name: `Port ${pi + 1}`,
      link, speed,
      duplex: link === "up" ? "full" : "—",
      poe, poeMax: 30,
      rxErr: r() < 0.05 ? Math.floor(r() * 120) : 0,
      txErr: r() < 0.03 ? Math.floor(r() * 30) : 0,
      neighbor: link === "up" && r() < 0.5 ? `U7-AP-${pi}` : undefined,
      clientCount: link === "up" ? Math.floor(r() * 6) : 0,
    };
  }),
);

// ---- Alerts / events feed ----

export type SiteEvent = {
  id: string;
  time: string;
  kind: "admin" | "wan" | "firmware" | "client" | "system";
  severity: "info" | "warn" | "error";
  title: string;
  detail: string;
};
export const siteEvents: SiteEvent[] = [
  { kind: "admin",    severity: "info",  title: "Admin login",            detail: "user: niels from 192.168.1.45" },
  { kind: "wan",      severity: "warn",  title: "WAN flap",               detail: "Bahnhof Fiber: 14s downtime" },
  { kind: "firmware", severity: "info",  title: "Firmware available",     detail: "U7-Pro-XG 8.7.0 ready" },
  { kind: "client",   severity: "warn",  title: "Repeated auth failures", detail: "54:32:04:52:12:a4 (iphone-guest) x12" },
  { kind: "system",   severity: "error", title: "Storage low",            detail: "UDR root: 88% used" },
  { kind: "wan",      severity: "info",  title: "Speed test complete",    detail: "↓ 938 Mbps / ↑ 472 Mbps" },
  { kind: "client",   severity: "info",  title: "New client",             detail: "tesla-wall joined LAN" },
  { kind: "admin",    severity: "info",  title: "Config backup",          detail: "auto-saved 18 KB" },
].map((e, i) => ({
  ...e,
  id: `ev${i}`,
  time: new Date(Date.now() - (i + 1) * 17 * 60_000).toISOString(),
}));

// ---- WAN / ISP detail ----

export const wan = {
  isp: "Bahnhof Fiber 1 Gbps",
  ipv4: "85.24.146.211",
  ipv6: "2a02:90:0:c::1f3",
  ddns: "noc.example.com",
  uplink: "1 Gbps",
  latencyHistory: Array.from({ length: 60 }, (_, i) => ({
    t: new Date(Date.now() - (59 - i) * 60_000).toISOString(),
    latency: 9 + Math.sin(i / 4) * 3 + r() * 4,
    jitter: 0.4 + r() * 2,
    loss: r() < 0.07 ? r() * 1.5 : 0,
  })),
  speedTests: Array.from({ length: 7 }, (_, i) => ({
    t: new Date(Date.now() - i * 86400_000).toISOString(),
    down: 850_000_000 + r() * 100_000_000,
    up: 420_000_000 + r() * 80_000_000,
    ping: 9 + r() * 4,
  })),
};

// ---- SSIDs / radios ----

export type Ssid = {
  name: string;
  band: "2.4" | "5" | "6" | "dual";
  clients: number;
  rx: number;
  tx: number;
  retries: number; // %
};
export const ssids: Ssid[] = [
  { name: "Hemma",        band: "dual", clients: 18, rx: 18_000_000, tx: 4_200_000, retries: 3 },
  { name: "Hemma-IoT",    band: "2.4",  clients: 11, rx: 220_000,    tx: 90_000,    retries: 7 },
  { name: "Guest",        band: "5",    clients: 3,  rx: 1_400_000,  tx: 220_000,   retries: 4 },
  { name: "Hemma-6E",     band: "6",    clients: 5,  rx: 32_000_000, tx: 6_800_000, retries: 1 },
];

// ---- Firmware ----

export type FirmwareRow = {
  device: string;
  model: string;
  current: string;
  latest: string;
  upToDate: boolean;
  backup: string; // relative
};
export const firmware: FirmwareRow[] = [
  { device: "UDR-7",            model: "Dream Router 7", current: "4.2.18", latest: "4.2.18", upToDate: true,  backup: "2h ago" },
  { device: "U7-Pro-XG-Loft",   model: "U7 Pro XG",      current: "8.6.11", latest: "8.7.0",  upToDate: false, backup: "2h ago" },
  { device: "U7-Pro-XG-Living", model: "U7 Pro XG",      current: "8.7.0",  latest: "8.7.0",  upToDate: true,  backup: "2h ago" },
  { device: "U7-Pro-Office",    model: "U7 Pro",         current: "7.0.92", latest: "7.0.92", upToDate: true,  backup: "2h ago" },
  { device: "U6-Mesh-Garage",   model: "U6 Mesh",        current: "6.7.5",  latest: "6.7.5",  upToDate: true,  backup: "2h ago" },
  { device: "sw-rack-24",       model: "USW-24-PoE",     current: "7.3.40", latest: "7.3.42", upToDate: false, backup: "2h ago" },
];

// ---- GeoIP (lightweight, mock) ----

const GEO: { net: string; cc: string; city: string; flag: string }[] = [
  { net: "185.220.",  cc: "DE", city: "Frankfurt",   flag: "🇩🇪" },
  { net: "45.83.",    cc: "RU", city: "Moscow",      flag: "🇷🇺" },
  { net: "104.244.",  cc: "US", city: "Seattle",     flag: "🇺🇸" },
  { net: "23.92.",    cc: "US", city: "Ashburn",     flag: "🇺🇸" },
  { net: "8.8.",      cc: "US", city: "Mountain View", flag: "🇺🇸" },
  { net: "1.1.",      cc: "AU", city: "Sydney",      flag: "🇦🇺" },
  { net: "212.83.",   cc: "FR", city: "Paris",       flag: "🇫🇷" },
];
export function geoLookup(ip?: string) {
  if (!ip) return null;
  const hit = GEO.find((g) => ip.startsWith(g.net));
  if (hit) return hit;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(ip)) return null;
  // fallback
  return { cc: "??", city: "Unknown", flag: "🌐" };
}

// ---- Collector health ----

export const collector = {
  msgsPerSec: 42,
  syslogQueueDepth: 0,
  unifiPollMs: 184,
  unifiPollAgeSec: 7,
  dbSizeBytes: 312 * 1024 * 1024,
  retentionDays: 30,
  oldestEntryDays: 27,
  fts5Indexed: 14_822_117,
};

// ---- Syslog per-minute rollup for histogram ----

export const syslogByMinute = (() => {
  const buckets: Record<string, { t: string; info: number; warn: number; error: number }> = {};
  syslog.forEach((s) => {
    const d = new Date(s.time);
    d.setSeconds(0, 0);
    const t = d.toISOString();
    buckets[t] ??= { t, info: 0, warn: 0, error: 0 };
    if (s.severity === "warn" || s.severity === "notice") buckets[t].warn++;
    else if (s.severity === "error" || s.severity === "critical") buckets[t].error++;
    else buckets[t].info++;
  });
  return Object.values(buckets).sort((a, b) => a.t.localeCompare(b.t));
})();

export const firewallByMinute = (() => {
  const buckets: Record<string, { t: string; failure: number; success: number }> = {};
  firewallEvents.forEach((e) => {
    const d = new Date(e.time);
    d.setSeconds(0, 0);
    const t = d.toISOString();
    buckets[t] ??= { t, failure: 0, success: 0 };
    if (e.action === "failure") buckets[t].failure++;
    else buckets[t].success++;
  });
  return Object.values(buckets).sort((a, b) => a.t.localeCompare(b.t));
})();

// ---- Decoded 802.11 deauth reasons ----

export const deauthReasonMap: Record<string, string> = {
  "1":  "Unspecified",
  "2":  "Previous auth no longer valid",
  "3":  "Deauth leaving",
  "4":  "Disassoc due to inactivity",
  "5":  "AP busy",
  "6":  "Class-2 frame from nonauth STA",
  "7":  "Class-3 frame from nonassoc STA",
  "8":  "Station leaving",
  "9":  "Not authenticated",
  "15": "4-way handshake timeout",
  "16": "Group key handshake timeout",
  "23": "802.1X auth failed",
};

// ---- Topology ----

export const topology = {
  gateway: { name: "UDR-7", model: "Dream Router 7" },
  switches: [
    { name: "sw-rack-24", model: "USW-24-PoE", ports: 24, clients: 18 },
    { name: "sw-office-8", model: "USW-Flex-Mini", ports: 8, clients: 4 },
  ],
  aps: accessPoints,
};
