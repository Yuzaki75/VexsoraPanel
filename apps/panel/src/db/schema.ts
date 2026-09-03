import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "user"] }).notNull().default("user"),
  totpSecret: text("totp_secret"),
  totpEnabled: integer("totp_enabled", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  type: text("type", { enum: ["client", "application"] }).notNull(),
  name: text("name").notNull(),
  description: text("description"),
  keyHash: text("key_hash").notNull().unique(),
  keyPreview: text("key_preview").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
});

export const nodes = sqliteTable("nodes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  fqdn: text("fqdn").notNull(),
  scheme: text("scheme", { enum: ["http", "https"] }).notNull().default("http"),
  port: integer("port").notNull().default(8081),
  publicHost: text("public_host"),
  agentSecret: text("agent_secret"),
  nodeTokenHash: text("node_token_hash"),
  joinTokenHash: text("join_token_hash"),
  joinExpiresAt: integer("join_expires_at", { mode: "timestamp_ms" }),
  runtimeMode: text("runtime_mode", { enum: ["docker", "native", "unknown"] }).notNull().default("unknown"),
  agentVersion: text("agent_version"),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
  status: text("status", { enum: ["online", "offline", "maintenance", "unreachable"] }).notNull().default("offline"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const allocations = sqliteTable("allocations", {
  id: text("id").primaryKey(),
  nodeId: text("node_id").notNull(),
  ip: text("ip").notNull().default("0.0.0.0"),
  port: integer("port").notNull(),
  serverId: text("server_id"),
  notes: text("notes"),
});

export const servers = sqliteTable("servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nodeId: text("node_id").notNull(),
  userId: text("user_id").notNull(),
  templateId: text("template_id").notNull(),
  variables: text("variables", { mode: "json" }).notNull().$type<Record<string, string>>().default({}),
  memoryMb: integer("memory_mb").notNull(),
  diskMb: integer("disk_mb").notNull(),
  cpuPercent: integer("cpu_percent").notNull().default(200),
  swapMb: integer("swap_mb").notNull().default(0),
  ioWeight: integer("io_weight").default(500),
  oomDisabled: integer("oom_disabled", { mode: "boolean" }).default(false),
  status: text("status").notNull().default("offline"),
  suspended: integer("suspended", { mode: "boolean" }).notNull().default(false),
  installedAt: integer("installed_at", { mode: "timestamp_ms" }),
  lastBackupAt: integer("last_backup_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const subusers = sqliteTable("subusers", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull(),
  userId: text("user_id").notNull(),
  permissions: text("permissions", { mode: "json" }).notNull().$type<string[]>().default([]),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const backups = sqliteTable("backups", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull(),
  nodeId: text("node_id").notNull(),
  name: text("name").notNull(),
  state: text("state").notNull().default("pending"),
  sizeBytes: integer("size_bytes", { mode: "number" }).notNull().default(0),
  checksum: text("checksum"),
  isLocked: integer("is_locked", { mode: "boolean" }).notNull().default(false),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// Schedules for automated tasks
export const schedules = sqliteTable("schedules", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull(),
  name: text("name").notNull(),
  cron: text("cron").notNull(), // e.g., "*/5 * * * *" or "0 2 * * *"
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  onlyWhenOnline: integer("only_when_online", { mode: "boolean" }).notNull().default(true),
  lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
  nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const scheduleTasks = sqliteTable("schedule_tasks", {
  id: text("id").primaryKey(),
  scheduleId: text("schedule_id").notNull(),
  sequenceId: integer("sequence_id").notNull(), // Order of execution
  action: text("action", { enum: ["power_start", "power_stop", "power_restart", "power_kill", "backup", "command"] }).notNull(),
  payload: text("payload", { mode: "json" }).notNull().$type<Record<string, unknown>>().default({}),
  continueOnFailure: integer("continue_on_failure", { mode: "boolean" }).notNull().default(false),
  timeoutSeconds: integer("timeout_seconds").notNull().default(60),
});

// External databases managed by the panel
export const databases = sqliteTable("databases", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull(),
  nodeId: text("node_id").notNull(),
  name: text("name").notNull(),
  databaseName: text("database_name").notNull(), // Actual DB name
  remoteUser: text("remote_user").notNull(), // Username for DB access
  passwordHash: text("password_hash").notNull(),
  host: text("host").notNull().default("127.0.0.1"),
  port: integer("port").notNull().default(3306),
  maxConnections: integer("max_connections").default(10),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// Activity/audit logs
export const activityLogs = sqliteTable("activity_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  serverId: text("server_id"),
  action: text("action").notNull(), // e.g., "server.start", "file.delete", "backup.create"
  metadata: text("metadata", { mode: "json" }).notNull().$type<Record<string, unknown>>().default({}),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// Server statistics for monitoring
export const serverStats = sqliteTable("server_stats", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  cpuUsage: integer("cpu_usage").notNull().default(0), // Percentage * 100 for precision
  memoryUsage: integer("memory_usage").notNull().default(0), // Bytes
  diskUsage: integer("disk_usage").notNull().default(0), // Bytes
  networkRx: integer("network_rx").notNull().default(0), // Bytes received
  networkTx: integer("network_tx").notNull().default(0), // Bytes transmitted
  uptimeMs: integer("uptime_ms").notNull().default(0),
  playerCount: integer("player_count").default(0),
});

export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  events: text("events", { mode: "json" }).notNull().$type<string[]>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
