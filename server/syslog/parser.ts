// RFC3164 / RFC5424 syslog parser tuned for UniFi devices.

const SEVERITIES = [
  "critical", // 0 emerg
  "critical", // 1 alert
  "critical", // 2 crit
  "error",    // 3 err
  "warn",     // 4 warning
  "notice",   // 5 notice
  "info",     // 6 info
  "info",     // 7 debug
] as const;

const FACILITIES = [
  "kern", "user", "mail", "daemon", "auth", "syslog", "lpr", "news",
  "uucp", "cron", "authpriv", "ftp", "ntp", "audit", "alert", "clock",
  "local0", "local1", "local2", "local3", "local4", "local5", "local6", "local7",
];

export type ParsedSyslog = {
  time: number;
  host: string;
  appname: string;
  facility: string;
  severity: string;
  message: string;
  raw: string;
  isFirewall: boolean;
};

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function parseRfc3164Time(s: string): number {
  const m = s.match(/^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return Date.now();
  const now = new Date();
  let year = now.getFullYear();
  const month = MONTHS[m[1]] ?? 0;
  const day = Number(m[2]);
  // UniFi sends RFC3164 timestamps without a timezone, in the device's local
  // time. Interpret as the container's local time — set TZ on the container
  // (e.g. TZ=Europe/Stockholm) to match the router.
  let guess = new Date(year, month, day, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
  if (guess - now.getTime() > 86_400_000) {
    year -= 1;
    guess = new Date(year, month, day, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
  }
  return guess;
}

export function parseSyslog(line: string, fallbackHost = "unknown"): ParsedSyslog {
  const raw = line.replace(/\0+$/g, "").trim();
  let rest = raw;
  let severityIdx = 6;
  let facilityIdx = 1;
  let time = Date.now();

  // <priority>
  const priMatch = rest.match(/^<(\d{1,3})>/);
  if (priMatch) {
    const pri = Number(priMatch[1]);
    severityIdx = pri & 7;
    facilityIdx = pri >> 3;
    rest = rest.slice(priMatch[0].length);
  }

  // RFC3164 timestamp "Jun 27 10:41:04" — optional, parse if present
  const tsMatch = rest.match(/^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+/);
  if (tsMatch) {
    time = parseRfc3164Time(tsMatch[1]);
    rest = rest.slice(tsMatch[0].length);
  }

  // host
  const hostMatch = rest.match(/^(\S+)\s+/);
  const host = hostMatch ? hostMatch[1] : fallbackHost;
  if (hostMatch) rest = rest.slice(hostMatch[0].length);

  // UniFi UDR/UDM frequently duplicate the hostname before the appname
  // ("Host Host appname[pid]: ..."). Strip a repeated host token.
  const escHost = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const dupHost = new RegExp(`^${escHost}\\s+`);
  if (dupHost.test(rest)) rest = rest.replace(dupHost, "");

  // appname — supports "name", "name[pid]", and "mac,model-version" forms; ends at ": "
  let appname = "";
  const appMatch = rest.match(/^([^\s:]+?)(?:\[\d+\])?\s*:\s+/);
  if (appMatch) {
    appname = appMatch[1];
    rest = rest.slice(appMatch[0].length);
  }

  const message = rest;
  const isFirewall =
    /\bSTA-TRACKER\b/.test(message) ||
    /\b(UFW|UBNT|FW)[\s_-]+(BLOCK|ALLOW|DENY|DROP|REJECT|ACCEPT)\b/i.test(message) ||
    // UniFi iptables rule-tag prefix, e.g. "[WAN_LOCAL-2000-D]IN=eth4 OUT= ..."
    /\[[A-Z0-9_]+-(?:\d+-[A-Z]|[A-Z]-\d+)\]/.test(message) ||
    // Generic kernel netfilter trace
    (/\bkernel\b/i.test(appname + " " + message) && /\bIN=\S*.*\bSRC=/.test(message)) ||
    /\bis_firewall\b/.test(line) ||
    appname.includes("stahtd");

  return {
    time,
    host,
    appname,
    facility: FACILITIES[facilityIdx] ?? `local${facilityIdx}`,
    severity: SEVERITIES[severityIdx] ?? "info",
    message,
    raw,
    isFirewall,
  };
}
