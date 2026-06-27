import { useEffect, useMemo, useState } from "react";
import { Columns3, GripVertical, RotateCcw } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export type ColumnDef<T> = {
  key: string;
  label: string;
  hint?: string;
  /** Visible by default if user has no saved preference. */
  defaultVisible?: boolean;
  /** Cannot be hidden by the user. */
  required?: boolean;
  align?: "left" | "right" | "center";
  /** Sort comparator value. If omitted column is not sortable. */
  sortValue?: (row: T) => number | string | null | undefined;
  className?: string;
  thClassName?: string;
  render: (row: T) => React.ReactNode;
};

type Persisted = { visible: string[]; order: string[] };

function loadState(key: string): Persisted | null {
  try {
    const raw = localStorage.getItem(`cols:${key}`);
    if (!raw) return null;
    const v = JSON.parse(raw) as Persisted;
    if (!Array.isArray(v.visible) || !Array.isArray(v.order)) return null;
    return v;
  } catch {
    return null;
  }
}

function saveState(key: string, v: Persisted) {
  try { localStorage.setItem(`cols:${key}`, JSON.stringify(v)); } catch { /* ignore */ }
}

export function useColumns<T>(storageKey: string, defs: ColumnDef<T>[]) {
  const defaults = useMemo<Persisted>(() => ({
    visible: defs.filter((c) => c.defaultVisible !== false).map((c) => c.key),
    order: defs.map((c) => c.key),
  }), [defs]);

  const [state, setState] = useState<Persisted>(defaults);

  useEffect(() => {
    const saved = loadState(storageKey);
    if (!saved) return;
    const known = new Set(defs.map((c) => c.key));
    const order = [
      ...saved.order.filter((k) => known.has(k)),
      ...defs.map((c) => c.key).filter((k) => !saved.order.includes(k)),
    ];
    const visible = saved.visible.filter((k) => known.has(k));
    for (const c of defs) {
      if (!saved.order.includes(c.key) && c.defaultVisible !== false && !visible.includes(c.key)) {
        visible.push(c.key);
      }
    }
    setState({ visible, order });
  }, [storageKey, defs]);

  function update(next: Persisted) {
    setState(next);
    saveState(storageKey, next);
  }

  const ordered = useMemo(() => {
    const byKey = new Map(defs.map((c) => [c.key, c] as const));
    return state.order.map((k) => byKey.get(k)!).filter(Boolean);
  }, [state.order, defs]);

  const visibleColumns = useMemo(() => {
    const vis = new Set(state.visible);
    return ordered.filter((c) => vis.has(c.key) || c.required);
  }, [ordered, state.visible]);

  function toggle(key: string) {
    const def = defs.find((c) => c.key === key);
    if (def?.required) return;
    const set = new Set(state.visible);
    if (set.has(key)) set.delete(key); else set.add(key);
    update({ ...state, visible: Array.from(set) });
  }

  function move(key: string, dir: -1 | 1) {
    const order = [...state.order];
    const i = order.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    update({ ...state, order });
  }

  function reset() {
    update(defaults);
  }

  const visibleSet = useMemo(() => new Set(visibleColumns.map((c) => c.key)), [visibleColumns]);

  return { visibleColumns, allColumns: ordered, visibleSet, toggle, move, reset };
}

export function ColumnPicker<T>({
  columns,
  visible,
  onToggle,
  onMove,
  onReset,
}: {
  columns: ColumnDef<T>[];
  visible: Set<string>;
  onToggle: (key: string) => void;
  onMove: (key: string, dir: -1 | 1) => void;
  onReset: () => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-secondary/60"
          title="Choose columns"
        >
          <Columns3 className="h-3.5 w-3.5" />
          Columns
          <span className="text-[10px] tabular-nums text-muted-foreground/70">
            {visible.size}/{columns.length}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0 bg-popover border-border">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-xs font-medium">Columns</span>
          <button onClick={onReset} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {columns.map((c) => {
            const checked = visible.has(c.key) || !!c.required;
            return (
              <div
                key={c.key}
                className={cn(
                  "group flex items-center gap-2 px-2 py-1.5 hover:bg-secondary/40",
                  c.required && "opacity-90",
                )}
              >
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40" />
                <Checkbox
                  checked={checked}
                  disabled={c.required}
                  onCheckedChange={() => onToggle(c.key)}
                  id={`col-${c.key}`}
                />
                <label htmlFor={`col-${c.key}`} className="flex-1 text-xs cursor-pointer select-none">
                  <div className="font-medium">{c.label}</div>
                  {c.hint && <div className="text-[10px] text-muted-foreground">{c.hint}</div>}
                </label>
                <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => onMove(c.key, -1)} className="px-1 text-[10px] text-muted-foreground hover:text-foreground" title="Move up">▲</button>
                  <button onClick={() => onMove(c.key, 1)} className="px-1 text-[10px] text-muted-foreground hover:text-foreground" title="Move down">▼</button>
                </div>
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
