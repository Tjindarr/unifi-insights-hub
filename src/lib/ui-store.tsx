// Lightweight UI state shared across pages: global time range + table density.
// Persisted in localStorage so preferences survive reloads.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type TimeRangeKey = "15m" | "1h" | "24h" | "7d" | "30d";
export const TIME_RANGES: { key: TimeRangeKey; label: string; minutes: number }[] = [
  { key: "15m", label: "15m", minutes: 15 },
  { key: "1h",  label: "1h",  minutes: 60 },
  { key: "24h", label: "24h", minutes: 60 * 24 },
  { key: "7d",  label: "7d",  minutes: 60 * 24 * 7 },
  { key: "30d", label: "30d", minutes: 60 * 24 * 30 },
];

export type Density = "comfortable" | "compact";

type Ctx = {
  range: TimeRangeKey;
  setRange: (k: TimeRangeKey) => void;
  density: Density;
  setDensity: (d: Density) => void;
  paletteOpen: boolean;
  setPaletteOpen: (b: boolean) => void;
};

const UIContext = createContext<Ctx | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [range, setRange] = useState<TimeRangeKey>("1h");
  const [density, setDensity] = useState<Density>("comfortable");
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const r = localStorage.getItem("ui-range") as TimeRangeKey | null;
    const d = localStorage.getItem("ui-density") as Density | null;
    if (r) setRange(r);
    if (d) setDensity(d);
  }, []);

  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("ui-range", range); }, [range]);
  useEffect(() => { if (typeof window !== "undefined") localStorage.setItem("ui-density", density); }, [density]);

  // Global cmd-k / ctrl-k
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <UIContext.Provider value={{ range, setRange, density, setDensity, paletteOpen, setPaletteOpen }}>
      {children}
    </UIContext.Provider>
  );
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI requires UIProvider");
  return ctx;
}

// j/k keyboard table navigation
export function useListKeyboardNav(
  count: number,
  onActivate?: (idx: number) => void,
) {
  const [idx, setIdx] = useState(-1);
  useEffect(() => {
    const tag = () => (document.activeElement?.tagName ?? "").toLowerCase();
    const onKey = (e: KeyboardEvent) => {
      if (["input", "textarea", "select"].includes(tag())) return;
      if (e.key === "j") { setIdx((i) => Math.min(count - 1, i + 1)); e.preventDefault(); }
      else if (e.key === "k") { setIdx((i) => Math.max(0, i - 1)); e.preventDefault(); }
      else if (e.key === "Enter" && idx >= 0) onActivate?.(idx);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, idx, onActivate]);
  return idx;
}
