import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Database, DownloadCloud, HardDrive, PlayCircle, RefreshCw, Router, Save, ShieldAlert, XCircle } from "lucide-react";

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
  threatIntel?: {
    hasAbuseIpdbKey: boolean;
    feeds?: Record<string, boolean>;
    checkOnMiss?: boolean;
  };
  syslog?: { tzOffsetMinutes: number; useArrivalTime: boolean };
  unifiStatus?: UnifiStatus;
};

type FeedStatus = {
  id: string;
  name: string;
  description: string;
  requiresKey: boolean;
  enabled: boolean;
  intervalHours: number;
  lastUpdatedAt: number | null;
  lastAttemptAt: number | null;
  lastError: string | null;
  ipCount: number;
  cidrCount: number;
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
  const [feeds, setFeeds] = useState<FeedStatus[]>([]);
  const [checkOnMiss, setCheckOnMiss] = useState(true);
  const [syslogForm, setSyslogForm] = useState<{ tzOffsetMinutes: number; useArrivalTime: boolean }>({
    tzOffsetMinutes: 0, useArrivalTime: false,
  });
  const [savingSyslog, setSavingSyslog] = useState(false);
  const [syslogMsg, setSyslogMsg] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [savingUnifi, setSavingUnifi] = useState(false);
  const [savingRet, setSavingRet] = useState(false);
  const [savingNoise, setSavingNoise] = useState(false);
  const [noiseMsg, setNoiseMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [unifiMsg, setUnifiMsg] = useState<string | null>(null);
  const [retMsg, setRetMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadFeeds() {
    try {
      const f = await fetch("/api/threat-feeds").then((x) => (x.ok ? x.json() : null));
      if (f?.feeds) setFeeds(f.feeds as FeedStatus[]);
    } catch { /* preview mode */ }
  }

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
        if (s.threatIntel?.checkOnMiss != null) setCheckOnMiss(!!s.threatIntel.checkOnMiss);
        if (s.syslog) {
          setSyslogForm({
            tzOffsetMinutes: Number(s.syslog.tzOffsetMinutes) || 0,
            useArrivalTime: !!s.syslog.useArrivalTime,
          });
        }
      }
      if (r) setRetention(r);
    } catch { /* preview mode */ }
    await loadFeeds();
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

  async function saveSyslog() {
    setSavingSyslog(true); setSyslogMsg(null);
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ syslog: syslogForm }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as Settings;
      setSettings(j);
      setSyslogMsg("Saved. New logs use the updated timestamp.");
    } catch (err) {
      setSyslogMsg("Save failed: " + (err instanceof Error ? err.message : String(err)));
    } finally { setSavingSyslog(false); }
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

  async function toggleFeed(id: string, enabled: boolean) {
    // Optimistic UI; revert on error.
    setFeeds((prev) => prev.map((f) => (f.id === id ? { ...f, enabled } : f)));
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threatIntel: { feeds: { [id]: enabled } } }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = (await r.json()) as Settings;
      setSettings(j);
      await loadFeeds();
    } catch {
      await loadFeeds();
    }
  }

  async function toggleCheckOnMiss(v: boolean) {
    setCheckOnMiss(v);
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threatIntel: { checkOnMiss: v } }),
      });
      if (r.ok) setSettings((await r.json()) as Settings);
    } catch { /* ignore */ }
  }

  async function refreshFeed(id: string) {
    setRefreshing(id);
    try {
      await fetch(`/api/threat-feeds/refresh/${encodeURIComponent(id)}`, { method: "POST" });
      await loadFeeds();
    } finally { setRefreshing(null); }
  }

  async function refreshAllFeeds() {
    setRefreshing("__all__");
    try {
      await fetch("/api/threat-feeds/refresh", { method: "POST" });
      await loadFeeds();
    } finally { setRefreshing(null); }
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

        {/* ---- Syslog timestamp / timezone ---- */}
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-medium">Syslog timestamps</h2>
          <p className="text-xs text-muted-foreground mt-1">
            UniFi sends syslog timestamps without a timezone, in the router's local time.
            If your container's <code className="font-mono">TZ</code> doesn't match the router,
            stored events will be off by the timezone difference. Set the router's UTC offset
            (e.g. <code className="font-mono">120</code> for CEST / Stockholm summer,{" "}
            <code className="font-mono">60</code> for CET winter, <code className="font-mono">0</code> for UTC).
            Container time is currently{" "}
            <code className="font-mono">{new Date().toString().match(/GMT([+-]\d{4})/)?.[1] ?? "?"}</code>.
          </p>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Router UTC offset (minutes)">
              <input className="input" type="number" step={15} min={-840} max={840}
                value={syslogForm.tzOffsetMinutes}
                onChange={(e) => setSyslogForm((f) => ({ ...f, tzOffsetMinutes: Number(e.target.value) }))} />
            </Field>
            <label className="flex items-center gap-2 text-xs pt-6">
              <input type="checkbox" checked={syslogForm.useArrivalTime}
                onChange={(e) => setSyslogForm((f) => ({ ...f, useArrivalTime: e.target.checked }))} />
              Ignore router timestamp — stamp on arrival
            </label>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <button onClick={saveSyslog} disabled={savingSyslog}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs bg-primary/10 hover:bg-primary/20 disabled:opacity-50">
              <Save className="h-3.5 w-3.5" /> Save
            </button>
            {syslogMsg && <span className="text-[11px] text-muted-foreground">{syslogMsg}</span>}
          </div>

          <p className="mt-3 text-[11px] text-muted-foreground">
            Only affects new incoming syslog lines. Existing rows keep their stored timestamps.
          </p>
        </section>


        {/* ---- Threat intel ---- */}
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" /> Threat intelligence
            </h2>
            <span
              className={`text-[11px] font-mono px-2 py-1 rounded ${
                settings?.threatIntel?.hasAbuseIpdbKey
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-secondary/60 text-muted-foreground"
              }`}
            >
              {settings?.threatIntel?.hasAbuseIpdbKey ? "key saved" : "not configured"}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Adds a confidence score and reports count to every external IP on the Firewall page.
            Get a free key at{" "}
            <a
              href="https://www.abuseipdb.com/account/api"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-foreground"
            >
              abuseipdb.com/account/api
            </a>{" "}
            (1,000 lookups/day on the free tier). Without a key, the Firewall page still shows
            country and ISP via the geo lookup.
          </p>

          <div className="mt-4">
            <Field
              label={
                settings?.threatIntel?.hasAbuseIpdbKey
                  ? "AbuseIPDB API key (leave blank to keep saved)"
                  : "AbuseIPDB API key"
              }
            >
              <input
                className="input"
                type="password"
                autoComplete="off"
                placeholder={settings?.threatIntel?.hasAbuseIpdbKey ? "••••••••" : ""}
                value={threatForm.abuseIpdbKey}
                onChange={(e) => setThreatForm({ abuseIpdbKey: e.target.value })}
              />
            </Field>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              onClick={() => saveThreat()}
              disabled={savingThreat || !threatForm.abuseIpdbKey}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs bg-primary/10 hover:bg-primary/20 disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" /> Save key
            </button>
            {settings?.threatIntel?.hasAbuseIpdbKey && (
              <button
                onClick={() => saveThreat({ clear: true })}
                disabled={savingThreat}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-secondary/60 disabled:opacity-50"
              >
                <XCircle className="h-3.5 w-3.5" /> Remove key
              </button>
            )}
            {threatMsg && <span className="text-[11px] text-muted-foreground">{threatMsg}</span>}
          </div>

          <p className="mt-3 text-[11px] text-muted-foreground">
            Per-IP <code className="font-mono">/check</code> results are cached for 7 days in
            <code className="font-mono"> /data/unifi.db</code>, and the local threat feeds below
            short-circuit most lookups before they spend any quota.
          </p>
        </section>

        {/* ---- Offline threat feeds ---- */}
        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="text-sm font-medium flex items-center gap-2">
              <Database className="h-4 w-4" /> Threat feeds (offline blocklists)
            </h2>
            <button
              onClick={refreshAllFeeds}
              disabled={refreshing !== null}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs bg-primary/10 hover:bg-primary/20 disabled:opacity-50"
            >
              <DownloadCloud className={`h-3.5 w-3.5 ${refreshing === "__all__" ? "animate-pulse" : ""}`} />
              Refresh due feeds
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Public IP / CIDR blocklists are downloaded on a 24 h cycle and stored locally.
            The Firewall page consults this cache first, so AbuseIPDB <code className="font-mono">/check</code>{" "}
            quota is only spent on IPs that no feed has heard of.
          </p>

          <label className="mt-3 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={checkOnMiss}
              onChange={(e) => toggleCheckOnMiss(e.target.checked)}
            />
            Fall back to AbuseIPDB <code className="font-mono">/check</code> for IPs not in any feed
            <span className="text-muted-foreground">
              ({settings?.threatIntel?.hasAbuseIpdbKey ? "key configured" : "needs API key"})
            </span>
          </label>

          <div className="mt-4 divide-y divide-border rounded-md border border-border overflow-hidden">
            {feeds.length === 0 && (
              <div className="px-3 py-4 text-xs text-muted-foreground">Loading feed status…</div>
            )}
            {feeds.map((f) => {
              const total = f.ipCount + f.cidrCount;
              const stale = f.lastUpdatedAt && Date.now() - f.lastUpdatedAt > f.intervalHours * 2 * 3600_000;
              return (
                <div key={f.id} className="px-3 py-3 flex items-start gap-3 bg-background/30">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={f.enabled}
                    onChange={(e) => toggleFeed(f.id, e.target.checked)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium">{f.name}</span>
                      {f.requiresKey && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">
                          needs key
                        </span>
                      )}
                      {f.lastError && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 truncate max-w-[260px]">
                          {f.lastError}
                        </span>
                      )}
                      {total > 0 && (
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {f.ipCount.toLocaleString()} ips · {f.cidrCount.toLocaleString()} cidrs
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{f.description}</p>
                    <p className="text-[10px] font-mono text-muted-foreground mt-0.5">
                      {f.lastUpdatedAt
                        ? <>updated {formatDateTime(f.lastUpdatedAt)}{stale ? " · stale" : ""}</>
                        : "never updated"}
                    </p>
                  </div>
                  <button
                    onClick={() => refreshFeed(f.id)}
                    disabled={refreshing !== null || (f.requiresKey && !settings?.threatIntel?.hasAbuseIpdbKey)}
                    className="flex items-center gap-1 px-2 py-1 rounded border border-border text-[11px] hover:bg-secondary/60 disabled:opacity-40"
                    title={f.requiresKey && !settings?.threatIntel?.hasAbuseIpdbKey ? "AbuseIPDB key required" : "Refresh now"}
                  >
                    <RefreshCw className={`h-3 w-3 ${refreshing === f.id ? "animate-spin" : ""}`} />
                    Refresh
                  </button>
                </div>
              );
            })}
          </div>

          <p className="mt-3 text-[11px] text-muted-foreground">
            Defaults enabled: AbuseIPDB Blacklist (1 request/day, separate from <code className="font-mono">/check</code> quota),
            FireHOL Level 1, and Spamhaus DROP. Toggle others on if you need wider coverage.
          </p>
        </section>


        {/* ---- Firewall logging tips ---- */}
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> Firewall logging on the UDR
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            The UDR's syslog stream does <strong>not</strong> include internet traffic by default.
            Normal LAN→WAN sessions are forwarded by the built-in "Allow established / related"
            rule, which has logging disabled. To populate the Firewall page (and the{" "}
            <em>Internet only</em> filter) you must enable logging on at least one rule.
          </p>
          <ol className="mt-3 space-y-1.5 text-xs text-muted-foreground list-decimal list-inside leading-relaxed">
            <li>
              Open the UniFi Network app →{" "}
              <strong>Settings → Security → Traffic &amp; Firewall Rules → Internet</strong>.
            </li>
            <li>
              Edit a <strong>Block</strong> rule (e.g. the default "Block External → Internal")
              and toggle <strong>Logging</strong> on. Drop rules are low volume / high value —
              the safest place to start.
            </li>
            <li>
              Optionally clone an <strong>Allow</strong> rule scoped to interesting destination
              ports (22, 23, 445, 3389) with logging on, to catch new outbound sessions without
              flooding syslog.
            </li>
            <li>
              Save. The first matching packet appears in syslog within a few seconds; the
              Firewall page typically starts filling within ~10 s of the next matching
              connection.
            </li>
          </ol>
          <p className="mt-3 text-[11px] text-muted-foreground">
            Avoid enabling logging on broad <strong>Allow</strong> rules — a busy network can
            push hundreds of lines/sec over UDP/514 and fill the database fast.
          </p>
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
