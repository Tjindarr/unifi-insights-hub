import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ArrowDown, ArrowUp, Cable, Gauge, Wifi } from "lucide-react";

import { PageHeader, StatTile } from "@/components/app-shell";
import { DemoBadge } from "@/components/demo-badge";
import { useEvents, useOverview, useWanThroughput } from "@/lib/live";
import { formatBits, formatBytes, formatRate, formatTime, relativeTime } from "@/lib/format";
import { ClientDrawer } from "@/components/client-drawer";
import { ParsingHealth } from "@/components/parsing-health";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Overview — UniFi Dashboard" }] }),
  component: OverviewPage,
});

function OverviewPage() {
  const { data: o, isLive } = useOverview();
  const wanThroughput = useWanThroughput();
  const { data: siteEvents } = useEvents();
  const [focus, setFocus] = useState<string | null>(null);

  return (
    <div>
      <PageHeader title="Overview" description="Live network health and top clients" actions={<DemoBadge isLive={isLive} />} />


      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="Clients" value={o.totalClients} sub={
            <span className="flex items-center gap-3">
              <span className="flex items-center gap-1"><Wifi className="h-3 w-3" />{o.wireless} wireless</span>
              <span className="flex items-center gap-1"><Cable className="h-3 w-3" />{o.wired} wired</span>
            </span>
          } />
          <StatTile label="WAN download" value={formatBits(o.currentRx)} sub={formatRate(o.currentRx)} accent="rx" />
          <StatTile label="WAN upload" value={formatBits(o.currentTx)} sub={formatRate(o.currentTx)} accent="tx" />
          <StatTile label="Avg satisfaction" value={`${o.avgSatisfaction}%`} sub={<span className="flex items-center gap-1"><Gauge className="h-3 w-3" />across all clients</span>} />
        </div>

        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between px-4 pt-4">
            <div>
              <h2 className="text-sm font-medium">WAN throughput</h2>
              <p className="text-xs text-muted-foreground">Last 60 minutes</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rx" />RX</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-tx" />TX</span>
            </div>
          </div>
          <div className="h-64 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={wanThroughput} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="rxFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-rx)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--color-rx)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="txFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-tx)" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="var(--color-tx)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="t" tickFormatter={(t) => formatTime(t)} tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} stroke="var(--color-border)" minTickGap={40} />
                <YAxis tickFormatter={(v) => formatBits(v).replace(" ", "")} tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} stroke="var(--color-border)" width={70} />
                <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 8, fontSize: 12 }} labelFormatter={(v) => formatTime(v)} formatter={(v: number, name) => [formatBits(v), name === "rx" ? "RX" : "TX"]} />
                <Area type="monotone" dataKey="rx" stroke="var(--color-rx)" strokeWidth={1.5} fill="url(#rxFill)" />
                <Area type="monotone" dataKey="tx" stroke="var(--color-tx)" strokeWidth={1.5} fill="url(#txFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_320px] gap-6">
          <div className="rounded-lg border border-border bg-card">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium">Top talkers</h2>
                <p className="text-xs text-muted-foreground">By current RX + TX · click for detail</p>
              </div>
            </div>
            <ul className="divide-y divide-border">
              {o.topTalkers.map((c) => {
                const total = c.rxRate + c.txRate;
                const maxTotal = o.topTalkers[0].rxRate + o.topTalkers[0].txRate || 1;
                const pct = (total / maxTotal) * 100;
                return (
                  <li key={c.id}>
                    <button onClick={() => setFocus(c.id)} className="w-full px-4 py-2.5 hover:bg-secondary/30 text-left">
                      <div className="flex items-center justify-between gap-4 text-sm">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium truncate">{c.hostname}</span>
                            <span className="text-[11px] text-muted-foreground font-mono">{c.ip}</span>
                            {c.wired ? <Cable className="h-3 w-3 text-muted-foreground" /> : <Wifi className="h-3 w-3 text-muted-foreground" />}
                          </div>
                          <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-xs tabular-nums whitespace-nowrap">
                          <span className="text-rx flex items-center gap-1"><ArrowDown className="h-3 w-3" />{formatBits(c.rxRate)}</span>
                          <span className="text-tx flex items-center gap-1"><ArrowUp className="h-3 w-3" />{formatBits(c.txRate)}</span>
                          <span className="text-muted-foreground w-20 text-right">{formatBytes(c.rxBytes + c.txBytes)}</span>
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-lg border border-border bg-card">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h2 className="text-sm font-medium">Recent events</h2>
              <Link to="/events" className="text-[11px] text-muted-foreground hover:text-foreground">View all →</Link>
            </div>
            <ul className="divide-y divide-border">
              {siteEvents.slice(0, 6).map((e) => (
                <li key={e.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("text-xs font-medium truncate",
                      e.severity === "error" ? "text-severity-error" : e.severity === "warn" ? "text-severity-warn" : "",
                    )}>{e.title}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">{relativeTime(e.time)}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">{e.detail}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <ClientDrawer id={focus} onClose={() => setFocus(null)} />
    </div>
  );
}
