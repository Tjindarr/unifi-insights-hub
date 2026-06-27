import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/app-shell";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({
    meta: [{ title: "Settings — UniFi Dashboard" }],
  }),
  component: SettingsPage,
});

const envVars: Array<{ key: string; desc: string; example?: string }> = [
  { key: "UNIFI_HOST", desc: "IP or hostname of your UniFi controller / Dream Router", example: "192.168.1.1" },
  { key: "UNIFI_USER", desc: "Read-only user created on the UniFi controller" },
  { key: "UNIFI_PASSWORD", desc: "Password for the read-only user" },
  { key: "UNIFI_SITE", desc: "Site name", example: "default" },
  { key: "SYSLOG_UDP_PORT", desc: "UDP port the syslog listener binds to", example: "514" },
  { key: "HTTP_PORT", desc: "HTTP port the dashboard serves on", example: "3000" },
  { key: "RETENTION_DAYS", desc: "How many days of syslog history to keep", example: "30" },
  { key: "DB_PATH", desc: "SQLite database file path inside the container", example: "/data/unifi.db" },
  { key: "DASH_USER", desc: "Dashboard login username" },
  { key: "DASH_PASSWORD", desc: "Dashboard login password" },
  { key: "SESSION_SECRET", desc: "Random 32+ character string used to encrypt the session cookie" },
];

function SettingsPage() {
  return (
    <div>
      <PageHeader title="Settings" description="Configuration is managed via container environment variables" />
      <div className="p-6 space-y-6 max-w-3xl">
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-medium">Environment</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Pass these to the container via <code className="font-mono">-e</code> flags, a{" "}
            <code className="font-mono">docker-compose.yml</code>, or your Unraid template.
          </p>
          <div className="mt-4 divide-y divide-border">
            {envVars.map((v) => (
              <div key={v.key} className="py-2 grid grid-cols-[200px_1fr] gap-3 items-baseline">
                <code className="font-mono text-xs text-primary">{v.key}</code>
                <div className="text-xs">
                  <div>{v.desc}</div>
                  {v.example && (
                    <div className="text-muted-foreground mt-0.5">
                      example: <code className="font-mono">{v.example}</code>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-sm font-medium">UniFi setup</h2>
          <ol className="mt-3 space-y-2 text-xs text-muted-foreground list-decimal list-inside leading-relaxed">
            <li>
              In the UniFi console, create a <strong className="text-foreground">read-only</strong>{" "}
              local user and put its credentials in <code className="font-mono">UNIFI_USER</code> /{" "}
              <code className="font-mono">UNIFI_PASSWORD</code>.
            </li>
            <li>
              Under <strong className="text-foreground">Settings → System → Remote Logging</strong>,
              enable Syslog forwarding to the IP of your Unraid server on UDP{" "}
              <code className="font-mono">514</code>. Tick all log levels you want captured.
            </li>
            <li>
              Map host port <code className="font-mono">514/udp</code> to the container and persist{" "}
              <code className="font-mono">/data</code> on an Unraid share so the SQLite DB survives
              restarts.
            </li>
          </ol>
        </section>
      </div>
    </div>
  );
}
