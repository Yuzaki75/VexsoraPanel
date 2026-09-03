const RING_SIZE = 500;
/** Per-server console: bounded history + live subscribers. */
export class ConsoleHub {
    channels = new Map();
    channel(serverId) {
        let ch = this.channels.get(serverId);
        if (!ch) {
            ch = { ring: [], clients: new Set() };
            this.channels.set(serverId, ch);
        }
        return ch;
    }
    log(serverId, line) {
        const ch = this.channel(serverId);
        const entry = { line, ts: Date.now() };
        ch.ring.push(entry);
        if (ch.ring.length > RING_SIZE)
            ch.ring.shift();
        const msg = JSON.stringify({ type: "output", data: entry });
        for (const ws of ch.clients) {
            if (ws.readyState === ws.OPEN)
                ws.send(msg);
        }
    }
    broadcast(serverId, envelope) {
        const ch = this.channel(serverId);
        const msg = JSON.stringify(envelope);
        for (const ws of ch.clients) {
            if (ws.readyState === ws.OPEN)
                ws.send(msg);
        }
    }
    history(serverId) {
        return this.channel(serverId).ring;
    }
    attach(serverId, ws) {
        const ch = this.channel(serverId);
        ch.clients.add(ws);
        ws.on("close", () => ch.clients.delete(ws));
    }
    cleanup(serverId) {
        this.channels.delete(serverId);
    }
}
export const consoleHub = new ConsoleHub();
//# sourceMappingURL=console.js.map