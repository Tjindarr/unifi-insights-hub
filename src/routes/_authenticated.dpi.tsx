import { createFileRoute } from "@tanstack/react-router";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { PageHeader } from "@/components/app-shell";
import { dpiTopApps, dpiByCategory } from "@/lib/mock-extra";
import { formatBytes } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/dpi")({
  head: () => ({ meta: [{ title: "DPI / Apps — UniFi Dashboard" }] }),
  component: DpiPage,
});

function DpiPage() {
  const max = dpiTopApps[0].rx + dpiTopApps[0].tx;
  return (
    <div>
      <PageHeader title="DPI / Apps" description="Top applications and categories by traffic" />
      <div className="p-6 space-y-6">
        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-medium">Traffic by category</h2>
          </div>
          <div className="h-64 p-3">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dpiByCategory} layout="vertical" margin={{ left: 32, right: 16 }}>
                <XAxis type="number" tickFormatter={(v) => formatBytes(v, 0)} tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} stroke="var(--color-border)" />
                <YAxis type="category" dataKey="category" tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }} stroke="var(--color-border)" width={100} />
                <Tooltip contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 12 }} formatter={(v: number) => formatBytes(v)} />
                <Bar dataKey="total" fill="var(--color-primary)" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-medium">Top applications</h2>
            <p className="text-xs text-muted-foreground">Last 24 hours</p>
          </div>
          <ul className="divide-y divide-border">
            {dpiTopApps.map((a) => {
              const total = a.rx + a.tx;
              const pct = (total / max) * 100;
              return (
                <li key={a.name} className="px-4 py-2.5 grid grid-cols-12 gap-3 items-center text-sm">
                  <div className="col-span-3">
                    <div className="font-medium">{a.name}</div>
                    <div className="text-[10px] text-muted-foreground">{a.category}</div>
                  </div>
                  <div className="col-span-6">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="col-span-2 text-right font-mono text-xs">
                    <div className="text-rx">↓ {formatBytes(a.rx)}</div>
                    <div className="text-tx">↑ {formatBytes(a.tx)}</div>
                  </div>
                  <div className="col-span-1 text-right font-mono text-xs">{formatBytes(total)}</div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
