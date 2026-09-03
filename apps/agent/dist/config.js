import path from "node:path";
function int(name, def) {
    const v = process.env[name];
    if (!v)
        return def;
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
    forceRuntime: (process.env.STRIX_FORCE_RUNTIME ?? ""),
    heartbeatSec: int("STRIX_HEARTBEAT_SEC", 15),
    version: "0.1.0",
};
export function credentialsPath(dataDir = config.dataDir) {
    return path.join(dataDir, "agent.json");
}
//# sourceMappingURL=config.js.map