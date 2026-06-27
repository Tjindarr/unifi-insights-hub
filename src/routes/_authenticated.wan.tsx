import { createFileRoute } from "@tanstack/react-router";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Globe, Network as NetIcon } from "lucide-react";

import { PageHeader, StatTile } from "@/components/app-shell";
import { wan } from "@/lib/mock-extra";
import { formatBits, formatTime } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/wan")({
  head: () => ({ meta: [{ title: "WAN — UniFi Dashboard" }] }),
  component: WanPage,
});

function WanPage() {
  const avgLat = (wan.latencyHistory.reduce((a, p) => a + p.latency, 0) / wan.latencyHistory.length).toFixed(1);
  const maxLat = Math.max(...wan.latencyHistory.map((p) => p.latency)).toFixed(1);
  const totalLoss = (wan.latencyHistory.reduce((a, p) => a + p.loss, 0) / wan.latencyHistory.length).toFixed(2);

  return (
    <div>
      <PageHeader title="WAN" description="ISP link, latency, and speed test history" />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="ISP" value={wan.isp} sub={wan.uplink} accent="primary" />
          <StatTile label="Avg latency" value={`${avgLat} ms`} sub={`max ${maxLat} ms`} />
          <StatTile label="Avg loss" value={`${totalLoss}%`} />
          <StatTile label="DDNS" value={wan.ddns} sub="resolved" />
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <Card label="IPv4">
            <div className="flex items-center gap-2"><Globe className="h-4 w-4 text-primary" /><span className="font-mono">{wan.ipv4}</span></div>
          </Card>
          <Card label="IPv6">
            <div className="flex items-center gap-2"><NetIcon className="h-4 w-4 text-primary" /><span className="font-mono">{wan.ipv6}</span></div>
          </Card>
        </div>

        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 pt-4">
            <h2 className="text-sm font-medium">Latency · jitter · loss</h2>
            <p className="text-xs text-muted-foreground">Last 60 minutes</p>
          </div>
          <div className="h-56 p-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={wan.latencyHistory}>
                <defs>
                  <linearGradient id="lat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-rx)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--color-rx)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="t" tickFormatter={(t) => formatTime(t)} tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} minTickGap={40} stroke="var(--color-border)" />
                <YAxis tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} stroke="var(--color-border)" width={40} unit="ms" />
                <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 12 }} labelFormatter={(t) => formatTime(t)} />
                <Area type="monotone" dataKey="latency" stroke="var(--color-rx)" strokeWidth={1.5} fill="url(#lat)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-medium">Speed test history</h2>
            <p className="text-xs text-muted-foreground">Daily auto-test</p>
          </div>
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground bg-secondary/40">
              <tr><th className="text-left px-3 py-2">When</th><th className="text-right px-3 py-2">Download</th><th className="text-right px-3 py-2">Upload</th><th className="text-right px-3 py-2">Ping</th></tr>
            </thead>
            <tbody>
              {wan.speedTests.map((t) => (
                <tr key={t.t} className="border-t border-border">
                  <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(t.t).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-right font-mono text-rx">{formatBits(t.down)}</td>
                  <td className="px-3 py-2 text-right font-mono text-tx">{formatBits(t.up)}</td>
                  <td className="px-3 py-2 text-right font-mono">{t.ping.toFixed(1)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-2 text-sm">{children}</div>
    </div>
  );
}
