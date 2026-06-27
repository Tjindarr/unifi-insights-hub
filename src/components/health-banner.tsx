import { Activity, Database, Radio, Timer } from "lucide-react";
import { collector } from "@/lib/mock-extra";
import { formatBytes } from "@/lib/format";

export function HealthBanner() {
  const c = collector;
  const stale = c.unifiPollAgeSec > 30;
  return (
    <div className="flex items-center gap-5 px-6 py-2 border-b border-border bg-card/40 text-[11px] font-mono">
      <Pill icon={<Radio className="h-3 w-3" />} label="syslog" value={`${c.msgsPerSec} msg/s`} ok={c.syslogQueueDepth === 0} />
      <Pill icon={<Timer className="h-3 w-3" />} label="unifi poll" value={`${c.unifiPollMs} ms · ${c.unifiPollAgeSec}s ago`} ok={!stale} />
      <Pill icon={<Database className="h-3 w-3" />} label="db" value={`${formatBytes(c.dbSizeBytes)} · ${c.fts5Indexed.toLocaleString()} idx`} ok />
      <Pill icon={<Activity className="h-3 w-3" />} label="retention" value={`${c.oldestEntryDays}d / ${c.retentionDays}d`} ok={c.oldestEntryDays < c.retentionDays} />
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
