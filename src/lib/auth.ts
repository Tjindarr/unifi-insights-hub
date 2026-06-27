// Preview-only client-side auth shim. The deployed container uses a
// server-side timing-safe password check + encrypted session cookie
// (see /server/auth.ts and /server/api/routes.ts).
//
// Default credentials are admin / admin. On first successful login with
// the default password the user is forced to set a new one before the
// dashboard becomes reachable.

const SESSION_KEY = "unifi-dash-session";
const PASSWORD_KEY = "unifi-dash-password";
const MUST_CHANGE_KEY = "unifi-dash-must-change";

const DEFAULT_USER = "admin";
const DEFAULT_PASSWORD = "admin";

function storedPassword(): string {
  if (typeof window === "undefined") return DEFAULT_PASSWORD;
  return localStorage.getItem(PASSWORD_KEY) ?? DEFAULT_PASSWORD;
}

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

export function signIn(username: string, password: string): SignInResult {
  if (!username.trim() || !password.trim()) {
    return { ok: false, error: "Enter a username and password." };
  }
  if (username !== DEFAULT_USER) {
    return { ok: false, error: "Invalid username or password." };
  }
  if (password !== storedPassword()) {
    return { ok: false, error: "Invalid username or password." };
  }
  const isDefault =
    password === DEFAULT_PASSWORD &&
    (typeof window === "undefined" || !localStorage.getItem(PASSWORD_KEY));

  if (typeof window !== "undefined") {
    localStorage.setItem(SESSION_KEY, "ok");
    if (isDefault) localStorage.setItem(MUST_CHANGE_KEY, "1");
    else localStorage.removeItem(MUST_CHANGE_KEY);
  }
  return { ok: true, mustChange: isDefault };
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
): { ok: true } | { ok: false; error: string } {
  if (currentPassword !== storedPassword()) {
    return { ok: false, error: "Current password is incorrect." };
  }
  if (newPassword.length < 8) {
    return { ok: false, error: "New password must be at least 8 characters." };
  }
  if (newPassword === DEFAULT_PASSWORD) {
    return { ok: false, error: "Choose a password other than the default." };
  }
  if (typeof window !== "undefined") {
    localStorage.setItem(PASSWORD_KEY, newPassword);
    localStorage.removeItem(MUST_CHANGE_KEY);
  }
  return { ok: true };
}

export function signOut() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(MUST_CHANGE_KEY);
  }
}
