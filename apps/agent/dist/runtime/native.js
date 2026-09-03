import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import pidusage from "pidusage";
import { buildEnv, LineSplitter } from "./types.js";
/**
 * Runs game servers as plain child processes in their server directory.
 * No container isolation — intended for trusted single-tenant hosts and dev.
 */
export class NativeRuntime {
    events;
    mode = "native";
    procs = new Map();
    constructor(events) {
        this.events = events;
    }
    envFor(cfg) {
        return buildEnv(cfg);
    }
    async start(serverId, cfg, cwd) {
        if (this.procs.has(serverId))
            throw new Error("Server already running");
        const command = cfg.template.startCommand;
        const env = { ...process.env, ...this.envFor(cfg) };
        const isWindows = process.platform === "win32";
        const child = isWindows
            ? spawn("cmd.exe", ["/d", "/s", "/c", command], { cwd, env, windowsHide: true })
            : spawn("/bin/bash", ["-c", command], { cwd, env });
        const proc = {
            child,
            splitter: new LineSplitter(),
            startedAt: Date.now(),
            intentionalStop: false,
            networkRxMb: 0,
            networkTxMb: 0,
        };
        this.procs.set(serverId, proc);
        proc.splitter.on("line", (line) => this.events.onOutput(serverId, line));
        child.stdout?.on("data", (d) => proc.splitter.push(d));
        child.stderr?.on("data", (d) => proc.splitter.push(d));
        child.on("error", (err) => {
            this.events.onOutput(serverId, `[agent] failed to start process: ${err.message}`);
            this.procs.delete(serverId);
            this.events.onExit(serverId, false, null);
        });
        child.on("exit", (code) => {
            const proc2 = this.procs.get(serverId);
            this.events.onOutput(serverId, `[agent] process exited with code ${code}`);
            this.procs.delete(serverId);
            this.events.onExit(serverId, proc2?.intentionalStop ?? false, code);
        });
    }
    sendCommand(serverId, command) {
        const proc = this.procs.get(serverId);
        if (!proc || !proc.child.stdin || proc.child.stdin.destroyed)
            return false;
        proc.child.stdin.write(command + "\n");
        return true;
    }
    async stop(serverId, cfg, timeoutSec) {
        const proc = this.procs.get(serverId);
        if (!proc)
            return;
        proc.intentionalStop = true;
        const { stopCommand } = cfg.template;
        if (stopCommand && proc.child.stdin && !proc.child.stdin.destroyed) {
            proc.child.stdin.write(stopCommand + "\n");
        }
        const exited = new Promise((resolve) => proc.child.once("exit", resolve));
        const timeout = new Promise((resolve) => setTimeout(resolve, Math.min(timeoutSec, 60) * 1000));
        await Promise.race([exited, timeout]);
        if (this.procs.has(serverId)) {
            await this.kill(serverId);
        }
    }
    async kill(serverId) {
        const proc = this.procs.get(serverId);
        if (!proc)
            return;
        proc.intentionalStop = true;
        const pid = proc.child.pid;
        if (!pid)
            return;
        if (process.platform === "win32") {
            spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
        }
        else {
            try {
                process.kill(-pid, "SIGKILL");
            }
            catch {
                proc.child.kill("SIGKILL");
            }
        }
    }
    async runInstall(serverId, cfg, cwd, onLine) {
        const script = cfg.template.installScript;
        if (!script)
            return;
        const { spawn } = await import("node:child_process");
        const env = { ...process.env, ...this.envFor(cfg) };
        const isWindows = process.platform === "win32";
        const useBash = isWindows ? await hasBash() : true;
        const child = isWindows
            ? useBash
                ? spawn("bash", ["-c", script], { cwd, env, windowsHide: true })
                : spawn("cmd.exe", ["/d", "/s", "/c", script], { cwd, env, windowsHide: true })
            : spawn("/bin/bash", ["-c", script], { cwd, env });
        const code = await new Promise((resolve, reject) => {
            child.stdout?.on("data", (d) => d.toString().split("\n").filter(Boolean).forEach(onLine));
            child.stderr?.on("data", (d) => d.toString().split("\n").filter(Boolean).forEach(onLine));
            child.on("error", reject);
            child.on("exit", (c) => resolve(c ?? 1));
        });
        if (code !== 0)
            throw new Error(`install script exited with code ${code}`);
    }
    isRunning(serverId) {
        return this.procs.has(serverId);
    }
    async stats(serverId, cfg, cwd) {
        const proc = this.procs.get(serverId);
        if (!proc || !proc.child.pid)
            return null;
        let cpuPercent = 0;
        let memoryMb = 0;
        try {
            const usage = await pidusage(proc.child.pid);
            cpuPercent = usage.cpu;
            memoryMb = usage.memory / (1024 * 1024);
        }
        catch {
            // process may have just exited
        }
        return {
            cpuPercent: Math.round(cpuPercent * 10) / 10,
            memoryMb: Math.round(memoryMb * 10) / 10,
            memoryLimitMb: cfg.limits.memoryMb,
            diskMb: await dirSizeMb(cwd),
            diskLimitMb: cfg.limits.diskMb,
            networkRxMb: proc.networkRxMb,
            networkTxMb: proc.networkTxMb,
            uptimeSec: Math.floor((Date.now() - proc.startedAt) / 1000),
            status: "running",
        };
    }
}
const diskCache = new Map();
async function hasBash() {
    return new Promise((resolve) => {
        const child = spawn("bash", ["--version"], { windowsHide: true });
        child.on("error", () => resolve(false));
        child.on("exit", () => resolve(true));
    });
}
export async function dirSizeMb(dir) {
    const cached = diskCache.get(dir);
    if (cached && Date.now() - cached.at < 30_000)
        return cached.mb;
    let total = 0;
    const walk = (d) => {
        let entries;
        try {
            entries = fs.readdirSync(d, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of entries) {
            const full = path.join(d, e.name);
            if (e.isDirectory())
                walk(full);
            else if (e.isFile()) {
                try {
                    total += fs.statSync(full).size;
                }
                catch {
                    // raced with delete
                }
            }
        }
    };
    walk(dir);
    const mb = Math.round((total / (1024 * 1024)) * 10) / 10;
    diskCache.set(dir, { at: Date.now(), mb });
    return mb;
}
//# sourceMappingURL=native.js.map