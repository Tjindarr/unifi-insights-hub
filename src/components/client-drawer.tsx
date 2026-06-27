import { useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { ArrowDown, ArrowUp, Cable, ShieldAlert, Wifi, X } from "lucide-react";

import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { clients as mockClientsList, firewallEvents as mockFwEvents } from "@/lib/mock-data";
import { clientHistory, clientDpi } from "@/lib/mock-extra";
import { useClients, useFirewall } from "@/lib/live";
import { formatBits, formatBytes, formatTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type ClientDetails = {
  mac: string;
  currentIp: string | null;
  dhcpHostname: string | null;
  ipHistory: { ip: string; firstSeen: number; lastSeen: number; count: number }[];
  wifiAuth: {
    total: number;
    failures: number;
    lastFailureAt: number | null;
    recent: {
      time: number;
      event_type: string | null;
      assoc_status: number | null;
      auth_failures: number | null;
      rssi: number | null;
      reason: string | null;
      vap: string | null;
    }[];
  };
};

export function ClientDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const client = id ? clients.find((c) => c.id === id) : null;
  const open = !!client;
  const history = client ? clientHistory[client.id] ?? [] : [];
  const dpi = client ? clientDpi[client.id] ?? [] : [];
  const fwEvents = client ? firewallEvents.filter((e) => e.clientMac === client?.mac).slice(0, 12) : [];

  const [details, setDetails] = useState<ClientDetails | null>(null);
  useEffect(() => {
    setDetails(null);
    if (!client?.mac) return;
    let cancelled = false;
    fetch(`/api/clients/${encodeURIComponent(client.mac)}/details`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d) setDetails(d as ClientDetails); })
      .catch(() => { /* offline / preview */ });
    return () => { cancelled = true; };
  }, [client?.mac]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto bg-card border-l border-border">
        {client && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {client.wired ? <Cable className="h-4 w-4 text-muted-foreground" /> : <Wifi className="h-4 w-4 text-muted-foreground" />}
                {client.hostname}
              </SheetTitle>
              <SheetDescription className="font-mono text-xs">
                {client.mac} · {client.ip} · {client.manufacturer}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
              <Tile label="VLAN" value={client.vlan} />
              <Tile label="AP / Port" value={client.ap} />
              <Tile label="Signal" value={client.wired ? "—" : `${client.signal} dBm`} />
              <Tile label="Satisfaction" value={`${client.satisfaction}%`} />
              <Tile label="RX total" value={formatBytes(client.rxBytes)} />
              <Tile label="TX total" value={formatBytes(client.txBytes)} />
            </div>

            <div className="mt-4 rounded-md border border-border bg-background/30">
              <div className="px-3 pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                Throughput · last 60 min
              </div>
              <div className="h-40 p-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={history}>
                    <defs>
                      <linearGradient id="dRx" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-rx)" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="var(--color-rx)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="dTx" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-tx)" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="var(--color-tx)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <Tooltip
                      contentStyle={{ background: "var(--color-popover)", border: "1px solid var(--color-border)", borderRadius: 6, fontSize: 11 }}
                      formatter={(v: number, k) => [formatBits(v), k === "rx" ? "RX" : "TX"]}
                      labelFormatter={(t) => formatTime(t)}
                    />
                    <Area type="monotone" dataKey="rx" stroke="var(--color-rx)" strokeWidth={1.5} fill="url(#dRx)" />
                    <Area type="monotone" dataKey="tx" stroke="var(--color-tx)" strokeWidth={1.5} fill="url(#dTx)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="flex gap-4 px-3 pb-2 text-[11px] font-mono">
                <span className="text-rx flex items-center gap-1"><ArrowDown className="h-3 w-3" />{formatBits(client.rxRate)}</span>
                <span className="text-tx flex items-center gap-1"><ArrowUp className="h-3 w-3" />{formatBits(client.txRate)}</span>
              </div>
            </div>

            {dpi.length > 0 && (
              <Section title="Top applications">
                <ul className="divide-y divide-border">
                  {dpi.map((a) => (
                    <li key={a.name} className="py-1.5 flex items-center justify-between text-xs">
                      <div>
                        <div>{a.name}</div>
                        <div className="text-[10px] text-muted-foreground">{a.category}</div>
                      </div>
                      <div className="font-mono text-muted-foreground">{formatBytes(a.rx + a.tx)}</div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}


            {details && (details.wifiAuth.total > 0 || details.wifiAuth.failures > 0) && (
              <Section title="Wi-Fi auth events (from syslog)">
                <div className="grid grid-cols-3 gap-2 mb-2 text-xs">
                  <Tile label="Total" value={details.wifiAuth.total} />
                  <Tile
                    label="Failures"
                    value={
                      <span className={details.wifiAuth.failures > 0 ? "text-severity-error" : ""}>
                        {details.wifiAuth.failures}
                      </span>
                    }
                  />
                  <Tile
                    label="Last failure"
                    value={details.wifiAuth.lastFailureAt ? relativeTime(details.wifiAuth.lastFailureAt) : "—"}
                  />
                </div>
                {details.wifiAuth.recent.length > 0 && (
                  <ul className="divide-y divide-border">
                    {details.wifiAuth.recent.slice(0, 8).map((e, i) => (
                      <li key={i} className="py-1.5 text-xs flex items-center gap-2">
                        <span className={cn(
                          "px-1.5 py-0.5 rounded text-[10px] uppercase font-medium flex items-center gap-1",
                          e.event_type === "failure"
                            ? "bg-severity-error/15 text-severity-error"
                            : "bg-chart-2/15 text-chart-2",
                        )}>
                          {e.event_type === "failure" && <ShieldAlert className="h-3 w-3" />}
                          {e.event_type ?? "event"}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">{e.vap ?? ""}</span>
                        <span className="text-muted-foreground truncate flex-1">
                          {e.reason ?? (e.assoc_status != null ? `assoc=${e.assoc_status}` : "")}
                          {e.rssi != null ? `  ·  ${e.rssi} dBm` : ""}
                          {e.auth_failures ? `  ·  ${e.auth_failures} fail` : ""}
                        </span>
                        <span className="text-muted-foreground tabular-nums">{relativeTime(e.time)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            )}

            {details && details.ipHistory.length > 0 && (
              <Section title={`IP history (${details.ipHistory.length})`}>
                {details.dhcpHostname && (
                  <div className="text-[11px] text-muted-foreground mb-1.5">
                    DHCP hostname: <span className="font-mono text-foreground">{details.dhcpHostname}</span>
                  </div>
                )}
                <ul className="divide-y divide-border">
                  {details.ipHistory.slice(0, 8).map((h) => (
                    <li key={h.ip} className="py-1.5 text-xs flex items-center gap-2">
                      <span className="font-mono">{h.ip}</span>
                      <span className="text-muted-foreground flex-1 truncate">
                        seen {h.count}× · first {relativeTime(h.firstSeen)}
                      </span>
                      <span className="text-muted-foreground tabular-nums">{relativeTime(h.lastSeen)}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title={`Recent firewall events (${fwEvents.length})`}>
              {fwEvents.length === 0 ? (
                <p className="text-xs text-muted-foreground">No firewall events for this client.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {fwEvents.map((e) => (
                    <li key={e.id} className="py-1.5 text-xs flex items-center gap-2">
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] uppercase font-medium",
                        e.action === "failure" ? "bg-severity-error/15 text-severity-error" : "bg-chart-2/15 text-chart-2",
                      )}>{e.action}</span>
                      <span className="font-mono">{e.rule}</span>
                      <span className="text-muted-foreground truncate flex-1">{e.reason}</span>
                      <span className="text-muted-foreground tabular-nums">{relativeTime(e.time)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <button
              onClick={onClose}
              className="absolute top-3 right-3 p-1 text-muted-foreground hover:text-foreground"
            ><X className="h-4 w-4" /></button>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-background/30 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-medium mt-0.5 truncate">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">{title}</div>
      {children}
    </div>
  );
}
