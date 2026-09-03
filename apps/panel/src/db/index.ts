import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";
import { config } from "../config.js";

const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  key_hash TEXT NOT NULL UNIQUE,
  key_preview TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  fqdn TEXT NOT NULL,
  scheme TEXT NOT NULL DEFAULT 'http',
  port INTEGER NOT NULL DEFAULT 8081,
  public_host TEXT,
  agent_secret TEXT,
  node_token_hash TEXT,
  join_token_hash TEXT,
  join_expires_at INTEGER,
  runtime_mode TEXT NOT NULL DEFAULT 'unknown',
  agent_version TEXT,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS allocations (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '0.0.0.0',
  port INTEGER NOT NULL,
  server_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS allocations_node_port ON allocations(node_id, port);
CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  node_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  variables TEXT NOT NULL DEFAULT '{}',
  memory_mb INTEGER NOT NULL,
  disk_mb INTEGER NOT NULL,
  cpu_percent INTEGER NOT NULL DEFAULT 200,
  status TEXT NOT NULL DEFAULT 'offline',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS subusers (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX IF NOT EXISTS subusers_server_user ON subusers(server_id, user_id);
CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  events TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`;

let db: BetterSQLite3Database<typeof schema> | null = null;

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const sqlite = new Database(config.dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.exec(DDL);
  db = drizzle(sqlite, { schema });
  return db;
}

/** Test helper: point the module at an in-memory database. */
export function setDb(testDb: BetterSQLite3Database<typeof schema>): void {
  db = testDb;
}
