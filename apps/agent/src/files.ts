import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";

/** Resolve a server-relative path, refusing traversal outside the server dir. */
export function resolveSafe(serverDir: string, relPath: string): string {
  const cleaned = relPath.replace(/^[/\\]+/, "").replace(/\.\.+/g, ".");
  const resolved = path.resolve(serverDir, cleaned);
  const root = path.resolve(serverDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Path escapes server directory");
  }
  return resolved;
}

export interface FileEntry {
  name: string;
  isDir: boolean;
  sizeBytes: number;
  modifiedAt: string;
}

export function listDir(serverDir: string, dir: string): { dir: string; entries: FileEntry[] } {
  const target = resolveSafe(serverDir, dir);
  fs.mkdirSync(target, { recursive: true });
  const entries: FileEntry[] = [];
  for (const e of fs.readdirSync(target, { withFileTypes: true })) {
    if (e.name === ".strix.json") continue;
    const full = path.join(target, e.name);
    let size = 0;
    let mtime = new Date(0);
    try {
      const st = fs.statSync(full);
      size = st.size;
      mtime = st.mtime;
    } catch {
      // raced with delete
    }
    entries.push({ name: e.name, isDir: e.isDirectory(), sizeBytes: size, modifiedAt: mtime.toISOString() });
  }
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  return { dir, entries };
}

export function readTextFile(serverDir: string, relPath: string, maxBytes = 2_000_000): string {
  const target = resolveSafe(serverDir, relPath);
  const st = fs.statSync(target);
  if (!st.isFile()) throw new Error("Not a file");
  if (st.size > maxBytes) throw new Error("File too large for editor (download instead)");
  return fs.readFileSync(target, "utf8");
}

export function writeTextFile(serverDir: string, relPath: string, content: string): void {
  const target = resolveSafe(serverDir, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

export function deletePath(serverDir: string, relPath: string): void {
  const target = resolveSafe(serverDir, relPath);
  fs.rmSync(target, { recursive: true, force: true });
}

export function renamePath(serverDir: string, from: string, to: string): void {
  const src = resolveSafe(serverDir, from);
  const dest = resolveSafe(serverDir, to);
  fs.renameSync(src, dest);
}

export function extractArchive(serverDir: string, relPath: string): void {
  const target = resolveSafe(serverDir, relPath);
  if (!fs.existsSync(target)) throw new Error("Archive not found");
  const ext = path.extname(target).toLowerCase();
  const destDir = path.dirname(target);
  
  let cmd: string;
  if (ext === ".zip") {
    // PowerShell Expand-Archive works everywhere on Windows; unzip on POSIX.
    cmd =
      process.platform === "win32"
        ? `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${target}' -DestinationPath '${destDir}' -Force"`
        : `unzip -o '${target}' -d '${destDir}'`;
  } else if (ext === ".gz" || ext === ".tgz" || ext === ".tar") {
    cmd = `tar -xf '${target}' -C '${destDir}'`;
  } else {
      return reject(new Error(`Unsupported archive type: ${ext}`));
    }
    exec(cmd, { windowsHide: true, timeout: 120_000 }, (err) => (err ? reject(err) : resolve()));
  }) as unknown as Promise<void>;
}
