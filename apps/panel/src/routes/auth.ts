import { Hono } from "hono";
import { eq, or } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { users, apiKeys } from "../db/schema.js";
import {
  LoginInput,
  RegisterInput,
  PublicUser,
  ApiKeyCreateInput,
  SERVER_PERMISSIONS,
} from "@strixmc/shared";
import { hashPassword, verifyPassword, randomToken } from "../auth/passwords.js";
import {
  createSession,
  destroySession,
  setSessionCookie,
  sessionTokenFromCookieHeader,
  toPublicUser,
} from "../auth/sessions.js";
import { createApiKey, lookupApiKey } from "../auth/apikeys.js";
import { generateTotpSecret, totpUri, verifyTotp } from "../auth/totp.js";
import { rateLimit, requireAuth, getUser, type AppEnv } from "../auth/middleware.js";

const auth = new Hono<AppEnv>();

function firstUserIsAdmin(): boolean {
  return getDb().select({ id: users.id }).from(users).limit(1).all().length === 0;
}

auth.post("/register", rateLimit(10, 60_000), async (c) => {
  const input = RegisterInput.parse(await c.req.json());
  const db = getDb();
  const existing = db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.email, input.email), eq(users.username, input.username)))
    .get();
  if (existing) return c.json({ error: "Email or username already in use" }, 409);
  const id = crypto.randomUUID();
  db.insert(users)
    .values({
      id,
      email: input.email.toLowerCase(),
      username: input.username,
      passwordHash: await hashPassword(input.password),
      role: firstUserIsAdmin() ? "admin" : "user",
    })
    .run();
  const token = await createSession(id);
  setSessionCookie(c, token);
  const user = db.select().from(users).where(eq(users.id, id)).get()!;
  return c.json({ user: toPublicUser(user) }, 201);
});

auth.post("/login", rateLimit(10, 60_000), async (c) => {
  const input = LoginInput.parse(await c.req.json());
  const db = getDb();
  const user = db.select().from(users).where(eq(users.email, input.email.toLowerCase())).get();
  if (!user || !(await verifyPassword(user.passwordHash, input.password))) {
    return c.json({ error: "Invalid credentials" }, 401);
  }
  if (user.totpEnabled) {
    if (!input.totpCode) return c.json({ error: "TOTP code required", totpRequired: true }, 401);
    if (!verifyTotp(user.totpSecret ?? "", input.totpCode)) {
      return c.json({ error: "Invalid TOTP code", totpRequired: true }, 401);
    }
  }
  const token = await createSession(user.id);
  setSessionCookie(c, token);
  return c.json({ user: toPublicUser(user) });
});

auth.post("/logout", async (c) => {
  const token = sessionTokenFromCookieHeader(c.req.header("Cookie"));
  if (token) destroySession(token);
  setSessionCookie(c, "");
  return c.json({ ok: true });
});

auth.get("/me", requireAuth, (c) => c.json({ user: getUser(c) }));

auth.post("/me/password", requireAuth, async (c) => {
  const { current, password } = (await c.req.json()) as { current: string; password: string };
  if (typeof password !== "string" || password.length < 8) {
    return c.json({ error: "New password must be at least 8 characters" }, 400);
  }
  const db = getDb();
  const row = db.select().from(users).where(eq(users.id, getUser(c).id)).get()!;
  if (!(await verifyPassword(row.passwordHash, current))) {
    return c.json({ error: "Current password is incorrect" }, 403);
  }
  db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, row.id)).run();
  return c.json({ ok: true });
});

// ---------- 2FA ----------
const pendingSecrets = new Map<string, string>();

auth.post("/me/totp/setup", requireAuth, (c) => {
  const user = getUser(c);
  if (user.totpEnabled) return c.json({ error: "2FA already enabled" }, 409);
  const secret = generateTotpSecret();
  pendingSecrets.set(user.id, secret);
  return c.json({ secret, uri: totpUri(secret, user.email) });
});

auth.post("/me/totp/enable", requireAuth, async (c) => {
  const { code } = (await c.req.json()) as { code: string };
  const secret = pendingSecrets.get(getUser(c).id);
  if (!secret) return c.json({ error: "Run setup first" }, 400);
  if (!verifyTotp(secret, code ?? "")) return c.json({ error: "Invalid code" }, 400);
  getDb()
    .update(users)
    .set({ totpSecret: secret, totpEnabled: true })
    .where(eq(users.id, getUser(c).id))
    .run();
  pendingSecrets.delete(getUser(c).id);
  return c.json({ ok: true });
});

auth.post("/me/totp/disable", requireAuth, async (c) => {
  const { code } = (await c.req.json()) as { code?: string };
  const db = getDb();
  const row = db.select().from(users).where(eq(users.id, getUser(c).id)).get()!;
  if (!row.totpEnabled) return c.json({ error: "2FA not enabled" }, 409);
  if (!code || !verifyTotp(row.totpSecret ?? "", code)) {
    return c.json({ error: "Valid TOTP code required to disable" }, 400);
  }
  db.update(users).set({ totpSecret: null, totpEnabled: false }).where(eq(users.id, row.id)).run();
  return c.json({ ok: true });
});

// ---------- API keys ----------
auth.get("/me/api-keys", requireAuth, (c) => {
  const user = getUser(c);
  const rows = getDb().select().from(apiKeys).all();
  const mine = rows
    .filter((r) => r.type === "application" || r.userId === user.id)
    .map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      type: r.type,
      keyPreview: r.keyPreview,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    }));
  return c.json({ keys: mine });
});

auth.post("/me/api-keys", requireAuth, async (c) => {
  const input = ApiKeyCreateInput.parse(await c.req.json());
  const user = getUser(c);
  // Application keys are admin-only; client keys act on behalf of their creator.
  const type = user.role === "admin" ? "application" : "client";
  const { id, plaintext } = createApiKey({
    type,
    name: input.name,
    description: input.description ?? null,
    userId: user.id,
  });
  return c.json({ id, type, plaintext }, 201);
});

auth.delete("/me/api-keys/:id", requireAuth, (c) => {
  const db = getDb();
  const row = db.select().from(apiKeys).where(eq(apiKeys.id, c.req.param("id") ?? "")).get();
  if (!row) return c.json({ error: "Not found" }, 404);
  const user = getUser(c);
  if (row.type === "client" && row.userId !== user.id && user.role !== "admin") {
    return c.json({ error: "Forbidden" }, 403);
  }
  db.delete(apiKeys).where(eq(apiKeys.id, row.id)).run();
  return c.json({ ok: true });
});

export const validPermissions = SERVER_PERMISSIONS;
export default auth;
