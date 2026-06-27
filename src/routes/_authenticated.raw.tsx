import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Copy, Download, Search } from "lucide-react";

import { PageHeader, SeverityDot } from "@/components/app-shell";
import { DemoBadge } from "@/components/demo-badge";
import { Input } from "@/components/ui/input";
import { useSyslog } from "@/lib/live";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/raw")({
  head: () => ({ meta: [{ title: "Raw syslog — UniFi Dashboard" }] }),
  component: RawPage,
});

type Mode = "raw" | "message" | "ndjson";

function RawPage() {
  const { data: syslog, isLive } = useSyslog();
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("raw");
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    if (!ql) return syslog;
    return syslog.filter((s) =>
      s.host.toLowerCase().includes(ql) ||
      s.appname.toLowerCase().includes(ql) ||
      s.message.toLowerCase().includes(ql) ||
      (s.raw ?? "").toLowerCase().includes(ql),
    );
  }, [syslog, q]);

  const text = useMemo(() => {
    if (mode === "ndjson") return rows.map((s) => JSON.stringify(s)).join("\n");
    if (mode === "message") return rows.map((s) => s.message).join("\n");
    return rows.map((s) => s.raw || s.message).join("\n");
  }, [rows, mode]);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied("all");
      setTimeout(() => setCopied(null), 1200);
    } catch { /* */ }
  }

  async function copyOne(id: string, line: string) {
    try {
      await navigator.clipboard.writeText(line);
      setCopied(id);
      setTimeout(() => setCopied(null), 1200);
    } catch { /* */ }
  }

  function download() {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `syslog-${mode}-${Date.now()}.${mode === "ndjson" ? "ndjson" : "log"}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        title="Raw syslog"
        description={`${rows.length} of ${syslog.length} messages — copy/paste friendly view`}
        actions={
          <div className="flex items-center gap-2">
            <DemoBadge isLive={isLive} />
            <div className="flex rounded-md border border-border overflow-hidden text-xs">
              {(["raw", "message", "ndjson"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "px-2.5 py-1.5 capitalize",
                    mode === m ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
            <button
              onClick={() => setWrap((w) => !w)}
              className={cn(
                "px-2.5 py-1.5 rounded-md border border-border text-xs",
                wrap ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-secondary/60",
              )}
            >
              Wrap
            </button>
            <button onClick={download} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-secondary/60">
              <Download className="h-3.5 w-3.5" />Download
            </button>
            <button onClick={copyAll} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-border text-xs text-muted-foreground hover:bg-secondary/60">
              <Copy className="h-3.5 w-3.5" />
              {copied === "all" ? "Copied" : "Copy all"}
            </button>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="filter host, app, message…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-7 h-8 w-72 font-mono"
              />
            </div>
          </div>
        }
      />

      <div className="p-6">
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <ul className="divide-y divide-border max-h-[calc(100vh-220px)] overflow-auto">
            {rows.map((s) => {
              const line = mode === "ndjson" ? JSON.stringify(s) : mode === "message" ? s.message : (s.raw || s.message);
              return (
                <li key={s.id} className="group px-3 py-2 hover:bg-secondary/20">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono mb-1">
                    <SeverityDot severity={s.severity} />
                    <span>{formatDateTime(s.time)}</span>
                    <span>{s.host}</span>
                    <span className="text-foreground/70">{s.appname}</span>
                    <button
                      onClick={() => copyOne(s.id, line)}
                      className="ml-auto opacity-0 group-hover:opacity-100 flex items-center gap-1 px-1.5 py-0.5 rounded border border-border hover:bg-secondary/60"
                    >
                      <Copy className="h-3 w-3" />
                      {copied === s.id ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre
                    className={cn(
                      "text-xs font-mono text-foreground/90",
                      wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre overflow-x-auto",
                    )}
                  >
                    {line}
                  </pre>
                </li>
              );
            })}
            {rows.length === 0 && (
              <li className="px-3 py-8 text-center text-sm text-muted-foreground">No messages match the filter.</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
