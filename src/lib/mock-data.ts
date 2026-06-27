// Mock UniFi data for the Lovable preview. The real container replaces these
// with REST calls to /api/* served by /server/.

export type Severity = "info" | "notice" | "warn" | "error" | "critical";

export type Client = {
  id: string;
  hostname: string;
  mac: string;
  ip: string;
  wired: boolean;
  ap: string; // AP name or switch port
  vlan: string;
  signal: number; // dBm, 0 for wired
  satisfaction: number; // 0-100
  rxRate: number; // bytes/sec
  txRate: number; // bytes/sec
  rxBytes: number; // total
  txBytes: number; // total
  lastSeen: string; // ISO
  manufacturer: string;
  // Extended UniFi attributes (optional — populated when available)
  alias?: string;
  note?: string;
  firstSeen?: string;
  uptime?: number;
  ip6?: string;
  essid?: string;
  networkId?: string;
  channel?: number;
  radio?: string;
  radioProto?: string;
  band?: "2.4" | "5" | "6" | "—";
  noise?: number;
  snr?: number;
  ccq?: number;
  txPower?: number;
  txRetries?: number;
  anomalies?: number;
  linkTxRate?: number;
  linkRxRate?: number;
  switchMac?: string;
  switchPort?: number;
  uplinkMac?: string;
  assocTime?: number;
  idleTime?: number;
  authorized?: boolean;
  isGuest?: boolean;
  blocked?: boolean;
  fixedIp?: string;
  usergroupId?: string;
  deviceFamily?: string;
  osName?: string;
  powersaveEnabled?: boolean;
  qosPolicyApplied?: boolean;
};

export type SyslogEntry = {
  id: string;
  time: string; // ISO
  host: string;
  appname: string;
  facility: string;
  severity: Severity;
  message: string;
  raw: string;
  isFirewall: boolean;
};

export type FirewallEvent = {
  id: string;
  time: string;
  rule: string;
  action: "allow" | "deny" | "drop" | "failure" | "success";
  eventType: string;
  messageType: string;
  clientMac?: string;
  clientName?: string;
  srcIp?: string;
  srcPort?: number;
  dstIp?: string;
  dstPort?: number;
  proto?: string;
  vap?: string;
  rssi?: number;
  reason?: string;
  severity: Severity;
  raw: Record<string, unknown>;
};

export type ThroughputPoint = {
  t: string; // ISO
  rx: number; // bytes/sec
  tx: number; // bytes/sec
};

export type AccessPoint = {
  id: string;
  name: string;
  model: string;
  clients: number;
  channelUtil24: number;
  channelUtil5: number;
  channelUtil6: number;
  airtime: number;
  uplink: number;
  downlink: number;
  status: "online" | "offline" | "degraded";
};

export type SiteHealth = {
  wanStatus: "up" | "down" | "degraded";
  wanLatency: number; // ms
  wanLoss: number; // %
  isp: string;
  uptime: number; // seconds
  cpu: number; // %
  memory: number; // %
};

// ----------------------------------------------------------------------------
// Deterministic pseudo-random so the preview is stable across renders.
// ----------------------------------------------------------------------------

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
const rand = mulberry32(20260627);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

const hostnames = [
  "macbook-niels", "iphone-niels", "ipad-living", "appletv-livingroom",
  "thermostat-hall", "doorbell-front", "printer-office", "nas-unraid",
  "synology-backup", "switch-office", "ps5-livingroom", "switch-loft",
  "iphone-anna", "ipad-anna", "macbook-anna", "echo-kitchen",
  "echo-bedroom", "hue-bridge", "robovac-aria", "tv-bedroom",
  "tv-living", "shelly-garage", "shelly-hall", "homepod-kitchen",
  "rpi-pihole", "tesla-wall", "gaming-rig", "laptop-guest",
  "iphone-guest", "switch-rack",
];
const manus = ["Apple", "Ubiquiti", "Sonos", "Amazon", "Google", "Synology", "Shelly", "Sony", "Samsung", "TP-Link", "Raspberry Pi", "Tesla"];
const aps = ["U7-Pro-XG-Loft", "U7-Pro-XG-Living", "U7-Pro-Office", "U6-Mesh-Garage"];
const switches = ["sw-rack:1", "sw-rack:4", "sw-rack:7", "sw-office:2", "sw-loft:3"];
const vlans = ["LAN", "IoT", "Guest", "Cameras", "Servers"];

