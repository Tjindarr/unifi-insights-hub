// Rolling per-minute counters for syslog ingestion health.
// Kept in memory only — meant for a small dashboard widget, not long-term audit.

export type HealthBucket = {
  t: number; // bucket start, unix ms
  accepted: number;
  rejected: number;
  tzSkewed: number;
  cefFailures: number;
};

const BUCKET_MS = 60_000;
const KEEP_BUCKETS = 120; // 2 hours of 1-minute buckets

const buckets = new Map<number, HealthBucket>();
const totals: Omit<HealthBucket, "t"> = {
  accepted: 0, rejected: 0, tzSkewed: 0, cefFailures: 0,
};

function current(now = Date.now()): HealthBucket {
  const key = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  let b = buckets.get(key);
  if (!b) {
    b = { t: key, accepted: 0, rejected: 0, tzSkewed: 0, cefFailures: 0 };
    buckets.set(key, b);
    // Drop anything past the keep window.
    if (buckets.size > KEEP_BUCKETS) {
      const cutoff = key - KEEP_BUCKETS * BUCKET_MS;
      for (const k of buckets.keys()) if (k < cutoff) buckets.delete(k);
    }
  }
  return b;
}

export type HealthKind = "accepted" | "rejected" | "tzSkewed" | "cefFailures";

export function recordParse(kind: HealthKind, now = Date.now()): void {
  current(now)[kind]++;
  totals[kind]++;
}

export function parseHealthSnapshot(windowMs = 60 * 60_000): {
  buckets: HealthBucket[];
  windowTotals: Omit<HealthBucket, "t">;
  totals: Omit<HealthBucket, "t">;
} {
  const now = Date.now();
  current(now); // make sure latest bucket exists
  const cutoff = Math.floor((now - windowMs) / BUCKET_MS) * BUCKET_MS;
  const startKey = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  const out: HealthBucket[] = [];
  const wt = { accepted: 0, rejected: 0, tzSkewed: 0, cefFailures: 0 };
  for (let k = cutoff; k <= startKey; k += BUCKET_MS) {
    const b = buckets.get(k) ?? { t: k, accepted: 0, rejected: 0, tzSkewed: 0, cefFailures: 0 };
    out.push(b);
    wt.accepted += b.accepted;
    wt.rejected += b.rejected;
    wt.tzSkewed += b.tzSkewed;
    wt.cefFailures += b.cefFailures;
  }
  return { buckets: out, windowTotals: wt, totals: { ...totals } };
}
