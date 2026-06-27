export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(Math.floor(Math.log(Math.abs(bytes)) / Math.log(k)), sizes.length - 1);
  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${sizes[i]}`;
}

export function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec, 1)}/s`;
}

export function formatBits(bytesPerSec: number): string {
  const bits = bytesPerSec * 8;
  const units = ["bps", "Kbps", "Mbps", "Gbps"];
  const i = bits === 0 ? 0 : Math.min(Math.floor(Math.log10(bits) / 3), units.length - 1);
  return `${(bits / Math.pow(1000, i)).toFixed(1)} ${units[i]}`;
}

export function formatMac(mac: string): string {
  return mac.toLowerCase();
}

export function relativeTime(date: Date | number | string): string {
  const d = new Date(date).getTime();
  const diff = Date.now() - d;
  const sec = Math.round(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export function formatTime(date: Date | number | string): string {
  const d = new Date(date);
  return d.toLocaleTimeString(undefined, { hour12: false });
}

export function formatDateTime(date: Date | number | string): string {
  const d = new Date(date);
  return d.toLocaleString(undefined, { hour12: false });
}
