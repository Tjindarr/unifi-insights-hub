import Database from "better-sqlite3";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const COOKIE = "unifi_session";
const DEFAULT_USER = "admin";
const DEFAULT_PASSWORD = "admin";

export type AuthDeps = {
  db: Database.Database;
  secret: string; // 32+ chars
  // Optional overrides (e.g. operator wants to bootstrap with a non-default
  // username/password instead of admin/admin). Only seeded on first run.
  seedUser?: string;
  seedPassword?: string;
};

function sign(value: string, secret: string): string {
  return createHash("sha256").update(value + ":" + secret).digest("hex").slice(0, 32);
}

function hashPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 64);
}

function verifyPassword(password: string, salt: Buffer, expected: Buffer): boolean {
  const got = hashPassword(password, salt);
  if (got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}

function ensureUsersTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      username     TEXT NOT NULL UNIQUE,
      salt         BLOB NOT NULL,
      password     BLOB NOT NULL,
      must_change  INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function seedDefaultUser(
  db: Database.Database,
  username: string,
  password: string,
  isDefault: boolean,
) {
  const row = db.prepare("SELECT id FROM users LIMIT 1").get();
  if (row) return;
  const salt = randomBytes(16);
  const hash = hashPassword(password, salt);
  db.prepare(
    "INSERT INTO users (username, salt, password, must_change) VALUES (?, ?, ?, ?)",
  ).run(username, salt, hash, isDefault ? 1 : 0);
}

export function makeAuth(deps: AuthDeps) {
  if (deps.secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  const { db } = deps;
  ensureUsersTable(db);

  const seedUser = deps.seedUser ?? DEFAULT_USER;
  const seedPassword = deps.seedPassword ?? DEFAULT_PASSWORD;
  const usingDefault = seedUser === DEFAULT_USER && seedPassword === DEFAULT_PASSWORD;
  seedDefaultUser(db, seedUser, seedPassword, usingDefault);

  type UserRow = {
    id: number;
    username: string;
    salt: Buffer;
    password: Buffer;
    must_change: number;
  };
  const getUser = db.prepare<string, UserRow>("SELECT * FROM users WHERE username = ?");
  const updatePassword = db.prepare(
    "UPDATE users SET salt = ?, password = ?, must_change = 0 WHERE id = ?",
  );

  return {
    cookieName: COOKIE,
    issueCookie(): string {
      const id = randomBytes(16).toString("hex");
      const sig = sign(id, deps.secret);
      return `${id}.${sig}`;
    },
    verifyCookie(raw: string | undefined): boolean {
      if (!raw) return false;
      const [id, sig] = raw.split(".");
      if (!id || !sig) return false;
      const expected = sign(id, deps.secret);
      try {
        return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      } catch {
        return false;
      }
    },
    checkCredentials(username: string, password: string): { ok: boolean; mustChange: boolean } {
      const user = getUser.get(username);
      if (!user) {
        // constant-time dummy compare to avoid leaking which field is wrong
        const salt = randomBytes(16);
        verifyPassword(password, salt, hashPassword("__nope__", salt));
        return { ok: false, mustChange: false };
      }
      const ok = verifyPassword(password, user.salt, user.password);
      return { ok, mustChange: ok && user.must_change === 1 };
    },
    changePassword(
      username: string,
      currentPassword: string,
      newPassword: string,
    ): { ok: true } | { ok: false; error: string } {
      const user = getUser.get(username);
      if (!user) return { ok: false, error: "Unknown user." };
      if (!verifyPassword(currentPassword, user.salt, user.password)) {
        return { ok: false, error: "Current password is incorrect." };
      }
      if (newPassword.length < 8) {
        return { ok: false, error: "New password must be at least 8 characters." };
      }
      if (newPassword === DEFAULT_PASSWORD) {
        return { ok: false, error: "Choose a password other than the default." };
      }
      const salt = randomBytes(16);
      const hash = hashPassword(newPassword, salt);
      updatePassword.run(salt, hash, user.id);
      return { ok: true };
    },
  };
}
