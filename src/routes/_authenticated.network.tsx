import { createFileRoute } from "@tanstack/react-router";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PageHeader, StatTile } from "@/components/app-shell";
import { DemoBadge } from "@/components/demo-badge";
import { useAccessPoints, useWan, useWanThroughput } from "@/lib/live";
import { formatBits } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/network")({
  head: () => ({
    meta: [{ title: "Network — UniFi Dashboard" }],
  }),
  component: NetworkPage,
});

function formatUptime(sec: number) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return `${d}d ${h}h`;
}

function NetworkPage() {
  const { data: wan, isLive } = useWan();
  const { data: accessPoints } = useAccessPoints();
  const wanThroughput = useWanThroughput();
  const peakRx = Math.max(...wanThroughput.map((p) => p.rx));
  const peakTx = Math.max(...wanThroughput.map((p) => p.tx));

  return (
    <div>
      <PageHeader title="Network" description="Site health, WAN, and access points" actions={<DemoBadge isLive={isLive} />} />

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile
            label="WAN status"
            value={wan.status.toUpperCase()}
            sub={wan.isp}
            accent={wan.status === "up" ? "primary" : "error"}
          />
          <StatTile
            label="WAN latency"
            value={`${wan.latency} ms`}
            sub={`${wan.loss}% loss`}
          />
          <StatTile label="Uptime" value={formatUptime(wan.uptime)} />
          <StatTile
            label="Gateway"
            value={`${wan.cpu}% CPU`}
            sub={`${wan.memory}% memory`}
          />

        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartCard title="WAN download" data={wanThroughput} dataKey="rx" peak={peakRx} color="rx" />
          <ChartCard title="WAN upload" data={wanThroughput} dataKey="tx" peak={peakTx} color="tx" />
        </div>

        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-medium">Access points</h2>
            <p className="text-xs text-muted-foreground">Channel utilization &amp; client load</p>
          </div>
          <ul className="divide-y divide-border">
            {accessPoints.map((ap) => (
              <li key={ap.id} className="px-4 py-3 grid grid-cols-12 gap-4 items-center text-sm">
                <div className="col-span-3">
                  <div className="font-medium">{ap.name}</div>
                  <div className="text-[11px] text-muted-foreground">{ap.model}</div>
                </div>
                <div className="col-span-1 text-xs">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5",
                      ap.status === "online"
                        ? "text-chart-2"
                        : ap.status === "degraded"
                          ? "text-severity-warn"
                          : "text-severity-error",
                    )}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {ap.status}
                  </span>
                </div>
                <div className="col-span-1 tabular-nums text-xs text-muted-foreground">
                  {ap.clients} clients
                </div>
                <div className="col-span-5 space-y-1.5">
                  <UtilBar label="2.4" value={ap.channelUtil24} />
                  <UtilBar label="5" value={ap.channelUtil5} />
                  <UtilBar label="6" value={ap.channelUtil6} />
                </div>
                <div className="col-span-2 text-right text-xs font-mono">
                  <div className="text-rx">↓ {formatBits(ap.downlink)}</div>
                  <div className="text-tx">↑ {formatBits(ap.uplink)}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function UtilBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-6 text-muted-foreground">{label}</span>
      <div className="flex-1 h-1 rounded-full bg-muted overflow-hidden">
        <div
          className={cn(
            "h-full",
            value > 60 ? "bg-severity-error" : value > 35 ? "bg-severity-warn" : "bg-chart-2",
          )}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-8 text-right tabular-nums text-muted-foreground">{value}%</span>
    </div>
  );
}

function ChartCard({
  title,
  data,
  dataKey,
  peak,
  color,
}: {
  title: string;
  data: { t: string; rx: number; tx: number }[];
  dataKey: "rx" | "tx";
  peak: number;
  color: "rx" | "tx";
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="px-4 pt-4 flex items-end justify-between">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          <p className="text-xs text-muted-foreground">Peak {formatBits(peak)}</p>
        </div>
      </div>
      <div className="h-48 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="t" hide />
            <YAxis
              tickFormatter={(v) => formatBits(v).replace(" ", "")}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 10 }}
              stroke="var(--color-border)"
              width={60}
            />
            <Tooltip
              contentStyle={{
                background: "var(--color-popover)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(v: number) => [formatBits(v), title]}
              labelFormatter={(v) => new Date(v).toLocaleTimeString()}
            />
            <Bar dataKey={dataKey} fill={`var(--color-${color})`} radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
