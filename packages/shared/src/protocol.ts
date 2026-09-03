/**
 * WebSocket console protocol shared between browser↔panel and panel↔agent.
 * Every message is a JSON envelope: { type, data }.
 */

export type ConsoleInbound =
  | { type: "auth"; data: { token?: string } }
  | { type: "command"; data: { command: string } }
  | { type: "resize"; data: { cols: number; rows: number } };

export type ServerEventType =
  | "status"
  | "install"
  | "stats"
  | "backup"
  | "webhook";

export type ConsoleOutbound =
  | { type: "output"; data: { line: string; ts: number } }
  | { type: "status"; data: { status: string; detail?: string } }
  | { type: "stats"; data: ServerStats }
  | { type: "error"; data: { message: string } };

export interface ServerStats {
  cpuPercent: number;
  memoryMb: number;
  memoryLimitMb: number;
  diskMb: number;
  diskLimitMb: number;
  networkRxMb: number;
  networkTxMb: number;
  uptimeSec: number;
  status: string;
}

/** Envelope used by the stats stream pushed over the console websocket. */
export function parseEnvelope(raw: string): { type: string; data: unknown } | null {
  try {
    const parsed = JSON.parse(raw) as { type?: unknown; data?: unknown };
    if (typeof parsed.type !== "string") return null;
    return { type: parsed.type, data: parsed.data ?? {} };
  } catch {
    return null;
  }
}

export const STATS_INTERVAL_MS = 2000;
