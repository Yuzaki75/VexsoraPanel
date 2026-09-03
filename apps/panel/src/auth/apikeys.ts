import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { apiKeys } from "../db/schema.js";
import { randomToken } from "./passwords.js";

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/** Returns plaintext key once; only its hash + preview are persisted. */
export function createApiKey(opts: {
  type: "client" | "application";
  name: string;
  description?: string | null;
  userId?: string | null;
}): { id: string; plaintext: string } {
  const id = crypto.randomUUID();
  const prefix = opts.type === "application" ? "strixapp" : "strix";
  const plaintext = `${prefix}_${randomToken(24)}`;
  getDb()
    .insert(apiKeys)
    .values({
      id,
      userId: opts.userId ?? null,
      type: opts.type,
      name: opts.name,
      description: opts.description ?? null,
      keyHash: hashKey(plaintext),
      keyPreview: `${plaintext.slice(0, 10)}…`,
    })
    .run();
  return { id, plaintext };
}

export function lookupApiKey(key: string): typeof apiKeys.$inferSelect | null {
  const row = getDb().select().from(apiKeys).where(eq(apiKeys.keyHash, hashKey(key))).get();
  if (row) {
    getDb().update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id)).run();
  }
  return row ?? null;
}
