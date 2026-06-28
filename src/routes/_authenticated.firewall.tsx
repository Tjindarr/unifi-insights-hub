import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronRight, Pause, Play, Search, ShieldAlert } from "lucide-react";

import { PageHeader, SeverityDot } from "@/components/app-shell";
import { DemoBadge } from "@/components/demo-badge";
import { Input } from "@/components/ui/input";
import { useFirewall, useFirewallByMinute } from "@/lib/live";
import { TIME_RANGES, useUI, type TimeRangeKey } from "@/lib/ui-store";
import { deauthReasonMap } from "@/lib/mock-extra";
import {
  describeFirewallEvent,
  isBlockedAction,
  isFirewallRuleEvent,
  shortEventLabel,
} from "@/lib/firewall-format";
import { ccToFlag, externalIp, threatTier, useIpInfo, type IpInfo } from "@/lib/ip-utils";
import { formatTime, relativeTime } from "@/lib/format";
import { exportNdjson } from "@/lib/export";
import { cn } from "@/lib/utils";



export const Route = createFileRoute("/_authenticated/firewall")({
  head: () => ({ meta: [{ title: "Firewall — UniFi Dashboard" }] }),
  component: FirewallPage,
});

type ActionFilter = "all" | "allow" | "block" | "drop" | "failure" | "success";
type ThreatFilter = "all" | "high" | "medium" | "low" | "clean" | "unknown";

const TIER_STYLE: Record<ReturnType<typeof threatTier>, string> = {
  high: "bg-severity-error/20 text-severity-error border-severity-error/30",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  low: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  clean: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  unknown: "bg-secondary/40 text-muted-foreground border-border",
};

function ThreatChip({ info }: { info?: IpInfo }) {
  const tier = threatTier(info?.abuseScore);
  if (tier === "unknown") {
    return <span className="text-[10px] text-muted-foreground">no threat data</span>;
  }
  const label = tier === "clean" ? "clean" : `${tier} · ${info?.abuseScore}%`;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] uppercase tracking-wider font-medium",
        TIER_STYLE[tier],
      )}
      title={
        info?.abuseReports != null
          ? `AbuseIPDB: ${info.abuseScore}% confidence · ${info.abuseReports} reports`
          : "AbuseIPDB threat score"
      }
    >
      <ShieldAlert className="h-3 w-3" />
      {label}
    </span>
  );
}

function GeoCell({ ip, info }: { ip: string; info?: IpInfo }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      <span className="text-base leading-none">{ccToFlag(info?.cc)}</span>
      <span className="font-mono">{ip}</span>
      {info?.city && info?.country && (
        <span className="text-muted-foreground">· {info.city}, {info.country}</span>
      )}
      {!info?.city && info?.country && (
        <span className="text-muted-foreground">· {info.country}</span>
      )}
    </span>
  );
}


const LIMITS = [500, 1000, 2000, 5000, 10000] as const;
type LimitOpt = typeof LIMITS[number];

const CUSTOM_RANGE_KEY = "firewall-custom-range";

function rangeToMinutes(r: TimeRangeKey): number {
  return TIME_RANGES.find((x) => x.key === r)?.minutes ?? 60;
}

