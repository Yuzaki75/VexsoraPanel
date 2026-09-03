import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import pidusage from "pidusage";
import { buildEnv, LineSplitter, type Runtime, type ServerConfig, type StatsSnapshot } from "./types.js";
import type { RuntimeEvents } from "./types.js";

interface NativeProcess {
  child: ChildProcess;
  splitter: LineSplitter;
  startedAt: number;
  intentionalStop: boolean;
  networkRxMb: number;
  networkTxMb: number;
}

/**
 * Runs game servers as plain child processes in their server directory.
 * No container isolation — intended for trusted single-tenant hosts and dev.
 */
export class NativeRuntime implements Runtime {
  mode = "native" as const;
  private procs = new Map<string, NativeProcess>();

  constructor(private events: RuntimeEvents) {}

  envFor(cfg: ServerConfig): Record<string, string> {
    return buildEnv(cfg);
  }

  async start(serverId: string, cfg: ServerConfig, cwd: string): Promise<void> {
    if (this.procs.has(serverId)) throw new Error("Server already running");
    const command = cfg.template.startCommand;
    const env = { ...process.env, ...this.envFor(cfg) };
    const isWindows = process.platform === "win32";
    const child = isWindows
      ? spawn("cmd.exe", ["/d", "/s", "/c", command], { cwd, env, windowsHide: true })
      : spawn("/bin/bash", ["-c", command], { cwd, env });

    const proc: NativeProcess = {
      child,
      splitter: new LineSplitter(),
      startedAt: Date.now(),
      intentionalStop: false,
      networkRxMb: 0,
      networkTxMb: 0,
    };
    this.procs.set(serverId, proc);

    proc.splitter.on("line", (line: string) => this.events.onOutput(serverId, line));
    child.stdout?.on("data", (d: Buffer) => proc.splitter.push(d));
    child.stderr?.on("data", (d: Buffer) => proc.splitter.push(d));
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

  sendCommand(serverId: string, command: string): boolean {
    const proc = this.procs.get(serverId);
    if (!proc || !proc.child.stdin || proc.child.stdin.destroyed) return false;
    proc.child.stdin.write(command + "\n");
    return true;
  }

  async stop(serverId: string, cfg: ServerConfig, timeoutSec: number): Promise<void> {
    const proc = this.procs.get(serverId);
    if (!proc) return;
    proc.intentionalStop = true;
    const { stopCommand } = cfg.template;
    if (stopCommand && proc.child.stdin && !proc.child.stdin.destroyed) {
      proc.child.stdin.write(stopCommand + "\n");
    }
    const exited = new Promise<void>((resolve) => proc.child.once("exit", resolve));
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, Math.min(timeoutSec, 60) * 1000));
    await Promise.race([exited, timeout]);
    if (this.procs.has(serverId)) {
      await this.kill(serverId);
    }
  }

  async kill(serverId: string): Promise<void> {
    const proc = this.procs.get(serverId);
    if (!proc) return;
    proc.intentionalStop = true;
    const pid = proc.child.pid;
    if (!pid) return;
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    } else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        proc.child.kill("SIGKILL");
      }
    }
  }

  async runInstall(serverId: string, cfg: ServerConfig, cwd: string, onLine: (line: string) => void): Promise<void> {
    const script = cfg.template.installScript;
    if (!script) return;
    const { spawn } = await import("node:child_process");
    const env = { ...process.env, ...this.envFor(cfg) };
    const isWindows = process.platform === "win32";
    const useBash = isWindows ? await hasBash() : true;
    const child = isWindows
      ? useBash
        ? spawn("bash", ["-c", script], { cwd, env, windowsHide: true })
        : spawn("cmd.exe", ["/d", "/s", "/c", script], { cwd, env, windowsHide: true })
      : spawn("/bin/bash", ["-c", script], { cwd, env });

    const code = await new Promise<number>((resolve, reject) => {
      child.stdout?.on("data", (d: Buffer) =>
        d.toString().split("\n").filter(Boolean).forEach(onLine)
      );
      child.stderr?.on("data", (d: Buffer) =>
        d.toString().split("\n").filter(Boolean).forEach(onLine)
      );
      child.on("error", reject);
      child.on("exit", (c) => resolve(c ?? 1));
    });
    if (code !== 0) throw new Error(`install script exited with code ${code}`);
  }

  isRunning(serverId: string): boolean {
    return this.procs.has(serverId);
  }

  async stats(serverId: string, cfg: ServerConfig, cwd: string): Promise<StatsSnapshot | null> {
    const proc = this.procs.get(serverId);
    if (!proc || !proc.child.pid) return null;
    let cpuPercent = 0;
    let memoryMb = 0;
    try {
      const usage = await pidusage(proc.child.pid);
      cpuPercent = usage.cpu;
      memoryMb = usage.memory / (1024 * 1024);
    } catch {
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

const diskCache = new Map<string, { at: number; mb: number }>();

async function hasBash(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("bash", ["--version"], { windowsHide: true });
    child.on("error", () => resolve(false));
    child.on("exit", () => resolve(true));
  });
}

export async function dirSizeMb(dir: string): Promise<number> {
  const cached = diskCache.get(dir);
  if (cached && Date.now() - cached.at < 30_000) return cached.mb;
  let total = 0;
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {
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
