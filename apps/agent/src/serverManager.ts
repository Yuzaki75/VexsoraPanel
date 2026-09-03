import fs from "node:fs";
import path from "node:path";
import { consoleHub } from "./console.js";
import { reportToPanel, type StrixCredentials } from "./panel.js";
import { config } from "./config.js";
import type { ServerConfig } from "./runtime/types.js";
import type { Runtime } from "./runtime/types.js";

export interface ServerState {
  config: ServerConfig;
  status: string;
  dir: string;
  startedAt: number | null;
}

const VALID_STATUSES = new Set([
  "installing",
  "installed",
  "starting",
  "running",
  "stopping",
  "stopped",
  "offline",
  "crashed",
]);

/**
 * Owns every server the agent manages: persisted config, live status,
 * directory layout, and the bridge between runtimes, console and panel.
 */
export class ServerManager {
  private servers = new Map<string, ServerState>();

  constructor(
    private runtime: Runtime,
    private creds: () => StrixCredentials | null
  ) {}

  dirFor(serverId: string): string {
    return path.join(config.dataDir, "servers", serverId);
  }

  private configPath(serverId: string): string {
    return path.join(this.dirFor(serverId), ".strix.json");
  }

  get(serverId: string): ServerState | undefined {
    return this.servers.get(serverId);
  }

  list(): ServerState[] {
    return [...this.servers.values()];
  }