function formatWindow(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d ${remH}h` : `${d}d`;
}

function FirewallPage() {
  const [limit, setLimit] = useState<LimitOpt>(1000);
  const [paused, setPaused] = useState(false);
  const { range, setRange } = useUI();

  // Custom From / To timespan — when both set and From < To, overrides the
  // global time range and bounds the firewall query exactly to that window.
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [rangeError, setRangeError] = useState<string | null>(null);

  // Restore last custom range from localStorage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem(CUSTOM_RANGE_KEY);
      if (raw) {
        const { from, to } = JSON.parse(raw) as { from?: string; to?: string };
        if (from) setCustomFrom(from);
        if (to) setCustomTo(to);
      }
    } catch { /* ignore */ }
  }, []);

  const customActive = useMemo(() => {
    if (!customFrom || !customTo) return false;
    const f = new Date(customFrom).getTime();
    const t = new Date(customTo).getTime();
    return Number.isFinite(f) && Number.isFinite(t) && f < t;
  }, [customFrom, customTo]);

  // Reset row limit when the window changes so we don't paginate inside stale data.
  useEffect(() => { setLimit(1000); }, [range, customFrom, customTo]);

  const { sinceMs, untilMs, windowMs } = useMemo(() => {
    if (customActive) {
      const f = new Date(customFrom).getTime();
      const t = new Date(customTo).getTime();
      return { sinceMs: f, untilMs: t, windowMs: t - f };
    }
    const w = rangeToMinutes(range) * 60_000;
    // Snap to a 30s grid so the query key is stable across renders.
    const snapped = Math.floor((Date.now() - w) / 30_000) * 30_000;
    return { sinceMs: snapped, untilMs: undefined as number | undefined, windowMs: w };
  }, [customActive, customFrom, customTo, range, Math.floor(Date.now() / 30_000)]);

  function applyCustom() {
    if (!customFrom || !customTo) { setRangeError("Pick both From and To."); return; }
    const f = new Date(customFrom).getTime();
    const t = new Date(customTo).getTime();
    if (!Number.isFinite(f) || !Number.isFinite(t)) { setRangeError("Invalid date."); return; }
    if (f >= t) { setRangeError("End must be after start."); return; }
    setRangeError(null);
    if (typeof window !== "undefined") {
      localStorage.setItem(CUSTOM_RANGE_KEY, JSON.stringify({ from: customFrom, to: customTo }));
    }
  }

  function clearCustom() {
    setCustomFrom("");
    setCustomTo("");
    setRangeError(null);
    if (typeof window !== "undefined") localStorage.removeItem(CUSTOM_RANGE_KEY);
  }

  const { data: allEvents, isLive } = useFirewall({
    kind: "firewall",
    limit,
    paused,
    since: sinceMs,
    until: untilMs,
  });

  const { data: firewallByMinute, label: bucketLabel } = useFirewallByMinute(range, {
    paused,
    sinceMs: customActive ? sinceMs : undefined,
    untilMs: customActive ? untilMs : undefined,
  });

  const [q, setQ] = useState("");
  const [srcQ, setSrcQ] = useState("");
  const [dstQ, setDstQ] = useState("");
  const [portQ, setPortQ] = useState("");
  const [proto, setProto] = useState<"all" | "tcp" | "udp" | "icmp">("all");
  const [action, setAction] = useState<ActionFilter>("all");
  const [threat, setThreat] = useState<ThreatFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Pre-filter: this page only deals with iptables / firewall-rule hits.
  // Wi-Fi / STA / device events live on the Internal events page.
  const firewallEvents = useMemo(() => allEvents.filter(isFirewallRuleEvent), [allEvents]);

  const tagged = useMemo(
    () => firewallEvents.map((e) => ({ event: e, ext: externalIp(e) })),
    [firewallEvents],
  );

  // First pass — everything except threat (which needs IP info derived from these rows).
  const prelim = useMemo(() => {
    const ql = q.toLowerCase();
    const sq = srcQ.toLowerCase();
    const dq = dstQ.toLowerCase();
    const pq = portQ.trim();
    const actionMatch = (a: string) => {
      if (action === "all") return true;
      if (action === "block") return a === "drop" || a === "deny" || a === "block";
      return a === action;
    };
    return tagged.filter(({ event: e, ext }) => {
      if (!actionMatch(e.action)) return false;
      if (proto !== "all" && (e.proto ?? "").toLowerCase() !== proto) return false;
      if (sq && !(e.srcIp ?? "").toLowerCase().includes(sq)) return false;
      if (dq && !(e.dstIp ?? "").toLowerCase().includes(dq)) return false;
      if (pq && String(e.srcPort ?? "") !== pq && String(e.dstPort ?? "") !== pq) return false;
      if (!ql) return true;
      return (
        e.rule.toLowerCase().includes(ql) ||
        e.clientMac?.toLowerCase().includes(ql) ||
        e.clientName?.toLowerCase().includes(ql) ||
        e.vap?.toLowerCase().includes(ql) ||
        e.srcIp?.includes(ql) ||
        e.dstIp?.includes(ql) ||
        ext?.includes(ql)
      );
    });
  }, [tagged, q, srcQ, dstQ, portQ, proto, action]);


  // Unique external IPs in the prelim set — used to batch GeoIP/threat lookups.
  const externalIps = useMemo(() => {
    const s = new Set<string>();
    for (const { ext } of prelim) if (ext) s.add(ext);
    return [...s];
  }, [prelim]);

  const { data: ipInfo } = useIpInfo(externalIps);

  // Second pass — applies threat-tier filter using the resolved IP info.
  const rows = useMemo(() => {
    if (threat === "all") return prelim.map((p) => p.event);
    return prelim
      .filter(({ ext }) => threatTier(ext ? ipInfo?.[ext]?.abuseScore : undefined) === threat)
      .map((p) => p.event);
  }, [prelim, ipInfo, threat]);



  const stats = {
    total: firewallEvents.length,
    failures: firewallEvents.filter((e) => isBlockedAction(e.action)).length,
    uniqueClients: new Set(firewallEvents.map((e) => e.clientMac)).size,
    external: tagged.filter((t) => t.ext).length,
  };

  const windowTotal = useMemo(
    () => firewallByMinute.reduce((sum, r) => sum + (Number(r.success) || 0) + (Number(r.failure) || 0), 0),
    [firewallByMinute],
  );

  return (
    <div>
      <PageHeader
        title="Firewall"
        description={`${rows.length} events · ${stats.failures} failures · ${stats.uniqueClients} clients · ${stats.external} internet · window ${customActive ? "custom" : range} (${formatWindow(windowMs)})`}
        actions={
          <div className="flex items-center gap-2 flex-wrap justify-end max-w-[760px]">
            <DemoBadge isLive={isLive} />
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value) as LimitOpt)}
              className="h-8 rounded-md border border-border bg-card px-2 text-xs"
              title="Maximum events to fetch"
            >
              {LIMITS.map((n) => <option key={n} value={n}>Last {n.toLocaleString()}</option>)}
            </select>

            <button
              onClick={() => setPaused((v) => !v)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs transition-colors",
                paused
                  ? "border-amber-500/40 bg-amber-500/15 text-amber-400"
                  : "border-border text-muted-foreground hover:bg-secondary/60",
              )}
              title={paused ? "Auto-refresh is paused — click to resume" : "Pause auto-refresh while you search"}
            >
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              {paused ? "Paused" : "Live"}
            </button>
            <div className="flex rounded-md border border-border overflow-hidden text-xs">
              {(["all", "allow", "block", "drop", "failure", "success"] as const).map((f) => (
                <button key={f} onClick={() => setAction(f)} className={cn("px-2.5 py-1.5 capitalize", action === f ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60")}>{f}</button>
              ))}
            </div>
            <select
              value={threat}
              onChange={(e) => setThreat(e.target.value as ThreatFilter)}
              className="h-8 rounded-md border border-border bg-card px-2 text-xs"
              title="Filter by AbuseIPDB threat tier"
            >
              <option value="all">Threat: any</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="clean">Clean</option>
              <option value="unknown">Unknown</option>
            </select>
            <select
              value={proto}
              onChange={(e) => setProto(e.target.value as typeof proto)}
              className="h-8 rounded-md border border-border bg-card px-2 text-xs"
            >
              <option value="all">Proto: any</option>
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
              <option value="icmp">ICMP</option>
            </select>
            <Input placeholder="Source IP" value={srcQ} onChange={(e) => setSrcQ(e.target.value)} className="h-8 w-32" />
            <Input placeholder="Dest IP" value={dstQ} onChange={(e) => setDstQ(e.target.value)} className="h-8 w-32" />
            <Input placeholder="Port" value={portQ} onChange={(e) => setPortQ(e.target.value)} className="h-8 w-20" />
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="rule, MAC, IP, VAP…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-7 h-8 w-56" />
            </div>
          </div>
        }
      />

      <div className="px-6 pt-4">
        <div className="rounded-lg border border-border bg-card px-4 py-3 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Quick range</label>
            <div className="flex rounded-md border border-border overflow-hidden text-xs">
              {TIME_RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => { setRange(r.key); clearCustom(); }}
                  className={cn(
                    "px-2.5 py-1.5",
                    !customActive && range === r.key
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-secondary/60",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">From</label>
            <Input
              type="datetime-local"
              value={customFrom}
              onChange={(e) => { setCustomFrom(e.target.value); setRangeError(null); }}
              className="h-8 w-[200px] font-mono text-xs"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">To</label>
            <Input
              type="datetime-local"
              value={customTo}
              onChange={(e) => { setCustomTo(e.target.value); setRangeError(null); }}
              className="h-8 w-[200px] font-mono text-xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={applyCustom}
              disabled={!customFrom || !customTo}
              className="h-8 px-3 rounded-md border border-border bg-secondary text-xs text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50"
            >
              Apply
            </button>
            {customActive && (
              <button
                onClick={clearCustom}
                className="h-8 px-3 rounded-md border border-border text-xs text-muted-foreground hover:bg-secondary/60"
              >
                Clear
              </button>
            )}
          </div>

          <div className="ml-auto text-[11px] text-muted-foreground tabular-nums">
            {customActive ? (
              <>
                {new Date(sinceMs).toLocaleString(undefined, { hour12: false })}
                {" → "}
                {untilMs != null ? new Date(untilMs).toLocaleString(undefined, { hour12: false }) : "now"}
                {" · "}
                {formatWindow(windowMs)}
              </>
            ) : (
              <>Last {formatWindow(windowMs)} · live up to now</>
            )}
          </div>

          {rangeError && (
            <div className="w-full text-[11px] text-severity-error">{rangeError}</div>
          )}
        </div>
      </div>

      <div className="p-6 space-y-4">

        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 pt-3 flex items-center justify-between">
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground">Events {bucketLabel}</h2>
            <span className="text-[10px] text-muted-foreground tabular-nums">{windowTotal} in selected window</span>
          </div>
          <div className="h-32 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={firewallByMinute} stackOffset="sign">
                <XAxis dataKey="t" tickFormatter={(t) => formatTime(t)} tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }} stroke="var(--color-border)" minTickGap={50} />
                <YAxis tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }} stroke="var(--color-border)" width={30} />
                <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 11 }} labelFormatter={(t) => formatTime(t)} />
                <Bar dataKey="success" stackId="a" fill="var(--color-chart-2)" />
                <Bar dataKey="failure" stackId="a" fill="var(--color-severity-error)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>


        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <ul className="divide-y divide-border">
              {rows.map((e) => {
                const open = expanded === e.id;
                const summary = describeFirewallEvent(e);
                const chip = shortEventLabel(e);
                const ext = externalIp(e);
                const info = ext ? ipInfo?.[ext] : undefined;
                void deauthReasonMap;
                return (
                  <li key={e.id} className={cn("text-sm border-l-2", isBlockedAction(e.action) ? "border-severity-error bg-severity-error/[0.03]" : "border-transparent")}>
                    <button onClick={() => setExpanded(open ? null : e.id)} className="w-full px-4 py-3 grid grid-cols-12 gap-3 items-start text-left hover:bg-secondary/30 transition-colors">
                      <div className="col-span-2 flex items-center gap-2 text-xs font-mono">
                        <SeverityDot severity={e.severity} />
                        <span>{formatTime(e.time)}</span>
                        <span className="text-muted-foreground">{relativeTime(e.time)}</span>
                      </div>
                      <div className="col-span-2">
                        <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium", isBlockedAction(e.action) ? "bg-severity-error/15 text-severity-error" : "bg-chart-2/15 text-chart-2")}>{chip}</span>
                        <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">{e.rule}</div>
                      </div>
                      <div className="col-span-3 min-w-0">
                        <div className="font-medium truncate">{e.clientName ?? <span className="text-muted-foreground">unknown</span>}</div>
                        <div className="text-[11px] text-muted-foreground font-mono truncate">{e.clientMac}</div>
                      </div>
                      <div className="col-span-4 text-xs text-foreground/90 leading-snug space-y-1">
                        <div>{summary}</div>
                        {ext && (
                          <div className="flex flex-wrap items-center gap-2">
                            <GeoCell ip={ext} info={info} />
                            <ThreatChip info={info} />
                          </div>
                        )}
                      </div>
                      <div className="col-span-1 text-right"><ChevronRight className={cn("h-4 w-4 text-muted-foreground transition-transform inline-block", open && "rotate-90")} /></div>
                    </button>
                    {open && (
                      <pre className="px-4 pb-4 -mt-1 text-[11px] font-mono text-muted-foreground bg-background/50 overflow-x-auto">
{JSON.stringify(e.raw, null, 2)}
                      </pre>
                    )}
                  </li>
                );
              })}
              {rows.length === 0 && <li className="px-4 py-12 text-center text-sm text-muted-foreground">No events match the current filters.</li>}
            </ul>
          </div>
      </div>
    </div>
  );
}