function randMac(i: number): string {
  const r = mulberry32(i + 7);
  const parts = Array.from({ length: 6 }, () =>
    Math.floor(r() * 256).toString(16).padStart(2, "0"),
  );
  return parts.join(":");
}

export const clients: Client[] = hostnames.map((h, i) => {
  const wired = rand() < 0.3;
  const isHeavy = rand() < 0.15;
  const rxRate = wired
    ? Math.floor(rand() * 4_000_000) + (isHeavy ? 30_000_000 : 0)
    : Math.floor(rand() * 1_500_000) + (isHeavy ? 8_000_000 : 0);
  const txRate = Math.floor(rxRate * (0.05 + rand() * 0.4));
  return {
    id: `c${i}`,
    hostname: h,
    mac: randMac(i),
    ip: `192.168.${pick(["1", "10", "20", "30"])}.${10 + i}`,
    wired,
    ap: wired ? pick(switches) : pick(aps),
    vlan: pick(vlans),
    signal: wired ? 0 : -(35 + Math.floor(rand() * 45)),
    satisfaction: wired ? 99 : Math.max(20, 100 - Math.floor(rand() * 70)),
    rxRate,
    txRate,
    rxBytes: Math.floor(rand() * 80_000_000_000),
    txBytes: Math.floor(rand() * 20_000_000_000),
    lastSeen: new Date(Date.now() - Math.floor(rand() * 600_000)).toISOString(),
    manufacturer: pick(manus),
  };
});

// ----------------------------------------------------------------------------
// Throughput history (60 min, 1 min resolution)
// ----------------------------------------------------------------------------

export const wanThroughput: ThroughputPoint[] = Array.from({ length: 60 }, (_, i) => {
  const t = new Date(Date.now() - (59 - i) * 60_000).toISOString();
  const base = 8_000_000 + Math.sin(i / 6) * 4_000_000;
  return {
    t,
    rx: Math.max(0, base + rand() * 6_000_000),
    tx: Math.max(0, base / 4 + rand() * 1_500_000),
  };
});

// ----------------------------------------------------------------------------
// Syslog + firewall events
// ----------------------------------------------------------------------------

const SEVS: Severity[] = ["info", "info", "info", "notice", "notice", "warn", "warn", "error", "critical"];

const sampleMessages = [
  "DHCPACK on 192.168.10.45 to 9c:8e:cd:11:22:33 via br10",
  "hostapd: wifi0ap8: STA 54:32:04:52:12:a4 IEEE 802.11: associated",
  "kernel: [UFW BLOCK] IN=eth4 OUT= MAC=... SRC=185.220.101.45 DST=192.168.1.1 LEN=60 PROTO=TCP SPT=44231 DPT=22",
  "dpinger: WAN 1.1.1.1: Alarm latency 24ms loss 0%",
  "stahtd: client roamed from U7-Pro-XG-Loft to U7-Pro-XG-Living",
  "miniupnpd: redirect port 49152 protocol UDP to 192.168.10.45:49152",
  "wpa_supplicant: CTRL-EVENT-DISCONNECTED bssid=9c:05:d6:11:22:33 reason=4",
];

function makeFirewallRaw(mac: string, evType: "failure" | "success"): Record<string, unknown> {
  return {
    op: "event",
    message_type: "STA_ASSOC_TRACKER",
    event_type: evType,
    mac,
    vap: pick(["wifi0ap8", "wifi1ap3", "wifi2ap0"]),
    assoc_status: evType === "failure" ? "0" : "16",
    wpa_auth_failures: evType === "failure" ? "1" : "0",
    deauth_reason: pick(["15", "4", "8", "23"]),
    auth_rssi: String(-(35 + Math.floor(rand() * 45))),
    auth_algo: "open",
  };
}

