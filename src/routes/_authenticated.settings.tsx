import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, HardDrive, PlayCircle, RefreshCw, Router, Save, ShieldAlert, XCircle } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { formatBytes, formatDateTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — UniFi Dashboard" }] }),
  component: SettingsPage,
});

type UnifiStatus = {
  enabled: boolean;
  configured: boolean;
  lastPollAt: number | null;
  lastError: string | null;
  lastOk: boolean;
};

type Settings = {
  unifi: { host: string; user: string; site: string; enabled: boolean; hasPassword: boolean };
  retention: {
    retentionDays: number;
    retentionFirewallDays: number;
    maxDbMb: number;
    intervalMin: number;
    vacuumHours: number;
  };
  noiseFilter: { enabled: boolean; action: "drop" | "downgrade"; patterns: string[] };
  threatIntel?: { hasAbuseIpdbKey: boolean };
  unifiStatus?: UnifiStatus;
};

type RetentionInfo = {
  config: Settings["retention"];
  last: null | {
    at: number; bySyslogAge: number; byFirewallAge: number; bySize: number;
    sizeBytesBefore: number; sizeBytesAfter: number; vacuumed: boolean;
  };
  db: {
    sizeBytes: number; syslogCount: number; firewallCount: number;
    oldestTime: number | null; newestTime: number | null;
  };
};

