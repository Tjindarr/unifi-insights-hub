import { cn } from "@/lib/utils";

/**
 * Small pill shown next to page titles when the UniFi controller is not
 * connected and the page is rendering deterministic mock data instead.
 */
export function DemoBadge({ isLive, className }: { isLive: boolean; className?: string }) {
  if (isLive) return null;
  return (
    <span
      title="UniFi controller not connected — showing demo data. Configure it in Settings."
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider font-medium border border-severity-warn/40 bg-severity-warn/10 text-severity-warn",
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-severity-warn animate-pulse" />
      Demo
    </span>
  );
}
