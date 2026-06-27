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

function arrayFrom(raw: any, keys: string[] = ["data", "events", "items", "results"]): Raw[] {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  for (const key of keys) {
    if (Array.isArray(raw[key])) return raw[key];
  }
  return [];
}

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
  rxRate: number;
  txRate: number;
  rxBytes: number;
  txBytes: number;
  lastSeen: string;
  manufacturer: string;
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

export function mapClient(c: Raw): MappedClient {
  const wired = !!(c.is_wired ?? c.wired);
  const ap = wired
    ? `${str(c.sw_name ?? c.sw_mac, "switch")}:${str(c.sw_port ?? "?")}`
    : str(c.ap_name ?? c.essid ?? c.ap_mac, "wifi");
  const rxBytes = num(c.rx_bytes ?? c["rx-bytes"]);
  const txBytes = num(c.tx_bytes ?? c["tx-bytes"]);
  // PHY link rate (kbps) — capacity, not actual throughput
  const linkRxKbps = num(c.rx_rate ?? c["rx-rate"]);
  const linkTxKbps = num(c.tx_rate ?? c["tx-rate"]);
  // Actual current throughput (bytes/sec) from UniFi's recent-rate counters
  const rxBps = num(c["rx-bytes-r"] ?? c.rx_bytes_r ?? c.rx_rate_bps);
  const txBps = num(c["tx-bytes-r"] ?? c.tx_bytes_r ?? c.tx_rate_bps);
  const radioRaw = str(c.radio);
  const band: MappedClient["band"] =
    radioRaw === "ng" ? "2.4" : radioRaw === "na" ? "5" : radioRaw === "6e" ? "6" : "—";
  const alias = str(c.name ?? c.note_alias ?? "") || undefined;
  const hostname =
    alias ||
    str(c.hostname ?? c.display_name ?? c.dhcpend_hostname ?? c.mac, "unknown");
  const signal = wired ? 0 : num(c.signal ?? c.rssi);
  const noise = c.noise != null ? num(c.noise) : undefined;
  return {
    id: str(c._id ?? c.mac, str(c.mac)),
    hostname,
    mac: str(c.mac),
    ip: str(c.ip ?? c.last_ip ?? "—"),
    wired,
    ap,
    vlan: str(c.network ?? c.network_name ?? "LAN"),
    signal,
    satisfaction: num(c.satisfaction ?? 100, 100),
    rxRate: Math.floor(rxBps),
    txRate: Math.floor(txBps),
    rxBytes,
    txBytes,
    lastSeen: new Date(num(c.last_seen) * 1000 || Date.now()).toISOString(),
    manufacturer: str(c.oui ?? c.fingerprint?.dev_vendor ?? "Unknown"),
    alias,
    note: str(c.note ?? "") || undefined,
    firstSeen: c.first_seen ? new Date(num(c.first_seen) * 1000).toISOString() : undefined,
    uptime: c.uptime != null ? num(c.uptime) : undefined,
    ip6: str(c.ipv6 ?? "") || undefined,
    essid: str(c.essid ?? "") || undefined,
    networkId: str(c.network_id ?? "") || undefined,
    channel: c.channel != null ? num(c.channel) : undefined,
    radio: radioRaw || undefined,
    radioProto: str(c.radio_proto ?? "") || undefined,
    band,
    noise,
    snr: !wired && signal && noise ? Math.abs(noise) - Math.abs(signal) : undefined,
    ccq: c.ccq != null ? num(c.ccq) : undefined,
    txPower: c.tx_power != null ? num(c.tx_power) : undefined,
    txRetries: c.tx_retries != null ? num(c.tx_retries) : undefined,
    anomalies: c.anomalies != null ? num(c.anomalies) : undefined,
    linkTxRate: linkTxKbps ? linkTxKbps * 1000 : undefined,
    linkRxRate: linkRxKbps ? linkRxKbps * 1000 : undefined,
    switchMac: str(c.sw_mac ?? "") || undefined,
    switchPort: c.sw_port != null ? num(c.sw_port) : undefined,
    uplinkMac: str(c.uplink_mac ?? "") || undefined,
    assocTime: c.assoc_time != null ? num(c.assoc_time) : undefined,
    idleTime: c.idletime != null ? num(c.idletime) : undefined,
    authorized: c.authorized != null ? !!c.authorized : undefined,
    isGuest: c.is_guest != null ? !!c.is_guest : undefined,
    blocked: c.blocked != null ? !!c.blocked : undefined,
    fixedIp: str(c.fixed_ip ?? "") || undefined,
    usergroupId: str(c.usergroup_id ?? "") || undefined,
    deviceFamily: str(c.fingerprint?.dev_family ?? c.dev_family ?? "") || undefined,
    osName: str(c.fingerprint?.os_name ?? c.os_name ?? "") || undefined,
    powersaveEnabled: c.powersave_enabled != null ? !!c.powersave_enabled : undefined,
    qosPolicyApplied: c.qos_policy_applied != null ? !!c.qos_policy_applied : undefined,
  };
}

