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
    // Keep bytes/sec — formatBits() on the frontend multiplies by 8.
    currentRx: Math.floor(totalRx),
    currentTx: Math.floor(totalTx),
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

export function mapPorts(rawDevices: any, rawClients?: any): MappedPort[] {
  const out: MappedPort[] = [];
  const devs: Raw[] = Array.isArray(rawDevices) ? rawDevices : [];
  const clients: Raw[] = Array.isArray(rawClients) ? rawClients : Array.isArray(rawClients?.data) ? rawClients.data : [];
  // Build (deviceMac, portIdx) -> client count from clients snapshot
  const clientCounts = new Map<string, number>();
  for (const c of clients) {
    const dev = String(c.sw_mac ?? c.uplink_mac ?? c.ap_mac ?? "").toLowerCase();
    const portIdx = Number(c.sw_port ?? c.switch_port ?? 0);
    if (!dev || !portIdx) continue;
    const key = `${dev}:${portIdx}`;
    clientCounts.set(key, (clientCounts.get(key) ?? 0) + 1);
  }
  // Build (uplinkDeviceMac, uplinkPortIdx) -> uplinked devices (APs/switches).
  // APs aren't in the clients snapshot but should count toward the port's
  // "Clients" column and provide a neighbor-name fallback.
  const devUplinks = new Map<string, { count: number; names: string[] }>();
  for (const d of devs) {
    const u = d.uplink ?? {};
    const upMac = String(
      u.uplink_remote_mac ?? u.uplink_mac ?? u.gateway_mac ?? d.uplink_mac ?? "",
    ).toLowerCase();
    const upPort = Number(
      u.uplink_remote_port ?? u.remote_port ?? u.uplink_port_idx ?? u.port_idx ?? 0,
    );
    if (!upMac || !upPort) continue;
    const key = `${upMac}:${upPort}`;
    const entry = devUplinks.get(key) ?? { count: 0, names: [] };
    entry.count += 1;
    entry.names.push(str(d.name ?? d.model ?? d.mac));
    devUplinks.set(key, entry);
  }
  for (const d of devs) {
    const devName = str(d.name ?? d.model ?? d.mac);
    const devMac = String(d.mac ?? "").toLowerCase();
    const ports: Raw[] = d.port_table ?? [];
    // Device-level LLDP table keyed by port_idx
    const lldpTable: Raw[] = Array.isArray(d.lldp_table) ? d.lldp_table : [];
    // Device-level mac_table with port_idx
    const devMacTable: Raw[] = Array.isArray(d.mac_table) ? d.mac_table : [];
    for (const p of ports) {
      const idx = num(p.port_idx ?? p.port_number);
      const up = !!(p.up ?? p.enable);
      const link: MappedPort["link"] = p.enable === false ? "disabled" : up ? "up" : "down";

      // PoE: poe_power is string watts; if missing, derive from voltage*current.
      let poeW = Number(p.poe_power ?? p.poe_wattage ?? p.stats?.poe_power ?? 0) || 0;
      if (!poeW) {
        const v = Number(p.poe_voltage ?? 0);
        const i = Number(p.poe_current ?? 0); // mA
        if (v && i) poeW = (v * i) / 1000;
      }
      const poeMax =
        Number(p.poe_max ?? p.poe_max_power ?? p.poe_caps_w ?? 0) ||
        (poeW > 60 ? 90 : poeW > 30 ? 60 : poeW > 0 ? 30 : 0);

      // Errors: try multiple shapes.
      const rxErr =
        Number(p.rx_errors ?? p.stats?.rx_errors ?? p.rx_err ?? p.stats?.rx_err ?? p.rx_dropped ?? 0) || 0;
      const txErr =
        Number(p.tx_errors ?? p.stats?.tx_errors ?? p.tx_err ?? p.stats?.tx_err ?? p.tx_dropped ?? 0) || 0;

      // LLDP neighbour — port-level first, then device-level lldp_table by port_idx.
      const lldpPort: any = Array.isArray(p.lldp_info) ? p.lldp_info[0] : p.lldp_info;
      const lldpDev: any = lldpTable.find((x) => Number(x.local_port_idx ?? x.port_idx) === idx);
      const neighbor =
        lldpPort?.system_name ||
        lldpPort?.chassis_id ||
        lldpDev?.chassis_name ||
        lldpDev?.system_name ||
        lldpDev?.chassis_id ||
        p.lldp_system_name ||
        p.lldp_chassis_id ||
        undefined;

      // Client count: port mac_table, then device mac_table by port_idx, then clients snapshot.
      const portMacTable: any[] = Array.isArray(p.mac_table) ? p.mac_table : [];
      const fromDevMac = devMacTable.filter((m) => Number(m.port_idx ?? m.sw_port) === idx).length;
      const fromClients = clientCounts.get(`${devMac}:${idx}`) ?? 0;
      const clientCount =
        portMacTable.length ||
        fromDevMac ||
        fromClients ||
        Number(p.num_sta ?? 0) ||
        0;

      out.push({
        id: idx,
        device: devName,
        name: str(p.name ?? `Port ${p.port_idx ?? "?"}`),
        link,
        speed: num(p.speed),
        duplex: p.full_duplex ? "full" : link === "up" ? "half" : "—",
        poe: poeW,
        poeMax,
        rxErr,
        txErr,
        neighbor,
        clientCount,
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
  let gateway = { name: "Gateway", model: "Unknown", mac: "" };
  const switches: { name: string; model: string; mac: string; ports: number; clients: number }[] = [];
  const aps: {
    id: string; name: string; model: string; clients: number;
    channelUtil24: number; channelUtil5: number; channelUtil6: number;
    airtime: number; uplink: number; downlink: number;
    status: "online" | "offline" | "degraded";
    uplinkMac?: string;
  }[] = [];
  const isGatewayType = (t: string) =>
    t === "ugw" || t.startsWith("udm") || t.startsWith("uxg") || t.startsWith("udr");
  for (const d of devs) {
    const type = str(d.type).toLowerCase();
    const modelUp = str(d.model).toUpperCase();
    if (isGatewayType(type) || d.is_gateway || modelUp.startsWith("UDR") || modelUp.startsWith("UDM") || modelUp.startsWith("UXG")) {
      gateway = { name: str(d.name ?? d.model ?? d.mac), model: str(d.model ?? type), mac: str(d.mac) };
      break;
    }
  }
  for (const d of devs) {
    const type = str(d.type).toLowerCase();
    const mac = str(d.mac);
    if (mac && mac === gateway.mac) continue;
    const name = str(d.name ?? d.model ?? d.mac);
    const model = str(d.model ?? type);
    const radios: Raw[] = d.radio_table_stats ?? d.radio_table ?? [];
    const hasRadios = radios.length > 0;
    const uplinkMac = str(d.uplink?.uplink_mac ?? d.uplink?.gateway_mac ?? "");
    if (type === "usw") {
      switches.push({ name, model, mac, ports: (d.port_table ?? []).length, clients: num(d.num_sta) });
    } else if (type === "uap" || hasRadios) {
      const utilFor = (band: string) => {
        const r = radios.find((x) => String(x.radio ?? x.name).includes(band));
        return r ? num(r.cu_total ?? r.channel_util ?? 0) : 0;
      };
      aps.push({
        id: mac || name, name, model,
        clients: num(d.num_sta),
        channelUtil24: utilFor("ng"),
        channelUtil5: utilFor("na"),
        channelUtil6: utilFor("6e"),
        airtime: num(d.airtime ?? 0),
        uplink: num(d.uplink?.tx_rate ?? d.tx_bytes_r),
        downlink: num(d.uplink?.rx_rate ?? d.rx_bytes_r),
        status: d.state === 1 ? "online" : d.state === 5 ? "degraded" : "offline",
        uplinkMac,
      });
    } else if ((d.port_table ?? []).length > 0) {
      switches.push({ name, model, mac, ports: d.port_table.length, clients: num(d.num_sta) });
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
    _txPackets: number; _txRetries: number;
  }>();
  for (const d of devs) {
    const vaps: Raw[] = d.vap_table ?? [];
    for (const v of vaps) {
      const name = str(v.essid);
      if (!name) continue;
      const radio = str(v.radio);
      const band: "2.4" | "5" | "6" | "dual" = radio === "ng" ? "2.4" : radio === "na" ? "5" : radio === "6e" ? "6" : "dual";
      const cur = byName.get(name) ?? { name, band, clients: 0, rx: 0, tx: 0, retries: 0, _txPackets: 0, _txRetries: 0 };
      cur.clients += num(v.num_sta);
      cur.rx += num(v.rx_bytes);
      cur.tx += num(v.tx_bytes);
      cur._txPackets += num(v.tx_packets);
      cur._txRetries += num(v.tx_retries);
      // If we see the same SSID on multiple bands, mark dual
      if (cur.band !== band) cur.band = "dual";
      byName.set(name, cur);
    }
  }
  // Compute retry percentage = tx_retries / (tx_packets + tx_retries) * 100
  for (const s of byName.values()) {
    const denom = s._txPackets + s._txRetries;
    s.retries = denom > 0 ? Math.round((s._txRetries / denom) * 1000) / 10 : 0;
  }
  return Array.from(byName.values()).map(({ _txPackets, _txRetries, ...rest }) => rest);
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

// ---- Speedtest history ----
// UniFi reports xput_download / xput_upload in Mbps and latency in ms.
// We convert Mbps → bytes/sec so the UI's formatBits() helper renders
// the row as a real throughput (e.g. "812.4 Mbps") instead of a byte total.
export function mapSpeedtests(raw: any): Array<{ t: string; down: number; up: number; ping: number }> {
  const arr: Raw[] = Array.isArray(raw) ? raw : [];
  const mbpsToBps = (mbps: number) => (mbps * 1_000_000) / 8;
  return arr
    .map((r) => {
      const tMs = num(r.time);
      const t = tMs > 1e12 ? tMs : tMs * 1000; // some endpoints return seconds
      const downMbps = num(r.xput_download ?? r.xput_down ?? r.download);
      const upMbps = num(r.xput_upload ?? r.xput_up ?? r.upload);
      const ping = num(r.latency ?? r.ping ?? 0);
      return {
        t: new Date(t || Date.now()).toISOString(),
        down: mbpsToBps(downMbps),
        up: mbpsToBps(upMbps),
        ping,
      };
    })
    .filter((x) => x.down > 0 || x.up > 0)
    .sort((a, b) => b.t.localeCompare(a.t))
    .slice(0, 30);
}



// ---- Events ----

// Collect all primitive (string/number) fields from a system-log event into a
// flat case-insensitive lookup we can use to fill `{PLACEHOLDER}` tokens.
function flattenParams(obj: any, into: Record<string, string> = {}, depth = 0): Record<string, string> {
  if (!obj || typeof obj !== "object" || depth > 4) return into;
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      const key = String(k).toLowerCase();
      if (!(key in into)) into[key] = String(v);
    } else if (typeof v === "object") {
      // Common nested containers
      flattenParams(v, into, depth + 1);
      // If the nested object has a "name"/"value"/"displayName" use that as the key's value too
      const named = (v as any).name ?? (v as any).displayName ?? (v as any).value;
      if (named != null && (typeof named === "string" || typeof named === "number")) {
        const key = String(k).toLowerCase();
        if (!(key in into)) into[key] = String(named);
      }
    }
  }
  return into;
}

function substituteTemplate(tpl: string, params: Record<string, string>): string {
  if (!tpl || tpl.indexOf("{") < 0) return tpl;
  return tpl.replace(/\{([A-Za-z0-9_]+)\}/g, (_m, name: string) => {
    const v = params[name.toLowerCase()];
    return v != null ? v : `{${name}}`;
  });
}

export function mapEvents(rawEvents: any) {
  const evs: Raw[] = arrayFrom(rawEvents);
  return evs.slice(0, 200).map((e, i) => {
    const params = flattenParams(e);
    // UniFi-specific derivations not covered by the generic flattener
    if (Array.isArray(e.updates) && !params.count) params.count = String(e.updates.length);
    if (e.meta && typeof e.meta === "object") {
      const m: any = e.meta;
      if (!params.object) params.object = String(m.display_property_value ?? m.collection ?? m.id ?? "");
      if (!params.section) params.section = String(m.section ?? "");
    }
    if (!params.setting_name && e.change_key) params.setting_name = String(e.change_key);
    const slMsg = str(
      e.message ?? e.readable_message ?? e.eventStringFormatted ?? e.text
        ?? (Array.isArray(e.messageEnums) ? e.messageEnums.join(" ") : ""),
    );
    const key = str(e.key ?? e.event ?? e.type ?? e.subsystem ?? e.category ?? e.__category ?? "");
    const rawMsg = slMsg || str(e.msg ?? e.description ?? e.name ?? "");
    const msg = substituteTemplate(rawMsg, params);

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
  0: "Instant messaging", 1: "P2P", 3: "File transfer", 4: "Streaming media",
  5: "Mail & collaboration", 6: "Voice over IP", 7: "Database", 8: "Games",
  9: "Network management", 10: "Remote access", 11: "Proxies & tunnels",
  12: "Stock market", 13: "Web", 14: "Security update", 15: "Web IM",
  17: "Business", 18: "Network protocols", 19: "Network protocols",
  20: "Network protocols", 23: "Private protocol", 24: "Social network",
  255: "Unknown",
};

type DpiCatalog = {
  apps?: Record<string, { name: string; category?: string | number }>;
  categories?: Record<string, string>;
};

export function mapDpi(rawDpi: any, catalog?: DpiCatalog | null) {
  const root = rawDpi && typeof rawDpi === "object" && !Array.isArray(rawDpi) ? rawDpi : null;
  const dataRoot = root?.data && typeof root.data === "object" ? root.data : null;

  // Prefer the pre-aggregated total_usage_by_app on v2 traffic responses.
  const totals: Raw[] = Array.isArray(root?.total_usage_by_app)
    ? root.total_usage_by_app
    : Array.isArray(dataRoot?.total_usage_by_app)
      ? dataRoot.total_usage_by_app
      : [];

  const arr: Raw[] = totals.length > 0 ? [] : arrayFrom(rawDpi, ["data", "items", "results", "applications", "client_usage_by_app"]);
  if (totals.length === 0) {
    if (root && arr.length === 0 && dataRoot) {
      if (Array.isArray(dataRoot.client_usage_by_app)) arr.push(...dataRoot.client_usage_by_app);
      else if (Array.isArray(dataRoot.by_app) || Array.isArray(dataRoot.by_cat) || Array.isArray(dataRoot.usage_by_app)) arr.push(dataRoot);
    }
    if (root && arr.length === 0 && (Array.isArray(root.by_app) || Array.isArray(root.by_cat) || Array.isArray(root.usage_by_app))) arr.push(root);
  }

  const appCat = catalog?.apps ?? {};
  const catMap = catalog?.categories ?? {};
  const resolveAppName = (id: any, fallback?: string) => {
    if (fallback) return fallback;
    const k = String(id);
    if (appCat[k]?.name) return appCat[k].name;
    return `App ${id}`;
  };
  const resolveCatName = (id: any, fallback?: string) => {
    if (fallback) return fallback;
    const k = String(id);
    if (catMap[k]) return catMap[k];
    if (DPI_CAT[num(id)]) return DPI_CAT[num(id)];
    return id == null || id === "?" ? "Unknown" : `Cat ${id}`;
  };

  const agg = new Map<string, { name: string; category: string; rx: number; tx: number }>();
  const catAgg = new Map<string, number>();

  const addApp = (a: Raw, ownerCat?: any) => {
    const appId = a.app ?? a.app_id ?? a.application ?? a.app_name ?? "unknown";
    const catId = a.cat ?? a.category ?? ownerCat ?? appCat[String(appId)]?.category ?? "?";
    const id = String(appId);
    const key = `${catId}/${id}`;
    const name = resolveAppName(appId, a.app_name ?? a.name ?? a.application_name);
    const category = resolveCatName(catId, a.cat_name ?? a.category_name);
    const prev = agg.get(key) ?? { name, category, rx: 0, tx: 0 };
    let rx = num(a.rx_bytes ?? a.rxBytes ?? a.bytes_rx ?? a.bytes_received ?? a.rx);
    let tx = num(a.tx_bytes ?? a.txBytes ?? a.bytes_tx ?? a.bytes_transmitted ?? a.tx);
    const total = num(a.total_bytes ?? a.totalBytes ?? a.bytes);
    if (!rx && !tx && total) { rx = total; tx = 0; }
    prev.rx += rx; prev.tx += tx;
    agg.set(key, prev);
    catAgg.set(category, (catAgg.get(category) ?? 0) + rx + tx);
  };

  if (totals.length > 0) {
    for (const a of totals) addApp(a);
  } else {
    for (const item of arr) {
      const cats: Raw[] = Array.isArray(item?.by_cat) ? item.by_cat : [];
      for (const c of cats) {
        const category = resolveCatName(c.cat, c.cat_name ?? c.category);
        const total = num(c.rx_bytes ?? c.rxBytes ?? c.bytes_rx ?? c.rx) + num(c.tx_bytes ?? c.txBytes ?? c.bytes_tx ?? c.tx);
        catAgg.set(category, (catAgg.get(category) ?? 0) + total);
      }
      const list: Raw[] = Array.isArray(item?.by_app) ? item.by_app
        : Array.isArray(item?.usage_by_app) ? item.usage_by_app
        : Array.isArray(item?.apps) ? item.apps
        : (item?.app != null || item?.app_id != null || item?.application != null || item?.app_name != null || item?.rx_bytes != null || item?.tx_bytes != null || item?.total_bytes != null)
          ? [item]
          : [];
      for (const a of list) addApp(a);
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
