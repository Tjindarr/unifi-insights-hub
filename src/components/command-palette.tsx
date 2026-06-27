import { useNavigate } from "@tanstack/react-router";
import {
  Activity, Cable, Flame, LayoutDashboard, ScrollText, Settings, Wifi,
  Network, BarChart3, Plug, AlertCircle, Search,
} from "lucide-react";

import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { useUI } from "@/lib/ui-store";
import { clients, firewallEvents } from "@/lib/mock-data";

const pages = [
  { label: "Overview",     to: "/",          icon: LayoutDashboard },
  { label: "Clients",      to: "/clients",   icon: Wifi },
  { label: "Network",      to: "/network",   icon: Activity },
  { label: "WAN",          to: "/wan",       icon: Cable },
  { label: "Topology",     to: "/topology",  icon: Network },
  
  { label: "Ports",        to: "/ports",     icon: Plug },
  { label: "Firewall",     to: "/firewall",  icon: Flame },
  { label: "Events",       to: "/events",    icon: AlertCircle },
  { label: "Logs",         to: "/logs",      icon: ScrollText },
  { label: "Settings",     to: "/settings",  icon: Settings },
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
      <CommandInput placeholder="Jump to page, client, MAC, IP, rule…" />
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
        <CommandGroup heading="Clients">
          {clients.slice(0, 20).map((c) => (
            <CommandItem
              key={c.id}
              value={`client ${c.hostname} ${c.mac} ${c.ip}`}
              onSelect={() => go(`/clients?focus=${c.id}`)}
            >
              {c.wired ? <Cable className="h-4 w-4 mr-2 text-muted-foreground" /> : <Wifi className="h-4 w-4 mr-2 text-muted-foreground" />}
              <span className="flex-1">{c.hostname}</span>
              <span className="text-[10px] text-muted-foreground font-mono">{c.ip}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Firewall rules">
          {Array.from(new Set(firewallEvents.map((e) => e.rule))).slice(0, 8).map((rule) => (
            <CommandItem key={rule} value={`rule ${rule}`} onSelect={() => go(`/firewall?rule=${rule}`)}>
              <Flame className="h-4 w-4 mr-2 text-muted-foreground" />
              {rule}
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
