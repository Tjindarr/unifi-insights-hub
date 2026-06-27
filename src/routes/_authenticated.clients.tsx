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
import { ColumnPicker, useColumns, type ColumnDef } from "@/components/column-picker";
import type { Client } from "@/lib/mock-data";

export const Route = createFileRoute("/_authenticated/clients")({
  head: () => ({ meta: [{ title: "Clients — UniFi Dashboard" }] }),
  component: ClientsPage,
});

function fmtDuration(sec?: number) {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

const COLUMNS: ColumnDef<Client>[] = [
  {
    key: "client", label: "Client", hint: "Alias or hostname + MAC",
    required: true, defaultVisible: true,
    sortValue: (c) => (c.alias ?? c.hostname).toLowerCase(),
    render: (c) => (
      <div className="flex items-center gap-2 min-w-0">
        {c.wired ? <Cable className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <Wifi className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <div className="min-w-0">
          <div className="font-medium truncate">{c.alias ?? c.hostname}</div>
          <div className="text-[10px] text-muted-foreground font-mono">{c.mac}</div>
        </div>
      </div>
    ),
  },
  { key: "alias", label: "Alias", hint: "UniFi user-set name", defaultVisible: false, sortValue: (c) => c.alias ?? "", render: (c) => <span className="text-xs">{c.alias ?? "—"}</span> },
  { key: "hostname", label: "Hostname", hint: "Reported by client", defaultVisible: false, sortValue: (c) => c.hostname, render: (c) => <span className="text-xs">{c.hostname}</span> },
  { key: "note", label: "Note", defaultVisible: false, render: (c) => <span className="text-xs text-muted-foreground truncate">{c.note ?? "—"}</span> },
  { key: "ip", label: "IP", defaultVisible: true, sortValue: (c) => c.ip, render: (c) => <span className="font-mono text-xs">{c.ip}</span> },
  { key: "ip6", label: "IPv6", defaultVisible: false, render: (c) => <span className="font-mono text-[11px] text-muted-foreground">{c.ip6 ?? "—"}</span> },
  { key: "fixedIp", label: "Fixed IP", defaultVisible: false, render: (c) => <span className="font-mono text-xs">{c.fixedIp ?? "—"}</span> },
  { key: "mac", label: "MAC", defaultVisible: false, sortValue: (c) => c.mac, render: (c) => <span className="font-mono text-[11px]">{c.mac}</span> },
  {
    key: "conn", label: "Connection", hint: "AP/switch + VLAN", defaultVisible: true,
    render: (c) => (
      <div className="text-xs text-muted-foreground">
        <div>{c.ap}</div><div className="text-[10px]">{c.vlan}</div>
      </div>
    ),
  },
  { key: "vlan", label: "Network", defaultVisible: false, sortValue: (c) => c.vlan, render: (c) => <span className="text-xs">{c.vlan}</span> },
  { key: "essid", label: "SSID", defaultVisible: false, render: (c) => <span className="text-xs">{c.essid ?? "—"}</span> },
  { key: "band", label: "Band", defaultVisible: false, sortValue: (c) => c.band ?? "", render: (c) => <span className="text-xs">{c.band ?? "—"}</span> },
  { key: "channel", label: "Channel", defaultVisible: false, sortValue: (c) => c.channel ?? -1, render: (c) => <span className="font-mono text-xs">{c.channel ?? "—"}</span> },
  { key: "radioProto", label: "Wi-Fi mode", hint: "ax / ac / n", defaultVisible: false, render: (c) => <span className="text-xs">{c.radioProto ?? "—"}</span> },
  { key: "signal", label: "Signal", defaultVisible: true, sortValue: (c) => c.signal, render: (c) => <span className="font-mono text-xs">{c.wired ? "—" : `${c.signal} dBm`}</span> },
  { key: "noise", label: "Noise", defaultVisible: false, sortValue: (c) => c.noise ?? 0, render: (c) => <span className="font-mono text-xs">{c.noise != null ? `${c.noise} dBm` : "—"}</span> },
  { key: "snr", label: "SNR", defaultVisible: false, sortValue: (c) => c.snr ?? 0, render: (c) => <span className="font-mono text-xs">{c.snr != null ? `${c.snr} dB` : "—"}</span> },
  { key: "ccq", label: "CCQ", hint: "Wi-Fi link quality 0-1000", defaultVisible: false, sortValue: (c) => c.ccq ?? 0, render: (c) => <span className="font-mono text-xs">{c.ccq ?? "—"}</span> },
  { key: "txPower", label: "TX power", defaultVisible: false, sortValue: (c) => c.txPower ?? 0, render: (c) => <span className="font-mono text-xs">{c.txPower != null ? `${c.txPower} dBm` : "—"}</span> },
  { key: "txRetries", label: "TX retries", defaultVisible: false, sortValue: (c) => c.txRetries ?? 0, render: (c) => <span className="font-mono text-xs">{c.txRetries ?? "—"}</span> },
  { key: "anomalies", label: "Anomalies", defaultVisible: false, sortValue: (c) => c.anomalies ?? 0, render: (c) => <span className="font-mono text-xs">{c.anomalies ?? "—"}</span> },
  {
    key: "satisfaction", label: "Sat", hint: "Client satisfaction 0-100", defaultVisible: true,
    sortValue: (c) => c.satisfaction,
    render: (c) => (
      <div className="flex items-center gap-2">
        <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
          <div className={cn("h-full", c.satisfaction > 75 ? "bg-chart-2" : c.satisfaction > 50 ? "bg-severity-warn" : "bg-severity-error")} style={{ width: `${c.satisfaction}%` }} />
        </div>
        <span className="text-xs tabular-nums">{c.satisfaction}</span>
      </div>
    ),
  },
  { key: "rxRate", label: "RX", hint: "Download throughput", defaultVisible: true, sortValue: (c) => c.rxRate, render: (c) => <span className="text-rx font-mono text-xs inline-flex items-center gap-1"><ArrowDown className="h-3 w-3" /> {formatBits(c.rxRate)}</span> },
  { key: "txRate", label: "TX", hint: "Upload throughput", defaultVisible: true, sortValue: (c) => c.txRate, render: (c) => <span className="text-tx font-mono text-xs inline-flex items-center gap-1"><ArrowUp className="h-3 w-3" /> {formatBits(c.txRate)}</span> },
  { key: "linkRxRate", label: "Link RX", hint: "PHY link rate", defaultVisible: false, sortValue: (c) => c.linkRxRate ?? 0, render: (c) => <span className="font-mono text-xs">{c.linkRxRate ? formatBits(c.linkRxRate / 8) : "—"}</span> },
  { key: "linkTxRate", label: "Link TX", hint: "PHY link rate", defaultVisible: false, sortValue: (c) => c.linkTxRate ?? 0, render: (c) => <span className="font-mono text-xs">{c.linkTxRate ? formatBits(c.linkTxRate / 8) : "—"}</span> },
  { key: "rxBytes", label: "RX total", defaultVisible: false, sortValue: (c) => c.rxBytes, render: (c) => <span className="font-mono text-xs text-muted-foreground">{formatBytes(c.rxBytes)}</span> },
  { key: "txBytes", label: "TX total", defaultVisible: false, sortValue: (c) => c.txBytes, render: (c) => <span className="font-mono text-xs text-muted-foreground">{formatBytes(c.txBytes)}</span> },
  { key: "total", label: "Total", hint: "RX+TX throughput", defaultVisible: true, align: "right", sortValue: (c) => c.rxRate + c.txRate, render: (c) => <span className="font-mono text-xs text-muted-foreground">{formatBytes(c.rxBytes + c.txBytes)}</span> },
  { key: "manufacturer", label: "Vendor", defaultVisible: false, sortValue: (c) => c.manufacturer, render: (c) => <span className="text-xs">{c.manufacturer}</span> },
  { key: "deviceFamily", label: "Device", defaultVisible: false, render: (c) => <span className="text-xs">{c.deviceFamily ?? "—"}</span> },
  { key: "osName", label: "OS", defaultVisible: false, render: (c) => <span className="text-xs">{c.osName ?? "—"}</span> },
  { key: "usergroupId", label: "User group", defaultVisible: false, render: (c) => <span className="text-[11px] font-mono text-muted-foreground">{c.usergroupId ?? "—"}</span> },
  { key: "switchPort", label: "Switch port", defaultVisible: false, sortValue: (c) => c.switchPort ?? 0, render: (c) => <span className="font-mono text-xs">{c.switchPort ?? "—"}</span> },
  { key: "uplinkMac", label: "Uplink MAC", defaultVisible: false, render: (c) => <span className="font-mono text-[11px]">{c.uplinkMac ?? "—"}</span> },
  { key: "isGuest", label: "Guest", defaultVisible: false, sortValue: (c) => (c.isGuest ? 1 : 0), render: (c) => <span className="text-xs">{c.isGuest ? "yes" : "—"}</span> },
  { key: "authorized", label: "Authorized", defaultVisible: false, render: (c) => <span className="text-xs">{c.authorized == null ? "—" : c.authorized ? "yes" : "no"}</span> },
  { key: "blocked", label: "Blocked", defaultVisible: false, render: (c) => <span className="text-xs">{c.blocked ? "yes" : "—"}</span> },
  { key: "powersave", label: "Powersave", defaultVisible: false, render: (c) => <span className="text-xs">{c.powersaveEnabled ? "on" : "—"}</span> },
  { key: "qos", label: "QoS", defaultVisible: false, render: (c) => <span className="text-xs">{c.qosPolicyApplied ? "yes" : "—"}</span> },
  { key: "uptime", label: "Uptime", defaultVisible: false, sortValue: (c) => c.uptime ?? 0, render: (c) => <span className="text-xs text-muted-foreground">{fmtDuration(c.uptime)}</span> },
  { key: "assocTime", label: "Assoc", hint: "Time associated to AP", defaultVisible: false, sortValue: (c) => c.assocTime ?? 0, render: (c) => <span className="text-xs text-muted-foreground">{fmtDuration(c.assocTime)}</span> },
  { key: "idleTime", label: "Idle", defaultVisible: false, sortValue: (c) => c.idleTime ?? 0, render: (c) => <span className="text-xs text-muted-foreground">{fmtDuration(c.idleTime)}</span> },
  { key: "firstSeen", label: "First seen", defaultVisible: false, sortValue: (c) => c.firstSeen ?? "", render: (c) => <span className="text-xs text-muted-foreground">{c.firstSeen ? relativeTime(c.firstSeen) : "—"}</span> },
  { key: "lastSeen", label: "Last seen", defaultVisible: true, align: "right", sortValue: (c) => c.lastSeen, render: (c) => <span className="text-xs text-muted-foreground">{relativeTime(c.lastSeen)}</span> },
];

function ClientsPage() {
  const { data: clients, isLive } = useClients();
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<string>("total");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState<"all" | "wireless" | "wired">("all");
  const [focus, setFocus] = useState<string | null>(null);
  const pad = useRowPad();
  const { visibleColumns, allColumns, visibleSet, toggle, move, reset } =
    useColumns<Client>("clients-v1", COLUMNS);

  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    const col = COLUMNS.find((c) => c.key === sortKey);
    return clients
      .filter((c) => (filter === "all" ? true : filter === "wired" ? c.wired : !c.wired))
      .filter((c) => {
        if (!ql) return true;
        return (
          c.hostname.toLowerCase().includes(ql) ||
          (c.alias ?? "").toLowerCase().includes(ql) ||
          c.mac.includes(ql) ||
          c.ip.includes(ql) ||
          c.manufacturer.toLowerCase().includes(ql) ||
          (c.essid ?? "").toLowerCase().includes(ql) ||
          (c.note ?? "").toLowerCase().includes(ql)
        );
      })
      .sort((a, b) => {
        if (!col?.sortValue) return 0;
        const av = col.sortValue(a) ?? 0;
        const bv = col.sortValue(b) ?? 0;
        if (av === bv) return 0;
        const cmp = av > bv ? 1 : -1;
        return dir === "asc" ? cmp : -cmp;
      });
  }, [q, sortKey, dir, filter, clients]);

  function toggleSort(k: string) {
    const col = COLUMNS.find((c) => c.key === k);
    if (!col?.sortValue) return;
    if (sortKey === k) setDir(dir === "asc" ? "desc" : "asc");
    else { setSortKey(k); setDir("desc"); }
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
            <ColumnPicker columns={allColumns} visible={visibleSet} onToggle={toggle} onMove={move} onReset={reset} />
            <DensityToggle />
            <div className="flex rounded-md border border-border overflow-hidden text-xs">
              {(["all", "wireless", "wired"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={cn("px-2.5 py-1.5 capitalize", filter === f ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60")}>{f}</button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search name, IP, MAC, SSID…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-7 h-8 w-64" />
            </div>
          </div>
        }
      />

      <div className="p-6">
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm min-w-max">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground bg-secondary/40">
              <tr>
                {visibleColumns.map((c) => {
                  const sortable = !!c.sortValue;
                  const active = sortKey === c.key;
                  const align = c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left";
                  return (
                    <th key={c.key} className={cn("px-3 py-2 font-medium whitespace-nowrap", align, c.thClassName)}>
                      {sortable ? (
                        <button
                          onClick={() => toggleSort(c.key)}
                          className={cn("uppercase tracking-wider inline-flex items-center gap-1", active ? "text-foreground" : "hover:text-foreground transition-colors")}
                        >
                          {c.label}
                          {active && <span className="text-[9px]">{dir === "asc" ? "▲" : "▼"}</span>}
                        </button>
                      ) : c.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} onClick={() => setFocus(c.id)} className="border-t border-border hover:bg-secondary/30 transition-colors cursor-pointer">
                  {visibleColumns.map((col) => {
                    const align = col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left";
                    return (
                      <td key={col.key} className={cn("px-3 whitespace-nowrap", pad, align, col.className)}>
                        {col.render(c)}
                      </td>
                    );
                  })}
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
