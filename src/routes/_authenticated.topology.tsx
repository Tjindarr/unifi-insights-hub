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
  return (
    <div>
      <PageHeader title="Topology" description="Gateway, switches, and access points" actions={<DemoBadge isLive={isLive} />} />

      <div className="p-6">
        <div className="rounded-lg border border-border bg-card p-8 overflow-auto">
          <div className="flex flex-col items-center gap-10 min-w-[640px]">
            <Node icon={<Router className="h-5 w-5" />} title={topology.gateway.name} sub={topology.gateway.model} accent />
            <Line />
            <div className="flex items-start gap-12">
              {topology.switches.map((sw) => (
                <div key={sw.name} className="flex flex-col items-center gap-4">
                  <Node icon={<Server className="h-5 w-5" />} title={sw.name} sub={`${sw.model} · ${sw.clients} clients`} />
                  <Line />
                  <div className="flex gap-6">
                    {topology.aps.slice(0, 2).map((ap) => (
                      <Node key={ap.id + sw.name} icon={<Wifi className="h-5 w-5" />} title={ap.name} sub={`${ap.clients} clients`} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Node({ icon, title, sub, accent }: { icon: React.ReactNode; title: string; sub: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border ${accent ? "border-primary/60 bg-primary/10" : "border-border bg-background/50"} px-4 py-3 min-w-[180px] text-center`}>
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
