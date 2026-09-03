import { Hono } from "hono";
import { eq, or, ne, and } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { users } from "../db/schema.js";
import { UserUpdateInput } from "@strixmc/shared";
import { hashPassword } from "../auth/passwords.js";
import { toPublicUser } from "../auth/sessions.js";
import { requireAuth, requireAdmin, getUser, type AppEnv } from "../auth/middleware.js";

const usersRouter = new Hono<AppEnv>();

usersRouter.use("*", requireAuth, requireAdmin);

usersRouter.get("/", (c) => {
  const rows = getDb().select().from(users).all();
  return c.json({ users: rows.map(toPublicUser) });
});

usersRouter.patch("/:id", async (c) => {
  const input = UserUpdateInput.parse(await c.req.json());
  const db = getDb();
  const target = db.select().from(users).where(eq(users.id, c.req.param("id"))).get();
  if (!target) return c.json({ error: "Not found" }, 404);

  if (input.email || input.username) {
    const clash = db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          ne(users.id, target.id),
          or(
            input.email ? eq(users.email, input.email.toLowerCase()) : undefined,
            input.username ? eq(users.username, input.username) : undefined
          )
        )
      )
      .get();
    if (clash) return c.json({ error: "Email or username already in use" }, 409);
  }

  // Never allow demoting or locking out the last admin.
  if (target.role === "admin" && input.role === "user") {
    const admins = db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).all();
    if (admins.length <= 1) return c.json({ error: "Cannot demote the last admin" }, 409);
  }

  const patch: Partial<typeof users.$inferInsert> = {};
  if (input.email) patch.email = input.email.toLowerCase();
  if (input.username) patch.username = input.username;
  if (input.role) patch.role = input.role;
  if (input.password) patch.passwordHash = await hashPassword(input.password);
  db.update(users).set(patch).where(eq(users.id, target.id)).run();
  return c.json({ user: toPublicUser(db.select().from(users).where(eq(users.id, target.id)).get()!) });
});

usersRouter.delete("/:id", (c) => {
  const db = getDb();
  const target = db.select().from(users).where(eq(users.id, c.req.param("id"))).get();
  if (!target) return c.json({ error: "Not found" }, 404);
  if (target.id === getUser(c).id) return c.json({ error: "Cannot delete yourself" }, 400);
  if (target.role === "admin") {
    const admins = db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).all();
    if (admins.length <= 1) return c.json({ error: "Cannot delete the last admin" }, 409);
  }
  db.delete(users).where(eq(users.id, target.id)).run();
  return c.json({ ok: true });
});

export default usersRouter;
