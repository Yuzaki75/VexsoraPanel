import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { nodes } from "../db/schema.js";

export type NodeRow = typeof nodes.$inferSelect;

export function agentBaseUrl(node: NodeRow): string {
  return `${node.scheme}://${node.fqdn}:${node.port}`;
}

export class AgentError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

/** Authenticated call from panel → agent. */
export async function agentFetch(
  node: NodeRow,
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000
): Promise<Response> {
  if (!node.agentSecret) throw new AgentError("Node has not joined yet", 409);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${agentBaseUrl(node)}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${node.agentSecret}`,
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    throw new AgentError(`Node unreachable: ${(err as Error).message}`, 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function agentJson<T>(
  node: NodeRow,
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000
): Promise<T> {
  const res = await agentFetch(node, path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  }, timeoutMs);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AgentError(body || `Agent returned ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

export function getNodeOr404(nodeId: string): NodeRow | null {
  return getDb().select().from(nodes).where(eq(nodes.id, nodeId)).get() ?? null;
}
