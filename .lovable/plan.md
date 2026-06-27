## What I understand

The events-per-minute chart should be based only on the global time picker in the top right:

- If you select `15m`, the chart shows counts for the last 15 minutes.
- If you select `1h`, the chart shows counts for the last hour.
- If you select `24h`, the chart shows counts for the last 24 hours.
- The table limit (`Last 500`, `Last 1000`, etc.) must only affect the log rows shown below the chart.
- Changing the table limit must not change the chart at all.

## Plan

1. **Trace both timeline data paths**
   - Check the firewall page, internal page, `src/lib/live.ts`, and the server API route for bucket queries.
   - Identify where the chart is still falling back to the currently displayed rows or sharing the table limit.

2. **Make chart queries independent**
   - Ensure firewall and internal charts call a dedicated bucket API using only:
     - selected global time range
     - bucket size
     - event kind: `firewall` or `internal`
   - Remove any fallback that buckets the currently displayed table rows for these charts.

3. **Keep table queries separate**
   - Keep `Last 500 / 1000 / ...` only on the log list query.
   - Do not pass that limit into chart hooks or bucket endpoints.

4. **Fix server-side bucket windowing if needed**
   - Make the bucket SQL use the selected range window consistently.
   - Preserve the existing clock-skew handling, but ensure it still spans the selected time range rather than the last N fetched rows.

5. **Verify behavior**
   - Confirm that changing `Last 500` to `Last 1000` does not change chart totals/bars.
   - Confirm that changing the top-right time range does change the chart window.