  loadFromDisk(): void {
    const serversRoot = path.join(config.dataDir, "servers");
    if (!fs.existsSync(serversRoot)) return;
    for (const entry of fs.readdirSync(serversRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const cfgFile = path.join(serversRoot, entry.name, ".strix.json");
      if (!fs.existsSync(cfgFile)) continue;
      try {
        const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8")) as ServerConfig;
        this.servers.set(cfg.serverId, {
          config: cfg,
          status: "stopped",
          dir: this.dirFor(cfg.serverId),
          startedAt: null,
        });
      } catch (err) {
        console.error(`[agent] failed to load server config ${entry.name}:`, (err as Error).message);
      }
    }
  }

  async provision(cfg: ServerConfig, startOnCreate: boolean): Promise<void> {
    const dir = this.dirFor(cfg.serverId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.configPath(cfg.serverId), JSON.stringify(cfg, null, 2));
    this.servers.set(cfg.serverId, { config: cfg, status: "installing", dir, startedAt: null });
    consoleHub.log(cfg.serverId, `[agent] server provisioned with template ${cfg.template.name}`);
    await this.install(cfg.serverId);
    if (startOnCreate) await this.start(cfg.serverId);
  }

  updateConfig(serverId: string, patch: { template?: ServerConfig["template"]; variables?: Record<string, string>; limits?: ServerConfig["limits"] }): void {
    const state = this.servers.get(serverId);
    if (!state) return;
    if (patch.template) state.config.template = patch.template;
    if (patch.variables) state.config.variables = { ...state.config.variables, ...patch.variables };
    if (patch.limits) state.config.limits = patch.limits;
    fs.writeFileSync(this.configPath(serverId), JSON.stringify(state.config, null, 2));
  }

  async remove(serverId: string): Promise<void> {
    if (this.runtime.isRunning(serverId)) await this.runtime.kill(serverId);
    this.servers.delete(serverId);
    consoleHub.cleanup(serverId);
    fs.rmSync(this.dirFor(serverId), { recursive: true, force: true });
  }

  setStatus(serverId: string, status: string, detail?: string): void {
    if (!VALID_STATUSES.has(status)) return;
    const state = this.servers.get(serverId);
    if (state) state.status = status;
    consoleHub.broadcast(serverId, { type: "status", data: { status, detail } });
    const creds = this.creds();
    if (creds) void reportToPanel(creds, { type: "server.status", serverId, status, detail });
  }

  async start(serverId: string): Promise<void> {
    const state = this.servers.get(serverId);
    if (!state) throw new Error("Server not found");
    if (this.runtime.isRunning(serverId)) throw new Error("Server already running");
    if (state.status === "installing") throw new Error("Server is still installing");
    this.setStatus(serverId, "starting");
    try {
      await this.runtime.start(serverId, state.config, state.dir);
      state.startedAt = Date.now();
      this.setStatus(serverId, "running");
    } catch (err) {
      this.setStatus(serverId, "crashed", (err as Error).message);
      consoleHub.log(serverId, `[agent] start failed: ${(err as Error).message}`);
      throw err;
    }
  }

  async power(serverId: string, action: "start" | "stop" | "restart" | "kill"): Promise<void> {
    const state = this.servers.get(serverId);
    if (!state) throw new Error("Server not found");
    switch (action) {
      case "start":
        await this.start(serverId);
        break;
      case "stop": {
        if (!this.runtime.isRunning(serverId)) {
          this.setStatus(serverId, "stopped");
          return;
        }
        this.setStatus(serverId, "stopping");
        await this.runtime.stop(serverId, state.config, state.config.template.stopTimeoutSec);
        break;
      }
      case "restart": {
        if (this.runtime.isRunning(serverId)) {
          this.setStatus(serverId, "stopping");
          await this.runtime.stop(serverId, state.config, state.config.template.stopTimeoutSec);
        }
        await this.start(serverId);
        break;
      }
      case "kill": {
        await this.runtime.kill(serverId);
        this.setStatus(serverId, "stopped");
        break;
      }
    }
  }

  sendCommand(serverId: string, command: string): boolean {
    return this.runtime.sendCommand(serverId, command);
  }

  reportBackup(backupId: string, serverId: string, state: string, sizeBytes: number): void {
    const creds = this.creds();
    if (creds) {
      void reportToPanel(creds, { type: "backup.state", serverId, backupId, status: state, sizeBytes });
    }
  }

  async install(serverId: string): Promise<void> {
    const state = this.servers.get(serverId);
    if (!state) throw new Error("Server not found");
    const { template } = state.config;
    this.setStatus(serverId, "installing");
    consoleHub.log(serverId, `[agent] installing ${template.name}…`);

    try {
      await this.runtime.runInstall(serverId, state.config, state.dir, (line) =>
        consoleHub.log(serverId, `[install] ${line}`)
      );
      this.renderConfigs(serverId, state);
      consoleHub.log(serverId, "[agent] install complete");
      this.setStatus(serverId, "installed");
    } catch (err) {
      consoleHub.log(serverId, `[agent] install failed: ${(err as Error).message}`);
      this.setStatus(serverId, "crashed", `install failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /** Render template config files into the server directory ({{VAR}} substitution). */
  private renderConfigs(serverId: string, state: ServerState): void {
    const vars: Record<string, string> = {
      ...state.config.variables,
      SERVER_IP: state.config.allocation.ip,
      SERVER_PORT: String(state.config.allocation.port),
      SERVER_MEMORY: String(state.config.limits.memoryMb),
    };
    for (const cfgFile of state.config.template.configs) {
      const target = path.join(state.dir, cfgFile.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const rendered = cfgFile.content.replace(/\{\{\s*([A-Z_][A-Z0-9_]*)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
      fs.writeFileSync(target, rendered);
      consoleHub.log(serverId, `[agent] wrote config ${cfgFile.path}`);
    }
  }

  stats(serverId: string): Promise<import("./runtime/types.js").StatsSnapshot | null> {
    const state = this.servers.get(serverId);
    if (!state) return Promise.resolve(null);
    return this.runtime.stats(serverId, state.config, state.dir);
  }

  isRunning(serverId: string): boolean {
    return this.runtime.isRunning(serverId);
  }

  get mode(): string {
    return this.runtime.mode;
  }

  /** Called by runtimes when a game process exits. */
  onExit(serverId: string, intentional: boolean, _code: number | null): void {
    const state = this.servers.get(serverId);
    if (state) state.startedAt = null;
    this.setStatus(serverId, intentional ? "stopped" : "crashed");
  }
}
