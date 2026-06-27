import { cn } from "@/lib/utils";

export function SkeletonRow({ className }: { className?: string }) {
  return <div className={cn("h-3 rounded bg-muted animate-pulse", className)} />;
}

export function SkeletonTiles({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-4 space-y-2">
          <SkeletonRow className="w-20" />
          <SkeletonRow className="w-32 h-5" />
        </div>
      ))}
    </div>
  );
}
