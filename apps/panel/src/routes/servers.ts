import { Hono } from "hono";
import crypto from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { servers, nodes, allocations, subusers, users, backups } from "../db/schema.js";
import {
  ServerCreateInput,
  ServerUpdateInput,
  PowerInput,
  SubuserCreateInput,
  hasPermission,
  SERVER_PERMISSIONS,
  type ServerPermission,
} from "@strixmc/shared";
import { requireAuth, getUser, type AppEnv } from "../auth/middleware.js";
import { HTTPException } from "hono/http-exception";
import { agentFetch, agentJson, getNodeOr404, AgentError } from "../proxy/agent.js";
import { getTemplate, resolveVariables } from "../templates.js";
import { emitWebhook } from "../webhooks.js";

const serversRouter = new Hono<AppEnv>();
serversRouter.use("*", requireAuth);

type ServerRow = typeof servers.$inferSelect;
type Access = { kind: "admin" | "owner" | "subuser"; perms: string[] | "*" };

function accessFor(user: { id: string; role: string }, server: ServerRow): Access | null {
  if (user.role === "admin") return { kind: "admin", perms: "*" };
  if (server.userId === user.id) return { kind: "owner", perms: "*" };
  const su = getDb()
    .select()
    .from(subusers)
    .where(and(eq(subusers.serverId, server.id), eq(subusers.userId, user.id)))
    .get();
  if (su) return { kind: "subuser", perms: su.permissions };
  return null;
}

function can(access: Access, perm: ServerPermission): boolean {
  return access.perms === "*" || hasPermission(access.perms, perm);
}

function canAny(access: Access, perms: ServerPermission[]): boolean {
  return perms.some((p) => can(access, p));
}

function getServer(id: string): ServerRow | null {
  return getDb().select().from(servers).where(eq(servers.id, id)).get() ?? null;
}

function guard(c: any, server: ServerRow): Access {
  const access = accessFor(c.get("user"), server);
  if (!access) throw new HTTPException(403, { message: "Forbidden" });
  return access;
}

function serverRowToJson(s: ServerRow, extra: Record<string, unknown> = {}) {
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    nodeId: s.nodeId,
    userId: s.userId,
    templateId: s.templateId,
    variables: s.variables,
    memoryMb: s.memoryMb,
    diskMb: s.diskMb,
    cpuPercent: s.cpuPercent,
    createdAt: s.createdAt.toISOString(),
    ...extra,
  };
}

function withDetails(s: ServerRow) {
  const node = getNodeOr404(s.nodeId);
  const owner = getDb().select().from(users).where(eq(users.id, s.userId)).get();
  const alloc = getDb().select().from(allocations).where(eq(allocations.serverId, s.id)).get();
  return serverRowToJson(s, {
    nodeName: node?.name,
    ownerEmail: owner?.email,
    allocationIp: alloc?.ip,
    allocationPort: alloc?.port,
  });
}

serversRouter.get("/", (c) => {
  const user = getUser(c);
  const db = getDb();
  let rows: ServerRow[];
  if (user.role === "admin") {
    rows = db.select().from(servers).all();
  } else {
    const subRows = db.select().from(subusers).where(eq(subusers.userId, user.id)).all();
    const ids = subRows.map((s) => s.serverId);
    rows = db
      .select()
      .from(servers)
      .where(ids.length ? or(eq(servers.userId, user.id), inArray(servers.id, ids)) : eq(servers.userId, user.id))
      .all();
  }
  return c.json({ servers: rows.map((s) => withDetails(s)) });
});

