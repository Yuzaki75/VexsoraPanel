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
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const allocations = sqliteTable("allocations", {
  id: text("id").primaryKey(),
  nodeId: text("node_id").notNull(),
  ip: text("ip").notNull().default("0.0.0.0"),
  port: integer("port").notNull(),
  serverId: text("server_id"),
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
  status: text("status").notNull().default("offline"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const subusers = sqliteTable("subusers", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull(),
  userId: text("user_id").notNull(),
  permissions: text("permissions", { mode: "json" }).notNull().$type<string[]>().default([]),
});

export const backups = sqliteTable("backups", {
  id: text("id").primaryKey(),
  serverId: text("server_id").notNull(),
  nodeId: text("node_id").notNull(),
  name: text("name").notNull(),
  state: text("state").notNull().default("pending"),
  sizeBytes: integer("size_bytes", { mode: "number" }).notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const webhooks = sqliteTable("webhooks", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  events: text("events", { mode: "json" }).notNull().$type<string[]>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
