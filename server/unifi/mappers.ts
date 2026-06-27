// Map raw UniFi controller payloads to the shapes the frontend pages expect
// (same shapes as the mock data in src/lib/mock-data.ts + mock-extra.ts).
// All mappers are defensive: missing fields → undefined / zero / [] rather than
// throwing, because field names vary slightly across UniFi OS / controller versions.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Raw = Record<string, any>;

const num = (v: any, d = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const str = (v: any, d = ""): string => (v == null ? d : String(v));

// ---- Clients ----

export type MappedClient = {
  id: string;
  hostname: string;
  mac: string;
  ip: string;
  wired: boolean;
  ap: string;
  vlan: string;
  signal: number;
  satisfaction: number;
  rxRate: number; // bytes/sec
  txRate: number;
  rxBytes: number;
  txBytes: number;
  lastSeen: string;
  manufacturer: string;
};

export function mapClient(c: Raw): MappedClient {
  const wired = !!(c.is_wired ?? c.wired);
  const ap = wired
    ? `${str(c.sw_name ?? c.sw_mac, "switch")}:${str(c.sw_port ?? "?")}`
    : str(c.ap_name ?? c.essid ?? c.ap_mac, "wifi");
  const rxBytes = num(c.rx_bytes ?? c["rx-bytes"]);
  const txBytes = num(c.tx_bytes ?? c["tx-bytes"]);
  // UniFi reports rx-rate/tx-rate in Kbps for wireless, raw bps for wired.
  // Normalize to bytes/sec to match mock.
  const rxKbps = num(c.rx_rate ?? c["rx-rate"]);
  const txKbps = num(c.tx_rate ?? c["tx-rate"]);
  return {
    id: str(c._id ?? c.mac, str(c.mac)),
    hostname: str(c.hostname ?? c.name ?? c.display_name ?? c.mac, "unknown"),
    mac: str(c.mac),
    ip: str(c.ip ?? c.last_ip ?? "—"),
    wired,
    ap,
    vlan: str(c.network ?? c.network_name ?? "LAN"),
    signal: wired ? 0 : num(c.signal ?? c.rssi),
    satisfaction: num(c.satisfaction ?? 100, 100),
    rxRate: Math.floor((rxKbps * 1000) / 8),
    txRate: Math.floor((txKbps * 1000) / 8),
    rxBytes,
    txBytes,
    lastSeen: new Date(num(c.last_seen) * 1000 || Date.now()).toISOString(),
    manufacturer: str(c.oui ?? c.fingerprint?.dev_vendor ?? "Unknown"),
  };
}

export function mapClients(raw: any): MappedClient[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map(mapClient);
}

// ---- Overview ----

export function mapOverview(rawClients: any, _rawDevices: any, _rawHealth: any) {
  const clients = mapClients(rawClients);
  const wireless = clients.filter((c) => !c.wired).length;
  const wired = clients.length - wireless;
  const avgSat = clients.length
    ? Math.round(clients.reduce((a, c) => a + c.satisfaction, 0) / clients.length)
    : 100;
  const totalRx = clients.reduce((a, c) => a + c.rxRate, 0);
  const totalTx = clients.reduce((a, c) => a + c.txRate, 0);
  const topTalkers = [...clients]
    .sort((a, b) => b.rxRate + b.txRate - a.rxRate - a.txRate)
    .slice(0, 10);
  return {
    totalClients: clients.length,
    wired,
    wireless,
    avgSatisfaction: avgSat,
    currentRx: totalRx,
    currentTx: totalTx,
    topTalkers,
  };
}

// ---- Ports (per switch/gateway port_table) ----

export type MappedPort = {
  id: number;
  device: string;
  name: string;
  link: "up" | "down" | "disabled";
  speed: number;
  duplex: "full" | "half" | "—";
  poe: number;
  poeMax: number;
  rxErr: number;
  txErr: number;
  neighbor?: string;
  clientCount: number;
};

export function mapPorts(rawDevices: any): MappedPort[] {
  const out: MappedPort[] = [];
  const devs: Raw[] = Array.isArray(rawDevices) ? rawDevices : [];
  for (const d of devs) {
    const devName = str(d.name ?? d.model ?? d.mac);
    const ports: Raw[] = d.port_table ?? [];
    for (const p of ports) {
      const up = !!(p.up ?? p.enable);
      const link: MappedPort["link"] = p.enable === false ? "disabled" : up ? "up" : "down";
      out.push({
        id: num(p.port_idx ?? p.port_number),
        device: devName,
        name: str(p.name ?? `Port ${p.port_idx ?? "?"}`),
        link,
        speed: num(p.speed),
        duplex: p.full_duplex ? "full" : link === "up" ? "half" : "—",
        poe: num(p.poe_power),
        poeMax: num(p.poe_caps ?? p.poe_max ?? 30, 30),
        rxErr: num(p.rx_errors),
        txErr: num(p.tx_errors),
        neighbor: p.lldp_info?.chassis_id ?? p.lldp_info?.system_name ?? undefined,
        clientCount: num(p.num_sta),
      });
    }
  }
  return out;
}

// ---- Firmware ----

export function mapFirmware(rawDevices: any) {
  const devs: Raw[] = Array.isArray(rawDevices) ? rawDevices : [];
  return devs.map((d) => {
    const current = str(d.version ?? d.firmware_version);
    const latest = str(d.upgrade_to_firmware ?? current);
    return {
      device: str(d.name ?? d.mac),
      model: str(d.model ?? d.type ?? "Unknown"),
      current,
      latest,
      upToDate: !d.upgradable && (!latest || latest === current),
      backup: "—",
    };
  });
}

// ---- Topology ----

export function mapTopology(rawDevices: any) {
  const devs: Raw[] = Array.isArray(rawDevices) ? rawDevices : [];
  let gateway = { name: "Gateway", model: "Unknown" };
  const switches: { name: string; model: string; ports: number; clients: number }[] = [];
  const aps: {
    id: string; name: string; model: string; clients: number;
    channelUtil24: number; channelUtil5: number; channelUtil6: number;
    airtime: number; uplink: number; downlink: number;
    status: "online" | "offline" | "degraded";
  }[] = [];
  for (const d of devs) {
    const type = str(d.type);
    const name = str(d.name ?? d.mac);
    const model = str(d.model ?? type);
    if (type === "ugw" || type === "udm" || type === "uxg") {
      gateway = { name, model };
    } else if (type === "usw") {
      switches.push({
        name, model,
        ports: (d.port_table ?? []).length,
        clients: num(d.num_sta),
      });
    } else if (type === "uap") {
      const radios: Raw[] = d.radio_table_stats ?? d.radio_table ?? [];
      const utilFor = (band: string) => {
        const r = radios.find((x) => String(x.radio ?? x.name).includes(band));
        return r ? num(r.cu_total ?? r.channel_util ?? 0) : 0;
      };
      aps.push({
        id: str(d.mac),
        name, model,
        clients: num(d.num_sta),
        channelUtil24: utilFor("ng"),
        channelUtil5: utilFor("na"),
        channelUtil6: utilFor("6e"),
        airtime: num(d.airtime ?? 0),
        uplink: num(d["uplink"]?.tx_rate ?? d.tx_bytes_r),
        downlink: num(d["uplink"]?.rx_rate ?? d.rx_bytes_r),
        status: d.state === 1 ? "online" : d.state === 5 ? "degraded" : "offline",
      });
    }
  }
  return { gateway, switches, aps };
}

// ---- SSIDs ----

export function mapSsids(rawDevices: any) {
  const devs: Raw[] = Array.isArray(rawDevices) ? rawDevices : [];
  const byName = new Map<string, {
    name: string; band: "2.4" | "5" | "6" | "dual";
    clients: number; rx: number; tx: number; retries: number;
  }>();
  for (const d of devs) {
    const vaps: Raw[] = d.vap_table ?? [];
    for (const v of vaps) {
      const name = str(v.essid);
      if (!name) continue;
      const radio = str(v.radio);
      const band: "2.4" | "5" | "6" | "dual" = radio === "ng" ? "2.4" : radio === "na" ? "5" : radio === "6e" ? "6" : "dual";
      const cur = byName.get(name) ?? { name, band, clients: 0, rx: 0, tx: 0, retries: 0 };
      cur.clients += num(v.num_sta);
      cur.rx += num(v.rx_bytes);
      cur.tx += num(v.tx_bytes);
      cur.retries = Math.max(cur.retries, num(v.tx_retries));
      // If we see the same SSID on multiple bands, mark dual
      if (cur.band !== band) cur.band = "dual";
      byName.set(name, cur);
    }
  }
  return Array.from(byName.values());
}

// ---- WAN / site health ----

export function mapWan(rawHealth: any, rawDevices: any) {
  const subsystems: Raw[] = Array.isArray(rawHealth) ? rawHealth : [];
  const wan = subsystems.find((s) => s.subsystem === "wan") ?? {};
  const wlan = subsystems.find((s) => s.subsystem === "wlan") ?? {};
  const www = subsystems.find((s) => s.subsystem === "www") ?? {};
  const gw = (Array.isArray(rawDevices) ? rawDevices : []).find((d: Raw) =>
    ["ugw", "udm", "uxg"].includes(String(d.type)),
  ) ?? {};
  return {
    isp: str(wan.isp_name ?? wan.gw_name ?? "Unknown"),
    ipv4: str(wan.wan_ip ?? gw.wan1?.ip ?? "—"),
    ipv6: str(gw.wan1?.ipv6 ?? gw.wan1?.ip6 ?? "—"),
    ddns: str(gw.ddns ?? "—"),
    uplink: str(wan.uplink ?? `${num(wan.xput_up)} Mbps up`),
    status: (wan.status === "ok" ? "up" : wan.status === "warning" ? "degraded" : "down") as "up" | "down" | "degraded",
    latency: num(wan.latency ?? www.latency),
    loss: num(wan.drops ?? 0),
    uptime: num(gw.uptime),
    cpu: num(gw["system-stats"]?.cpu),
    memory: num(gw["system-stats"]?.mem),
    wlanClients: num(wlan.num_user),
  };
}

// ---- Events ----

export function mapEvents(rawEvents: any) {
  const evs: Raw[] = Array.isArray(rawEvents) ? rawEvents : [];
  return evs.slice(0, 50).map((e, i) => {
    const key = str(e.key ?? "");
    let kind: "admin" | "wan" | "firmware" | "client" | "system" = "system";
    if (/Admin|Login|User/.test(key)) kind = "admin";
    else if (/Wan|Gateway/.test(key)) kind = "wan";
    else if (/Upgrade|Firmware/.test(key)) kind = "firmware";
    else if (/User|Sta|Guest|Client/.test(key)) kind = "client";
    const sev: "info" | "warn" | "error" =
      /Lost|Down|Disconnect|Failed|Error/.test(key) ? "error"
      : /Restart|Provisioned|Roam/.test(key) ? "warn" : "info";
    return {
      id: str(e._id ?? `ev${i}`),
      time: new Date(num(e.time) || Date.now()).toISOString(),
      kind,
      severity: sev,
      title: key || "event",
      detail: str(e.msg ?? ""),
    };
  });
}

// ---- DPI ----

const DPI_CAT: Record<number, string> = {
  0: "Web", 1: "Streaming", 2: "Gaming", 3: "Messaging", 4: "Cloud",
  5: "Audio", 6: "Video Conf", 7: "Dev", 8: "System", 9: "Backup",
};

export function mapDpi(rawDpi: any) {
  const arr: Raw[] = Array.isArray(rawDpi) ? rawDpi : [];
  // Per-site DPI returns { by_app: [{ app, cat, rx_bytes, tx_bytes }] } items
  const apps: Raw[] = arr.flatMap((x) => x.by_app ?? []);
  const top = apps.map((a) => ({
    name: str(a.app_name ?? a.app ?? `app-${a.app}`),
    category: DPI_CAT[num(a.cat)] ?? "Other",
    rx: num(a.rx_bytes),
    tx: num(a.tx_bytes),
  })).filter((a) => a.rx + a.tx > 0)
     .sort((a, b) => b.rx + b.tx - a.rx - a.tx)
     .slice(0, 30);
  const byCat = Object.entries(
    top.reduce<Record<string, number>>((acc, a) => {
      acc[a.category] = (acc[a.category] ?? 0) + a.rx + a.tx;
      return acc;
    }, {}),
  ).map(([category, total]) => ({ category, total }))
   .sort((a, b) => b.total - a.total);
  return { apps: top, byCategory: byCat };
}