serversRouter.post("/", async (c) => {
  const user = getUser(c);
  if (user.role !== "admin") return c.json({ error: "Admin access required" }, 403);
  const input = ServerCreateInput.parse(await c.req.json());
  const db = getDb();

  const template = getTemplate(input.templateId);
  if (!template) return c.json({ error: `Unknown template: ${input.templateId}` }, 400);
  if (input.memoryMb < template.minMemoryMb) {
    return c.json({ error: `${template.name} needs at least ${template.minMemoryMb} MB of memory` }, 400);
  }

  const node = getNodeOr404(input.nodeId);
  if (!node) return c.json({ error: "Unknown node" }, 404);
  if (!node.agentSecret) return c.json({ error: "Node has not joined yet" }, 409);

  const alloc = db.select().from(allocations).where(eq(allocations.id, input.allocationId)).get();
  if (!alloc || alloc.nodeId !== node.id) return c.json({ error: "Allocation is not on this node" }, 400);
  if (alloc.serverId) return c.json({ error: "Allocation already in use" }, 409);

  let variables: Record<string, string>;
  try {
    variables = resolveVariables(template, input.variables);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }

  const id = crypto.randomUUID();
  db.insert(servers)
    .values({
      id,
      name: input.name,
      nodeId: node.id,
      userId: user.id,
      templateId: template.id,
      variables,
      memoryMb: input.memoryMb,
      diskMb: input.diskMb,
      cpuPercent: input.cpuPercent,
      status: "installing",
    })
    .run();
  db.update(allocations).set({ serverId: id }).where(eq(allocations.id, alloc.id)).run();

  try {
    await agentJson(node, "/api/v1/servers", {
      method: "POST",
      body: JSON.stringify({
        serverId: id,
        template,
        variables,
        limits: { memoryMb: input.memoryMb, diskMb: input.diskMb, cpuPercent: input.cpuPercent },
        allocation: { ip: alloc.ip, port: alloc.port },
        startOnCreate: input.startOnCreate,
      }),
    });
  } catch (err) {
    db.delete(servers).where(eq(servers.id, id)).run();
    db.update(allocations).set({ serverId: null }).where(eq(allocations.id, alloc.id)).run();
    const msg = err instanceof AgentError ? err.message : "Failed to provision on node";
    return c.json({ error: msg }, 502);
  }

  emitWebhook("server.created", { serverId: id, data: { name: input.name, template: template.id } });
  return c.json({ server: withDetails(getServer(id)!) }, 201);
});

serversRouter.get("/:id", (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  return c.json({ server: withDetails(server) });
});

