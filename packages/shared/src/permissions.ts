/** Granular per-server permissions granted to subusers. */
export const SERVER_PERMISSIONS = [
  "console.send",
  "console.view",
  "power.start",
  "power.stop",
  "power.restart",
  "power.kill",
  "files.read",
  "files.write",
  "files.delete",
  "backups.create",
  "backups.restore",
  "backups.delete",
  "backups.download",
  "settings.rename",
  "settings.reinstall",
  "subusers.manage",
  "activity.read",
] as const;

export type ServerPermission = (typeof SERVER_PERMISSIONS)[number];

/** Permissions implied by broader ones — used to make checks intuitive. */
export const PERMISSION_IMPLICATIONS: Partial<Record<ServerPermission, ServerPermission[]>> = {
  "settings.reinstall": ["power.start", "power.stop"],
};

export function hasPermission(granted: readonly string[], needed: ServerPermission): boolean {
  if (granted.includes(needed)) return true;
  for (const g of granted) {
    if ((PERMISSION_IMPLICATIONS[g as ServerPermission] ?? []).includes(needed)) return true;
  }
  return false;
}

export const POWER_ACTIONS = ["start", "stop", "restart", "kill"] as const;
export type PowerAction = (typeof POWER_ACTIONS)[number];

export const BACKUP_STATES = ["pending", "creating", "completed", "failed", "restoring"] as const;
export type BackupState = (typeof BACKUP_STATES)[number];

export const SERVER_STATUSES = [
  "installing",
  "installed",
  "starting",
  "running",
  "stopping",
  "stopped",
  "offline",
  "crashed",
] as const;
export type ServerStatus = (typeof SERVER_STATUSES)[number];
