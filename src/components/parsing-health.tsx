import { useMemo } from "react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CheckCircle2, XCircle, Clock, FileWarning } from "lucide-react";

import { useParseHealth } from "@/lib/live";
import { formatTime } from "@/lib/format";
import { DemoBadge } from "@/components/demo-badge";

type StatProps = {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  tone: "ok" | "warn" | "bad";
};

function Stat({ label, value, icon: Icon, tone }: StatProps) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-500"
      : tone === "warn"
        ? "text-amber-500"
        : value > 0
          ? "text-rose-500"
          : "text-muted-foreground";
  return (
    <div className="rounded-md border border-border bg-background/50 px-3 py-2 flex items-center gap-3">
      <Icon className={`h-4 w-4 ${toneClass}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="text-base font-medium tabular-nums">{value.toLocaleString()}</div>
      </div>
    </div>
  );
}

export function ParsingHealth({ windowMin = 60, paused = false }: { windowMin?: number; paused?: boolean }) {
  const { data, isLive } = useParseHealth(windowMin, { paused });

  const chartData = useMemo(
    () =>
      data.buckets.map((b) => ({
        t: b.t,
        accepted: b.accepted,
        rejected: b.rejected,
        tzSkewed: b.tzSkewed,
        cefFailures: b.cefFailures,
      })),
    [data.buckets],
  );

  // Anchor the X-axis to the requested window so the chart always spans the
  // full `windowMin` even when only a few recent buckets have non-zero values.
  // Without this the category-scale axis collapses to the buckets that
  // actually contain data and the widget looks like it only covers a few
  // minutes.
  const { xDomain, xTicks } = useMemo(() => {
    const bucketMs = 60_000;
    const now = Date.now();
    const end = Math.floor(now / bucketMs) * bucketMs;
    const start = end - (windowMin - 1) * bucketMs;
    const step = Math.max(1, Math.round(windowMin / 6)) * bucketMs;
    const ticks: number[] = [];
    for (let t = start; t <= end; t += step) ticks.push(t);
    if (ticks[ticks.length - 1] !== end) ticks.push(end);
    return { xDomain: [start, end + bucketMs] as [number, number], xTicks: ticks };
  }, [windowMin, data.buckets]);

  const w = data.windowTotals;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between px-4 pt-4">
        <div>
          <h2 className="text-sm font-medium">Parsing health</h2>
          <p className="text-xs text-muted-foreground">
            Syslog ingestion — last {windowMin} minutes
          </p>
        </div>
        <DemoBadge isLive={isLive} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-4 pt-3">
        <Stat label="Accepted" value={w.accepted} icon={CheckCircle2} tone="ok" />
        <Stat label="Rejected" value={w.rejected} icon={XCircle} tone="bad" />
        <Stat label="TZ skewed" value={w.tzSkewed} icon={Clock} tone="warn" />
        <Stat label="CEF failures" value={w.cefFailures} icon={FileWarning} tone="bad" />
      </div>

      <div className="h-44 p-2 pt-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={xDomain}
              ticks={xTicks}
              tickFormatter={(t) => formatTime(t as number)}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
              stroke="var(--color-border)"
              minTickGap={24}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
              stroke="var(--color-border)"
              width={36}
            />
            <Tooltip
              contentStyle={{
                background: "var(--color-popover)",
                border: "1px solid var(--color-border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(v) => formatTime(v as number)}
            />
            <Bar dataKey="accepted" stackId="a" fill="hsl(160 70% 45%)" name="Accepted" maxBarSize={8} />
            <Bar dataKey="tzSkewed" stackId="a" fill="hsl(38 90% 55%)" name="TZ skewed" maxBarSize={8} />
            <Bar dataKey="cefFailures" stackId="a" fill="hsl(290 60% 60%)" name="CEF failures" maxBarSize={8} />
            <Bar dataKey="rejected" stackId="a" fill="hsl(0 75% 60%)" name="Rejected" maxBarSize={8} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {data.totals.accepted + data.totals.rejected > 0 && (
        <div className="px-4 pb-3 text-[11px] text-muted-foreground">
          Lifetime: {data.totals.accepted.toLocaleString()} accepted ·{" "}
          {data.totals.rejected.toLocaleString()} rejected ·{" "}
          {data.totals.tzSkewed.toLocaleString()} tz-skewed ·{" "}
          {data.totals.cefFailures.toLocaleString()} CEF failures
        </div>
      )}
    </div>
  );
}
