import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { PageHeader, SeverityDot } from "@/components/app-shell";
import { Input } from "@/components/ui/input";
import { syslog } from "@/lib/mock-data";
import type { Severity } from "@/lib/mock-data";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/logs")({
  head: () => ({
    meta: [{ title: "Logs — UniFi Dashboard" }],
  }),
  component: LogsPage,
});

const SEVERITIES: Severity[] = ["info", "notice", "warn", "error", "critical"];

function LogsPage() {
  const [q, setQ] = useState("");
  const [sev, setSev] = useState<Set<Severity>>(new Set(SEVERITIES));
  const [host, setHost] = useState<string | "all">("all");

  const hosts = useMemo(() => Array.from(new Set(syslog.map((s) => s.host))).sort(), []);
  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    return syslog.filter(
      (s) =>
        sev.has(s.severity) &&
        (host === "all" || s.host === host) &&
        (!ql ||
          s.message.toLowerCase().includes(ql) ||
          s.host.toLowerCase().includes(ql) ||
          s.appname.toLowerCase().includes(ql)),
    );
  }, [q, sev, host]);

  function toggleSev(s: Severity) {
    const next = new Set(sev);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    setSev(next);
  }

  return (
    <div>
      <PageHeader
        title="Logs"
        description={`${rows.length} of ${syslog.length} entries · FTS5 search in production`}
        actions={
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search messages…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-7 h-8 w-80"
            />
          </div>
        }
      />

      <div className="p-6 grid grid-cols-[200px_1fr] gap-4">
        <aside className="space-y-4">
          <Facet title="Severity">
            {SEVERITIES.map((s) => (
              <label
                key={s}
                className="flex items-center gap-2 text-xs cursor-pointer py-1"
              >
                <input
                  type="checkbox"
                  checked={sev.has(s)}
                  onChange={() => toggleSev(s)}
                  className="accent-primary"
                />
                <SeverityDot severity={s} />
                <span className="capitalize">{s}</span>
                <span className="ml-auto text-muted-foreground">
                  {syslog.filter((x) => x.severity === s).length}
                </span>
              </label>
            ))}
          </Facet>
          <Facet title="Host">
            <button
              onClick={() => setHost("all")}
              className={cn(
                "w-full text-left text-xs py-1 px-1.5 rounded",
                host === "all" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60",
              )}
            >
              All hosts
            </button>
            {hosts.map((h) => (
              <button
                key={h}
                onClick={() => setHost(h)}
                className={cn(
                  "w-full text-left text-xs py-1 px-1.5 rounded font-mono truncate",
                  host === h ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60",
                )}
              >
                {h}
              </button>
            ))}
          </Facet>
        </aside>

        <div className="rounded-lg border border-border bg-card overflow-hidden min-w-0">
          <ul className="divide-y divide-border">
            {rows.map((s) => (
              <li key={s.id} className="px-3 py-2 hover:bg-secondary/20 transition-colors">
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
                  <SeverityDot severity={s.severity} />
                  <span>{formatDateTime(s.time)}</span>
                  <span>{s.host}</span>
                  <span className="truncate">{s.appname}</span>
                </div>
                <div className="text-xs font-mono mt-1 text-foreground/90 break-all">
                  {s.message}
                </div>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="px-4 py-12 text-center text-sm text-muted-foreground">
                No log entries match the current filters.
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Facet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{title}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
