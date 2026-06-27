import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Cable, Download, Search, Wifi } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { DemoBadge } from "@/components/demo-badge";
import { Input } from "@/components/ui/input";
import { useClients } from "@/lib/live";
import { formatBits, formatBytes, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ClientDrawer } from "@/components/client-drawer";
import { DensityToggle, useRowPad } from "@/components/density-toggle";
import { exportCsv } from "@/lib/export";

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({ meta: [{ title: "Clients — UniFi Dashboard" }] }),
  component: ClientsPage,
});

type SortKey = "hostname" | "ip" | "signal" | "satisfaction" | "rxRate" | "txRate" | "total";

function ClientsPage() {
  const { data: clients, isLive } = useClients();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("total");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState<"all" | "wireless" | "wired">("all");
  const [focus, setFocus] = useState<string | null>(null);
  const pad = useRowPad();

  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    return clients
      .filter((c) => (filter === "all" ? true : filter === "wired" ? c.wired : !c.wired))
      .filter((c) => !ql || c.hostname.toLowerCase().includes(ql) || c.mac.includes(ql) || c.ip.includes(ql) || c.manufacturer.toLowerCase().includes(ql))
      .sort((a, b) => {
        const av = sort === "total" ? a.rxRate + a.txRate : (a[sort as keyof typeof a] as number | string);
        const bv = sort === "total" ? b.rxRate + b.txRate : (b[sort as keyof typeof b] as number | string);
        if (av === bv) return 0;
        const cmp = av > bv ? 1 : -1;
        return dir === "asc" ? cmp : -cmp;
      });
  }, [q, sort, dir, filter, clients]);

  function toggleSort(k: SortKey) {
    if (sort === k) setDir(dir === "asc" ? "desc" : "asc");
    else { setSort(k); setDir("desc"); }
  }

  return (
    <div>
      <PageHeader
        title="Clients"
        description={`${rows.length} of ${clients.length} clients`}
        actions={
          <div className="flex items-center gap-2">
            <DemoBadge isLive={isLive} />

            <button onClick={() => exportCsv("clients", rows)} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-secondary/60">
              <Download className="h-3.5 w-3.5" />CSV
            </button>
            <DensityToggle />
            <div className="flex rounded-md border border-border overflow-hidden text-xs">
              {(["all", "wireless", "wired"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={cn("px-2.5 py-1.5 capitalize", filter === f ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60")}>{f}</button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search name, IP, MAC…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-7 h-8 w-64" />
            </div>
          </div>
        }
      />

      <div className="p-6">
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground bg-secondary/40">
              <tr>
                <Th onClick={() => toggleSort("hostname")} active={sort === "hostname"} dir={dir}>Client</Th>
                <Th onClick={() => toggleSort("ip")} active={sort === "ip"} dir={dir}>IP</Th>
                <th className="px-3 py-2 text-left">Conn</th>
                <Th onClick={() => toggleSort("signal")} active={sort === "signal"} dir={dir}>Signal</Th>
                <Th onClick={() => toggleSort("satisfaction")} active={sort === "satisfaction"} dir={dir}>Sat</Th>
                <Th onClick={() => toggleSort("rxRate")} active={sort === "rxRate"} dir={dir}>RX</Th>
                <Th onClick={() => toggleSort("txRate")} active={sort === "txRate"} dir={dir}>TX</Th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} onClick={() => setFocus(c.id)} className="border-t border-border hover:bg-secondary/30 transition-colors cursor-pointer">
                  <td className={cn("px-3", pad)}>
                    <div className="flex items-center gap-2 min-w-0">
                      {c.wired ? <Cable className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <Wifi className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                      <div className="min-w-0">
                        <div className="font-medium truncate">{c.hostname}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{c.mac}</div>
                      </div>
                    </div>
                  </td>
                  <td className={cn("px-3 font-mono text-xs", pad)}>{c.ip}</td>
                  <td className={cn("px-3 text-xs text-muted-foreground", pad)}>
                    <div>{c.ap}</div>
                    <div className="text-[10px]">{c.vlan}</div>
                  </td>
                  <td className={cn("px-3 font-mono text-xs", pad)}>{c.wired ? "—" : `${c.signal} dBm`}</td>
                  <td className={cn("px-3", pad)}>
                    <div className="flex items-center gap-2">
                      <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
                        <div className={cn("h-full", c.satisfaction > 75 ? "bg-chart-2" : c.satisfaction > 50 ? "bg-severity-warn" : "bg-severity-error")} style={{ width: `${c.satisfaction}%` }} />
                      </div>
                      <span className="text-xs tabular-nums">{c.satisfaction}</span>
                    </div>
                  </td>
                  <td className={cn("px-3 text-rx font-mono text-xs", pad)}><span className="inline-flex items-center gap-1"><ArrowDown className="h-3 w-3" /> {formatBits(c.rxRate)}</span></td>
                  <td className={cn("px-3 text-tx font-mono text-xs", pad)}><span className="inline-flex items-center gap-1"><ArrowUp className="h-3 w-3" /> {formatBits(c.txRate)}</span></td>
                  <td className={cn("px-3 text-right font-mono text-xs text-muted-foreground", pad)}>{formatBytes(c.rxBytes + c.txBytes)}</td>
                  <td className={cn("px-3 text-right text-xs text-muted-foreground", pad)}>{relativeTime(c.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ClientDrawer id={focus} onClose={() => setFocus(null)} />
    </div>
  );
}

function Th({ children, onClick, active, dir }: { children: React.ReactNode; onClick: () => void; active: boolean; dir: "asc" | "desc" }) {
  return (
    <th className="px-3 py-2 text-left font-medium">
      <button onClick={onClick} className={cn("uppercase tracking-wider inline-flex items-center gap-1", active ? "text-foreground" : "hover:text-foreground transition-colors")}>
        {children}
        {active && <span className="text-[9px]">{dir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}
