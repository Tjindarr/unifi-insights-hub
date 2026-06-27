import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { PageHeader } from "@/components/app-shell";
import { ports, firmware, ssids } from "@/lib/mock-extra";
import { formatBits } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/ports")({
  head: () => ({ meta: [{ title: "Ports & Devices — UniFi Dashboard" }] }),
  component: PortsPage,
});

function PortsPage() {
  const devices = Array.from(new Set(ports.map((p) => p.device)));
  const [dev, setDev] = useState(devices[0]);

  const rows = ports.filter((p) => p.device === dev);

  return (
    <div>
      <PageHeader
        title="Ports & devices"
        description="Switch ports, PoE, firmware, and SSIDs"
        actions={
          <div className="flex rounded-md border border-border overflow-hidden text-xs">
            {devices.map((d) => (
              <button key={d} onClick={() => setDev(d)} className={cn("px-2.5 py-1.5", dev === d ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60")}>{d}</button>
            ))}
          </div>
        }
      />
      <div className="p-6 space-y-6">
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wider text-muted-foreground bg-secondary/40">
              <tr>
                <th className="text-left px-3 py-2">Port</th>
                <th className="text-left px-3 py-2">Link</th>
                <th className="text-left px-3 py-2">Speed</th>
                <th className="text-left px-3 py-2">PoE</th>
                <th className="text-left px-3 py-2">Neighbor</th>
                <th className="text-right px-3 py-2">Clients</th>
                <th className="text-right px-3 py-2">Errors</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-3 py-2 font-mono">{p.name}</td>
                  <td className="px-3 py-2">
                    <span className={cn("inline-flex items-center gap-1.5 text-xs",
                      p.link === "up" ? "text-chart-2" : p.link === "down" ? "text-muted-foreground" : "text-severity-warn",
                    )}>
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />{p.link}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{p.speed ? formatBits(p.speed * 1_000_000 / 8) : "—"} {p.duplex !== "—" && <span className="text-muted-foreground">{p.duplex}</span>}</td>
                  <td className="px-3 py-2 text-xs">
                    {p.poe > 0 ? (
                      <div className="flex items-center gap-2">
                        <div className="w-14 h-1 rounded-full bg-muted overflow-hidden"><div className="h-full bg-primary" style={{ width: `${(p.poe / p.poeMax) * 100}%` }} /></div>
                        <span className="tabular-nums">{p.poe} W</span>
                      </div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{p.neighbor ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-xs tabular-nums">{p.clientCount || ""}</td>
                  <td className={cn("px-3 py-2 text-right text-xs tabular-nums", (p.rxErr + p.txErr) > 0 && "text-severity-warn")}>{p.rxErr + p.txErr || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          <div className="rounded-lg border border-border bg-card">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-medium">Firmware</h2>
              <p className="text-xs text-muted-foreground">Device versions and last backup</p>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {firmware.map((f) => (
                  <tr key={f.device} className="border-t border-border">
                    <td className="px-3 py-2">
                      <div className="font-medium">{f.device}</div>
                      <div className="text-[10px] text-muted-foreground">{f.model}</div>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono">{f.current}</td>
                    <td className="px-3 py-2 text-xs">
                      {f.upToDate ? <span className="text-chart-2">up to date</span> : <span className="text-severity-warn">→ {f.latest}</span>}
                    </td>
                    <td className="px-3 py-2 text-xs text-right text-muted-foreground">backup {f.backup}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-border bg-card">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-medium">SSIDs</h2>
              <p className="text-xs text-muted-foreground">Wireless networks</p>
            </div>
            <table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr><th className="text-left px-3 py-2">SSID</th><th className="text-left px-3 py-2">Band</th><th className="text-right px-3 py-2">Clients</th><th className="text-right px-3 py-2">RX/TX</th><th className="text-right px-3 py-2">Retries</th></tr>
              </thead>
              <tbody>
                {ssids.map((s) => (
                  <tr key={s.name} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2 text-xs font-mono">{s.band}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.clients}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      <div className="text-rx">{formatBits(s.rx)}</div>
                      <div className="text-tx">{formatBits(s.tx)}</div>
                    </td>
                    <td className={cn("px-3 py-2 text-right text-xs tabular-nums", s.retries > 5 && "text-severity-warn")}>{s.retries}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
