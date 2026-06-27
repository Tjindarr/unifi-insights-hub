import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronRight, Download, Search } from "lucide-react";

import { PageHeader, SeverityDot } from "@/components/app-shell";
import { DemoBadge } from "@/components/demo-badge";
import { Input } from "@/components/ui/input";
import { useFirewall } from "@/lib/live";
import {
  describeFirewallEvent,
  internalCategory,
  isInternalEvent,
  shortEventLabel,
  type InternalCategory,
} from "@/lib/firewall-format";
import { formatTime, relativeTime } from "@/lib/format";
import { exportNdjson } from "@/lib/export";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/internal")({
  head: () => ({ meta: [{ title: "Internal events — UniFi Dashboard" }] }),
  component: InternalPage,
});

type Filter = "all" | InternalCategory;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "connect", label: "Connected" },
  { key: "disconnect", label: "Disconnected" },
  { key: "auth-success", label: "Auth ok" },
  { key: "auth-failure", label: "Auth fail" },
  { key: "roam", label: "Roam" },
  { key: "other", label: "Other" },
];

const CATEGORY_STYLE: Record<InternalCategory, string> = {
  "connect": "bg-chart-2/15 text-chart-2",
  "disconnect": "bg-muted/40 text-muted-foreground",
  "auth-success": "bg-chart-2/15 text-chart-2",
  "auth-failure": "bg-severity-error/15 text-severity-error",
  "roam": "bg-primary/15 text-primary",
  "other": "bg-secondary/40 text-muted-foreground",
};

function InternalPage() {
  const { data: events, isLive } = useFirewall();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const internal = useMemo(() => events.filter(isInternalEvent), [events]);

  const categorised = useMemo(
    () => internal.map((e) => ({ e, cat: internalCategory(e) })),
    [internal],
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: internal.length };
    for (const { cat } of categorised) c[cat] = (c[cat] ?? 0) + 1;
    return c;
  }, [categorised, internal.length]);

  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    return categorised
      .filter(({ e, cat }) => {
        if (filter !== "all" && cat !== filter) return false;
        if (!ql) return true;
        return (
          e.rule.toLowerCase().includes(ql) ||
          e.eventType?.toLowerCase().includes(ql) ||
          e.messageType?.toLowerCase().includes(ql) ||
          e.clientMac?.toLowerCase().includes(ql) ||
          e.clientName?.toLowerCase().includes(ql) ||
          e.vap?.toLowerCase().includes(ql) ||
          e.reason?.toLowerCase().includes(ql)
        );
      })
      .map(({ e }) => e);
  }, [categorised, filter, q]);

  return (
    <div>
      <PageHeader
        title="Internal events"
        description={`${rows.length} of ${internal.length} events · Wi-Fi associate / deauth, auth, device, system`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <DemoBadge isLive={isLive} />
            <button
              onClick={() => exportNdjson("internal-events", rows)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-secondary/60"
            >
              <Download className="h-3.5 w-3.5" />NDJSON
            </button>
            <div className="flex rounded-md border border-border overflow-hidden text-xs">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "px-2.5 py-1.5",
                    filter === f.key
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-secondary/60",
                  )}
                >
                  {f.label}
                  <span className="ml-1 text-[10px] text-muted-foreground/80 tabular-nums">
                    {counts[f.key] ?? 0}
                  </span>
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="MAC, name, SSID, reason…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-7 h-8 w-72"
              />
            </div>
          </div>
        }
      />

      <div className="p-6">
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <ul className="divide-y divide-border">
            {rows.map((e) => {
              const open = expanded === e.id;
              const cat = internalCategory(e);
              return (
                <li key={e.id} className="text-sm">
                  <button
                    onClick={() => setExpanded(open ? null : e.id)}
                    className="w-full px-4 py-3 grid grid-cols-12 gap-3 items-start text-left hover:bg-secondary/30 transition-colors"
                  >
                    <div className="col-span-2 flex items-center gap-2 text-xs font-mono">
                      <SeverityDot severity={e.severity} />
                      <span>{formatTime(e.time)}</span>
                      <span className="text-muted-foreground">{relativeTime(e.time)}</span>
                    </div>
                    <div className="col-span-2">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium",
                          CATEGORY_STYLE[cat],
                        )}
                      >
                        {shortEventLabel(e)}
                      </span>
                      <div className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                        {e.eventType || e.messageType || "—"}
                      </div>
                    </div>
                    <div className="col-span-3 min-w-0">
                      <div className="font-medium truncate">
                        {e.clientName ?? <span className="text-muted-foreground">unknown</span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">
                        {e.clientMac ?? "—"}
                      </div>
                    </div>
                    <div className="col-span-4 text-xs text-foreground/90 leading-snug">
                      {describeFirewallEvent(e)}
                    </div>
                    <div className="col-span-1 text-right">
                      <ChevronRight
                        className={cn(
                          "h-4 w-4 text-muted-foreground transition-transform inline-block",
                          open && "rotate-90",
                        )}
                      />
                    </div>
                  </button>
                  {open && (
                    <pre className="px-4 pb-4 -mt-1 text-[11px] font-mono text-muted-foreground bg-background/50 overflow-x-auto">
{JSON.stringify(e.raw, null, 2)}
                    </pre>
                  )}
                </li>
              );
            })}
            {rows.length === 0 && (
              <li className="px-4 py-12 text-center text-sm text-muted-foreground">
                No internal events match the current filters.
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
