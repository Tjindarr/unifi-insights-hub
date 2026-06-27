// Human-readable translation for UniFi firewall / STA-tracker events.
import type { FirewallEvent } from "./mock-data";

// 802.11 deauthentication/disassociation reason codes (IEEE 802.11-2020 §9.4.1.7)
export const DEAUTH_REASONS: Record<string, string> = {
  "1": "Unspecified",
  "2": "Previous auth no longer valid",
  "3": "Station is leaving",
  "4": "Disassociated due to inactivity",
  "5": "AP is unable to handle more stations",
  "6": "Class-2 frame from non-authenticated station",
  "7": "Class-3 frame from non-associated station",
  "8": "Station is leaving the BSS",
  "9": "Station not authenticated",
  "10": "Power capability element unacceptable",
  "11": "Supported channels element unacceptable",
  "13": "Invalid information element",
  "14": "MIC failure",
  "15": "4-way handshake timeout",
  "16": "Group key handshake timeout",
  "17": "IE in 4-way handshake differs",
  "18": "Invalid group cipher",
  "19": "Invalid pairwise cipher",
  "20": "Invalid AKMP",
  "21": "Unsupported RSN IE version",
  "22": "Invalid RSN IE capabilities",
  "23": "802.1X authentication failed",
  "24": "Cipher suite rejected by policy",
  "34": "Disassociated due to poor channel conditions",
};

// Auth algorithms reported by UniFi
const AUTH_ALGO: Record<string, string> = {
  open: "Open",
  shared: "Shared key",
  ft: "Fast Transition (802.11r)",
  sae: "WPA3-SAE",
  "ft-sae": "WPA3-SAE + Fast Transition",
  owe: "OWE (Enhanced Open)",
  eap: "802.1X / EAP",
};

const EVENT_TYPE_LABEL: Record<string, string> = {
  sta_assoc: "Connected",
  sta_assoc_attempt: "Connection attempt",
  sta_leave: "Disconnected",
  sta_disconnect: "Disconnected",
  failure: "Authentication failed",
  success: "Authentication succeeded",
  roam: "Roamed between APs",
};

function reason(code?: string | number | null): string | null {
  if (code === undefined || code === null || code === "") return null;
  const k = String(code);
  return DEAUTH_REASONS[k] ?? `reason ${k}`;
}

function ssidFromVap(vap?: string | null): string | null {
  if (!vap) return null;
  // wifi0ap0 → radio 0 (2.4 GHz) / wifi1apX → 5 GHz / wifi2apX → 6 GHz
  const m = vap.match(/^wifi(\d+)ap(\d+)$/);
  if (!m) return vap;
  const band = m[1] === "0" ? "2.4 GHz" : m[1] === "1" ? "5 GHz" : m[1] === "2" ? "6 GHz" : `radio ${m[1]}`;
  return `${band} · SSID #${m[2]}`;
}

/**
 * Produce a single-line, human-readable summary of a firewall/STA event.
 * Falls back gracefully when fields are missing.
 */
export function describeFirewallEvent(e: FirewallEvent): string {
  const raw = (e.raw ?? {}) as Record<string, unknown>;

  // ---- STA association / wifi events ----
  if (e.messageType?.startsWith("STA_") || /assoc|leave|deauth|auth/i.test(e.eventType ?? "")) {
    const action =
      EVENT_TYPE_LABEL[e.eventType ?? ""] ??
      (e.action === "failure" ? "Wi-Fi authentication failed" : "Wi-Fi event");

    const parts: string[] = [action];

    const deauth = reason(raw.deauth_reason as string);
    const disassoc = reason(raw.disassoc_reason as string);
    const dc = (raw.sta_dc_reason as string) || null;

    if (deauth) parts.push(`deauth: ${deauth}`);
    else if (disassoc) parts.push(`disassoc: ${disassoc}`);
    else if (dc) parts.push(dc);

    if (raw.auth_failures && Number(raw.auth_failures) > 0) {
      parts.push(`${raw.auth_failures} failed attempt${raw.auth_failures === "1" ? "" : "s"}`);
    }

    const algo = raw.auth_algo ? AUTH_ALGO[String(raw.auth_algo).toLowerCase()] ?? String(raw.auth_algo) : null;
    if (algo) parts.push(`auth: ${algo}`);

    const rssi = e.rssi ?? (raw.auth_rssi != null ? Number(raw.auth_rssi) : null) ?? (raw.avg_rssi != null ? Number(raw.avg_rssi) : null);
    if (rssi != null && !Number.isNaN(rssi)) {
      const quality = rssi >= -55 ? "excellent" : rssi >= -67 ? "good" : rssi >= -75 ? "fair" : "poor";
      parts.push(`signal ${rssi} dBm (${quality})`);
    }

    const where = ssidFromVap(e.vap ?? (raw.vap as string));
    if (where) parts.push(`on ${where}`);

    return parts.join(" · ");
  }

  // ---- Firewall rule (iptables / UniFi rule tag) ----
  if (e.srcIp || e.dstIp) {
    const verb = e.action === "allow" ? "Allowed" : e.action === "reject" ? "Rejected" : "Blocked";
    const src = e.srcIp ? `${e.srcIp}${e.srcPort ? `:${e.srcPort}` : ""}` : "?";
    const dst = e.dstIp ? `${e.dstIp}${e.dstPort ? `:${e.dstPort}` : ""}` : "?";
    const proto = e.proto ? ` ${e.proto.toUpperCase()}` : "";
    return `${verb}${proto} ${src} → ${dst} (rule ${e.rule})`;
  }

  return e.reason ?? e.messageType ?? e.rule ?? "Event";
}

/** Short label for the action chip (e.g. "Connected", "Auth fail"). */
export function shortEventLabel(e: FirewallEvent): string {
  return EVENT_TYPE_LABEL[e.eventType ?? ""] ?? e.action;
}
