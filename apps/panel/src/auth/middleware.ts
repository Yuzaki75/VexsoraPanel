import type { Context, Next } from "hono";
import { getDb } from "../db/index.js";
import { users, nodes } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { PublicUser } from "@strixmc/shared";
import { lookupApiKey } from "./apikeys.js";
import {
  sessionTokenFromCookieHeader,
  SESSION_COOKIE,
  userFromSession,
  toPublicUser,
} from "./sessions.js";

export type AppEnv = { Variables: { user: PublicUser; node: typeof nodes.$inferSelect } };

export function getUser(c: Context<AppEnv>): PublicUser {
  return c.get("user");
}

function bearerFrom(c: Context): string | null {
  const h = c.req.header("Authorization");
  if (!h) return null;
  const [scheme, ...rest] = h.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || rest.length === 0) return null;
  return rest.join(" ").trim() || null;
}

/** Session cookie OR API key auth. */
export async function requireAuth(c: Context<AppEnv>, next: Next) {
  const bearer = bearerFrom(c);
  if (bearer) {
    const key = lookupApiKey(bearer);
    if (!key) return c.json({ error: "Invalid API key" }, 401);
    if (key.type === "application") {
      // Application keys act as an admin service identity.
      c.set("user", {
        id: `apikey:${key.id}`,
        email: "",
        username: key.name,
        role: "admin",
        totpEnabled: false,
        createdAt: key.createdAt.toISOString(),
      });
      return next();
    }
    if (!key.userId) return c.json({ error: "Invalid API key" }, 401);
    const u = getDb().select().from(users).where(eq(users.id, key.userId)).get();
    if (!u) return c.json({ error: "Invalid API key" }, 401);
    c.set("user", toPublicUser(u));
    return next();
  }
  const token = sessionTokenFromCookieHeader(c.req.header("Cookie"));
  if (!token) return c.json({ error: "Not authenticated" }, 401);
  const user = userFromSession(token);
  if (!user) return c.json({ error: "Session expired" }, 401);
  c.set("user", user);
  return next();
}

export async function requireAdmin(c: Context<AppEnv>, next: Next) {
  const user = getUser(c);
  if (user.role !== "admin") return c.json({ error: "Admin access required" }, 403);
  return next();
}

/** Naive fixed-window rate limiter for sensitive routes (per IP). */
const buckets = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(max: number, windowMs: number) {
  return async (c: Context<AppEnv>, next: Next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "local";
    const now = Date.now();
    const entry = buckets.get(ip);
    if (!entry || entry.resetAt < now) {
      buckets.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > max) return c.json({ error: "Too many requests" }, 429);
    return next();
  };
}
