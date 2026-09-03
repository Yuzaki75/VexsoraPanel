import { EventEmitter } from "node:events";
import type { ServerTemplate } from "@strixmc/shared";

export interface Limits {
  memoryMb: number;
  diskMb: number;
  cpuPercent: number;
}

export interface ServerConfig {
  serverId: string;
  template: ServerTemplate;
  variables: Record<string, string>;
  limits: Limits;
  allocation: { ip: string; port: number };
}

export interface StatsSnapshot {
  cpuPercent: number;
  memoryMb: number;
  memoryLimitMb: number;
  diskMb: number;
  diskLimitMb: number;
  networkRxMb: number;
  networkTxMb: number;
  uptimeSec: number;
  status: string;
}

export interface RuntimeEvents {
  onOutput(serverId: string, line: string): void;
  onExit(serverId: string, intentional: boolean, code: number | null): void;
}

export interface Runtime {
  mode: "docker" | "native";
  start(serverId: string, cfg: ServerConfig, cwd: string): Promise<void>;
  /** Send a command to the running process's stdin. Returns false if unsupported/absent. */
  sendCommand(serverId: string, command: string): boolean;
  /** Graceful stop: send stopCommand, escalate to SIGTERM/SIGKILL after timeout. */
  stop(serverId: string, cfg: ServerConfig, timeoutSec: number): Promise<void>;
  kill(serverId: string): Promise<void>;
  isRunning(serverId: string): boolean;
  stats(serverId: string, cfg: ServerConfig, cwd: string): Promise<StatsSnapshot | null>;
  /** Run the template's install script; emits log lines through onLine. */
  runInstall(serverId: string, cfg: ServerConfig, cwd: string, onLine: (line: string) => void): Promise<void>;
  /** Environment available for install/start (variables + builtins). */
  envFor(cfg: ServerConfig): Record<string, string>;
}

export function buildEnv(cfg: ServerConfig): Record<string, string> {
  return {
    ...cfg.variables,
    SERVER_IP: cfg.allocation.ip === "0.0.0.0" ? "0.0.0.0" : cfg.allocation.ip,
    SERVER_PORT: String(cfg.allocation.port),
    SERVER_MEMORY: String(cfg.limits.memoryMb),
    SERVER_DISK: String(cfg.limits.diskMb),
  };
}

/** Split a chunk stream into clean lines, tolerating \r\n and partial chunks. */
export class LineSplitter extends EventEmitter {
  private buffer = "";
  push(chunk: Buffer | string): void {
    this.buffer += chunk.toString("utf8");
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      if (line.length > 0) this.emit("line", line);
    }
    // Flush pathological single-line overflow so the buffer cannot grow unbounded.
    if (this.buffer.length > 32_768) {
      this.emit("line", this.buffer.slice(0, 32_768));
      this.buffer = "";
    }
  }
}
