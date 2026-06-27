import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE = "unifi_session";

export type AuthConfig = {
  user: string;
  password: string;
  secret: string; // 32+ chars
};

function sign(value: string, secret: string): string {
  return createHash("sha256").update(value + ":" + secret).digest("hex").slice(0, 32);
}

function passwordsMatch(input: string, expected: string): boolean {
  const a = createHash("sha256").update(input, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}

export function makeAuth(cfg: AuthConfig) {
  if (cfg.secret.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");

  return {
    issueCookie(): string {
      const id = randomBytes(16).toString("hex");
      const sig = sign(id, cfg.secret);
      return `${id}.${sig}`;
    },
    verifyCookie(raw: string | undefined): boolean {
      if (!raw) return false;
      const [id, sig] = raw.split(".");
      if (!id || !sig) return false;
      const expected = sign(id, cfg.secret);
      try {
        return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      } catch {
        return false;
      }
    },
    checkCredentials(user: string, password: string): boolean {
      if (user !== cfg.user) {
        // still do a constant-time pw compare so timing doesn't leak which field is wrong
        passwordsMatch(password, cfg.password);
        return false;
      }
      return passwordsMatch(password, cfg.password);
    },
    cookieName: COOKIE,
  };
}