serversRouter.patch("/:id", async (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  if (access.kind === "subuser") return c.json({ error: "Forbidden" }, 403);

  const input = ServerUpdateInput.parse(await c.req.json());
  const db = getDb();
  let variables = server.variables;
  if (input.variables) {
    const tpl = getTemplate(server.templateId);
    if (!tpl) return c.json({ error: "Template no longer available" }, 400);
    try {
      variables = resolveVariables(tpl, { ...server.variables, ...input.variables });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  }
  db.update(servers)
    .set({
      name: input.name ?? server.name,
      memoryMb: input.memoryMb ?? server.memoryMb,
      diskMb: input.diskMb ?? server.diskMb,
      cpuPercent: input.cpuPercent ?? server.cpuPercent,
      variables,
    })
    .where(eq(servers.id, server.id))
    .run();

  const node = getNodeOr404(server.nodeId);
  if (node) {
    try {
      await agentJson(node, `/api/v1/servers/${server.id}/config`, {
        method: "PUT",
        body: JSON.stringify({
          variables,
          limits: {
            memoryMb: input.memoryMb ?? server.memoryMb,
            diskMb: input.diskMb ?? server.diskMb,
            cpuPercent: input.cpuPercent ?? server.cpuPercent,
          },
        }),
      });
    } catch {
      // Config sync is best-effort; node may be offline.
    }
  }
  return c.json({ server: withDetails(getServer(server.id)!) });
});

serversRouter.delete("/:id", async (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  if (access.kind === "subuser") return c.json({ error: "Forbidden" }, 403);

  const node = getNodeOr404(server.nodeId);
  if (node) {
    await agentFetch(node, `/api/v1/servers/${server.id}`, { method: "DELETE" }).catch(() => {});
  }
  const db = getDb();
  db.delete(subusers).where(eq(subusers.serverId, server.id)).run();
  db.delete(backups).where(eq(backups.serverId, server.id)).run();
  db.update(allocations).set({ serverId: null }).where(eq(allocations.serverId, server.id)).run();
  db.delete(servers).where(eq(servers.id, server.id)).run();
  emitWebhook("server.deleted", { serverId: server.id, data: { name: server.name } });
  return c.json({ ok: true });
});

// ---------- power ----------
const POWER_PERM: Record<string, ServerPermission> = {
  start: "power.start",
  stop: "power.stop",
  restart: "power.restart",
  kill: "power.kill",
};

serversRouter.post("/:id/power", async (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  const { action } = PowerInput.parse(await c.req.json());
  if (!can(access, POWER_PERM[action])) return c.json({ error: "Forbidden" }, 403);

  const node = getNodeOr404(server.nodeId);
  if (!node) return c.json({ error: "Unknown node" }, 404);
  try {
    await agentJson(node, `/api/v1/servers/${server.id}/power`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
  } catch (err) {
    const msg = err instanceof AgentError ? err.message : "Node unreachable";
    return c.json({ error: msg }, err instanceof AgentError && err.status === 409 ? 409 : 502);
  }
  const optimistic =
    action === "start" ? "starting" : action === "restart" ? "starting" : "stopping";
  if (action !== "kill") {
    getDb().update(servers).set({ status: optimistic }).where(eq(servers.id, server.id)).run();
  }
  return c.json({ ok: true });
});

serversRouter.post("/:id/reinstall", async (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  if (!access) return;
  if (!can(access, "settings.reinstall")) return c.json({ error: "Forbidden" }, 403);
  const node = getNodeOr404(server.nodeId);
  if (!node) return c.json({ error: "Unknown node" }, 404);
  try {
    await agentJson(node, `/api/v1/servers/${server.id}/reinstall`, { method: "POST" });
  } catch (err) {
    return c.json({ error: err instanceof AgentError ? err.message : "Node unreachable" }, 502);
  }
  getDb().update(servers).set({ status: "installing" }).where(eq(servers.id, server.id)).run();
  return c.json({ ok: true });
});

// ---------- generic agent proxy ----------
async function forward(c: any, server: ServerRow, path: string, init: RequestInit = {}): Promise<Response> {
  const node = getNodeOr404(server.nodeId);
  if (!node) return c.json({ error: "Unknown node" }, 404);
  try {
    const res = await agentFetch(node, path, init);
    const headers = new Headers();
    for (const h of ["content-type", "content-disposition", "content-length"]) {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    }
    return new Response(res.body, { status: res.status, headers });
  } catch (err) {
    return c.json({ error: err instanceof AgentError ? err.message : "Node unreachable" }, 502);
  }
}

// ---------- files ----------
serversRouter.get("/:id/files", (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  if (!can(access, "files.read")) return c.json({ error: "Forbidden" }, 403);
  const dir = c.req.query("dir") || "/";
  return forward(c, server, `/api/v1/servers/${server.id}/files?dir=${encodeURIComponent(dir)}`);
});

serversRouter.get("/:id/files/content", (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  if (!can(access, "files.read")) return c.json({ error: "Forbidden" }, 403);
  return forward(c, server, `/api/v1/servers/${server.id}/files/content?path=${encodeURIComponent(c.req.query("path") ?? "")}`);
});

serversRouter.get("/:id/files/download", (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  if (!can(access, "files.read")) return c.json({ error: "Forbidden" }, 403);
  return forward(c, server, `/api/v1/servers/${server.id}/files/download?path=${encodeURIComponent(c.req.query("path") ?? "")}`);
});

serversRouter.put("/:id/files/content", async (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  if (!can(access, "files.write")) return c.json({ error: "Forbidden" }, 403);
  return forward(c, server, `/api/v1/servers/${server.id}/files/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: await c.req.text(),
  });
});

serversRouter.post("/:id/files/upload", async (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  if (!can(access, "files.write")) return c.json({ error: "Forbidden" }, 403);
  const body = await c.req.arrayBuffer();
  return forward(c, server, `/api/v1/servers/${server.id}/files/upload`, {
    method: "POST",
    headers: { "Content-Type": c.req.header("Content-Type") ?? "application/octet-stream" },
    body,
  });
});

for (const action of ["rename", "extract", "delete"] as const) {
  serversRouter.post(`/:id/files/${action}`, async (c) => {
    const server = getServer(c.req.param("id"));
    if (!server) return c.json({ error: "Not found" }, 404);
    const access = guard(c, server);
    if (!access) return;
    const needed = action === "delete" ? "files.delete" : "files.write";
    if (!can(access, needed)) return c.json({ error: "Forbidden" }, 403);
    return forward(c, server, `/api/v1/servers/${server.id}/files/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await c.req.text(),
    });
  });
}

