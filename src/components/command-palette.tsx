import { useNavigate } from "@tanstack/react-router";
import {
  AlertCircle, FileText, Flame, LayoutDashboard, Radio, ScrollText, Search, Settings,
} from "lucide-react";

import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { useUI } from "@/lib/ui-store";

const pages = [
  { label: "Overview",   to: "/",          icon: LayoutDashboard },
  { label: "Firewall",   to: "/firewall",  icon: Flame },
  { label: "Internal",   to: "/internal",  icon: Radio },
  { label: "Events",     to: "/events",    icon: AlertCircle },
  { label: "Logs",       to: "/logs",      icon: ScrollText },
  { label: "Raw syslog", to: "/raw",       icon: FileText },
  { label: "Settings",   to: "/settings",  icon: Settings },
] as const;

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = useUI();
  const navigate = useNavigate();

  const go = (to: string) => {
    setPaletteOpen(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    navigate({ to: to as any });
  };

  return (
    <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <CommandInput placeholder="Jump to page…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Pages">
          {pages.map((p) => (
            <CommandItem key={p.to} value={`page ${p.label}`} onSelect={() => go(p.to)}>
              <p.icon className="h-4 w-4 mr-2 text-muted-foreground" />
              {p.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Search">
          <CommandItem value="open log search" onSelect={() => go("/logs")}>
            <Search className="h-4 w-4 mr-2 text-muted-foreground" />
            Open log search
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
