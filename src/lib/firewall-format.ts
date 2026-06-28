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

// Canonical labels. Lookups normalize (lowercase, spaces/hyphens → underscore).
const EVENT_TYPE_LABEL: Record<string, string> = {
  // --- STA-TRACKER ---
  association: "Connected",
  sta_assoc: "Connected",
  sta_associated: "Connected",
  sta_assoc_attempt: "Connection attempt",
  sta_assoc_failure: "Connection failed",
  sta_auth: "Authenticated",
  sta_auth_success: "Authentication succeeded",
  sta_auth_failure: "Authentication failed",
  sta_leave: "Disconnected",
  sta_disconnect: "Disconnected",
  sta_deauth: "Deauthenticated",
  sta_disassoc: "Disassociated",
  sta_roam: "Roaming",
  sta_roamed: "Roaming",
  sta_roam_attempt: "Roam attempt",
  sta_ip: "IP acquired",
  ip_acquired: "IP acquired",
  dhcp_ack: "DHCP lease granted",
  // Generic STA-tracker outcomes
  success: "Authentication succeeded",
  failure: "Authentication failed",
  soft_failure: "Soft failure",
  hard_failure: "Hard failure",
  auth_success: "Authentication succeeded",
  auth_failure: "Authentication failed",
  // --- UniFi CEF (event names normalized to lower_snake_case) ---
  wifi_client_connected: "Wi-Fi client connected",
  wifi_client_disconnected: "Wi-Fi client disconnected",
  wifi_client_roamed: "Wi-Fi client roamed",
  wifi_authentication_failure: "Wi-Fi authentication failed",
  wifi_client_blocked: "Wi-Fi client blocked",
  wireless_guest_connected: "Guest connected",
  wireless_guest_disconnected: "Guest disconnected",
  wired_client_connected: "Wired client connected",
  wired_client_disconnected: "Wired client disconnected",
  lan_client_connected: "LAN client connected",
  lan_client_disconnected: "LAN client disconnected",
  vpn_client_connected: "VPN client connected",
  vpn_client_disconnected: "VPN client disconnected",
  user_logged_in: "User logged in",
  user_logged_out: "User logged out",
  admin_login: "Admin login",
  admin_logout: "Admin logout",
  admin_login_failed: "Admin login failed",
  threat_detected: "Threat detected",
  ips_alert: "IPS alert",
  ids_alert: "IDS alert",
  device_adopted: "Device adopted",
  device_restarted: "Device restarted",
  device_lost_contact: "Device lost contact",
  device_connected: "Device connected",
  device_disconnected: "Device disconnected",
  wan_transition: "WAN transition",
  wan_up: "WAN up",
  wan_down: "WAN down",
  speedtest_completed: "Speed test completed",
  firmware_upgrade: "Firmware upgrade",
  config_changed: "Configuration changed",
  backup_created: "Backup created",
};

function normalizeKey(s?: string | null): string {
  return (s ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function labelFor(eventType?: string | null): string | undefined {
  const k = normalizeKey(eventType);
  if (!k) return undefined;
  if (EVENT_TYPE_LABEL[k]) return EVENT_TYPE_LABEL[k];
  // Strip common prefix and retry
  const stripped = k.replace(/^(sta|wifi|wired|lan|wlan|client|user|admin|device)_/, "");
  if (EVENT_TYPE_LABEL[stripped]) return EVENT_TYPE_LABEL[stripped];
  return undefined;
}

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
      labelFor(e.eventType) ??
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
    const verb = e.action === "allow" ? "Allowed" : e.action === "drop" ? "Dropped" : "Blocked";
    const src = e.srcIp ? `${e.srcIp}${e.srcPort ? `:${e.srcPort}` : ""}` : "?";
    const dst = e.dstIp ? `${e.dstIp}${e.dstPort ? `:${e.dstPort}` : ""}` : "?";
    const proto = e.proto ? ` ${e.proto.toUpperCase()}` : "";
    return `${verb}${proto} ${src} → ${dst} (rule ${e.rule})`;
  }

  return e.reason ?? e.messageType ?? e.rule ?? "Event";
}

/** Short label for the action chip (e.g. "Connected", "Auth fail"). */
export function shortEventLabel(e: FirewallEvent): string {
  return labelFor(e.eventType) ?? e.action;
}

/**
 * True when the event is an internal device / Wi-Fi / auth event
 * (STA-TRACKER, association, deauth, auth success/failure, roam, etc.)
 * rather than an iptables firewall-rule hit.
 */
export function isInternalEvent(e: FirewallEvent): boolean {
  if (e.messageType?.startsWith("STA_")) return true;
  if (/assoc|leave|deauth|auth|roam|connect|disconnect/i.test(e.eventType ?? "")) return true;
  if (!e.srcIp && !e.dstIp && !/^(LAN_|WAN_|GUEST_)/i.test(e.rule ?? "")) {
    // Many UniFi system events have neither IPs nor a rule prefix.
    return true;
  }
  return false;
}

/** True when the event came from an iptables / UniFi firewall rule. */
export function isFirewallRuleEvent(e: FirewallEvent): boolean {
  return !isInternalEvent(e);
}

/** Actions that represent a blocked / denied / dropped firewall decision. */
export function isBlockedAction(action?: string | null): boolean {
  if (!action) return false;
  const a = action.toLowerCase();
  return ["block", "deny", "drop", "reject", "failure"].includes(a);
}

/** Categorise internal events for filtering chips. */
export type InternalCategory =
  | "connect"
  | "disconnect"
  | "auth-success"
  | "auth-failure"
  | "roam"
  | "other";

export function internalCategory(e: FirewallEvent): InternalCategory {
  const t = (e.eventType ?? "").toLowerCase();
  const m = (e.messageType ?? "").toLowerCase();
  if (e.action === "failure" || /fail/i.test(t)) return "auth-failure";
  if (t === "success" || t === "sta_auth_success") return "auth-success";
  if (t.includes("roam")) return "roam";
  if (t.includes("assoc") || m.includes("assoc")) return "connect";
  if (t.includes("leave") || t.includes("disconnect") || t.includes("deauth") || m.includes("leave")) {
    return "disconnect";
  }
  return "other";
}

