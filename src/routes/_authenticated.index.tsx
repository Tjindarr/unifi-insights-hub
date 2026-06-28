import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Legend,
} from "recharts";
import {
  Activity, AlertTriangle, Cable, Flame, Radio, ShieldAlert, Wifi,
} from "lucide-react";

import { PageHeader, StatTile } from "@/components/app-shell";
import { DemoBadge } from "@/components/demo-badge";
import {
  bucketSpecForRange, useFirewall, useFirewallByMinute, useInternalByBucket, useOverview,
} from "@/lib/live";
import { useUI } from "@/lib/ui-store";
import {
  internalCategory, isFirewallRuleEvent, isInternalEvent, shortEventLabel,
} from "@/lib/firewall-format";
import { externalIp, threatTier, useIpInfo } from "@/lib/ip-utils";
import { formatTime, relativeTime } from "@/lib/format";
import { ParsingHealth } from "@/components/parsing-health";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Overview — UniFi Syslog" }] }),
  component: OverviewPage,
});

// Palette
const C = {
  allow:   "var(--color-chart-2)",
  block:   "var(--color-severity-error)",
  drop:    "var(--color-severity-warn)",
  failure: "var(--color-severity-error)",
  other:   "var(--color-chart-4)",
  primary: "var(--color-primary)",
  muted:   "var(--color-muted-foreground)",
};

const ACTION_COLOR: Record<string, string> = {
  allow: C.allow, accept: C.allow, success: C.allow,
  block: C.block, deny: C.block, drop: C.drop,
  failure: C.failure, info: C.muted,
};

const INTERNAL_COLOR: Record<string, string> = {
  "connect": C.allow,
  "auth-success": C.primary,
  "roam": "var(--color-chart-3)",
  "disconnect": C.muted,
  "auth-failure": C.failure,
  "other": C.other,
};

const THREAT_COLOR: Record<string, string> = {
  high: C.block, medium: C.drop, low: "var(--color-chart-5)", clean: C.allow, unknown: C.muted,
};

const INTERNAL_LABEL: Record<string, string> = {
  "connect": "Connected",
  "disconnect": "Disconnected",
  "auth-success": "Auth ok",
  "auth-failure": "Auth failed",
  "roam": "Roaming",
  "other": "Other",
};

const INTERNAL_KEYS = [
  "connect", "auth-success", "roam", "disconnect", "auth-failure", "other",
] as const;

