import fs from "node:fs";
import path from "node:path";
import { consoleHub } from "./console.js";
import { reportToPanel } from "./panel.js";
import { config } from "./config.js";
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
    runtime;
    creds;
    servers = new Map();
    constructor(runtime, creds) {
        this.runtime = runtime;
        this.creds = creds;
    }
    dirFor(serverId) {
        return path.join(config.dataDir, "servers", serverId);
    }
    configPath(serverId) {
        return path.join(this.dirFor(serverId), ".strix.json");
    }
    get(serverId) {
        return this.servers.get(serverId);
    }
    list() {
        return [...this.servers.values()];
    }
    loadFromDisk() {
        const serversRoot = path.join(config.dataDir, "servers");
        if (!fs.existsSync(serversRoot))
            return;
        for (const entry of fs.readdirSync(serversRoot, { withFileTypes: true })) {
            if (!entry.isDirectory())
                continue;
            const cfgFile = path.join(serversRoot, entry.name, ".strix.json");
            if (!fs.existsSync(cfgFile))
                continue;
            try {
                const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf8"));
                this.servers.set(cfg.serverId, {
                    config: cfg,
                    status: "stopped",
                    dir: this.dirFor(cfg.serverId),
                    startedAt: null,
                });
            }
            catch (err) {
                console.error(`[agent] failed to load server config ${entry.name}:`, err.message);
            }
        }
    }
    async provision(cfg, startOnCreate) {
        const dir = this.dirFor(cfg.serverId);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.configPath(cfg.serverId), JSON.stringify(cfg, null, 2));
        this.servers.set(cfg.serverId, { config: cfg, status: "installing", dir, startedAt: null });
        consoleHub.log(cfg.serverId, `[agent] server provisioned with template ${cfg.template.name}`);
        await this.install(cfg.serverId);
        if (startOnCreate)
            await this.start(cfg.serverId);
    }
    updateConfig(serverId, patch) {
        const state = this.servers.get(serverId);
        if (!state)
            return;
        if (patch.template)
            state.config.template = patch.template;
        if (patch.variables)
            state.config.variables = { ...state.config.variables, ...patch.variables };
        if (patch.limits)
            state.config.limits = patch.limits;
        fs.writeFileSync(this.configPath(serverId), JSON.stringify(state.config, null, 2));
    }
    async remove(serverId) {
        if (this.runtime.isRunning(serverId))
            await this.runtime.kill(serverId);
        this.servers.delete(serverId);
        consoleHub.cleanup(serverId);
        fs.rmSync(this.dirFor(serverId), { recursive: true, force: true });
    }
    setStatus(serverId, status, detail) {
        if (!VALID_STATUSES.has(status))
            return;
        const state = this.servers.get(serverId);
        if (state)
            state.status = status;
        consoleHub.broadcast(serverId, { type: "status", data: { status, detail } });
        const creds = this.creds();
        if (creds)
            void reportToPanel(creds, { type: "server.status", serverId, status, detail });
    }
    async start(serverId) {
        const state = this.servers.get(serverId);
        if (!state)
            throw new Error("Server not found");
        if (this.runtime.isRunning(serverId))
            throw new Error("Server already running");
        if (state.status === "installing")
            throw new Error("Server is still installing");
        this.setStatus(serverId, "starting");
        try {
            await this.runtime.start(serverId, state.config, state.dir);
            state.startedAt = Date.now();
            this.setStatus(serverId, "running");
        }
        catch (err) {
            this.setStatus(serverId, "crashed", err.message);
            consoleHub.log(serverId, `[agent] start failed: ${err.message}`);
            throw err;
        }
    }
    async power(serverId, action) {
        const state = this.servers.get(serverId);
        if (!state)
            throw new Error("Server not found");
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
    sendCommand(serverId, command) {
        return this.runtime.sendCommand(serverId, command);
    }
    reportBackup(backupId, serverId, state, sizeBytes) {
        const creds = this.creds();
        if (creds) {
            void reportToPanel(creds, { type: "backup.state", serverId, backupId, status: state, sizeBytes });
        }
    }
    async install(serverId) {
        const state = this.servers.get(serverId);
        if (!state)
            throw new Error("Server not found");
        const { template } = state.config;
        this.setStatus(serverId, "installing");
        consoleHub.log(serverId, `[agent] installing ${template.name}…`);
        try {
            await this.runtime.runInstall(serverId, state.config, state.dir, (line) => consoleHub.log(serverId, `[install] ${line}`));
            this.renderConfigs(serverId, state);
            consoleHub.log(serverId, "[agent] install complete");
            this.setStatus(serverId, "installed");
        }
        catch (err) {
            consoleHub.log(serverId, `[agent] install failed: ${err.message}`);
            this.setStatus(serverId, "crashed", `install failed: ${err.message}`);
            throw err;
        }
    }
    /** Render template config files into the server directory ({{VAR}} substitution). */
    renderConfigs(serverId, state) {
        const vars = {
            ...state.config.variables,
            SERVER_IP: state.config.allocation.ip,
            SERVER_PORT: String(state.config.allocation.port),
            SERVER_MEMORY: String(state.config.limits.memoryMb),
        };
        for (const cfgFile of state.config.template.configs) {
            const target = path.join(state.dir, cfgFile.path);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            const rendered = cfgFile.content.replace(/\{\{\s*([A-Z_][A-Z0-9_]*)\s*\}\}/g, (_, key) => vars[key] ?? "");
            fs.writeFileSync(target, rendered);
            consoleHub.log(serverId, `[agent] wrote config ${cfgFile.path}`);
        }
    }
    stats(serverId) {
        const state = this.servers.get(serverId);
        if (!state)
            return Promise.resolve(null);
        return this.runtime.stats(serverId, state.config, state.dir);
    }
    isRunning(serverId) {
        return this.runtime.isRunning(serverId);
    }
    get mode() {
        return this.runtime.mode;
    }
    /** Called by runtimes when a game process exits. */
    onExit(serverId, intentional, _code) {
        const state = this.servers.get(serverId);
        if (state)
            state.startedAt = null;
        this.setStatus(serverId, intentional ? "stopped" : "crashed");
    }
}
//# sourceMappingURL=serverManager.js.map