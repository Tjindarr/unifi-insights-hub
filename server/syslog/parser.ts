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

export function parseSyslog(line: string, fallbackHost = "unknown"): ParsedSyslog {
  const raw = line.replace(/\0+$/g, "").trim();
  let rest = raw;
  let severityIdx = 6;
  let facilityIdx = 1;

  // <priority>
  const priMatch = rest.match(/^<(\d{1,3})>/);
  if (priMatch) {
    const pri = Number(priMatch[1]);
    severityIdx = pri & 7;
    facilityIdx = pri >> 3;
    rest = rest.slice(priMatch[0].length);
  }

  // RFC3164 timestamp "Jun 27 10:41:04" — optional, skip if present
  const tsMatch = rest.match(/^([A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+/);
  if (tsMatch) rest = rest.slice(tsMatch[0].length);

  // host
  const hostMatch = rest.match(/^(\S+)\s+/);
  const host = hostMatch ? hostMatch[1] : fallbackHost;
  if (hostMatch) rest = rest.slice(hostMatch[0].length);

  // appname (everything before first colon-space; may contain commas and dashes)
  let appname = "";
  const appMatch = rest.match(/^([^\s:]+(?:\+[^\s:]+)?)\s*:\s*/);
  if (appMatch) {
    appname = appMatch[1];
    rest = rest.slice(appMatch[0].length);
  }

  const message = rest;
  const isFirewall =
    /\bSTA-TRACKER\b/.test(message) ||
    /\b(UFW|UBNT|FW)\s*[-_:]?\s*(BLOCK|ALLOW|DENY|DROP|REJECT)\b/i.test(message) ||
    /\bis_firewall\b/.test(line) ||
    appname.includes("stahtd");

  return {
    time: Date.now(),
    host,
    appname,
    facility: FACILITIES[facilityIdx] ?? `local${facilityIdx}`,
    severity: SEVERITIES[severityIdx] ?? "info",
    message,
    raw,
    isFirewall,
  };
}
