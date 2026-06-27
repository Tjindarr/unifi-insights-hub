// Server-backed auth. The Fastify backend issues an httpOnly session
// cookie on /api/login. We mirror minimal state to localStorage so the
// router guards can decide synchronously where to send the user.

const SESSION_KEY = "unifi-dash-session";
const MUST_CHANGE_KEY = "unifi-dash-must-change";

const DEFAULT_PASSWORD = "admin";

export function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SESSION_KEY) === "ok";
}

export function mustChangePassword(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(MUST_CHANGE_KEY) === "1";
}

export type SignInResult =
  | { ok: true; mustChange: boolean }
  | { ok: false; error: string };

export async function signIn(username: string, password: string): Promise<SignInResult> {
  if (!username.trim() || !password.trim()) {
    return { ok: false, error: "Enter a username and password." };
  }
  try {
    const r = await fetch("/api/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!r.ok) return { ok: false, error: "Invalid username or password." };
    const j = (await r.json()) as { ok: boolean; mustChange?: boolean };
    if (!j.ok) return { ok: false, error: "Invalid username or password." };
    localStorage.setItem(SESSION_KEY, "ok");
    if (j.mustChange) localStorage.setItem(MUST_CHANGE_KEY, "1");
    else localStorage.removeItem(MUST_CHANGE_KEY);
    return { ok: true, mustChange: !!j.mustChange };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (newPassword.length < 8) {
    return { ok: false, error: "New password must be at least 8 characters." };
  }
  if (newPassword === DEFAULT_PASSWORD) {
    return { ok: false, error: "Choose a password other than the default." };
  }
  try {
    const r = await fetch("/api/change-password", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const j = (await r.json()) as { ok: boolean; error?: string };
    if (!j.ok) return { ok: false, error: j.error || "Failed to change password." };
    localStorage.removeItem(MUST_CHANGE_KEY);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

export async function signOut() {
  try {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  } catch { /* ignore */ }
  if (typeof window !== "undefined") {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(MUST_CHANGE_KEY);
  }
}
