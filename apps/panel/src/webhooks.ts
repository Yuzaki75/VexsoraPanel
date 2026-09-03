import crypto from "node:crypto";
import { getDb } from "./db/index.js";
import { webhooks } from "./db/schema.js";
import type { WebhookEvent } from "@strixmc/shared";

export interface WebhookPayload {
  event: WebhookEvent | string;
  serverId?: string;
  data?: Record<string, unknown>;
  ts: number;
}

/** Fire-and-forget webhook delivery; failures are logged, never thrown. */
export function emitWebhook(event: WebhookEvent, payload: Omit<WebhookPayload, "ts" | "event">): void {
  const hooks = getDb().select().from(webhooks).all().filter((h) => h.events.includes(event));
  if (hooks.length === 0) return;
  const body: WebhookPayload = { event, ...payload, ts: Date.now() };
  const serialized = JSON.stringify(body);
  for (const hook of hooks) {
    const signature = crypto.createHmac("sha256", hook.id).update(serialized).digest("hex");
    fetch(hook.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Strix-Event": event,
        "X-Strix-Signature": `sha256=${signature}`,
      },
      body: serialized,
      signal: AbortSignal.timeout(10_000),
    }).catch((err) => console.error(`[webhook] delivery to ${hook.url} failed:`, (err as Error).message));
  }
}
