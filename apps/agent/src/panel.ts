export interface StrixCredentials {
  nodeId: string;
  nodeToken: string;
  agentSecret: string;
}

export interface AgentEvent {
  type: "server.status" | "backup.state";
  serverId?: string;
  backupId?: string;
  status?: string;
  detail?: string;
  sizeBytes?: number;
}

import { config } from "./config.js";

/** Report an event upstream to the panel (fire-and-forget with logging). */
export async function reportToPanel(creds: StrixCredentials, event: AgentEvent): Promise<void> {
  if (!config.panelUrl) return;
  try {
    await fetch(`${config.panelUrl}/api/v1/nodes/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${creds.nodeToken}` },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error(`[agent] failed to report ${event.type} to panel:`, (err as Error).message);
  }
}
