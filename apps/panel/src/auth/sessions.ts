import crypto from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { sessions, users } from "../db/schema.js";
import { randomToken } from "./passwords.js";
import { config } from "../config.js";
import type { PublicUser } from "@strixmc/shared";
import type { Context } from "hono";

export const SESSION_COOKIE = "strix_session";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<string> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 86_400_000);
  getDb()
    .insert(sessions)
    .values({ tokenHash: hashToken(token), userId, expiresAt })
    .run();
  return token;
}

export function destroySession(token: string): void {
  getDb().delete(sessions).where(eq(sessions.tokenHash, hashToken(token))).run();
}

export function userFromSession(token: string): PublicUser | null {
  const row = getDb()
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .get();
  if (!row) return null;
  return toPublicUser(row.user);
}

export function toPublicUser(u: typeof users.$inferSelect): PublicUser {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    role: u.role,
    totpEnabled: u.totpEnabled,
    createdAt: u.createdAt.toISOString(),
  };
}

/** Extract the session token from the Cookie header (works on WS upgrades too). */
export function sessionTokenFromCookieHeader(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function setSessionCookie(c: Context, token: string): void {
  const maxAge = config.sessionTtlDays * 86_400;
  c.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${
      config.publicUrl.startsWith("https") ? "; Secure" : ""
    }`,
    { append: true }
  );
}
