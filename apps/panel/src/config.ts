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
  port: int("PORT", 8080),
  dbPath: process.env.STRIX_DB_PATH ?? path.join(root, "data", "panel.db"),
  templateDir: process.env.STRIX_TEMPLATE_DIR ?? path.join(root, "templates"),
  webDist: process.env.STRIX_WEB_DIST ?? path.join(root, "apps", "web", "dist"),
  sessionTtlDays: int("STRIX_SESSION_TTL_DAYS", 14),
  /** Heartbeats older than this mark a node offline. */
  nodeOnlineWindowSec: int("STRIX_NODE_ONLINE_WINDOW_SEC", 60),
  publicUrl: process.env.STRIX_PUBLIC_URL ?? `http://localhost:${int("PORT", 8080)}`,
  trustProxy: process.env.STRIX_TRUST_PROXY === "1",
};
