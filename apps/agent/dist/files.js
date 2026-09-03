import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
/** Resolve a server-relative path, refusing traversal outside the server dir. */
export function resolveSafe(serverDir, relPath) {
    const cleaned = relPath.replace(/^[/\\]+/, "").replace(/\.\.+/g, ".");
    const resolved = path.resolve(serverDir, cleaned);
    const root = path.resolve(serverDir);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new Error("Path escapes server directory");
    }
    return resolved;
}
export function listDir(serverDir, dir) {
    const target = resolveSafe(serverDir, dir);
    fs.mkdirSync(target, { recursive: true });
    const entries = [];
    for (const e of fs.readdirSync(target, { withFileTypes: true })) {
        if (e.name === ".strix.json")
            continue;
        const full = path.join(target, e.name);
        let size = 0;
        let mtime = new Date(0);
        try {
            const st = fs.statSync(full);
            size = st.size;
            mtime = st.mtime;
        }
        catch {
            // raced with delete
        }
        entries.push({ name: e.name, isDir: e.isDirectory(), sizeBytes: size, modifiedAt: mtime.toISOString() });
    }
    entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
    return { dir, entries };
}
export function readTextFile(serverDir, relPath, maxBytes = 2_000_000) {
    const target = resolveSafe(serverDir, relPath);
    const st = fs.statSync(target);
    if (!st.isFile())
        throw new Error("Not a file");
    if (st.size > maxBytes)
        throw new Error("File too large for editor (download instead)");
    return fs.readFileSync(target, "utf8");
}
export function writeTextFile(serverDir, relPath, content) {
    const target = resolveSafe(serverDir, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}
export function deletePath(serverDir, relPath) {
    const target = resolveSafe(serverDir, relPath);
    fs.rmSync(target, { recursive: true, force: true });
}
export function renamePath(serverDir, from, to) {
    const src = resolveSafe(serverDir, from);
    const dest = resolveSafe(serverDir, to);
    fs.renameSync(src, dest);
}
export function extractArchive(serverDir, relPath) {
    const target = resolveSafe(serverDir, relPath);
    if (!fs.existsSync(target))
        throw new Error("Archive not found");
    const ext = path.extname(target).toLowerCase();
    const destDir = path.dirname(target);
    let cmd;
    if (ext === ".zip") {
        // PowerShell Expand-Archive works everywhere on Windows; unzip on POSIX.
        cmd =
            process.platform === "win32"
                ? `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${target}' -DestinationPath '${destDir}' -Force"`
                : `unzip -o '${target}' -d '${destDir}'`;
    }
    else if (ext === ".gz" || ext === ".tgz" || ext === ".tar") {
        cmd = `tar -xf '${target}' -C '${destDir}'`;
    }
    else {
        throw new Error(`Unsupported archive type: ${ext}`);
    }
    try {
        execSync(cmd, { stdio: "pipe", timeout: 120_000 });
    }
    catch (err) {
        throw new Error(`Failed to extract archive: ${err.message}`);
    }
}
//# sourceMappingURL=files.js.map