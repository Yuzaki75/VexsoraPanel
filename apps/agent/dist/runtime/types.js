import { EventEmitter } from "node:events";
export function buildEnv(cfg) {
    return {
        ...cfg.variables,
        SERVER_IP: cfg.allocation.ip === "0.0.0.0" ? "0.0.0.0" : cfg.allocation.ip,
        SERVER_PORT: String(cfg.allocation.port),
        SERVER_MEMORY: String(cfg.limits.memoryMb),
        SERVER_DISK: String(cfg.limits.diskMb),
    };
}
/** Split a chunk stream into clean lines, tolerating \r\n and partial chunks. */
export class LineSplitter extends EventEmitter {
    buffer = "";
    push(chunk) {
        this.buffer += chunk.toString("utf8");
        let idx;
        while ((idx = this.buffer.indexOf("\n")) !== -1) {
            const line = this.buffer.slice(0, idx).replace(/\r$/, "");
            this.buffer = this.buffer.slice(idx + 1);
            if (line.length > 0)
                this.emit("line", line);
        }
        // Flush pathological single-line overflow so the buffer cannot grow unbounded.
        if (this.buffer.length > 32_768) {
            this.emit("line", this.buffer.slice(0, 32_768));
            this.buffer = "";
        }
    }
}
//# sourceMappingURL=types.js.map