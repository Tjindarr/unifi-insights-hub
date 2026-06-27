import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";

import { PageHeader, SeverityDot } from "@/components/app-shell";
import { Input } from "@/components/ui/input";
import { firewallEvents } from "@/lib/mock-data";
import { formatTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/firewall")({
  head: () => ({
    meta: [{ title: "Firewall — UniFi Dashboard" }],
  }),
  component: FirewallPage,
});

function FirewallPage() {
  const [q, setQ] = useState("");
  const [action, setAction] = useState<"all" | "failure" | "success">("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    return firewallEvents.filter(
      (e) =>
        (action === "all" || e.action === action) &&
        (!ql ||
          e.rule.toLowerCase().includes(ql) ||
          e.clientMac?.toLowerCase().includes(ql) ||
          e.clientName?.toLowerCase().includes(ql) ||
          e.vap?.toLowerCase().includes(ql)),
    );
  }, [q, action]);

  const stats = useMemo(
    () => ({
      total: firewallEvents.length,
      failures: firewallEvents.filter((e) => e.action === "failure").length,
      uniqueClients: new Set(firewallEvents.map((e) => e.clientMac)).size,
    }),
    [],
  );

  return (
    <div>
      <PageHeader
        title="Firewall"
        description={`${rows.length} events · ${stats.failures} failures · ${stats.uniqueClients} clients`}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border overflow-hidden text-xs">
              {(["all", "failure", "success"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setAction(f)}
                  className={cn(
                    "px-2.5 py-1.5 capitalize",
                    action === f
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:bg-secondary/60",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="rule, MAC, client, VAP…"
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
              return (
                <li key={e.id} className="text-sm">
                  <button
                    onClick={() => setExpanded(open ? null : e.id)}
                    className="w-full px-4 py-3 grid grid-cols-12 gap-3 items-center text-left hover:bg-secondary/30 transition-colors"
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
                          e.action === "failure"
                            ? "bg-severity-error/15 text-severity-error"
                            : "bg-chart-2/15 text-chart-2",
                        )}
                      >
                        {e.action}
                      </span>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{e.rule}</div>
                    </div>
                    <div className="col-span-3 min-w-0">
                      <div className="font-medium truncate">
                        {e.clientName ?? <span className="text-muted-foreground">unknown</span>}
                      </div>
                      <div className="text-[11px] text-muted-foreground font-mono truncate">
                        {e.clientMac}
                      </div>
                    </div>
                    <div className="col-span-2 text-xs">
                      <div className="font-mono">{e.vap ?? "—"}</div>
                      <div className="text-muted-foreground">
                        {e.rssi !== undefined ? `${e.rssi} dBm` : ""}
                      </div>
                    </div>
                    <div className="col-span-2 text-xs text-muted-foreground truncate">
                      {e.reason ?? e.messageType}
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
                No events match the current filters.
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
