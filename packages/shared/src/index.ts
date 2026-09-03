export * from "./permissions.js";
export * from "./schemas.js";
export * from "./protocol.js";

/** Shared API response shapes (subset the web app relies on). */
export interface PublicUser {
  id: string;
  email: string;
  username: string;
  role: "admin" | "user";
  totpEnabled: boolean;
  createdAt: string;
}

export interface PublicNode {
  id: string;
  name: string;
  fqdn: string;
  scheme: string;
  port: number;
  publicHost: string | null;
  status: "online" | "offline" | "maintenance" | "unreachable";
  runtimeMode: string;
  agentVersion: string | null;
  lastSeenAt: string | null;
  createdAt: string;
}

export interface PublicAllocation {
  id: string;
  nodeId: string;
  ip: string;
  port: number;
  serverId: string | null;
  notes?: string | null;
}

export interface PublicServer {
  id: string;
  name: string;
  status: string;
  nodeId: string;
  nodeName?: string;
  userId: string;
  ownerEmail?: string;
  templateId: string;
  templateName?: string;
  allocationIp?: string;
  allocationPort?: number;
  memoryMb: number;
  diskMb: number;
  cpuPercent: number;
  swapMb?: number;
  variables: Record<string, string>;
  suspended?: boolean;
  lastBackupAt?: string | null;
  createdAt: string;
}

export interface PublicBackup {
  id: string;
  serverId: string;
  name: string;
  state: string;
  sizeBytes: number;
  checksum?: string | null;
  isLocked?: boolean;
  createdAt: string;
}

export interface PublicSchedule {
  id: string;
  serverId: string;
  name: string;
  cron: string;
  isActive: boolean;
  onlyWhenOnline: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  tasks?: PublicScheduleTask[];
  createdAt: string;
}

export interface PublicScheduleTask {
  id: string;
  scheduleId: string;
  sequenceId: number;
  action: string;
  payload: Record<string, unknown>;
  continueOnFailure: boolean;
  timeoutSeconds: number;
}

export interface PublicDatabase {
  id: string;
  serverId: string;
  name: string;
  databaseName: string;
  remoteUser: string;
  host: string;
  port: number;
  maxConnections: number | null;
  createdAt: string;
}

export interface PublicActivityLog {
  id: string;
  userId: string | null;
  username?: string | null;
  serverId: string | null;
  serverName?: string | null;
  action: string;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface PublicSubuser {
  id: string;
  userId: string;
  email: string;
  username: string;
  permissions: string[];
}

export interface PublicApiKey {
  id: string;
  name: string;
  description: string | null;
  type: "client" | "application";
  keyPreview: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface ApiError {
  error: string;
  details?: unknown;
}
