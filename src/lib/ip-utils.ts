// Utilities for classifying IP addresses and looking up GeoIP / threat info
// via the server-side /api/ipinfo proxy (ip-api.com + optional AbuseIPDB).

import { useQuery } from "@tanstack/react-query";

/** RFC1918 / loopback / link-local / multicast / CGNAT. */
export function isPrivateIp(ip?: string | null): boolean {
  if (!ip) return true;
  const v = ip.trim();
  if (!v) return true;
  if (v.includes(":")) {
    const lower = v.toLowerCase();
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fe80") ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("ff")
    );
  }
  return /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|22[4-9]\.|2[3-5]\d\.|255\.255\.255\.255)/.test(v);
}

/** Pick the side of the conversation that is on the public internet, if any. */
export function externalIp(e: { srcIp?: string | null; dstIp?: string | null }): string | null {
  if (e.srcIp && !isPrivateIp(e.srcIp)) return e.srcIp;
  if (e.dstIp && !isPrivateIp(e.dstIp)) return e.dstIp;
  return null;
}

/** Convert a 2-letter ISO country code into a flag emoji. */
export function ccToFlag(cc?: string | null): string {
  if (!cc || cc.length !== 2) return "🌐";
  const A = 0x1f1e6;
  const up = cc.toUpperCase();
  return String.fromCodePoint(A + up.charCodeAt(0) - 65, A + up.charCodeAt(1) - 65);
}

export type IpInfo = {
  country?: string;
  cc?: string;
  city?: string;
  isp?: string;
  abuseScore?: number;
  abuseReports?: number;
};

/** Threat tier derived from AbuseIPDB confidence score (0..100). */
export function threatTier(score?: number): "unknown" | "clean" | "low" | "medium" | "high" {
  if (score == null) return "unknown";
  if (score >= 75) return "high";
  if (score >= 40) return "medium";
  if (score >= 10) return "low";
  return "clean";
}

export function useIpInfo(ips: string[]) {
  const sorted = Array.from(new Set(ips.filter(Boolean))).sort();
  const key = sorted.join(",");
  return useQuery<Record<string, IpInfo>>({
    queryKey: ["ipinfo", key],
    enabled: sorted.length > 0,
    staleTime: 6 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const out: Record<string, IpInfo> = {};
      for (let i = 0; i < sorted.length; i += 80) {
        const chunk = sorted.slice(i, i + 80);
        const r = await fetch(`/api/ipinfo?ips=${encodeURIComponent(chunk.join(","))}`, {
          credentials: "include",
        });
        if (!r.ok) continue;
        const j = (await r.json()) as { data?: Record<string, IpInfo> };
        Object.assign(out, j.data ?? {});
      }
      return out;
    },
  });
}
