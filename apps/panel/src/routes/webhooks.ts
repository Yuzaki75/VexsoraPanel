import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { webhooks } from "../db/schema.js";
import { WebhookCreateInput } from "@strixmc/shared";
import { requireAuth, requireAdmin, type AppEnv } from "../auth/middleware.js";

const webhooksRouter = new Hono<AppEnv>();
webhooksRouter.use("*", requireAuth, requireAdmin);

webhooksRouter.get("/", (c) => {
  const rows = getDb().select().from(webhooks).all();
  return c.json({
    webhooks: rows.map((w) => ({ id: w.id, url: w.url, events: w.events, createdAt: w.createdAt.toISOString() })),
  });
});

webhooksRouter.post("/", async (c) => {
  const input = WebhookCreateInput.parse(await c.req.json());
  const id = crypto.randomUUID();
  getDb().insert(webhooks).values({ id, url: input.url, events: input.events }).run();
  return c.json({ id }, 201);
});

webhooksRouter.delete("/:id", (c) => {
  getDb().delete(webhooks).where(eq(webhooks.id, c.req.param("id"))).run();
  return c.json({ ok: true });
});

export default webhooksRouter;
