import fs from "node:fs";
import path from "node:path";
import * as tar from "tar";
import { config } from "./config.js";
function backupsDir(serverId) {
    return path.join(config.dataDir, "backups", serverId);
}
export function backupPath(serverId, backupId) {
    return path.join(backupsDir(serverId), `${backupId}.tar.gz`);
}
export function backupExists(serverId, backupId) {
    return fs.existsSync(backupPath(serverId, backupId));
}
export function createBackup(serverId, backupId, serverDir) {
    fs.mkdirSync(backupsDir(serverId), { recursive: true });
    return tar.c({
        gzip: true,
        file: backupPath(serverId, backupId),
        cwd: serverDir,
        portable: true,
        filter: (entryPath) => path.basename(entryPath) !== ".strix.json",
    }, ["."]);
}
export function restoreBackup(serverId, backupId, serverDir) {
    if (!backupExists(serverId, backupId))
        return Promise.reject(new Error("Backup file missing on node"));
    return tar.x({ cwd: serverDir, file: backupPath(serverId, backupId) });
}
export function deleteBackup(serverId, backupId) {
    fs.rmSync(backupPath(serverId, backupId), { force: true });
}
export function backupSizeBytes(serverId, backupId) {
    try {
        return fs.statSync(backupPath(serverId, backupId)).size;
    }
    catch {
        return 0;
    }
}
export function listLocalBackups(serverId) {
    const dir = backupsDir(serverId);
    if (!fs.existsSync(dir))
        return [];
    return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".tar.gz"))
        .map((f) => ({
        backupId: f.replace(/\.tar\.gz$/, ""),
        sizeBytes: fs.statSync(path.join(dir, f)).size,
    }));
}
//# sourceMappingURL=backups.js.map