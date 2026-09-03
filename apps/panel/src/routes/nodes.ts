import { Hono } from "hono";
import crypto from "node:crypto";
import { eq, and } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { nodes, servers, allocations, backups } from "../db/schema.js";
import { NodeCreateInput, NodeUpdateInput, NodeJoinInput, AllocationCreateInput } from "@strixmc/shared";
import { randomToken } from "../auth/passwords.js";
import { requireAuth, requireAdmin, type AppEnv } from "../auth/middleware.js";
import { config } from "../config.js";
import { emitWebhook } from "../webhooks.js";
import type { Context, Next } from "hono";

const nodesRouter = new Hono<AppEnv>();

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function nodeIsOnline(lastSeenAt: Date | null, windowSec: number): boolean {
  return !!lastSeenAt && Date.now() - lastSeenAt.getTime() < windowSec * 1000;
}

function toPublicNode(n: typeof nodes.$inferSelect, onlineWindowSec: number) {
  return {
    id: n.id,
    name: n.name,
    fqdn: n.fqdn,
    scheme: n.scheme,
    port: n.port,
    publicHost: n.publicHost,
    online: nodeIsOnline(n.lastSeenAt, onlineWindowSec),
    runtimeMode: n.runtimeMode,
    agentVersion: n.agentVersion,
    lastSeenAt: n.lastSeenAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

// ---------- admin node management ----------
nodesRouter.use("/", requireAuth, requireAdmin);

nodesRouter.get("/", (c) => {
  const rows = getDb().select().from(nodes).all();
  return c.json({ nodes: rows.map((n) => toPublicNode(n, config.nodeOnlineWindowSec)) });
});

nodesRouter.post("/", async (c) => {
  const input = NodeCreateInput.parse(await c.req.json());
  const db = getDb();
  const id = crypto.randomUUID();
  const joinToken = `strixjoin_${randomToken(24)}`;
  db.insert(nodes)
    .values({
      id,
      name: input.name,
      fqdn: input.fqdn,
      scheme: input.scheme,
      port: input.port,
      publicHost: input.publicHost ?? null,
      joinTokenHash: hashToken(joinToken),
      joinExpiresAt: new Date(Date.now() + 24 * 3600_000),
    })
    .run();
  return c.json(
    {
      node: toPublicNode(db.select().from(nodes).where(eq(nodes.id, id)).get()!, 60),
      join: {
        token: joinToken,
        expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
        instructions:
          "Run the agent on the target machine with STRIX_PANEL_URL and STRIX_JOIN_TOKEN set. The token is valid for 24 hours.",
      },
    },
    201
  );
});

nodesRouter.patch("/:id", async (c) => {
  const input = NodeUpdateInput.parse(await c.req.json());
  const db = getDb();
  const node = db.select().from(nodes).where(eq(nodes.id, c.req.param("id"))).get();
  if (!node) return c.json({ error: "Not found" }, 404);
  db.update(nodes)
    .set({
      name: input.name ?? node.name,
      fqdn: input.fqdn ?? node.fqdn,
      scheme: input.scheme ?? node.scheme,
      port: input.port ?? node.port,
      publicHost: input.publicHost ?? node.publicHost,
    })
    .where(eq(nodes.id, node.id))
    .run();
  return c.json({ node: toPublicNode(db.select().from(nodes).where(eq(nodes.id, node.id)).get()!, 60) });
});

nodesRouter.delete("/:id", (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const hosted = db.select({ id: servers.id }).from(servers).where(eq(servers.nodeId, id)).all();
  if (hosted.length > 0) return c.json({ error: "Node still hosts servers" }, 409);
  db.delete(allocations).where(eq(allocations.nodeId, id)).run();
  db.delete(nodes).where(eq(nodes.id, id)).run();
  return c.json({ ok: true });
});

nodesRouter.post("/:id/regenerate-join", (c) => {
  const db = getDb();
  const joinToken = `strixjoin_${randomToken(24)}`;
  const res = db
    .update(nodes)
    .set({ joinTokenHash: hashToken(joinToken), joinExpiresAt: new Date(Date.now() + 24 * 3600_000) })
    .where(eq(nodes.id, c.req.param("id")))
    .returning()
    .get();
  if (!res) return c.json({ error: "Not found" }, 404);
  return c.json({ token: joinToken, expiresAt: new Date(Date.now() + 24 * 3600_000).toISOString() });
});

nodesRouter.get("/:id/allocations", (c) => {
  const rows = getDb().select().from(allocations).where(eq(allocations.nodeId, c.req.param("id"))).all();
  return c.json({
    allocations: rows.map((a) => ({ id: a.id, nodeId: a.nodeId, ip: a.ip, port: a.port, serverId: a.serverId })),
  });
});

nodesRouter.post("/:id/allocations", async (c) => {
  const input = AllocationCreateInput.parse(await c.req.json());
  const db = getDb();
  const node = db.select().from(nodes).where(eq(nodes.id, c.req.param("id"))).get();
  if (!node) return c.json({ error: "Not found" }, 404);
  const to = input.portTo ?? input.port;
  if (to < input.port) return c.json({ error: "portTo must be >= port" }, 400);
  if (to - input.port + 1 > 256) return c.json({ error: "Max 256 ports per request" }, 400);
  const created: string[] = [];
  for (let port = input.port; port <= to; port++) {
    const existing = db
      .select({ id: allocations.id })
      .from(allocations)
      .where(and(eq(allocations.nodeId, node.id), eq(allocations.port, port)))
      .get();
    if (existing) continue;
    const id = crypto.randomUUID();
    db.insert(allocations).values({ id, nodeId: node.id, ip: input.ip, port }).run();
    created.push(id);
  }
  return c.json({ created: created.length }, 201);
});

nodesRouter.delete("/:id/allocations/:aid", (c) => {
  const db = getDb();
  const alloc = db.select().from(allocations).where(eq(allocations.id, c.req.param("aid"))).get();
  if (!alloc || alloc.nodeId !== c.req.param("id")) return c.json({ error: "Not found" }, 404);
  if (alloc.serverId) return c.json({ error: "Allocation is assigned to a server" }, 409);
  db.delete(allocations).where(eq(allocations.id, alloc.id)).run();
  return c.json({ ok: true });
});

// ---------- agent-facing endpoints (no session auth) ----------
const agent = new Hono<AppEnv>();

agent.post("/join", async (c) => {
  const input = NodeJoinInput.parse(await c.req.json());
  const db = getDb();
  const node = db.select().from(nodes).where(eq(nodes.joinTokenHash, hashToken(input.joinToken))).get();
  if (!node || !node.joinExpiresAt || node.joinExpiresAt.getTime() < Date.now()) {
    return c.json({ error: "Invalid or expired join token" }, 401);
  }
  const nodeToken = `strixnode_${randomToken(24)}`;
  db.update(nodes)
    .set({
      agentSecret: input.agentSecret,
      nodeTokenHash: hashToken(nodeToken),
      joinTokenHash: null,
      joinExpiresAt: null,
      runtimeMode: input.runtimeMode,
      agentVersion: input.agentVersion,
      lastSeenAt: new Date(),
    })
    .where(eq(nodes.id, node.id))
    .run();
  return c.json({ nodeId: node.id, nodeToken, panelUrl: new URL(c.req.url).origin });
});

export async function requireNode(c: Context<AppEnv>, next: Next) {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return c.json({ error: "Node auth required" }, 401);
  const node = getDb().select().from(nodes).where(eq(nodes.nodeTokenHash, hashToken(token))).get();
  if (!node) return c.json({ error: "Unknown node" }, 401);
  getDb().update(nodes).set({ lastSeenAt: new Date() }).where(eq(nodes.id, node.id)).run();
  c.set("node", node);
  return next();
}

agent.use("*", requireNode);

agent.post("/heartbeat", async (c) => {
  const node = c.get("node");
  const body = (await c.req.json().catch(() => ({}))) as {
    version?: string;
    runtimeMode?: "docker" | "native";
  };
  getDb()
    .update(nodes)
    .set({
      agentVersion: body.version ?? node.agentVersion,
      runtimeMode: body.runtimeMode ?? node.runtimeMode,
      lastSeenAt: new Date(),
    })
    .where(eq(nodes.id, node.id))
    .run();
  return c.json({ ok: true });
});

/** Status/install/backup callbacks pushed by the agent. */
agent.post("/events", async (c) => {
  const body = (await c.req.json()) as {
    type: string;
    serverId?: string;
    backupId?: string;
    status?: string;
    detail?: string;
    sizeBytes?: number;
  };
  const db = getDb();

  if (body.type === "server.status" && body.serverId) {
    const prev = db.select().from(servers).where(eq(servers.id, body.serverId)).get();
    if (prev && prev.status !== body.status) {
      db.update(servers).set({ status: body.status! }).where(eq(servers.id, body.serverId)).run();
      if (body.status === "running") emitWebhook("power.start", { serverId: body.serverId, data: { name: prev.name } });
      if (body.status === "stopped") emitWebhook("power.stop", { serverId: body.serverId, data: { name: prev.name } });
      if (body.status === "crashed") emitWebhook("power.crash", { serverId: body.serverId, data: { name: prev.name } });
      if (body.status === "installed") emitWebhook("server.installed", { serverId: body.serverId, data: { name: prev.name } });
    }
  }
  if (body.type === "backup.state" && body.backupId) {
    db.update(backups)
      .set({ state: body.status ?? "completed", sizeBytes: body.sizeBytes ?? 0 })
      .where(eq(backups.id, body.backupId))
      .run();
    if (body.status === "completed") emitWebhook("backup.completed", { serverId: body.serverId, data: { backupId: body.backupId } });
  }
  return c.json({ ok: true });
});

nodesRouter.route("/", agent);

export default nodesRouter;
