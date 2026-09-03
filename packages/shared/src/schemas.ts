import { z } from "zod";

export const zEmail = z.string().email().max(255);
export const zUsername = z
  .string()
  .min(2)
  .max(32)
  .regex(/^[a-zA-Z0-9_.-]+$/, "letters, digits, dot, dash, underscore only");
export const zPassword = z.string().min(8).max(256);

// ---------- auth ----------
export const RegisterInput = z.object({
  email: zEmail,
  username: zUsername,
  password: zPassword,
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: zEmail,
  password: z.string().min(1),
  totpCode: z.string().optional(),
});
export type LoginInput = z.infer<typeof LoginInput>;

// ---------- nodes ----------
export const NodeCreateInput = z.object({
  name: z.string().min(1).max(64),
  fqdn: z.string().min(1).max(255),
  scheme: z.enum(["http", "https"]).default("http"),
  port: z.coerce.number().int().min(1).max(65535).default(8081),
  publicHost: z.string().max(255).optional(),
});
export type NodeCreateInput = z.infer<typeof NodeCreateInput>;

export const NodeUpdateInput = NodeCreateInput.partial();

export const NodeJoinInput = z.object({
  joinToken: z.string().min(10),
  agentSecret: z.string().min(32).max(128),
  agentVersion: z.string().default("dev"),
  runtimeMode: z.enum(["docker", "native"]).default("native"),
});
export type NodeJoinInput = z.infer<typeof NodeJoinInput>;

// ---------- allocations ----------
export const AllocationCreateInput = z.object({
  ip: z.string().min(1).max(64).default("0.0.0.0"),
  port: z.coerce.number().int().min(1).max(65535),
  portTo: z.coerce.number().int().min(1).max(65535).optional(),
});
export type AllocationCreateInput = z.infer<typeof AllocationCreateInput>;

// ---------- templates ----------
export const TemplateVariable = z.object({
  key: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
  label: z.string().min(1),
  default: z.string().default(""),
  required: z.boolean().default(false),
  secret: z.boolean().default(false),
  choices: z.array(z.string()).optional(),
});
export type TemplateVariable = z.infer<typeof TemplateVariable>;

export const ServerTemplate = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  game: z.string().min(1),
  description: z.string().default(""),
  dockerImage: z.string().default(""),
  installImage: z.string().default("debian:bookworm-slim"),
  installScript: z.string().default(""),
  startCommand: z.string().min(1),
  stopCommand: z.string().default(""),
  stopSignal: z.string().default("SIGTERM"),
  stopTimeoutSec: z.number().int().min(1).max(300).default(30),
  variables: z.array(TemplateVariable).default([]),
  configs: z
    .array(
      z.object({
        path: z.string().min(1),
        content: z.string(),
      })
    )
    .default([]),
  minMemoryMb: z.number().int().min(64).default(512),
  minDiskMb: z.number().int().min(256).default(1024),
});
export type ServerTemplate = z.infer<typeof ServerTemplate>;

// ---------- servers ----------
export const ServerCreateInput = z.object({
  name: z.string().min(1).max(64),
  nodeId: z.string().uuid(),
  templateId: z.string().min(1),
  allocationId: z.string().uuid(),
  memoryMb: z.coerce.number().int().min(64).max(1_048_576),
  diskMb: z.coerce.number().int().min(256).max(16_777_216),
  cpuPercent: z.coerce.number().min(1).max(32_000).default(200),
  variables: z.record(z.string()).default({}),
  startOnCreate: z.boolean().default(false),
});
export type ServerCreateInput = z.infer<typeof ServerCreateInput>;

export const ServerUpdateInput = z.object({
  name: z.string().min(1).max(64).optional(),
  memoryMb: z.coerce.number().int().min(64).optional(),
  diskMb: z.coerce.number().int().min(256).optional(),
  cpuPercent: z.coerce.number().min(1).optional(),
  variables: z.record(z.string()).optional(),
});

export const PowerInput = z.object({
  action: z.enum(["start", "stop", "restart", "kill"]),
});

export const CommandInput = z.object({ command: z.string().max(2000) });

export const SubuserCreateInput = z.object({
  email: zEmail,
  permissions: z.array(z.string()).default([]),
});
export type SubuserCreateInput = z.infer<typeof SubuserCreateInput>;

// ---------- files ----------
export const FileListQuery = z.object({
  dir: z.string().default("/"),
});

export const FileWriteInput = z.object({
  path: z.string().min(1),
  content: z.string().max(8_000_000),
});

export const FileRenameInput = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const FileDeleteInput = z.object({ path: z.string().min(1) });
export const FileExtractInput = z.object({ path: z.string().min(1) });
export const FileDownloadQuery = z.object({ path: z.string().min(1) });

// ---------- backups ----------
export const BackupCreateInput = z.object({ name: z.string().max(64).optional() });

// ---------- webhooks ----------
export const WEBHOOK_EVENTS = [
  "server.created",
  "server.deleted",
  "server.installed",
  "power.start",
  "power.stop",
  "power.crash",
  "backup.completed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WebhookCreateInput = z.object({
  url: z.string().url(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1),
});

// ---------- users ----------
export const UserUpdateInput = z.object({
  email: zEmail.optional(),
  username: zUsername.optional(),
  password: zPassword.optional(),
  role: z.enum(["admin", "user"]).optional(),
});

export const ApiKeyCreateInput = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(255).optional(),
});
