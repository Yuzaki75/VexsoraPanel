import fs from "node:fs";
import { serve } from "@hono/node-server";
import { WebSocketServer, WebSocket } from "ws";
import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import { config, credentialsPath, type AgentCredentials } from "./config.js";
import { createApp } from "./routes.js";
import { ServerManager } from "./serverManager.js";
import { createRuntime } from "./runtime/index.js";
import { consoleHub } from "./console.js";
import type { ConsoleInbound, ServerStats } from "@strixmc/shared";
import { STATS_INTERVAL_MS } from "@strixmc/shared";

function loadCredentials(): AgentCredentials | null {
  const file = credentialsPath();
  if (fs.existsSync(file)) {
    const creds = JSON.parse(fs.readFileSync(file, "utf8")) as AgentCredentials;
    console.log(`[agent] loaded credentials for node ${creds.nodeId}`);
    return creds;
  }
  return null;
}

async function joinPanel(): Promise<AgentCredentials> {
  if (!config.panelUrl || !config.joinToken) {
    console.error(
      `[agent] No credentials found. Either restore ${credentialsPath()} or join a panel:\n` +
        `  STRIX_PANEL_URL=<panel url> STRIX_JOIN_TOKEN=<join token> npm start`
    );
    process.exit(1);
  }
  const agentSecret = crypto.randomBytes(32).toString("hex");
  console.log("[agent] joining panel…");
  const res = await fetch(`${config.panelUrl}/api/v1/nodes/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      joinToken: config.joinToken,
      agentSecret,
      agentVersion: config.version,
      runtimeMode: "native",
    }),
  });
  if (!res.ok) {
    console.error(`[agent] join failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const data = (await res.json()) as { nodeId: string; nodeToken: string; panelUrl: string };
  const creds: AgentCredentials = {
    nodeId: data.nodeId,
    nodeToken: data.nodeToken,
    agentSecret,
  };
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(credentialsPath(), JSON.stringify(creds, null, 2));
  console.log(`[agent] joined panel as node ${creds.nodeId}`);
  return creds;
}

async function main(): Promise<void> {
  let creds = loadCredentials();
  if (!creds) creds = await joinPanel();

  const managerRef: { current: ServerManager | null } = { current: null };

  const runtime = await createRuntime({
    onOutput: (serverId, line) => consoleHub.log(serverId, line),
    onExit: (serverId, intentional, code) => managerRef.current?.onExit(serverId, intentional, code),
  });

  const manager = new ServerManager(runtime, () => creds);
  managerRef.current = manager;
  manager.loadFromDisk();

  const app = createApp(manager, creds.agentSecret);
  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    console.log(`[agent] listening on http://${config.host}:${info.port} (runtime: ${runtime.mode})`);
  });

  // ---------- console websocket ----------
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const match = url.pathname.match(/^\/api\/v1\/servers\/([0-9a-f-]+)\/console$/);
    if (!match) return socket.destroy();
    const token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null;
    if (token !== creds?.agentSecret) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }
    const serverId = match[1];
    if (!manager.get(serverId)) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket as never, head, (ws) => {
      consoleHub.attach(serverId, ws);
      // Replay history
      for (const entry of consoleHub.history(serverId)) {
        ws.send(JSON.stringify({ type: "output", data: entry }));
      }
      const state = manager.get(serverId);
      if (state) ws.send(JSON.stringify({ type: "status", data: { status: state.status } }));

      ws.on("message", (raw) => {
        let parsed: ConsoleInbound | null = null;
        try {
          parsed = JSON.parse(raw.toString()) as ConsoleInbound;
        } catch {
          return;
        }
        if (parsed?.type === "command") {
          const ok = manager.sendCommand(serverId, parsed.data.command.slice(0, 2000));
          if (!ok) {
            ws.send(
              JSON.stringify({ type: "error", data: { message: "Server is not running or does not accept input" } })
            );
          }
        }
      });
    });
  });

  // ---------- stats broadcaster ----------
  setInterval(async () => {
    for (const state of manager.list()) {
      const stats = manager.isRunning(state.config.serverId) ? await manager.stats(state.config.serverId) : null;
      if (!stats) continue;
      const snapshot: ServerStats = { ...stats, status: state.status };
      consoleHub.broadcast(state.config.serverId, { type: "stats", data: snapshot });
    }
  }, STATS_INTERVAL_MS);

  // ---------- heartbeat ----------
  setInterval(async () => {
    if (!creds) return;
    try {
      await fetch(`${config.panelUrl}/api/v1/nodes/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${creds.nodeToken}` },
        body: JSON.stringify({ version: config.version, runtimeMode: runtime.mode }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // panel offline — will retry
    }
  }, config.heartbeatSec * 1000);
}

main().catch((err) => {
  console.error("[agent] fatal:", err);
  process.exit(1);
});