export const syslog: SyslogEntry[] = Array.from({ length: 220 }, (_, i) => {
  const t = new Date(Date.now() - i * (4_000 + Math.floor(rand() * 30_000))).toISOString();
  const isFw = rand() < 0.35;
  const sev: Severity = isFw ? pick(["notice", "warn", "warn", "error"]) : pick(SEVS);
  const host = pick(["U7ProXG-Loft", "U7ProXG-Living", "UDR7", "sw-rack", "U6-Mesh-Garage"]);
  const appname = isFw
    ? `${randMac(i).replace(/:/g, "")},U7-Pro-XG-8.6.11+18870`
    : pick(["dnsmasq", "kernel", "dpinger", "hostapd", "miniupnpd", "stahtd"]);
  const mac = clients[i % clients.length].mac;
  const message = isFw
    ? `stahtd[6631]: [STA-TRACKER].stahtd_dump_event(): ${JSON.stringify(makeFirewallRaw(mac, rand() < 0.7 ? "failure" : "success"))}`
    : pick(sampleMessages);
  return {
    id: `s${i}`,
    time: t,
    host,
    appname,
    facility: isFw ? "user" : pick(["user", "daemon", "kern", "auth"]),
    severity: sev,
    message,
    raw: `<14>${new Date(t).toUTCString()} ${host} ${appname}: ${message}`,
    isFirewall: isFw,
  };
});

export const firewallEvents: FirewallEvent[] = syslog
  .filter((s) => s.isFirewall)
  .map((s, i) => {
    const jsonStart = s.message.indexOf("{");
    const raw = jsonStart >= 0 ? (JSON.parse(s.message.slice(jsonStart)) as Record<string, unknown>) : {};
    const mac = (raw.mac as string) || "";
    const client = clients.find((c) => c.mac === mac);
    const evType = (raw.event_type as string) || "info";
    const sev: Severity = evType === "failure" ? "warn" : "info";
    const reasonMap: Record<string, string> = {
      "15": "4-way handshake timeout",
      "4": "Disassociated due to inactivity",
      "8": "Station leaving",
      "23": "802.1X auth failed",
    };
    return {
      id: `fw${i}`,
      time: s.time,
      rule: "STA-TRACKER",
      action: evType === "failure" ? "failure" : "success",
      eventType: evType,
      messageType: (raw.message_type as string) || "STA_ASSOC_TRACKER",
      clientMac: mac,
      clientName: client?.hostname,
      vap: raw.vap as string,
      rssi: raw.auth_rssi ? Number(raw.auth_rssi) : undefined,
      reason: reasonMap[raw.deauth_reason as string] ?? (raw.deauth_reason as string),
      severity: sev,
      raw,
    };
  });

// ----------------------------------------------------------------------------
// Access points + site health
// ----------------------------------------------------------------------------

export const accessPoints: AccessPoint[] = aps.map((name, i) => ({
  id: `ap${i}`,
  name,
  model: name.includes("U7-Pro-XG") ? "U7 Pro XG" : name.includes("U7") ? "U7 Pro" : "U6 Mesh",
  clients: 4 + Math.floor(rand() * 14),
  channelUtil24: Math.floor(rand() * 60),
  channelUtil5: Math.floor(rand() * 50),
  channelUtil6: Math.floor(rand() * 25),
  airtime: Math.floor(rand() * 70),
  uplink: Math.floor(rand() * 80_000_000),
  downlink: Math.floor(rand() * 200_000_000),
  status: rand() < 0.92 ? "online" : "degraded",
}));

export const siteHealth: SiteHealth = {
  wanStatus: "up",
  wanLatency: 11,
  wanLoss: 0,
  isp: "Bahnhof Fiber 1 Gbps",
  uptime: 14 * 24 * 3600 + 7 * 3600,
  cpu: 18,
  memory: 42,
};

// ----------------------------------------------------------------------------
// Derived summaries
// ----------------------------------------------------------------------------

export function overview() {
  const wireless = clients.filter((c) => !c.wired).length;
  const wired = clients.length - wireless;
  const avgSat = Math.round(clients.reduce((a, c) => a + c.satisfaction, 0) / clients.length);
  const totalRx = clients.reduce((a, c) => a + c.rxRate, 0);
  const totalTx = clients.reduce((a, c) => a + c.txRate, 0);
  return {
    totalClients: clients.length,
    wired,
    wireless,
    avgSatisfaction: avgSat,
    currentRx: totalRx,
    currentTx: totalTx,
    topTalkers: [...clients].sort((a, b) => b.rxRate + b.txRate - a.rxRate - a.txRate).slice(0, 10),
  };
}
