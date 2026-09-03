import path from "node:path";

function int(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

const root = process.env.STRIX_ROOT ?? process.cwd();

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: int("PORT", 8081),
  dataDir: process.env.STRIX_DATA_DIR ?? path.join(root, "data"),
  panelUrl: (process.env.STRIX_PANEL_URL ?? "").replace(/\/$/, ""),
  joinToken: process.env.STRIX_JOIN_TOKEN ?? "",
  /** Override runtime detection: "docker" | "native" */
  forceRuntime: (process.env.STRIX_FORCE_RUNTIME ?? "") as "" | "docker" | "native",
  heartbeatSec: int("STRIX_HEARTBEAT_SEC", 15),
  version: "0.1.0",
};

export interface AgentCredentials {
  nodeId: string;
  nodeToken: string;
  agentSecret: string;
}

export function credentialsPath(dataDir = config.dataDir): string {
  return path.join(dataDir, "agent.json");
}
