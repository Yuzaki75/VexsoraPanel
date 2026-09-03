import { Hono } from "hono";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CommandInput,
  FileWriteInput,
  FileRenameInput,
  FileDeleteInput,
  FileExtractInput,
  type ServerTemplate,
} from "@strixmc/shared";
import { config } from "./config.js";
import { consoleHub } from "./console.js";
import { ServerManager } from "./serverManager.js";
import {
  listDir,
  readTextFile,
  writeTextFile,
  deletePath,
  renamePath,
  extractArchive,
  resolveSafe,
} from "./files.js";
import {
  createBackup,
  restoreBackup,
  deleteBackup,
  backupExists,
  backupPath,
  backupSizeBytes,
  listLocalBackups,
} from "./backups.js";
import type { ServerConfig } from "./runtime/types.js";

type AgentEnv = { Variables: { manager: ServerManager } };

export function createApp(manager: ServerManager, agentSecret: string): Hono<AgentEnv> {
  const app = new Hono<AgentEnv>();
  app.use("*", async (c, next) => {
    // Health is the only unauthenticated route.
    if (c.req.path === "/api/v1/health") return next();
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const ok =
      !!token &&
      token.length === agentSecret.length &&
      crypto.timingSafeEqual(Buffer.from(token), Buffer.from(agentSecret));
    if (!ok) return c.json({ error: "Unauthorized" }, 401);
    c.set("manager", manager);
    return next();
  });

  app.onError((err, c) => {
    console.error("[agent] error:", err);
    return c.json({ error: (err as Error).message }, 500);
  });

  app.get("/api/v1/health", (c) =>
    c.json({ ok: true, version: config.version, runtime: manager.mode })
  );

  // ---------- servers ----------
  app.post("/api/v1/servers", async (c) => {
    const body = (await c.req.json()) as ServerConfig & { startOnCreate?: boolean };
    if (!body.serverId || !body.template) return c.json({ error: "Invalid payload" }, 400);
    try {
      await manager.provision(body, body.startOnCreate ?? false);
      return c.json({ ok: true }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.put("/api/v1/servers/:id/config", async (c) => {
    const body = (await c.req.json()) as {
      template?: ServerTemplate;
      variables?: Record<string, string>;
      limits?: ServerConfig["limits"];
    };
    manager.updateConfig(c.req.param("id"), body);
    return c.json({ ok: true });
  });

  app.delete("/api/v1/servers/:id", async (c) => {
    await manager.remove(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.post("/api/v1/servers/:id/power", async (c) => {
    const { action } = (await c.req.json()) as { action: "start" | "stop" | "restart" | "kill" };
    try {
      await manager.power(c.req.param("id"), action);
      return c.json({ ok: true });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("already running") || msg.includes("still installing")) {
        return c.json({ error: msg }, 409);
      }
      return c.json({ error: msg }, 500);
    }
  });

  app.post("/api/v1/servers/:id/reinstall", async (c) => {
    try {
      await manager.install(c.req.param("id"));
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get("/api/v1/servers/:id/stats", async (c) => {
    const state = manager.get(c.req.param("id"));
    if (!state) return c.json({ error: "Not found" }, 404);
    const stats = await manager.stats(c.req.param("id"));
    return c.json({
      running: manager.isRunning(c.req.param("id")),
      ...(stats ?? {
        cpuPercent: 0,
        memoryMb: 0,
        memoryLimitMb: state.config.limits.memoryMb,
        diskMb: 0,
        diskLimitMb: state.config.limits.diskMb,
        networkRxMb: 0,
        networkTxMb: 0,
        uptimeSec: 0,
      }),
    });
  });

  app.post("/api/v1/servers/:id/command", async (c) => {
    const { command } = CommandInput.parse(await c.req.json());
    const ok = manager.sendCommand(c.req.param("id"), command);
    return c.json({ ok }, ok ? 200 : 409);
  });

  // ---------- files ----------
  const serverDir = (id: string): string => {
    const state = manager.get(id);
    if (!state) throw new Error("Server not found");
    return state.dir;
  };

  app.get("/api/v1/servers/:id/files", (c) => {
    try {
      return c.json(listDir(serverDir(c.req.param("id")), c.req.query("dir") || "/"));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get("/api/v1/servers/:id/files/content", (c) => {
    try {
      const content = readTextFile(serverDir(c.req.param("id")), c.req.query("path") ?? "");
      return c.json({ path: c.req.query("path"), content });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get("/api/v1/servers/:id/files/download", (c) => {
    try {
      const base = serverDir(c.req.param("id"));
      const target = resolveSafe(base, c.req.query("path") ?? "");
      const st = fs.statSync(target);
      if (!st.isFile()) return c.json({ error: "Not a file" }, 400);
      const data = fs.readFileSync(target);
      return c.body(data as unknown as ArrayBuffer, 200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${path.basename(target)}"`,
      });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.put("/api/v1/servers/:id/files/content", async (c) => {
    const input = FileWriteInput.parse(await c.req.json());
    try {
      writeTextFile(serverDir(c.req.param("id")), input.path, input.content);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.post("/api/v1/servers/:id/files/upload", async (c) => {
    try {
      const dir = c.req.query("dir") || "/";
      const form = await c.req.parseBody({ all: true });
      const files = Object.values(form).filter((v): v is File => v instanceof File);
      if (files.length === 0) return c.json({ error: "No files in request" }, 400);
      const base = serverDir(c.req.param("id"));
      for (const file of files) {
        const target = resolveSafe(base, path.posix.join(dir, file.name));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, Buffer.from(await file.arrayBuffer()));
      }
      return c.json({ ok: true, count: files.length });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.post("/api/v1/servers/:id/files/rename", async (c) => {
    const input = FileRenameInput.parse(await c.req.json());
    try {
      renamePath(serverDir(c.req.param("id")), input.from, input.to);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.post("/api/v1/servers/:id/files/extract", async (c) => {
    const input = FileExtractInput.parse(await c.req.json());
    try {
      await extractArchive(serverDir(c.req.param("id")), input.path);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.post("/api/v1/servers/:id/files/delete", async (c) => {
    const input = FileDeleteInput.parse(await c.req.json());
    try {
      deletePath(serverDir(c.req.param("id")), input.path);
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // ---------- backups ----------
  app.post("/api/v1/servers/:id/backups", async (c) => {
    const { backupId } = (await c.req.json()) as { backupId: string };
    const state = manager.get(c.req.param("id"));
    if (!state) return c.json({ error: "Server not found" }, 404);
    try {
      consoleHub.log(c.req.param("id"), "[agent] creating backup…");
      await createBackup(c.req.param("id"), backupId, state.dir);
      const size = backupSizeBytes(c.req.param("id"), backupId);
      consoleHub.log(c.req.param("id"), `[agent] backup complete (${(size / 1024 / 1024).toFixed(1)} MB)`);
      manager.reportBackup(backupId, c.req.param("id"), "completed", size);
      return c.json({ ok: true, sizeBytes: size }, 201);
    } catch (err) {
      manager.reportBackup(backupId, c.req.param("id"), "failed", 0);
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.get("/api/v1/servers/:id/backups", (c) => {
    return c.json({ backups: listLocalBackups(c.req.param("id")) });
  });

  app.get("/api/v1/servers/:id/backups/:bid/download", (c) => {
    const id = c.req.param("id");
    const bid = c.req.param("bid");
    if (!backupExists(id, bid)) return c.json({ error: "Backup not found" }, 404);
    const data = fs.readFileSync(backupPath(id, bid));
    return c.body(data as unknown as ArrayBuffer, 200, {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${bid}.tar.gz"`,
    });
  });

  app.post("/api/v1/servers/:id/backups/:bid/restore", async (c) => {
    const id = c.req.param("id");
    const bid = c.req.param("bid");
    const state = manager.get(id);
    if (!state) return c.json({ error: "Server not found" }, 404);
    if (manager.isRunning(id)) return c.json({ error: "Stop the server before restoring" }, 409);
    try {
      consoleHub.log(id, "[agent] restoring backup…");
      await restoreBackup(id, bid, state.dir);
      consoleHub.log(id, "[agent] restore complete");
      return c.json({ ok: true });
    } catch (err) {
      return c.json({ error: (err as Error).message }, 500);
    }
  });

  app.delete("/api/v1/servers/:id/backups/:bid", (c) => {
    deleteBackup(c.req.param("id"), c.req.param("bid"));
    return c.json({ ok: true });
  });

  return app;
}
