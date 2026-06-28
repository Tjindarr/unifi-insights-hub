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
  "macbook-owner", "iphone-owner", "ipad-tablet", "appletv-livingroom",
  "thermostat-hall", "doorbell-front", "printer-office", "nas-unraid",
  "synology-backup", "switch-office", "ps5-livingroom", "switch-loft",
  "iphone-member", "ipad-member", "macbook-member", "echo-kitchen",
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
// Syslog + firewall events — anonymized samples modeled on real UDR7 output:
//   <13> ... [LAN_WAN-A-2147483647] DESCR="[LAN_WAN]Allow All Traffic" IN=br0
//        OUT=eth3 MAC=... SRC=172.16.10.X DST=<public> PROTO=TCP/UDP SPT=... DPT=...
//   <13> ... [WAN_LOCAL-D-2147483647] DESCR="[WAN_LOCAL]Block All Traffic" ...
//   <14> ... stahtd[NNN]: [STA-TRACKER].stahtd_dump_event(): {...}
// ----------------------------------------------------------------------------

// Anonymized public destinations (a mix of well-known clean ASNs).
const PUB_DESTS = [
  "162.159.140.164", "172.64.151.205", "1.1.1.1",
  "8.8.8.8", "8.8.4.4", "142.251.142.225", "172.217.20.161",
  "17.253.39.134", "17.248.214.70", "23.215.2.148",
  "151.101.131.6", "104.18.32.47",
  "20.190.177.83", "52.123.128.14", "40.126.53.18",
  "31.13.72.8", "157.240.20.35",
  "52.51.22.235", "34.111.220.252", "3.5.78.20",
];
// "Scanner" sources hitting WAN_LOCAL — anonymized DE/RU/NL/BG ranges.
const SCAN_SRCS = [
  "79.124.56.210", "79.124.49.114", "45.143.200.14",
  "194.165.16.78", "185.220.101.45", "212.83.42.117",
  "104.244.74.211", "23.92.16.5", "92.118.39.6",
];
const RULES_ALLOW = ["LAN_WAN-A-2147483647", "LAN_LOCAL-A-2147483647", "LANv6_WAN-A-2147483647"];
const RULES_BLOCK = ["WAN_LOCAL-D-2147483647", "LAN_WAN-D-2000000000", "WAN_IN-D-2147483647"];

const NOW = Date.now();
const WINDOW_MS = 60 * 60_000;

function randPort(seed: number): number {
  const r = mulberry32(seed);
  return 1024 + Math.floor(r() * 60000);
}

type RuleSample = {
  event: FirewallEvent;
  host: string;
  rawLine: string;
};

function makeRuleSample(i: number): RuleSample {
  const t = NOW - Math.floor(rand() * WINDOW_MS);
  const blocked = rand() < 0.3;
  const client = clients[i % clients.length];
  const proto = rand() < 0.7 ? "TCP" : "UDP";
  const dpt = proto === "UDP" && rand() < 0.4 ? 53 : (rand() < 0.85 ? 443 : pick([80, 853, 5228, 3478, 51820]));
  const spt = randPort(i * 7 + 3);
  const rule = blocked ? pick(RULES_BLOCK) : pick(RULES_ALLOW);
  const action: FirewallEvent["action"] = blocked ? "drop" : "allow";
  const src = blocked ? pick(SCAN_SRCS) : client.ip;
  const dst = blocked ? "203.0.113.1" : pick(PUB_DESTS);
  const sev: Severity = blocked ? "warn" : "notice";
  const descr = blocked ? "[WAN_LOCAL]Block All Traffic" : "[LAN_WAN]Allow All Traffic";
  const inIf = blocked ? "eth3" : "br0";
  const outIf = blocked ? "" : "eth3";
  const ts = new Date(t).toISOString();
  const host = "Demo-UDR7";
  const rawLine =
    `<13>${new Date(t).toUTCString().replace("GMT", "")} ${host} ${host} ` +
    `[${rule}] DESCR="${descr}" IN=${inIf} OUT=${outIf} MAC=${client.mac} ` +
    `SRC=${src} DST=${dst} LEN=60 TOS=00 PREC=0x00 TTL=63 PROTO=${proto} SPT=${spt} DPT=${dpt}`;
  return {
    host,
    rawLine,
    event: {
      id: `fw${i}`,
      time: ts,
      rule,
      action,
      eventType: blocked ? "block" : "allow",
      messageType: "FIREWALL",
      clientMac: blocked ? undefined : client.mac,
      clientName: blocked ? undefined : client.hostname,
      srcIp: src, srcPort: spt,
      dstIp: dst, dstPort: dpt,
      proto,
      severity: sev,
      raw: { rule, descr, in: inIf, out: outIf, src, dst, proto, spt, dpt },
    },
  };
}