export function mapClients(raw: any): MappedClient[] {
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map(mapClient);
}

// ---- Overview ----

export function mapOverview(rawClients: any, rawDevices: any, _rawHealth: any) {
  const clients = mapClients(rawClients);
  const wireless = clients.filter((c) => !c.wired).length;
  const wired = clients.length - wireless;
  const avgSat = clients.length
    ? Math.round(clients.reduce((a, c) => a + c.satisfaction, 0) / clients.length)
    : 100;
  // Prefer WAN throughput from the gateway device (true uplink) and fall back
  // to summing per-client recent-rate counters if the gateway doesn't publish
  // them. UniFi reports bytes/sec on `wan1`/`wan2`/`uplink`; some firmwares
  // use `rx_bytes-r`, others use the bracket key `rx-bytes-r`.
  const devs: Raw[] = Array.isArray(rawDevices) ? rawDevices : [];
  const gw = devs.find((d) => ["ugw", "udm", "uxg"].includes(String(d.type)));
  const wanBps = (key: "rx" | "tx") => {
    if (!gw) return 0;
    const k1 = `${key}-bytes-r`;
    const k2 = `${key}_bytes-r`;
    const fromObj = (o: any) => num(o?.[k1] ?? o?.[k2]);
    return (
      fromObj(gw.wan1) +
      fromObj(gw.wan2) ||
      fromObj(gw.uplink) ||
      fromObj(gw)
    );
  };
  const gwRx = wanBps("rx");
  const gwTx = wanBps("tx");
  const totalRx = gwRx || clients.reduce((a, c) => a + c.rxRate, 0);
  const totalTx = gwTx || clients.reduce((a, c) => a + c.txRate, 0);
  const topTalkers = [...clients]
    .sort((a, b) => b.rxRate + b.txRate - a.rxRate - a.txRate)
    .slice(0, 10);
  return {
    totalClients: clients.length,
    wired,
    wireless,
    avgSatisfaction: avgSat,
    // Convert bytes/sec → bits/sec for the WAN tiles (formatBits expects bps).
    currentRx: Math.floor(totalRx * 8),
    currentTx: Math.floor(totalTx * 8),
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
  const evs: Raw[] = arrayFrom(rawEvents);
  return evs.slice(0, 200).map((e, i) => {
    // system-log entries put the human text in different places per category
    const slMsg = str(
      e.message ?? e.readable_message ?? e.eventStringFormatted ?? e.text
        ?? (Array.isArray(e.messageEnums) ? e.messageEnums.join(" ") : ""),
    );
    const key = str(e.key ?? e.event ?? e.type ?? e.subsystem ?? e.category ?? e.__category ?? "");
    const msg = slMsg || str(e.msg ?? e.description ?? e.name ?? "");
    const cat = str(e.__category ?? "");
    let kind: "admin" | "wan" | "firmware" | "client" | "system" = "system";
    const haystack = `${cat} ${key} ${msg}`;
    if (/admin|login|user|account/i.test(haystack)) kind = "admin";
    else if (/wan|gateway|internet|isp/i.test(haystack)) kind = "wan";
    else if (/upgrade|firmware|update/i.test(haystack)) kind = "firmware";
    else if (/sta|guest|client|device|ap[-_ ]/i.test(haystack)) kind = "client";
    const sev: "info" | "warn" | "error" =
      /lost|down|disconnect|failed|error|denied|threat|attack|block/i.test(haystack) ? "error"
      : /restart|provisioned|roam|warn|degrad/i.test(haystack) ? "warn" : "info";
    const time = num(e.timestamp ?? e.time ?? e.datetime ?? e.created_at ?? e.createdAt);
    return {
      id: str(e._id ?? e.id ?? `ev${i}`),
      time: new Date(time ? (time < 10_000_000_000 ? time * 1000 : time) : Date.now()).toISOString(),
      kind,
      severity: sev,
      title: key || cat || msg || "event",
      detail: msg || key || cat,
    };
  });
}


// ---- DPI ----

const DPI_CAT: Record<number, string> = {
  0: "Web", 1: "Streaming", 2: "Gaming", 3: "Messaging", 4: "Cloud",
  5: "Audio", 6: "Video Conf", 7: "Dev", 8: "System", 9: "Backup",
};

export function mapDpi(rawDpi: any) {
  const arr: Raw[] = arrayFrom(rawDpi, ["data", "items", "results", "applications"]);
  const root = rawDpi && typeof rawDpi === "object" && !Array.isArray(rawDpi) ? rawDpi : null;
  if (root && arr.length === 0 && (Array.isArray(root.by_app) || Array.isArray(root.by_cat))) arr.push(root);
  // Items can be { by_app: [...] } (sitedpi), direct app rows, or per-station
  // { mac, by_app: [...] } (stadpi). Aggregate across all by_app/app entries.
  // Aggregate across all by_app entries by app id.
  const agg = new Map<string, { name: string; category: string; rx: number; tx: number }>();
  const catAgg = new Map<string, number>();
  for (const item of arr) {
    const cats: Raw[] = Array.isArray(item?.by_cat) ? item.by_cat : [];
    for (const c of cats) {
      const category = str(c.cat_name ?? c.category ?? DPI_CAT[num(c.cat)] ?? `Cat ${c.cat ?? "?"}`);
      const total = num(c.rx_bytes ?? c.rxBytes ?? c.bytes_rx ?? c.rx) + num(c.tx_bytes ?? c.txBytes ?? c.bytes_tx ?? c.tx);
      catAgg.set(category, (catAgg.get(category) ?? 0) + total);
    }
    const list: Raw[] = Array.isArray(item?.by_app)
      ? item.by_app
      : Array.isArray(item?.apps)
        ? item.apps
        : (item?.app != null || item?.app_id != null || item?.app_name != null || item?.rx_bytes != null || item?.tx_bytes != null)
          ? [item]
          : [];
    for (const a of list) {
      const id = String(a.app ?? a.app_id ?? a.app_name ?? "unknown");
      const key = `${a.cat ?? "?"}/${id}`;
      const prev = agg.get(key) ?? {
        name: str(a.app_name ?? a.name ?? a.application ?? `App ${id}`),
        category: str(a.cat_name ?? a.category ?? DPI_CAT[num(a.cat)] ?? `Cat ${a.cat ?? "?"}`),
        rx: 0,
        tx: 0,
      };
      const rx = num(a.rx_bytes ?? a.rxBytes ?? a.rx_bytes_r ?? a.bytes_rx ?? a.rx);
      const tx = num(a.tx_bytes ?? a.txBytes ?? a.tx_bytes_r ?? a.bytes_tx ?? a.tx);
      prev.rx += rx;
      prev.tx += tx;
      agg.set(key, prev);
      catAgg.set(prev.category, (catAgg.get(prev.category) ?? 0) + rx + tx);
    }
  }
  const top = [...agg.values()]
    .filter((a) => a.rx + a.tx > 0)
    .sort((a, b) => b.rx + b.tx - a.rx - a.tx)
    .slice(0, 30);
  const byCat = [...catAgg.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
  return { apps: top, byCategory: byCat };
}
