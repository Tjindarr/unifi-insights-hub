// Preview-only client-side auth shim. The real container uses a server-side
// timing-safe password check + encrypted session cookie (see /server/auth.ts).
// Any non-empty username/password is accepted here so the dashboard is usable
// in the Lovable preview.

const KEY = "unifi-dash-session";

export function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(KEY) === "ok";
}

export function signIn(username: string, password: string): boolean {
  if (!username.trim() || !password.trim()) return false;
  if (typeof window !== "undefined") localStorage.setItem(KEY, "ok");
  return true;
}

export function signOut() {
  if (typeof window !== "undefined") localStorage.removeItem(KEY);
}
