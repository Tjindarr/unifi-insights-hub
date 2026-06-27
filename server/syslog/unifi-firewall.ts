// Extract structured firewall / STA-tracker fields from a parsed UniFi syslog line.

export type FirewallFields = {
  rule: string | null;
  action: string | null;
  event_type: string | null;
  message_type: string | null;
  client_mac: string | null;
  src_ip: string | null;
  src_port: number | null;
  dst_ip: string | null;
  dst_port: number | null;
  proto: string | null;
  vap: string | null;
  rssi: number | null;
  reason: string | null;
  raw_json: string | null;
};

const EMPTY: FirewallFields = {
  rule: null, action: null, event_type: null, message_type: null,
  client_mac: null, src_ip: null, src_port: null, dst_ip: null, dst_port: null,
  proto: null, vap: null, rssi: null, reason: null, raw_json: null,
};

const DEAUTH_REASONS: Record<string, string> = {
  "1": "Unspecified",
  "2": "Previous auth no longer valid",
  "3": "Station leaving",
  "4": "Disassociated due to inactivity",
  "6": "Class 2 frame from non-auth STA",
  "7": "Class 3 frame from non-assoc STA",
  "8": "Station leaving",
  "15": "4-way handshake timeout",
  "23": "802.1X auth failed",
};

export function extractFirewall(message: string, appname: string): FirewallFields {
  const result: FirewallFields = { ...EMPTY };

  // STA-tracker / wifi assoc JSON blob
  const jsonStart = message.indexOf("{");
  if (jsonStart >= 0 && /STA[-_]TRACKER|STA_ASSOC|stahtd/.test(message + appname)) {
    try {
      const raw = JSON.parse(message.slice(jsonStart)) as Record<string, unknown>;
      result.raw_json = JSON.stringify(raw);
      result.rule = "STA-TRACKER";
      result.message_type = (raw.message_type as string) ?? null;
      result.event_type = (raw.event_type as string) ?? null;
      result.action = result.event_type === "failure" ? "failure" : "success";
      result.client_mac = (raw.mac as string) ?? null;
      result.vap = (raw.vap as string) ?? null;
      result.rssi = raw.auth_rssi != null ? Number(raw.auth_rssi) : null;
      const dr = raw.deauth_reason as string | undefined;
      if (dr) result.reason = DEAUTH_REASONS[dr] ?? `reason=${dr}`;
      return result;
    } catch {
      /* fall through */
    }
  }

  // Kernel UFW / iptables style: [UFW BLOCK] or UniFi rule tag [WAN_LOCAL-2000-D]
  const ufw = message.match(/\[(UFW|UBNT|FW)[\s_-]+(BLOCK|ALLOW|DENY|DROP|REJECT|ACCEPT)\]/i);
  const unifiTag = message.match(/\[([A-Z0-9_]+)-(\d+)-([A-Z])\]/);
  if (ufw || unifiTag) {
    if (ufw) {
      result.rule = ufw[1].toUpperCase();
      const act = ufw[2].toUpperCase();
      result.action = act === "ACCEPT" || act === "ALLOW" ? "allow" : "deny";
    } else if (unifiTag) {
      result.rule = `${unifiTag[1]}-${unifiTag[2]}`;
      const code = unifiTag[3];
      result.action = code === "A" ? "allow" : code === "R" ? "reject" : "deny";
    }
    result.src_ip = message.match(/\bSRC=([^\s]+)/)?.[1] ?? null;
    result.dst_ip = message.match(/\bDST=([^\s]+)/)?.[1] ?? null;
    const spt = message.match(/\bSPT=(\d+)/)?.[1];
    const dpt = message.match(/\bDPT=(\d+)/)?.[1];
    result.src_port = spt ? Number(spt) : null;
    result.dst_port = dpt ? Number(dpt) : null;
    result.proto = message.match(/\bPROTO=(\w+)/)?.[1] ?? null;
    result.raw_json = JSON.stringify({
      src: result.src_ip, dst: result.dst_ip, spt: result.src_port, dpt: result.dst_port,
      proto: result.proto, rule: result.rule, action: result.action,
    });
    return result;
  }

  return result;
}

  return result;
}