function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [retention, setRetention] = useState<RetentionInfo | null>(null);
  const [unifiForm, setUnifiForm] = useState({
    host: "", user: "", password: "", site: "default", enabled: true,
  });
  const [retForm, setRetForm] = useState({
    retentionDays: 30, retentionFirewallDays: 30,
    maxDbMb: 2048, intervalMin: 60, vacuumHours: 24,
  });
  const [noiseForm, setNoiseForm] = useState<{
    enabled: boolean; action: "drop" | "downgrade"; patternsText: string;
  }>({ enabled: true, action: "drop", patternsText: "" });
  const [threatForm, setThreatForm] = useState({ abuseIpdbKey: "" });
  const [savingThreat, setSavingThreat] = useState(false);
  const [threatMsg, setThreatMsg] = useState<string | null>(null);
  const [savingUnifi, setSavingUnifi] = useState(false);
  const [savingRet, setSavingRet] = useState(false);
  const [savingNoise, setSavingNoise] = useState(false);
  const [noiseMsg, setNoiseMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [unifiMsg, setUnifiMsg] = useState<string | null>(null);
  const [retMsg, setRetMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [s, r] = await Promise.all([
        fetch("/api/settings").then((x) => (x.ok ? x.json() : null)),
        fetch("/api/retention").then((x) => (x.ok ? x.json() : null)),
      ]);
      if (s) {
        setSettings(s);
        setUnifiForm({
          host: s.unifi.host || "",
          user: s.unifi.user || "",
          password: "",
          site: s.unifi.site || "default",
          enabled: !!s.unifi.enabled,
        });
        setRetForm({ ...s.retention });
        if (s.noiseFilter) {
          setNoiseForm({
            enabled: !!s.noiseFilter.enabled,
            action: s.noiseFilter.action === "downgrade" ? "downgrade" : "drop",
            patternsText: (s.noiseFilter.patterns ?? []).join("\n"),
          });
        }
        // Threat-intel form: never receive the saved key — only whether one exists.
        setThreatForm({ abuseIpdbKey: "" });
      }
      if (r) setRetention(r);
    } catch { /* preview mode */ }
  }
  useEffect(() => { load(); }, []);

  async function saveUnifi() {
    setSavingUnifi(true); setUnifiMsg(null);
    try {
      const body: Record<string, unknown> = {
        host: unifiForm.host.trim(),
        user: unifiForm.user.trim(),
        site: unifiForm.site.trim() || "default",
        enabled: unifiForm.enabled,
      };
      if (unifiForm.password) body.password = unifiForm.password;
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ unifi: body }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as Settings;
      setSettings(j);
      setUnifiForm((f) => ({ ...f, password: "" }));
      setUnifiMsg("Saved. Poller restarted.");
    } catch (err) {
      setUnifiMsg("Save failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSavingUnifi(false);
    }
  }

  async function testUnifi() {
    setTesting(true); setTestResult(null);
    try {
      const r = await fetch("/api/settings/test-unifi", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          host: unifiForm.host.trim(),
          user: unifiForm.user.trim(),
          password: unifiForm.password,
          site: unifiForm.site.trim() || "default",
        }),
      });
      setTestResult(await r.json());
    } catch (err) {
      setTestResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally { setTesting(false); }
  }

  async function saveRetention() {
    setSavingRet(true); setRetMsg(null);
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ retention: retForm }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as Settings;
      setSettings(j);
      setRetMsg("Saved. Schedule updated.");
      const ri = await fetch("/api/retention").then((x) => x.json());
      setRetention(ri);
    } catch (err) {
      setRetMsg("Save failed: " + (err instanceof Error ? err.message : String(err)));
    } finally { setSavingRet(false); }
  }

  async function runNow() {
    setBusy(true);
    try {
      const r = await fetch("/api/retention/run", { method: "POST" });
      if (r.ok) {
        const j = await r.json();
        setRetention((d) => (d ? { ...d, last: j.last, db: j.db } : d));
      }
    } finally { setBusy(false); }
  }

  async function saveNoise() {
    setSavingNoise(true); setNoiseMsg(null);
    try {
      const patterns = noiseForm.patternsText
        .split("\n").map((s) => s.trim()).filter(Boolean);
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          noiseFilter: { enabled: noiseForm.enabled, action: noiseForm.action, patterns },
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as Settings;
      setSettings(j);
      setNoiseMsg("Saved. Applied to incoming syslog.");
    } catch (err) {
      setNoiseMsg("Save failed: " + (err instanceof Error ? err.message : String(err)));
    } finally { setSavingNoise(false); }
  }

  async function saveThreat(opts: { clear?: boolean } = {}) {
    setSavingThreat(true); setThreatMsg(null);
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threatIntel: { abuseIpdbKey: opts.clear ? "" : threatForm.abuseIpdbKey.trim() },
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as Settings;
      setSettings(j);
      setThreatForm({ abuseIpdbKey: "" });
      setThreatMsg(opts.clear ? "Key removed." : "Key saved.");
    } catch (err) {
      setThreatMsg("Save failed: " + (err instanceof Error ? err.message : String(err)));
    } finally { setSavingThreat(false); }
  }


  const status = settings?.unifiStatus;

  return (
    <div>
      <PageHeader title="Settings" description="UniFi controller, retention, and storage — stored in /data/config.json" />
      <div className="p-6 space-y-6 max-w-3xl">
        {/* ---- UniFi controller ---- */}
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium flex items-center gap-2">
              <Router className="h-4 w-4" /> UniFi controller
            </h2>
            {status && (
              <span className={`text-[11px] font-mono px-2 py-1 rounded ${
                status.lastOk ? "bg-emerald-500/10 text-emerald-400"
                : status.configured && status.enabled ? "bg-amber-500/10 text-amber-400"
                : "bg-secondary/60 text-muted-foreground"
              }`}>
                {!status.enabled ? "disabled"
                  : !status.configured ? "not configured"
                  : status.lastOk ? "connected"
                  : "error"}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Create a read-only local admin on the UDR (UniFi OS → Settings → Admins) and enter
            those credentials here. Settings save to <code className="font-mono">/data/config.json</code>.
          </p>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Host / IP">
              <input className="input" placeholder="192.168.1.1"
                value={unifiForm.host}
                onChange={(e) => setUnifiForm((f) => ({ ...f, host: e.target.value }))} />
            </Field>
            <Field label="Site">
              <input className="input" placeholder="default"
                value={unifiForm.site}
                onChange={(e) => setUnifiForm((f) => ({ ...f, site: e.target.value }))} />
            </Field>
            <Field label="Username">
              <input className="input" placeholder="readonly"
                value={unifiForm.user}
                onChange={(e) => setUnifiForm((f) => ({ ...f, user: e.target.value }))} />
            </Field>
            <Field label={settings?.unifi.hasPassword ? "Password (leave blank to keep saved)" : "Password"}>
              <input className="input" type="password" placeholder={settings?.unifi.hasPassword ? "••••••••" : ""}
                value={unifiForm.password}
                onChange={(e) => setUnifiForm((f) => ({ ...f, password: e.target.value }))} />
            </Field>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={unifiForm.enabled}
                onChange={(e) => setUnifiForm((f) => ({ ...f, enabled: e.target.checked }))} />
              Enable polling
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button onClick={saveUnifi} disabled={savingUnifi}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs bg-primary/10 hover:bg-primary/20 disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> Save &amp; restart poller
            </button>
            <button onClick={testUnifi} disabled={testing || !unifiForm.host || !unifiForm.user}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-secondary/60 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${testing ? "animate-spin" : ""}`} /> Test connection
            </button>
            {testResult && (
              <span className={`text-[11px] flex items-center gap-1 ${testResult.ok ? "text-emerald-400" : "text-red-400"}`}>
                {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {testResult.ok ? "Connection OK" : testResult.error || "Failed"}
              </span>
            )}
            {unifiMsg && <span className="text-[11px] text-muted-foreground">{unifiMsg}</span>}
          </div>

          {status?.lastPollAt && (
            <p className="mt-3 text-[11px] text-muted-foreground font-mono">
              Last poll {formatDateTime(status.lastPollAt)} —{" "}
              {status.lastOk ? "ok" : `error: ${status.lastError}`}
            </p>
          )}
        </section>

        {/* ---- Retention ---- */}
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium flex items-center gap-2">
              <HardDrive className="h-4 w-4" /> Retention &amp; storage
            </h2>
            <button onClick={runNow} disabled={busy || !retention}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs bg-primary/10 hover:bg-primary/20 disabled:opacity-50">
              <PlayCircle className="h-3.5 w-3.5" /> Run cleanup now
            </button>
          </div>

          {retention && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
              <Stat label="DB size" value={formatBytes(retention.db.sizeBytes)} sub={`cap ${retention.config.maxDbMb} MB`} />
              <Stat label="Syslog rows" value={retention.db.syslogCount.toLocaleString()} sub={`oldest ${retention.db.oldestTime ? formatDateTime(retention.db.oldestTime) : "—"}`} />
              <Stat label="Firewall events" value={retention.db.firewallCount.toLocaleString()} sub={`retain ${retention.config.retentionFirewallDays}d`} />
              <Stat label="Last cleanup"
                value={retention.last ? formatDateTime(retention.last.at) : "never"}
                sub={retention.last ? `−${retention.last.bySyslogAge} syslog · −${retention.last.byFirewallAge} fw · −${retention.last.bySize} size` : ""} />
            </div>
          )}

          <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Syslog retention (days)">
              <input className="input" type="number" min={0} max={3650}
                value={retForm.retentionDays}
                onChange={(e) => setRetForm((f) => ({ ...f, retentionDays: Number(e.target.value) }))} />
            </Field>
            <Field label="Firewall retention (days)">
              <input className="input" type="number" min={0} max={3650}
                value={retForm.retentionFirewallDays}
                onChange={(e) => setRetForm((f) => ({ ...f, retentionFirewallDays: Number(e.target.value) }))} />
            </Field>
            <Field label="Max DB size (MB)">
              <input className="input" type="number" min={16}
                value={retForm.maxDbMb}
                onChange={(e) => setRetForm((f) => ({ ...f, maxDbMb: Number(e.target.value) }))} />
            </Field>
            <Field label="Cleanup interval (min)">
              <input className="input" type="number" min={1} max={1440}
                value={retForm.intervalMin}
                onChange={(e) => setRetForm((f) => ({ ...f, intervalMin: Number(e.target.value) }))} />
            </Field>
            <Field label="VACUUM cadence (hours)">
              <input className="input" type="number" min={1} max={720}
                value={retForm.vacuumHours}
                onChange={(e) => setRetForm((f) => ({ ...f, vacuumHours: Number(e.target.value) }))} />
            </Field>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button onClick={saveRetention} disabled={savingRet}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs bg-primary/10 hover:bg-primary/20 disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> Save retention
            </button>
            {retMsg && <span className="text-[11px] text-muted-foreground">{retMsg}</span>}
          </div>

          <p className="mt-3 text-[11px] text-muted-foreground">
            Set days to <code className="font-mono">0</code> to disable that age-based rule. Size cap always applies.
          </p>
        </section>

        {/* ---- Noise filter ---- */}
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-medium">Syslog noise filter</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Built-in defaults already strip the very chatty UDR housekeeping lines
            (<code className="font-mono">_udapi_lu_set_inform_interval</code>,{" "}
            <code className="font-mono">smp-affinity-monitor</code>, WiFi IRQ affinity, periodic STA stat dumps).
            Add your own JavaScript regex patterns below, one per line.
          </p>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={noiseForm.enabled}
                onChange={(e) => setNoiseForm((f) => ({ ...f, enabled: e.target.checked }))} />
              Enable noise filter
            </label>
            <Field label="Action for matched lines">
              <select className="input"
                value={noiseForm.action}
                onChange={(e) => setNoiseForm((f) => ({ ...f, action: e.target.value as "drop" | "downgrade" }))}>
                <option value="drop">Drop (don't store)</option>
                <option value="downgrade">Downgrade to debug (keep, hide by default)</option>
              </select>
            </Field>
          </div>

          <div className="mt-3">
            <Field label="Additional regex patterns (one per line)">
              <textarea className="input" rows={4}
                placeholder={"e.g. mcad\\[\\d+\\]: ubnt_lr_recv\nntpd\\[\\d+\\]: Listen normally"}
                value={noiseForm.patternsText}
                onChange={(e) => setNoiseForm((f) => ({ ...f, patternsText: e.target.value }))} />
            </Field>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button onClick={saveNoise} disabled={savingNoise}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs bg-primary/10 hover:bg-primary/20 disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> Save filter
            </button>
            {noiseMsg && <span className="text-[11px] text-muted-foreground">{noiseMsg}</span>}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-medium">Unraid install</h2>
          <p className="text-xs text-muted-foreground mt-1">
            No env vars required. Everything above is stored in
            <code className="font-mono"> /data/config.json</code> and survives container updates.
          </p>
          <ol className="mt-3 space-y-2 text-xs text-muted-foreground list-decimal list-inside leading-relaxed">
            <li>Map a host path to <code className="font-mono">/data</code> (e.g.{" "}
              <code className="font-mono">/mnt/user/appdata/unifi-dashboard</code>).</li>
            <li>Expose <code className="font-mono">3000/tcp</code> for the UI and <code className="font-mono">514/udp</code> for syslog
              (or use <code className="font-mono">--network host</code> so the source IP is preserved).</li>
            <li>Log in with <code className="font-mono">admin / admin</code>, set a new password, then come back here and
              fill in your UniFi credentials.</li>
            <li>On the UDR, enable Remote Syslog pointing at this server on UDP 514.</li>
          </ol>
        </section>
      </div>

      <style>{`
        .input {
          width: 100%;
          background: oklch(0.34 0.012 250);
          border: 1px solid oklch(0.55 0.015 250);
          box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.35);
          border-radius: 6px;
          padding: 8px 10px;
          font-size: 13px;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          color: hsl(var(--foreground));
          transition: border-color .12s, box-shadow .12s, background .12s;
        }
        .input::placeholder { color: oklch(0.60 0.018 250); }
        .input:hover { background: oklch(0.38 0.012 250); border-color: oklch(0.70 0.14 200); }
        .input:focus {
          outline: none;
          border-color: oklch(0.90 0.14 200);
          box-shadow: 0 0 0 2px oklch(0.78 0.14 200 / 0.35), inset 0 1px 3px rgba(0, 0, 0, 0.25);
          background: oklch(0.42 0.012 250);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
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
