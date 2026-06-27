import { createFileRoute } from "@tanstack/react-router";
import { Router, Server, Wifi } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { DemoBadge } from "@/components/demo-badge";
import { useTopology } from "@/lib/live";

export const Route = createFileRoute("/_authenticated/topology")({
  head: () => ({ meta: [{ title: "Topology — UniFi Dashboard" }] }),
  component: TopologyPage,
});

function TopologyPage() {
  const { data: topology, isLive } = useTopology();
  const switches = topology.switches ?? [];
  const aps = topology.aps ?? [];
  const gatewayMac = (topology.gateway as any).mac ?? "";

  // Group APs by uplink: switch mac, gateway mac, or "direct"
  const apsBySwitch = new Map<string, typeof aps>();
  const apsDirect: typeof aps = [];
  for (const ap of aps) {
    const up = (ap as any).uplinkMac ?? "";
    const sw = switches.find((s) => s.mac && s.mac === up);
    if (sw) {
      const arr = apsBySwitch.get(sw.mac) ?? [];
      arr.push(ap);
      apsBySwitch.set(sw.mac, arr);
    } else {
      apsDirect.push(ap);
    }
  }

  return (
    <div>
      <PageHeader title="Topology" description="Gateway, switches, and access points" actions={<DemoBadge isLive={isLive} />} />

      <div className="p-6">
        <div className="rounded-lg border border-border bg-card p-8 overflow-auto">
          <div className="flex flex-col items-center gap-8 min-w-[640px]">
            <Node icon={<Router className="h-5 w-5" />} title={topology.gateway.name} sub={topology.gateway.model} accent />
            <Line />
            <div className="flex flex-wrap items-start justify-center gap-10">
              {switches.map((sw) => {
                const downAps = apsBySwitch.get(sw.mac) ?? [];
                return (
                  <div key={sw.mac || sw.name} className="flex flex-col items-center gap-4">
                    <Node icon={<Server className="h-5 w-5" />} title={sw.name} sub={`${sw.model} · ${sw.ports} ports · ${sw.clients} clients`} />
                    {downAps.length > 0 && <Line />}
                    {downAps.length > 0 && (
                      <div className="flex flex-wrap justify-center gap-4">
                        {downAps.map((ap) => (
                          <Node key={ap.id} icon={<Wifi className="h-5 w-5" />} title={ap.name} sub={`${ap.model} · ${ap.clients} clients`} status={ap.status} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {apsDirect.map((ap) => (
                <div key={ap.id} className="flex flex-col items-center gap-4">
                  <Node icon={<Wifi className="h-5 w-5" />} title={ap.name} sub={`${ap.model} · ${ap.clients} clients`} status={ap.status} />
                </div>
              ))}
              {switches.length === 0 && apsDirect.length === 0 && (
                <div className="text-xs text-muted-foreground">No downstream devices reported by the controller.</div>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">
              Gateway MAC: {gatewayMac || "—"} · {switches.length} switch{switches.length === 1 ? "" : "es"} · {aps.length} AP{aps.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Node({
  icon, title, sub, accent, status,
}: { icon: React.ReactNode; title: string; sub: string; accent?: boolean; status?: "online" | "offline" | "degraded" }) {
  const dot =
    status === "offline" ? "bg-destructive" :
    status === "degraded" ? "bg-yellow-500" :
    status ? "bg-emerald-500" : "";
  return (
    <div className={`rounded-lg border ${accent ? "border-primary/60 bg-primary/10" : "border-border bg-background/50"} px-4 py-3 min-w-[200px] text-center relative`}>
      {status && <span className={`absolute top-2 right-2 h-2 w-2 rounded-full ${dot}`} />}
      <div className="flex items-center justify-center gap-2">
        <span className={accent ? "text-primary" : "text-muted-foreground"}>{icon}</span>
        <span className="text-sm font-medium">{title}</span>
      </div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}

function Line() {
  return <div className="h-6 w-px bg-border" />;
}
