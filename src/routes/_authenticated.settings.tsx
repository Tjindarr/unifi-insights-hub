import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HardDrive, PlayCircle, RefreshCw } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { formatBytes, formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [{ title: "Settings — UniFi Dashboard" }],
  }),
  component: SettingsPage,
});

const envVars: Array<{ key: string; desc: string; example?: string }> = [
  { key: "UNIFI_HOST", desc: "IP or hostname of your UniFi controller / Dream Router", example: "192.168.1.1" },
  { key: "UNIFI_USER", desc: "Read-only user created on the UniFi controller" },
  { key: "UNIFI_PASSWORD", desc: "Password for the read-only user" },
  { key: "UNIFI_SITE", desc: "Site name", example: "default" },
  { key: "SYSLOG_UDP_PORT", desc: "UDP port the syslog listener binds to", example: "514" },
  { key: "HTTP_PORT", desc: "HTTP port the dashboard serves on", example: "3000" },
  { key: "DB_PATH", desc: "SQLite database file path inside the container", example: "/data/unifi.db" },
  { key: "RETENTION_DAYS", desc: "Drop syslog rows older than N days", example: "30" },
  { key: "RETENTION_FIREWALL_DAYS", desc: "Drop firewall events older than N days", example: "30" },
  { key: "RETENTION_MAX_DB_MB", desc: "Hard cap on DB size — oldest rows pruned to fit", example: "2048" },
  { key: "RETENTION_INTERVAL_MIN", desc: "How often the cleanup job runs", example: "60" },
  { key: "RETENTION_VACUUM_HOURS", desc: "How often to VACUUM to reclaim disk space", example: "24" },
  { key: "DASH_USER", desc: "Dashboard login username (default admin)" },
  { key: "DASH_PASSWORD", desc: "Dashboard login password (default admin, must change on first login)" },
  { key: "SESSION_SECRET", desc: "Random 32+ character string used to encrypt the session cookie" },
];

type Retention = {
  config: {
    retentionDays: number;
    retentionFirewallDays: number;
    maxDbMb: number;
    intervalMin: number;
    vacuumHours: number;
  };
  last: null | {
    at: number;
    bySyslogAge: number;
    byFirewallAge: number;
    bySize: number;
    sizeBytesBefore: number;
    sizeBytesAfter: number;
    vacuumed: boolean;
  };
  db: {
    sizeBytes: number;
    syslogCount: number;
    firewallCount: number;
    oldestTime: number | null;
    newestTime: number | null;
  };
};

function SettingsPage() {
  const [data, setData] = useState<Retention | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await fetch("/api/retention");
      if (r.ok) setData(await r.json());
    } catch { /* preview / no backend */ }
  }
  useEffect(() => { load(); }, []);

  async function runNow() {
    setBusy(true);
    try {
      const r = await fetch("/api/retention/run", { method: "POST" });
      if (r.ok) {
        const j = await r.json();
        setData((d) => (d ? { ...d, last: j.last, db: j.db } : d));
      }
    } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader title="Settings" description="Retention, storage, and environment configuration" />
      <div className="p-6 space-y-6 max-w-3xl">
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium flex items-center gap-2">
              <HardDrive className="h-4 w-4" /> Retention &amp; storage
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={load}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-secondary/60"
              >
                <RefreshCw className="h-3.5 w-3.5" />Refresh
              </button>
              <button
                onClick={runNow}
                disabled={busy || !data}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs text-foreground bg-primary/10 hover:bg-primary/20 disabled:opacity-50"
              >
                <PlayCircle className="h-3.5 w-3.5" />Run cleanup now
              </button>
            </div>
          </div>

          {!data ? (
            <p className="text-xs text-muted-foreground mt-3">
              Live retention stats are reported by the container backend at <code className="font-mono">/api/retention</code>.
              Not available in the design preview.
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <Stat label="DB size" value={formatBytes(data.db.sizeBytes)} sub={`cap ${data.config.maxDbMb} MB`} />
              <Stat label="Syslog rows" value={data.db.syslogCount.toLocaleString()} sub={`oldest ${data.db.oldestTime ? formatDateTime(data.db.oldestTime) : "—"}`} />
              <Stat label="Firewall events" value={data.db.firewallCount.toLocaleString()} sub={`retain ${data.config.retentionFirewallDays}d`} />
              <Stat label="Syslog retention" value={`${data.config.retentionDays} days`} sub={`cleanup every ${data.config.intervalMin}m`} />
              <Stat label="VACUUM cadence" value={`${data.config.vacuumHours}h`} sub={data.last?.vacuumed ? "ran last cycle" : "—"} />
              <Stat
                label="Last cleanup"
                value={data.last ? formatDateTime(data.last.at) : "never"}
                sub={data.last ? `−${data.last.bySyslogAge} syslog · −${data.last.byFirewallAge} fw · −${data.last.bySize} size` : ""}
              />
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-medium">Environment</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Pass these to the container via <code className="font-mono">-e</code> flags, a{" "}
            <code className="font-mono">docker-compose.yml</code>, or your Unraid template.
          </p>
          <div className="mt-4 divide-y divide-border">
            {envVars.map((v) => (
              <div key={v.key} className="py-2 grid grid-cols-[220px_1fr] gap-3 items-baseline">
                <code className="font-mono text-xs text-primary">{v.key}</code>
                <div className="text-xs">
                  <div>{v.desc}</div>
                  {v.example && (
                    <div className="text-muted-foreground mt-0.5">
                      example: <code className="font-mono">{v.example}</code>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-medium">Unraid quick install</h2>
          <ol className="mt-3 space-y-2 text-xs text-muted-foreground list-decimal list-inside leading-relaxed">
            <li>Build the image on the Unraid box (or pull from your registry):
              <pre className="mt-1 ml-4 p-2 rounded bg-secondary/40 font-mono text-[11px] overflow-x-auto">docker build -t unifi-dashboard /path/to/repo</pre>
            </li>
            <li>Add a Docker container in the Unraid UI with:
              <ul className="mt-1 ml-4 space-y-0.5 list-disc list-inside">
                <li>Repository: <code className="font-mono">unifi-dashboard:latest</code></li>
                <li>Network type: <code className="font-mono">host</code> (recommended so the syslog source IP is the real device IP)</li>
                <li>Path: <code className="font-mono">/data</code> → <code className="font-mono">/mnt/user/appdata/unifi-dashboard</code> (RW)</li>
                <li>Port: <code className="font-mono">3000/tcp</code> · <code className="font-mono">514/udp</code> (skip if host network)</li>
                <li>All env vars from the table above</li>
              </ul>
            </li>
            <li>In the UniFi console, enable Remote Syslog to your Unraid IP on UDP 514.</li>
            <li>The container exposes <code className="font-mono">HEALTHCHECK</code> on <code className="font-mono">/api/health</code> — Unraid shows it as healthy/unhealthy automatically.</li>
          </ol>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-medium mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5 font-mono truncate">{sub}</div>}
    </div>
  );
}
