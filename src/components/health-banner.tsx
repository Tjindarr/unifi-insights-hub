import { Activity, AlertTriangle, Database, Radio, Timer } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { useCollector } from "@/lib/live";
import { formatBytes } from "@/lib/format";

export function HealthBanner() {
  const { data: c, isLive } = useCollector();
  const stale = c.unifiPollAgeSec > 30;
  return (
    <div className="flex items-center gap-5 px-6 py-2 border-b border-border bg-card/40 text-[11px] font-mono">
      <Pill icon={<Radio className="h-3 w-3" />} label="syslog" value={`${c.msgsPerSec} msg/s`} ok={c.syslogQueueDepth === 0} />
      <Pill
        icon={<Timer className="h-3 w-3" />}
        label="unifi"
        value={
          !c.unifiConfigured
            ? "not configured"
            : !c.unifiOk
            ? "disconnected"
            : `${c.unifiPollAgeSec}s ago`
        }
        ok={c.unifiOk && !stale}
      />
      <Pill icon={<Database className="h-3 w-3" />} label="db" value={`${formatBytes(c.dbSizeBytes)} · ${c.fts5Indexed.toLocaleString()} idx`} ok />
      <Pill icon={<Activity className="h-3 w-3" />} label="retention" value={`${c.oldestEntryDays}d / ${c.retentionDays}d`} ok={c.oldestEntryDays < c.retentionDays} />
      {!isLive && (
        <Link
          to="/settings"
          className="ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-severity-warn/40 bg-severity-warn/10 text-severity-warn hover:bg-severity-warn/20"
        >
          <AlertTriangle className="h-3 w-3" />
          <span className="uppercase tracking-wider text-[10px]">Demo data — connect UniFi</span>
        </Link>
      )}
    </div>
  );
}

function Pill({ icon, label, value, ok }: { icon: React.ReactNode; label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={ok ? "text-chart-2" : "text-severity-warn"}>{icon}</span>
      <span className="text-muted-foreground uppercase tracking-wider text-[10px]">{label}</span>
      <span className={ok ? "text-foreground" : "text-severity-warn"}>{value}</span>
    </div>
  );
}
