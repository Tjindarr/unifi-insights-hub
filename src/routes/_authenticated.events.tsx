import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, Cable, Download, Shield, User, Wifi } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { DemoBadge } from "@/components/demo-badge";
import { useEvents } from "@/lib/live";
import { formatDateTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/events")({
  head: () => ({ meta: [{ title: "Events — UniFi Dashboard" }] }),
  component: EventsPage,
});

const icons = {
  admin: User,
  wan: Cable,
  firmware: Download,
  client: Wifi,
  system: Shield,
} as const;

function EventsPage() {
  const { data: siteEvents, isLive } = useEvents();

  return (
    <div>
      <PageHeader title="Events" description="Admin actions, WAN flaps, firmware, system" actions={<DemoBadge isLive={isLive} />} />
      <div className="p-6">
        <ul className="rounded-lg border border-border bg-card divide-y divide-border">
          {siteEvents.map((e) => {
            const Icon = icons[e.kind] ?? AlertCircle;
            return (
              <li key={e.id} className="px-4 py-3 flex items-center gap-3">
                <Icon className={cn("h-4 w-4 shrink-0",
                  e.severity === "error" ? "text-severity-error" : e.severity === "warn" ? "text-severity-warn" : "text-muted-foreground",
                )} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{e.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{e.detail}</div>
                </div>
                <div className="text-right text-xs">
                  <div className="font-mono">{formatDateTime(e.time)}</div>
                  <div className="text-muted-foreground">{relativeTime(e.time)}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
