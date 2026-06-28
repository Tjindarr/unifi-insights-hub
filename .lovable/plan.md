## Goal
On `/firewall`, let the user search the firewall log for an exact timespan — e.g. `2026-05-01 12:45 → 2026-05-01 13:45` — not just "last 1h / 24h". Backend already supports it; the page just doesn't expose it.

## What's already there
- `recentFirewall` accepts `since` + `until` (ms) and `/api/firewall` exposes both.
- `firewall_events_fts` makes filtered queries fast.
- `useFirewall` only sends `since` and there's no UI to pick a window — the Firewall page currently shows "last N events" with no time bound at all.

## Changes (frontend only)

1. **`src/lib/live.ts` — `useFirewall`**
   - Add `until?: number` to the options and append it to the query string.
   - Add `since?: number` is already there; keep behaviour.
   - When a custom window is active the caller will pass both bounds; query key already includes them via `qs.toString()`.

2. **`src/routes/_authenticated.firewall.tsx` — Range toolbar**
   - New state: `customFrom: string`, `customTo: string` (datetime-local strings), `customActive = !!(from && to && from < to)`.
   - Persist to `localStorage("firewall-custom-range")` so reloads keep it.
   - Derive `sinceMs` / `untilMs`:
     - If custom is active → use those exact ms bounds.
     - Else → fall back to the global `useUI().range` window (compute `sinceMs` from `rangeMinutes`, leave `untilMs` undefined for "up to now").
   - Pass `since` + `until` into `useFirewall({ kind: "firewall", limit, paused, since, until })`.
   - Pass the same `since`/`rangeMs` into `useFirewallByMinute` so the chart matches the table (extend that hook with optional `since`/`rangeMs` overrides — endpoint already accepts both).

3. **UI placement**
   - Add a dedicated **Time range** row directly under `PageHeader`, above the events chart, so it's not lost in the wrapped header toolbar.
   - Layout:
     - Quick presets: `15m · 1h · 24h · 7d · 30d` (set global `useUI` range, clear custom).
     - `From` + `To` shadcn date+time pickers (`Popover` + `Calendar` with `pointer-events-auto` + `<input type="time">` inside the popover) — falls back gracefully to `<input type="datetime-local">` if simpler.
     - `Apply` button (disabled until both valid and From < To).
     - `Clear` button (only shown when custom active) → resets to global range.
     - Active-window readout: `2026-05-01 12:45 → 2026-05-01 13:45 (1h, 1,234 events)`.
   - Inline validation message when From ≥ To.

4. **Pagination / limit interplay**
   - When the window changes, reset `limit` to its default (1000). Existing limit dropdown keeps working inside the custom window.

5. **Header description**
   - Update the subtitle to include the active window so it's obvious the table is scoped to it.

## Files touched
- `src/lib/live.ts` (add `until` to `useFirewall`)
- `src/routes/_authenticated.firewall.tsx` (state, toolbar, wiring)
- Optional: extract the toolbar into `src/components/firewall-range-toolbar.tsx` if it grows past ~80 lines.

No backend, schema, or query changes — the timespan capability already exists server-side; this exposes it on `/firewall`.