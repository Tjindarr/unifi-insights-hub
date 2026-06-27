import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { Download, Save, Search, Star, X } from "lucide-react";

import { PageHeader, SeverityDot } from "@/components/app-shell";
import { DemoBadge } from "@/components/demo-badge";
import { Input } from "@/components/ui/input";
import type { Severity, SyslogEntry } from "@/lib/mock-data";
import { useSyslog, useSyslogByMinute } from "@/lib/live";
import { formatDateTime, formatTime } from "@/lib/format";
import { exportNdjson } from "@/lib/export";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({ meta: [{ title: "Logs — UniFi Dashboard" }] }),
  component: LogsPage,
});


const SEVERITIES: Severity[] = ["info", "notice", "warn", "error", "critical"];
const SAVED_KEY = "logs-saved-searches";

// Query syntax: free terms + key:value filters. Keys: host, sev, app, msg.
type Parsed = { terms: string[]; host?: string; sev?: Severity; app?: string; msg?: string };
function parseQuery(q: string): Parsed {
  const out: Parsed = { terms: [] };
  for (const tok of q.split(/\s+/).filter(Boolean)) {
    const m = tok.match(/^(host|sev|app|msg):(.+)$/i);
    if (m) {
      const k = m[1].toLowerCase() as "host" | "sev" | "app" | "msg";
      const v = m[2];
      if (k === "sev") out.sev = v as Severity;
      else out[k] = v;
    } else out.terms.push(tok.toLowerCase());
  }
  return out;
}
function matches(s: SyslogEntry, p: Parsed): boolean {
  if (p.host && s.host !== p.host) return false;
  if (p.sev && s.severity !== p.sev) return false;
  if (p.app && !s.appname.toLowerCase().includes(p.app.toLowerCase())) return false;
  if (p.msg && !s.message.toLowerCase().includes(p.msg.toLowerCase())) return false;
  if (p.terms.length) {
    const hay = `${s.host} ${s.appname} ${s.message}`.toLowerCase();
    for (const t of p.terms) if (!hay.includes(t)) return false;
  }
  return true;
}

function LogsPage() {
  const { data: syslog, isLive } = useSyslog();
  const [q, setQ] = useState("");
  const [sev, setSev] = useState<Set<Severity>>(new Set(SEVERITIES));
  const [host, setHost] = useState<string | "all">("all");
  const [saved, setSaved] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try { setSaved(JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]")); } catch { /* */ }
  }, []);

  function persistSaved(next: string[]) {
    setSaved(next);
    if (typeof window !== "undefined") localStorage.setItem(SAVED_KEY, JSON.stringify(next));
  }

  const hosts = useMemo(() => Array.from(new Set(syslog.map((s) => s.host))).sort(), [syslog]);
  const parsed = useMemo(() => parseQuery(q), [q]);
  const rows = useMemo(() =>
    syslog.filter((s: SyslogEntry) => sev.has(s.severity) && (host === "all" || s.host === host) && matches(s, parsed))
  , [parsed, sev, host, syslog]);
  const syslogByMinute = useSyslogByMinute(rows, isLive);



  function toggleSev(s: Severity) {
    const next = new Set(sev);
    if (next.has(s)) next.delete(s); else next.add(s);
    setSev(next);
  }

  function saveSearch() {
    if (!q.trim() || saved.includes(q)) return;
    persistSaved([q, ...saved].slice(0, 10));
  }
  function removeSaved(s: string) { persistSaved(saved.filter((x) => x !== s)); }

  return (
    <div>
      <PageHeader
        title="Logs"
        description={`${rows.length} of ${syslog.length} · syntax: host:U7ProXG sev:warn app:stahtd term`}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportNdjson("logs", rows)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-secondary/60">
              <Download className="h-3.5 w-3.5" />NDJSON
            </button>
            <button onClick={saveSearch} disabled={!q.trim()} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-secondary/60 disabled:opacity-50">
              <Save className="h-3.5 w-3.5" />Save
            </button>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder='host:U7ProXG sev:warn term' value={q} onChange={(e) => setQ(e.target.value)} className="pl-7 h-8 w-96 font-mono" />
            </div>
          </div>
        }
      />

      <div className="px-6 pt-4">
        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 pt-3 flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Messages / minute</h2>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-severity-info" />info</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-severity-warn" />warn</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-severity-error" />error</span>
            </div>
          </div>
          <div className="h-24 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={syslogByMinute}>
                <XAxis dataKey="t" tickFormatter={(t) => formatTime(t)} tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }} stroke="var(--color-border)" minTickGap={50} />
                <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 11 }} labelFormatter={(t) => formatTime(t)} />
                <Bar dataKey="info"  stackId="a" fill="var(--color-severity-info)" />
                <Bar dataKey="warn"  stackId="a" fill="var(--color-severity-warn)" />
                <Bar dataKey="error" stackId="a" fill="var(--color-severity-error)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="p-6 grid grid-cols-[200px_1fr] gap-4">
        <aside className="space-y-4">
          {saved.length > 0 && (
            <Facet title="Saved">
              {saved.map((s) => (
                <div key={s} className="flex items-center gap-1 text-xs">
                  <button onClick={() => setQ(s)} className="flex-1 flex items-center gap-1.5 py-1 px-1.5 rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground text-left truncate">
                    <Star className="h-3 w-3" />
                    <span className="truncate font-mono">{s}</span>
                  </button>
                  <button onClick={() => removeSaved(s)} className="p-0.5 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
                </div>
              ))}
            </Facet>
          )}
          <Facet title="Severity">
            {SEVERITIES.map((s) => (
              <label key={s} className="flex items-center gap-2 text-xs cursor-pointer py-1">
                <input type="checkbox" checked={sev.has(s)} onChange={() => toggleSev(s)} className="accent-primary" />
                <SeverityDot severity={s} />
                <span className="capitalize">{s}</span>
                <span className="ml-auto text-muted-foreground">{syslog.filter((x) => x.severity === s).length}</span>
              </label>
            ))}
          </Facet>
          <Facet title="Host">
            <button onClick={() => setHost("all")} className={cn("w-full text-left text-xs py-1 px-1.5 rounded", host === "all" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60")}>All hosts</button>
            {hosts.map((h) => (
              <button key={h} onClick={() => setHost(h)} className={cn("w-full text-left text-xs py-1 px-1.5 rounded font-mono truncate", host === h ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60")}>{h}</button>
            ))}
          </Facet>
        </aside>

        <div className="rounded-lg border border-border bg-card overflow-hidden min-w-0">
          <ul className="divide-y divide-border">
            {rows.map((s) => (
              <li key={s.id} className="px-3 py-2 hover:bg-secondary/20 transition-colors">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
                  <SeverityDot severity={s.severity} />
                  <span>{formatDateTime(s.time)}</span>
                  <span>{s.host}</span>
                  <span className="truncate">{s.appname}</span>
                </div>
                <div className="text-xs font-mono mt-1 text-foreground/90 break-all">{s.message}</div>
              </li>
            ))}
            {rows.length === 0 && <li className="px-4 py-12 text-center text-sm text-muted-foreground">No log entries match the current filters.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Facet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
