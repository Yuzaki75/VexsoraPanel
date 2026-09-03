import type { WebSocket } from "ws";

const RING_SIZE = 500;

interface ConsoleChannel {
  ring: { line: string; ts: number }[];
  clients: Set<WebSocket>;
}

/** Per-server console: bounded history + live subscribers. */
export class ConsoleHub {
  private channels = new Map<string, ConsoleChannel>();

  private channel(serverId: string): ConsoleChannel {
    let ch = this.channels.get(serverId);
    if (!ch) {
      ch = { ring: [], clients: new Set() };
      this.channels.set(serverId, ch);
    }
    return ch;
  }

  log(serverId: string, line: string): void {
    const ch = this.channel(serverId);
    const entry = { line, ts: Date.now() };
    ch.ring.push(entry);
    if (ch.ring.length > RING_SIZE) ch.ring.shift();
    const msg = JSON.stringify({ type: "output", data: entry });
    for (const ws of ch.clients) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  }

  broadcast(serverId: string, envelope: unknown): void {
    const ch = this.channel(serverId);
    const msg = JSON.stringify(envelope);
    for (const ws of ch.clients) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  }

  history(serverId: string): { line: string; ts: number }[] {
    return this.channel(serverId).ring;
  }

  attach(serverId: string, ws: WebSocket): void {
    const ch = this.channel(serverId);
    ch.clients.add(ws);
    ws.on("close", () => ch.clients.delete(ws));
  }

  cleanup(serverId: string): void {
    this.channels.delete(serverId);
  }
}

export const consoleHub = new ConsoleHub();