// ---------- backups ----------
serversRouter.post("/:id/backups", async (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  if (!can(access, "backups.create")) return c.json({ error: "Forbidden" }, 403);
  const node = getNodeOr404(server.nodeId);
  if (!node) return c.json({ error: "Unknown node" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  const id = crypto.randomUUID();
  const name = body.name?.trim() || `backup-${new Date().toISOString().slice(0, 16)}`;
  getDb().insert(backups).values({ id, serverId: server.id, nodeId: server.nodeId, name, state: "pending" });
  try {
    await agentJson(node, `/api/v1/servers/${server.id}/backups`, {
      method: "POST",
      body: JSON.stringify({ backupId: id, name }),
    });
  } catch (err) {
    getDb().update(backups).set({ state: "failed" }).where(eq(backups.id, id)).run();
    return c.json({ error: err instanceof AgentError ? err.message : "Node unreachable" }, 502);
  }
  return c.json({ ok: true, id }, 201);
});

serversRouter.get("/:id/backups", (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  if (!canAny(access, ["backups.create", "backups.download", "backups.restore", "backups.delete"])) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const rows = getDb().select().from(backups).where(eq(backups.serverId, server.id)).all();
  return c.json({
    backups: rows.map((b) => ({
      id: b.id,
      serverId: b.serverId,
      name: b.name,
      state: b.state,
      sizeBytes: b.sizeBytes,
      createdAt: b.createdAt.toISOString(),
    })),
  });
});

serversRouter.get("/:id/backups/:bid/download", (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  if (!can(access, "backups.download")) return c.json({ error: "Forbidden" }, 403);
  return forward(c, server, `/api/v1/servers/${server.id}/backups/${c.req.param("bid")}/download`);
});

serversRouter.post("/:id/backups/:bid/restore", (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  if (!can(access, "backups.restore")) return c.json({ error: "Forbidden" }, 403);
  return forward(c, server, `/api/v1/servers/${server.id}/backups/${c.req.param("bid")}/restore`, { method: "POST" });
});

serversRouter.delete("/:id/backups/:bid", (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  if (!can(access, "backups.delete")) return c.json({ error: "Forbidden" }, 403);
  const db = getDb();
  db.delete(backups).where(and(eq(backups.id, c.req.param("bid")), eq(backups.serverId, server.id))).run();
  return forward(c, server, `/api/v1/servers/${server.id}/backups/${c.req.param("bid")}`, { method: "DELETE" });
});

// ---------- subusers ----------
function granterCanGrant(access: Access, requested: string[]): boolean {
  if (access.perms === "*") return true;
  const granted = access.perms as readonly string[];
  return requested.every((p) => SERVER_PERMISSIONS.includes(p as ServerPermission) && hasPermission(granted, p as ServerPermission));
}

serversRouter.get("/:id/subusers", (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  if (!can(access, "subusers.manage")) return c.json({ error: "Forbidden" }, 403);
  const rows = getDb()
    .select({ su: subusers, user: users })
    .from(subusers)
    .innerJoin(users, eq(users.id, subusers.userId))
    .where(eq(subusers.serverId, server.id))
    .all();
  return c.json({
    subusers: rows.map(({ su, user }) => ({
      id: su.id,
      userId: user.id,
      email: user.email,
      username: user.username,
      permissions: su.permissions,
    })),
  });
});

serversRouter.post("/:id/subusers", async (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  if (!can(access, "subusers.manage")) return c.json({ error: "Forbidden" }, 403);
  const input = SubuserCreateInput.parse(await c.req.json());
  if (!granterCanGrant(access, input.permissions)) {
    return c.json({ error: "You cannot grant permissions you do not have" }, 403);
  }
  const db = getDb();
  const target = db.select().from(users).where(eq(users.email, input.email.toLowerCase())).get();
  if (!target) return c.json({ error: "No user with that email exists" }, 404);
  if (target.id === server.userId) return c.json({ error: "Owner already has full access" }, 409);
  const existing = db
    .select()
    .from(subusers)
    .where(and(eq(subusers.serverId, server.id), eq(subusers.userId, target.id)))
    .get();
  if (existing) {
    db.update(subusers).set({ permissions: input.permissions }).where(eq(subusers.id, existing.id)).run();
    return c.json({ ok: true, id: existing.id });
  }
  const id = crypto.randomUUID();
  db.insert(subusers).values({ id, serverId: server.id, userId: target.id, permissions: input.permissions }).run();
  return c.json({ ok: true, id }, 201);
});

serversRouter.patch("/:id/subusers/:sid", async (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  if (!can(access, "subusers.manage")) return c.json({ error: "Forbidden" }, 403);
  const input = SubuserCreateInput.parse(await c.req.json());
  if (!granterCanGrant(access, input.permissions)) {
    return c.json({ error: "You cannot grant permissions you do not have" }, 403);
  }
  getDb()
    .update(subusers)
    .set({ permissions: input.permissions })
    .where(and(eq(subusers.id, c.req.param("sid")), eq(subusers.serverId, server.id)))
    .run();
  return c.json({ ok: true });
});

serversRouter.delete("/:id/subusers/:sid", (c) => {
  const server = getServer(c.req.param("id"));
  if (!server) return c.json({ error: "Not found" }, 404);
  const access = guard(c, server);
  if (!can(access, "subusers.manage")) return c.json({ error: "Forbidden" }, 403);
  getDb()
    .delete(subusers)
    .where(and(eq(subusers.id, c.req.param("sid")), eq(subusers.serverId, server.id)))
    .run();
  return c.json({ ok: true });
});

export default serversRouter;