function OverviewPage() {
  const { data: o, isLive } = useOverview();
  const { range } = useUI();
  const spec = bucketSpecForRange(range);
  // Snap to a bucket boundary so the query key is stable across renders.
  // Without this, sinceMs would change every render, making react-query
  // perpetually "loading" and falling back to demo data.
  const sinceMs = Math.floor((Date.now() - spec.windowMs) / spec.bucketMs) * spec.bucketMs;

  // Rows for breakdowns/top-talkers; charts use the dedicated bucket endpoints.
  const { data: fwRows } = useFirewall({ kind: "firewall", limit: 10000, since: sinceMs });
  const { data: intRows } = useFirewall({ kind: "internal", limit: 10000, since: sinceMs });

  const { data: fwByBucket, label: fwLabel } = useFirewallByMinute(range);
  const { data: intByBucket, label: intLabel } = useInternalByBucket(
    internalCategory, INTERNAL_KEYS, range,
  );

  const firewall = useMemo(() => fwRows.filter(isFirewallRuleEvent), [fwRows]);
  const internal = useMemo(() => intRows.filter(isInternalEvent), [intRows]);

  // Action breakdown
  const actionBreakdown = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of firewall) {
      const k = e.action || "info";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()].map(([name, value]) => ({ name, value }));
  }, [firewall]);

  const blocked = useMemo(
    () => firewall.filter((e) => ["block", "drop", "deny", "failure"].includes(e.action)).length,
    [firewall],
  );
  const allowed = firewall.length - blocked;

  // Top firewall rules
  const topRules = useMemo(() => {
    const m = new Map<string, { name: string; count: number; blocked: number }>();
    for (const e of firewall) {
      const k = e.rule || "—";
      const row = m.get(k) ?? { name: k, count: 0, blocked: 0 };
      row.count++;
      if (["block", "drop", "deny", "failure"].includes(e.action)) row.blocked++;
      m.set(k, row);
    }
    return [...m.values()].sort((a, b) => b.count - a.count).slice(0, 8);
  }, [firewall]);

  // Internal category breakdown
  const internalBreakdown = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of internal) {
      const k = internalCategory(e);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return INTERNAL_KEYS
      .map((k) => ({ name: INTERNAL_LABEL[k], key: k, value: m.get(k) ?? 0 }))
      .filter((r) => r.value > 0);
  }, [internal]);

  // Top internal event types
  const topInternalTypes = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of internal) {
      const k = shortEventLabel(e);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [internal]);

  // Top clients by event volume (combined)
  const topClients = useMemo(() => {
    const m = new Map<string, { name: string; mac: string; fw: number; int: number }>();
    const add = (mac: string | undefined, name: string | undefined, kind: "fw" | "int") => {
      const key = (mac ?? "").toLowerCase();
      if (!key) return;
      const row = m.get(key) ?? { name: name || "unknown", mac: mac!, fw: 0, int: 0 };
      if (name && row.name === "unknown") row.name = name;
      row[kind]++;
      m.set(key, row);
    };
    for (const e of firewall) add(e.clientMac, e.clientName, "fw");
    for (const e of internal) add(e.clientMac, e.clientName, "int");
    return [...m.values()]
      .map((r) => ({ ...r, total: r.fw + r.int }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [firewall, internal]);

  // Threat distribution for external IPs in firewall events
  const externalIps = useMemo(() => {
    const s = new Set<string>();
    for (const e of firewall) {
      const ext = externalIp(e);
      if (ext) s.add(ext);
    }
    return [...s];
  }, [firewall]);
  const { data: ipInfo } = useIpInfo(externalIps);

  const threatBreakdown = useMemo(() => {
    const counts: Record<string, number> = { high: 0, medium: 0, low: 0, clean: 0, unknown: 0 };
    for (const ip of externalIps) {
      const t = threatTier(ipInfo?.[ip]?.abuseScore);
      counts[t]++;
    }
    return (["high", "medium", "low", "clean", "unknown"] as const)
      .map((k) => ({ name: k, value: counts[k] }))
      .filter((r) => r.value > 0);
  }, [externalIps, ipInfo]);
  const threatHigh = (ipInfo ? externalIps.filter((ip) => {
    const t = threatTier(ipInfo[ip]?.abuseScore);
    return t === "high" || t === "medium";
  }).length : 0);

  return (
    <div>
      <PageHeader
        title="Overview"
        description={`Syslog activity for the last ${spec.label.replace(/per /, "")} window`}
        actions={<DemoBadge isLive={isLive} />}
      />

      <div className="p-6 space-y-6">
        {/* Top stat tiles */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatTile
            label="Clients"
            value={o.totalClients}
            sub={
              <span className="flex items-center gap-3">
                <span className="flex items-center gap-1"><Wifi className="h-3 w-3" />{o.wireless}</span>
                <span className="flex items-center gap-1"><Cable className="h-3 w-3" />{o.wired}</span>
              </span>
            }
          />
          <StatTile
            label="Firewall events"
            value={firewall.length.toLocaleString()}
            sub={<span className="flex items-center gap-1"><Flame className="h-3 w-3" />in window</span>}
            accent="primary"
          />
          <StatTile
            label="Allowed"
            value={allowed.toLocaleString()}
            sub="Accept / allow"
            accent="rx"
          />
          <StatTile
            label="Blocked"
            value={blocked.toLocaleString()}
            sub="Block / drop / deny / fail"
            accent="error"
          />
          <StatTile
            label="Internal events"
            value={internal.length.toLocaleString()}
            sub={<span className="flex items-center gap-1"><Radio className="h-3 w-3" />Wi-Fi / auth</span>}
          />
          <StatTile
            label="Threat IPs"
            value={threatHigh.toLocaleString()}
            sub={<span className="flex items-center gap-1"><ShieldAlert className="h-3 w-3" />med/high external</span>}
            accent="warn"
          />
        </div>

        {/* Events per minute charts */}
        <div className="grid lg:grid-cols-2 gap-6">
          <ChartCard title="Firewall events" subtitle={fwLabel}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={fwByBucket} stackOffset="sign">
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="t" tickFormatter={(t) => formatTime(t)} tick={{ fill: C.muted, fontSize: 10 }} stroke="var(--color-border)" minTickGap={50} />
                <YAxis tick={{ fill: C.muted, fontSize: 10 }} stroke="var(--color-border)" width={30} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(t) => formatTime(t)} />
                <Bar dataKey="success" stackId="a" name="Allowed" fill={C.allow} />
                <Bar dataKey="failure" stackId="a" name="Blocked" fill={C.block} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title="Internal events" subtitle={intLabel}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={intByBucket}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="t" tickFormatter={(t) => formatTime(t)} tick={{ fill: C.muted, fontSize: 10 }} stroke="var(--color-border)" minTickGap={50} />
                <YAxis tick={{ fill: C.muted, fontSize: 10 }} stroke="var(--color-border)" width={30} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(t) => formatTime(t)} />
                {INTERNAL_KEYS.map((k) => (
                  <Bar key={k} dataKey={k} stackId="a" name={INTERNAL_LABEL[k]} fill={INTERNAL_COLOR[k]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Pies */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <ChartCard title="Firewall actions" subtitle="Distribution" height="h-56">
            {actionBreakdown.length === 0 ? <Empty /> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={actionBreakdown} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70} paddingAngle={2}>
                    {actionBreakdown.map((e, i) => (
                      <Cell key={i} fill={ACTION_COLOR[e.name] ?? C.other} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="Internal categories" subtitle="Distribution" height="h-56">
            {internalBreakdown.length === 0 ? <Empty /> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={internalBreakdown} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70} paddingAngle={2}>
                    {internalBreakdown.map((e, i) => (
                      <Cell key={i} fill={INTERNAL_COLOR[e.key] ?? C.other} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard title="External IP threat level" subtitle={`${externalIps.length} unique`} height="h-56">
            {threatBreakdown.length === 0 ? <Empty /> : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={threatBreakdown} dataKey="value" nameKey="name" innerRadius={40} outerRadius={70} paddingAngle={2}>
                    {threatBreakdown.map((e, i) => (
                      <Cell key={i} fill={THREAT_COLOR[e.name] ?? C.muted} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        {/* Top tables */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <TopList
            title="Top firewall rules"
            subtitle="Events in window"
            link={{ to: "/firewall", label: "View firewall →" }}
            rows={topRules.map((r) => ({
              key: r.name,
              primary: r.name,
              secondary: `${r.blocked} blocked`,
              value: r.count,
            }))}
            emptyHint="No firewall events"
          />
          <TopList
            title="Top internal event types"
            subtitle="Wi-Fi / auth"
            link={{ to: "/internal", label: "View internal →" }}
            rows={topInternalTypes.map((r) => ({
              key: r.name,
              primary: r.name,
              value: r.count,
            }))}
            emptyHint="No internal events"
          />
          <TopList
            title="Top clients by entries"
            subtitle="Combined firewall + internal"
            rows={topClients.map((r) => ({
              key: r.mac,
              primary: r.name,
              secondary: `${r.mac}  ·  ${r.fw} fw / ${r.int} int`,
              value: r.total,
            }))}
            emptyHint="No client activity yet"
          />
        </div>

        {/* Bottom row: top rules horizontal bar + parsing health */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6">
          <ChartCard title="Top firewall rules" subtitle="Events / blocked" height="h-72">
            {topRules.length === 0 ? <Empty /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topRules} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid stroke="var(--color-border)" strokeDasharray="2 4" horizontal={false} />
                  <XAxis type="number" tick={{ fill: C.muted, fontSize: 10 }} stroke="var(--color-border)" />
                  <YAxis type="category" dataKey="name" tick={{ fill: C.muted, fontSize: 11 }} stroke="var(--color-border)" width={160} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" name="Total" fill={C.primary} />
                  <Bar dataKey="blocked" name="Blocked" fill={C.block} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
          <ParsingHealth windowMin={60} />
        </div>
      </div>
    </div>
  );
}

const tooltipStyle = {
  background: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 6,
  fontSize: 11,
} as const;

function ChartCard({
  title, subtitle, children, height = "h-64",
}: {
  title: string; subtitle?: string; children: React.ReactNode; height?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card flex flex-col">
      <div className="flex items-center justify-between px-4 pt-3">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground">{title}</h2>
        {subtitle && <span className="text-[10px] text-muted-foreground">{subtitle}</span>}
      </div>
      <div className={cn("p-2 flex-1", height)}>{children}</div>
    </div>
  );
}

function Empty() {
  return (
    <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
      <Activity className="h-3 w-3 mr-1.5" /> No data in window
    </div>
  );
}

function TopList({
  title, subtitle, link, rows, emptyHint,
}: {
  title: string;
  subtitle?: string;
  link?: { to: "/firewall" | "/internal"; label: string };
  rows: { key: string; primary: string; secondary?: string; value: number }[];
  emptyHint: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {link && (
          <Link to={link.to} className="text-[11px] text-muted-foreground hover:text-foreground">
            {link.label}
          </Link>
        )}
      </div>
      <ul className="divide-y divide-border">
        {rows.length === 0 ? (
          <li className="px-4 py-8 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
            <AlertTriangle className="h-3 w-3" /> {emptyHint}
          </li>
        ) : (
          rows.map((r) => (
            <li key={r.key} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{r.primary}</div>
                  {r.secondary && (
                    <div className="text-[11px] text-muted-foreground font-mono truncate">{r.secondary}</div>
                  )}
                  <div className="mt-1.5 h-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />
                  </div>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground w-12 text-right">
                  {r.value.toLocaleString()}
                </span>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

// Suppress unused import warning for relativeTime (kept for future use)
void relativeTime;
