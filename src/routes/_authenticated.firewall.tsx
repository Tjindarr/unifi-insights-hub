import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronRight, Download, Globe, Pause, Play, Search, ShieldAlert } from "lucide-react";

import { PageHeader, SeverityDot } from "@/components/app-shell";
import { DemoBadge } from "@/components/demo-badge";
import { Input } from "@/components/ui/input";
import { useFirewall, useFirewallByMinute } from "@/lib/live";
import { useUI } from "@/lib/ui-store";
import { deauthReasonMap, geoLookup } from "@/lib/mock-extra";
import {
  describeFirewallEvent,
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

type View = "list" | "rule" | "mac" | "src";

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

type ActionFilter = "all" | "allow" | "block" | "drop" | "failure" | "success";
type ThreatFilter = "all" | "high" | "medium" | "low" | "clean" | "unknown";

const LIMITS = [500, 1000, 2000, 5000, 10000] as const;
type LimitOpt = typeof LIMITS[number];

function FirewallPage() {
  const [limit, setLimit] = useState<LimitOpt>(1000);
  const [paused, setPaused] = useState(false);
  const { data: allEvents, isLive } = useFirewall({ kind: "firewall", limit, paused });

  const { range } = useUI();
  const { data: firewallByMinute, label: bucketLabel } = useFirewallByMinute(range);
  const [q, setQ] = useState("");
  const [srcQ, setSrcQ] = useState("");
  const [dstQ, setDstQ] = useState("");
  const [portQ, setPortQ] = useState("");
  const [proto, setProto] = useState<"all" | "tcp" | "udp" | "icmp">("all");
  const [action, setAction] = useState<ActionFilter>("all");
  const [threat, setThreat] = useState<ThreatFilter>("all");
  const [view, setView] = useState<View>("list");
  const [internetOnly, setInternetOnly] = useState(false);
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
      if (internetOnly && !ext) return false;
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
  }, [tagged, q, srcQ, dstQ, portQ, proto, action, internetOnly]);


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



  const grouped = useMemo(() => {
    if (view === "list") return [];
    const key = view === "rule" ? "rule" : view === "mac" ? "clientMac" : "srcIp";
    const map = new Map<string, { key: string; name?: string; count: number; failures: number; last: string }>();
    for (const e of rows) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const k = ((e as any)[key] as string) ?? "—";
      const g = map.get(k) ?? { key: k, name: view === "mac" ? e.clientName : undefined, count: 0, failures: 0, last: e.time };
      if (view === "mac" && !g.name && e.clientName) g.name = e.clientName;
      g.count++;
      if (e.action === "failure") g.failures++;
      if (e.time > g.last) g.last = e.time;
      map.set(k, g);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [view, rows]);

  const stats = {
    total: firewallEvents.length,
    failures: firewallEvents.filter((e) => e.action === "failure").length,
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
        description={`${rows.length} events · ${stats.failures} failures · ${stats.uniqueClients} clients · ${stats.external} internet`}
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
            <button onClick={() => exportNdjson("firewall", rows)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-secondary/60">
              <Download className="h-3.5 w-3.5" />NDJSON
            </button>

            <button
              onClick={() => setInternetOnly((v) => !v)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs transition-colors",
                internetOnly
                  ? "border-chart-2/40 bg-chart-2/15 text-chart-2"
                  : "border-border text-muted-foreground hover:bg-secondary/60",
              )}
              title="Show only events that touch a public IP"
            >
              <Globe className="h-3.5 w-3.5" />
              Internet only
            </button>
            <div className="flex rounded-md border border-border overflow-hidden text-xs">
              {(["list", "rule", "mac", "src"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className={cn("px-2.5 py-1.5 capitalize", view === v ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60")}>
                  {v === "list" ? "List" : `By ${v}`}
                </button>
              ))}
            </div>
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

        {internetOnly && rows.length === 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
            <div className="font-medium text-amber-100">No internet traffic in syslog</div>
            <p className="mt-1 text-amber-200/80 leading-relaxed">
              The UDR only forwards firewall events for rules with <strong>Logging</strong> enabled.
              In the UniFi Network app, open{" "}
              <strong>Settings → Security → Traffic &amp; Firewall Rules → Internet</strong>,
              edit a <strong>Block</strong> rule (e.g. the default "Block External → Internal"),
              and toggle Logging on. Events should start appearing within ~10 seconds of the
              next matching connection. See <em>Settings → Firewall logging on the UDR</em> for
              the full guide.
            </p>
          </div>
        )}

        {view !== "list" ? (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted-foreground bg-secondary/40">
                <tr>
                  <th className="text-left px-3 py-2">{view === "rule" ? "Rule" : view === "mac" ? "Client MAC" : "Source IP"}</th>
                  {view === "src" && <th className="text-left px-3 py-2">Location</th>}
                  {view === "src" && <th className="text-left px-3 py-2">Threat</th>}
                  <th className="text-right px-3 py-2">Events</th>
                  <th className="text-right px-3 py-2">Failures</th>
                  <th className="text-right px-3 py-2">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g) => {
                  const info = view === "src" ? ipInfo?.[g.key] : undefined;
                  const fallbackGeo = view === "src" && !info ? geoLookup(g.key) : null;
                  return (
                    <tr key={g.key} className="border-t border-border">
                      <td className="px-3 py-2 text-xs">
                        {view === "mac" && g.name && <span className="font-medium mr-2">{g.name}</span>}
                        <span className="font-mono text-muted-foreground">{g.key}</span>
                      </td>
                      {view === "src" && (
                        <td className="px-3 py-2 text-xs">
                          {info ? (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="text-base leading-none">{ccToFlag(info.cc)}</span>
                              <span>{info.city ? `${info.city}, ` : ""}{info.country ?? "—"}</span>
                              {info.isp && <span className="text-muted-foreground">· {info.isp}</span>}
                            </span>
                          ) : fallbackGeo ? (
                            <span className="text-muted-foreground">{fallbackGeo.flag} {fallbackGeo.city}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                      {view === "src" && (
                        <td className="px-3 py-2"><ThreatChip info={info} /></td>
                      )}
                      <td className="px-3 py-2 text-right tabular-nums">{g.count}</td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", g.failures > 0 && "text-severity-error")}>{g.failures}</td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground">{relativeTime(g.last)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
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
                  <li key={e.id} className="text-sm">
                    <button onClick={() => setExpanded(open ? null : e.id)} className="w-full px-4 py-3 grid grid-cols-12 gap-3 items-start text-left hover:bg-secondary/30 transition-colors">
                      <div className="col-span-2 flex items-center gap-2 text-xs font-mono">
                        <SeverityDot severity={e.severity} />
                        <span>{formatTime(e.time)}</span>
                        <span className="text-muted-foreground">{relativeTime(e.time)}</span>
                      </div>
                      <div className="col-span-2">
                        <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium", e.action === "failure" ? "bg-severity-error/15 text-severity-error" : "bg-chart-2/15 text-chart-2")}>{chip}</span>
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
        )}
      </div>
    </div>
  );
}
