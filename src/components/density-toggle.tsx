import { Rows3, Rows4 } from "lucide-react";
import { useUI } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

export function DensityToggle() {
  const { density, setDensity } = useUI();
  return (
    <div className="flex items-center rounded-md border border-border overflow-hidden">
      <button
        onClick={() => setDensity("comfortable")}
        title="Comfortable"
        className={cn(
          "px-2 py-1.5",
          density === "comfortable" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60",
        )}
      >
        <Rows3 className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => setDensity("compact")}
        title="Compact"
        className={cn(
          "px-2 py-1.5",
          density === "compact" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60",
        )}
      >
        <Rows4 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function useRowPad() {
  const { density } = useUI();
  return density === "compact" ? "py-1" : "py-2";
}
