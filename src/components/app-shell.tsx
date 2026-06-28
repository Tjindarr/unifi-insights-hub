import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  AlertCircle, Command as CommandIcon, FileText, Flame,
  LayoutDashboard, LogOut, Radio, ScrollText, Search, Settings, Shield,
} from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { signOut } from "@/lib/auth";
import { useUI } from "@/lib/ui-store";
import { TimeRangePicker } from "@/components/time-range";
import { HealthBanner } from "@/components/health-banner";
import { CommandPalette } from "@/components/command-palette";

type NavItem = {
  to: "/" | "/firewall" | "/internal" | "/events" | "/logs" | "/raw" | "/settings";
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
  group: "Monitor" | "Security" | "System";
};

const nav: NavItem[] = [
  { to: "/",         label: "Overview", icon: LayoutDashboard, exact: true, group: "Monitor" },
  { to: "/firewall", label: "Firewall", icon: Flame,                         group: "Security" },
  { to: "/internal", label: "Internal", icon: Radio,                         group: "Security" },
  { to: "/events",   label: "Events",   icon: AlertCircle,                   group: "Security" },
  { to: "/logs",     label: "Logs",     icon: ScrollText,                    group: "Security" },
  { to: "/raw",      label: "Raw syslog", icon: FileText,                    group: "Security" },
  { to: "/settings", label: "Settings", icon: Settings,                      group: "System" },
];

const groups = ["Monitor", "Security", "System"] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { setPaletteOpen } = useUI();

  function handleSignOut() {
    signOut();
    navigate({ to: "/login" });
  }

  return (
    <div className="min-h-screen grid grid-cols-[220px_1fr] bg-background text-foreground">
      <aside className="border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex flex-col">
        <div className="px-4 py-4 flex items-center gap-2 border-b border-sidebar-border">
          <div className="h-8 w-8 rounded-md bg-primary/15 flex items-center justify-center ring-1 ring-primary/30">
            <Flame className="h-4 w-4 text-primary" />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">FireSight</div>
            <div className="text-[11px] text-muted-foreground">Firewall analytics</div>
          </div>
          <div className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-chart-2 animate-pulse" />
            LIVE
          </div>
        </div>

        <nav className="flex-1 p-2 space-y-3 overflow-y-auto">
          {groups.map((g) => (
            <div key={g}>
              <div className="px-2 pt-1 pb-1 text-[9px] uppercase tracking-wider text-muted-foreground/70">{g}</div>
              {nav.filter((n) => n.group === g).map((item) => {
                const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "flex items-center gap-2.5 px-3 py-1.5 rounded-md text-[13px] transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-2">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex flex-col">
        <div className="flex items-center gap-3 px-6 py-2 border-b border-border bg-card/30">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 text-xs text-muted-foreground border border-border rounded-md px-2 py-1.5 hover:bg-secondary/60 transition-colors w-72"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Quick search…</span>
            <kbd className="ml-auto inline-flex items-center gap-0.5 font-mono text-[10px]">
              <CommandIcon className="h-3 w-3" />K
            </kbd>
          </button>
          <div className="ml-auto">
            <TimeRangePicker />
          </div>
        </div>
        <HealthBanner />
        <div className="flex-1 min-w-0">{children}</div>
        <CommandPalette />
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4 px-6 py-5 border-b border-border">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: "rx" | "tx" | "primary" | "warn" | "error";
}) {
  const accentClass: Record<string, string> = {
    rx: "text-rx",
    tx: "text-tx",
    primary: "text-primary",
    warn: "text-severity-warn",
    error: "text-severity-error",
  };
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-2 text-2xl font-semibold tabular-nums tracking-tight",
          accent && accentClass[accent],
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

export function SeverityDot({ severity }: { severity: string }) {
  const color: Record<string, string> = {
    info: "bg-severity-info",
    notice: "bg-severity-notice",
    warn: "bg-severity-warn",
    error: "bg-severity-error",
    critical: "bg-severity-critical",
  };
  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full", color[severity] ?? "bg-muted-foreground")}
    />
  );
}
