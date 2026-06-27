// Tiny CSV / NDJSON download helpers.

function download(name: string, body: string, mime: string) {
  if (typeof document === "undefined") return;
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportCsv<T extends Record<string, unknown>>(name: string, rows: T[]) {
  if (!rows.length) return;
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const head = cols.join(",");
  const body = rows.map((r) => cols.map((c) => csvEscape(r[c])).join(",")).join("\n");
  download(`${name}.csv`, `${head}\n${body}\n`, "text/csv");
}

export function exportNdjson<T>(name: string, rows: T[]) {
  download(`${name}.ndjson`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "application/x-ndjson");
}
