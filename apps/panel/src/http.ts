import { serve } from "@hono/node-server";
import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { and, eq } from "drizzle-orm";
import { config } from "./config.js";
import { getDb } from "./db/index.js";
import { servers, subusers, users } from "./db/schema.js";
import { sessionTokenFromCookieHeader, userFromSession } from "./auth/sessions.js";
import { lookupApiKey } from "./auth/apikeys.js";
import { getNodeOr404, agentFetch, agentBaseUrl } from "./proxy/agent.js";
import authRoutes from "./routes/auth.js";
import usersRoutes from "./routes/users.js";
import nodesRoutes from "./routes/nodes.js";
import serversRoutes from "./routes/servers.js";
import templatesRoutes from "./routes/templates.js";
import webhooksRoutes from "./routes/webhooks.js";

const api = new Hono();

api.onError((err, c) => {
  if (err instanceof SyntaxError) return c.json({ error: "Invalid JSON body" }, 400);
  console.error("[panel] unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

api.route("/auth", authRoutes);
api.route("/users", usersRoutes);
api.route("/nodes", nodesRoutes);
api.route("/servers", serversRoutes);
api.route("/templates", templatesRoutes);
api.route("/webhooks", webhooksRoutes);

const app = new Hono();
app.route("/api/v1", api);

// Static SPA (production)
if (fs.existsSync(config.webDist)) {
  app.use("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    const file = path.join(config.webDist, c.req.path === "/" ? "index.html" : c.req.path);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      return c.body(fs.readFileSync(file) as unknown as ArrayBuffer, 200, {
        "Content-Type": lookupMime(file),
      });
    }
    return c.body(fs.readFileSync(path.join(config.webDist, "index.html")) as unknown as ArrayBuffer, 200, {
      "Content-Type": "text/html; charset=utf-8",
    });
  });
}

function lookupMime(file: string): string {
  const ext = path.extname(file).toLowerCase();
  const mimes: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".map": "application/json",
  };
  return mimes[ext] ?? "application/octet-stream";
}

// ---------- WebSocket console proxy: browser <-> panel <-> agent ----------
const wss = new WebSocketServer({ noServer: true });

async function handleConsoleUpgrade(req: IncomingMessage, socket: any, head: Buffer) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const match = url.pathname.match(/^\/api\/v1\/servers\/([0-9a-f-]+)\/console$/);
  if (!match) {
    socket.destroy();
    return;
  }
  const serverId = match[1];

  // Authenticate the browser: session cookie or API key (query/header bearer).
  let user = null as null | { id: string; role: string };
  const token = sessionTokenFromCookieHeader(req.headers.cookie);
  if (token) user = userFromSession(token);
  if (!user) {
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : url.searchParams.get("token");
    if (bearer) {
      const key = lookupApiKey(bearer);
      if (key?.userId) {
        const db = getDb();
        const u = db.select().from(users).where(eq(users.id, key.userId)).get();
        if (u) user = { id: u.id, role: u.role };
      }
    }
  }
  if (!user) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const db = getDb();
  const server = db.select().from(servers).where(eq(servers.id, serverId)).get();
  if (!server) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  if (user.role !== "admin" && server.userId !== user.id) {
    const su = db
      .select()
      .from(subusers)
      .where(and(eq(subusers.serverId, server.id), eq(subusers.userId, user.id)))
      .get();
    const perms = su?.permissions ?? [];
    if (!perms.includes("console.view")) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
  }

  const node = getNodeOr404(server.nodeId);
  if (!node?.agentSecret) {
    socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    socket.destroy();
    return;
  }

  const agentUrl = `${agentBaseUrl(node).replace(/^http/, "ws")}/api/v1/servers/${server.id}/console`;
  const { default: WebSocketClient } = await import("ws");
  const upstream = new WebSocketClient(agentUrl, {
    headers: { Authorization: `Bearer ${node.agentSecret}` },
  });

  upstream.on("open", () => {
    wss.handleUpgrade(req, socket as any, head, (client: WebSocket) => {
      const pipe = (from: WebSocket, to: WebSocket) => {
        from.on("message", (data) => {
          if (to.readyState === WebSocket.OPEN) to.send(data.toString());
        });
        from.on("close", () => to.close());
        from.on("error", () => to.close());
      };
      pipe(client, upstream as unknown as WebSocket);
      pipe(upstream as unknown as WebSocket, client);
    });
  });
  upstream.on("error", () => {
    socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    socket.destroy();
  });
}

const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
  console.log(`[panel] StrixMC panel listening on http://${config.host}:${info.port}`);
});

server.on("upgrade", (req, socket, head) => {
  void handleConsoleUpgrade(req, socket as any, head);
});

export { app };