function makeStaSample(i: number): RuleSample {
  const t = NOW - Math.floor(rand() * WINDOW_MS);
  const client = clients[i % clients.length];
  const evType = pick(["association", "sta_roam", "soft failure", "failure", "sta_leave", "success"]);
  const action: FirewallEvent["action"] = evType === "failure" ? "failure" : "success";
  const vap = pick(["wifi0ap0", "wifi1ap2", "wifi2ap0"]);
  const rssi = -(35 + Math.floor(rand() * 50));
  const deauth = pick(["3", "4", "8", "15", "23"]);
  const reasonMap: Record<string, string> = {
    "3": "Station is leaving",
    "4": "Disassociated due to inactivity",
    "8": "Station leaving",
    "15": "4-way handshake timeout",
    "23": "802.1X auth failed",
  };
  const raw: Record<string, unknown> = {
    op: "event",
    message_type: "STA_ASSOC_TRACKER",
    event_type: evType,
    mac: client.mac,
    vap,
    auth_rssi: String(rssi),
    auth_algo: pick(["sae", "open", "ft-sae"]),
    deauth_reason: deauth,
    auth_failures: action === "failure" ? "1" : "0",
  };
  const ts = new Date(t).toISOString();
  const host = pick(["U7ProXG", "U7-Pro-XG-Living", "U6-Mesh-Garage"]);
  const rawLine = `<14>${new Date(t).toUTCString().replace("GMT", "")} ${host} stahtd[6630]: [STA-TRACKER].stahtd_dump_event(): ${JSON.stringify(raw)}`;
  return {
    host,
    rawLine,
    event: {
      id: `fw_sta${i}`,
      time: ts,
      rule: "STA-TRACKER",
      action,
      eventType: evType,
      messageType: "STA_ASSOC_TRACKER",
      clientMac: client.mac,
      clientName: client.hostname,
      vap,
      rssi,
      reason: reasonMap[deauth],
      severity: action === "failure" ? "warn" : "info",
      raw,
    },
  };
}

const _samples: RuleSample[] = [
  ...Array.from({ length: 600 }, (_, i) => makeRuleSample(i)),
  ...Array.from({ length: 160 }, (_, i) => makeStaSample(i)),
].sort((a, b) => b.event.time.localeCompare(a.event.time));

export const firewallEvents: FirewallEvent[] = _samples.map((s) => s.event);

// Syslog view — show ~260 recent lines: most firewall-derived, plus system noise.
const _systemLines = [
  { app: "systemd",  msg: "Finished Check and correct WiFi IRQ affinity." },
  { app: "systemd",  msg: "smp-affinity-monitor.service: Succeeded." },
  { app: "dnsmasq",  msg: "DHCPACK(br10) 172.16.10.45 b8:01:1f:5e:36:45 ipad-living" },
  { app: "kernel",   msg: "wlan: peer 22:c0:6c:f3:01:b0 roamed wifi0ap0 -> wifi1ap2" },
  { app: "dpinger",  msg: "WAN 1.1.1.1: latency 11ms loss 0%" },
];

export const syslog: SyslogEntry[] = [
  ..._samples.slice(0, 220).map((s) => ({
    id: `s_${s.event.id}`,
    time: s.event.time,
    host: s.host,
    appname: s.event.rule === "STA-TRACKER" ? "stahtd" : "",
    facility: "user",
    severity: s.event.severity,
    message: s.rawLine.slice(s.rawLine.indexOf("[")),
    raw: s.rawLine,
    isFirewall: true,
  })),
  ...Array.from({ length: 40 }, (_, i) => {
    const tpl = _systemLines[i % _systemLines.length];
    const t = new Date(NOW - Math.floor(rand() * WINDOW_MS)).toISOString();
    return {
      id: `ssys${i}`,
      time: t,
      host: "Demo-UDR7",
      appname: tpl.app,
      facility: "daemon",
      severity: "info" as Severity,
      message: `${tpl.app}[1]: ${tpl.msg}`,
      raw: `<30>${new Date(t).toUTCString().replace("GMT", "")} Demo-UDR7 ${tpl.app}[1]: ${tpl.msg}`,
      isFirewall: false,
    };
  }),
].sort((a, b) => b.time.localeCompare(a.time));

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
  isp: "Demo ISP 1 Gbps",
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
