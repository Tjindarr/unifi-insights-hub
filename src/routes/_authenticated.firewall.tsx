import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronRight, Download, Search } from "lucide-react";

import { PageHeader, SeverityDot } from "@/components/app-shell";
import { DemoBadge } from "@/components/demo-badge";
import { Input } from "@/components/ui/input";
import { useFirewall, useFirewallByMinute } from "@/lib/live";
import { deauthReasonMap, geoLookup } from "@/lib/mock-extra";
import { describeFirewallEvent, shortEventLabel } from "@/lib/firewall-format";
import { formatTime, relativeTime } from "@/lib/format";
import { exportNdjson } from "@/lib/export";
import { cn } from "@/lib/utils";


export const Route = createFileRoute("/_authenticated/firewall")({
  head: () => ({ meta: [{ title: "Firewall — UniFi Dashboard" }] }),
  component: FirewallPage,
});

type View = "list" | "rule" | "mac" | "src";

function FirewallPage() {
  const { data: firewallEvents, isLive } = useFirewall();
  const { data: firewallByMinute } = useFirewallByMinute();
  const [q, setQ] = useState("");
  const [action, setAction] = useState<"all" | "failure" | "success">("all");
  const [view, setView] = useState<View>("list");
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    return firewallEvents.filter((e) =>
      (action === "all" || e.action === action) &&
      (!ql || e.rule.toLowerCase().includes(ql) || e.clientMac?.toLowerCase().includes(ql) || e.clientName?.toLowerCase().includes(ql) || e.vap?.toLowerCase().includes(ql) || e.srcIp?.includes(ql) || e.dstIp?.includes(ql)),
    );
  }, [q, action, firewallEvents]);


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
  };

  return (
    <div>
      <PageHeader
        title="Firewall"
        description={`${rows.length} events · ${stats.failures} failures · ${stats.uniqueClients} clients`}
        actions={
          <div className="flex items-center gap-2">
            <DemoBadge isLive={isLive} />

            <button onClick={() => exportNdjson("firewall", rows)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-secondary/60">
              <Download className="h-3.5 w-3.5" />NDJSON
            </button>
            <div className="flex rounded-md border border-border overflow-hidden text-xs">
              {(["list", "rule", "mac", "src"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)} className={cn("px-2.5 py-1.5 capitalize", view === v ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60")}>
                  {v === "list" ? "List" : `By ${v}`}
                </button>
              ))}
            </div>
            <div className="flex rounded-md border border-border overflow-hidden text-xs">
              {(["all", "failure", "success"] as const).map((f) => (
                <button key={f} onClick={() => setAction(f)} className={cn("px-2.5 py-1.5 capitalize", action === f ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60")}>{f}</button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="rule, MAC, IP, VAP…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-7 h-8 w-72" />
            </div>
          </div>
        }
      />

      <div className="p-6 space-y-4">
        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 pt-3"><h2 className="text-xs uppercase tracking-wider text-muted-foreground">Events / minute</h2></div>
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

        {view !== "list" ? (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-muted-foreground bg-secondary/40">
                <tr>
                  <th className="text-left px-3 py-2">{view === "rule" ? "Rule" : view === "mac" ? "Client MAC" : "Source IP"}</th>
                  <th className="text-right px-3 py-2">Events</th>
                  <th className="text-right px-3 py-2">Failures</th>
                  <th className="text-right px-3 py-2">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {grouped.map((g) => {
                  const geo = view === "src" ? geoLookup(g.key) : null;
                  return (
                    <tr key={g.key} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs">
                        {g.key} {geo && <span className="ml-2 text-muted-foreground">{geo.flag} {geo.city}</span>}
                      </td>
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
                      <div className="col-span-4 text-xs text-foreground/90 leading-snug">
                        {summary}
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
