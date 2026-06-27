import { TIME_RANGES, useUI } from "@/lib/ui-store";
import { cn } from "@/lib/utils";
import { Clock } from "lucide-react";

export function TimeRangePicker() {
  const { range, setRange } = useUI();
  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-card px-1 py-1 text-xs">
      <Clock className="h-3.5 w-3.5 text-muted-foreground ml-1" />
      {TIME_RANGES.map((r) => (
        <button
          key={r.key}
          onClick={() => setRange(r.key)}
          className={cn(
            "px-2 py-1 rounded transition-colors tabular-nums",
            range === r.key
              ? "bg-secondary text-secondary-foreground"
              : "text-muted-foreground hover:bg-secondary/60",
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
