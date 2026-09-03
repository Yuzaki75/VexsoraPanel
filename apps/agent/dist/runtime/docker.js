import { Writable } from "node:stream";
import Dockerode from "dockerode";
import { buildEnv, LineSplitter } from "./types.js";
const MB = 1024 * 1024;
/** Runs game servers inside Docker containers with resource limits. */
export class DockerRuntime {
    events;
    mode = "docker";
    docker = new Dockerode();
    procs = new Map();
    constructor(events) {
        this.events = events;
    }
    envFor(cfg) {
        return buildEnv(cfg);
    }
    async ensureImage(image) {
        try {
            await this.docker.getImage(image).inspect();
            return;
        }
        catch {
            // not present — pull below
        }
        await new Promise((resolve, reject) => {
            this.docker.pull(image, (err, stream) => {
                if (err)
                    return reject(err);
                this.docker.modem.followProgress(stream, (progressErr) => progressErr ? reject(progressErr) : resolve());
            });
        });
    }
    async start(serverId, cfg, cwd) {
        if (this.procs.has(serverId))
            throw new Error("Server already running");
        if (!cfg.template.dockerImage)
            throw new Error("Template has no dockerImage (use native mode)");
        await this.ensureImage(cfg.template.dockerImage);
        // Remove any leftover container from a previous run.
        const name = `strix_${serverId}`;
        try {
            const old = await this.docker.getContainer(name);
            await old.remove({ force: true });
        }
        catch {
            // did not exist
        }
        const port = cfg.allocation.port;
        const container = await this.docker.createContainer({
            name,
            Image: cfg.template.dockerImage,
            Cmd: ["/bin/sh", "-c", cfg.template.startCommand],
            WorkingDir: "/home/container",
            Env: Object.entries(this.envFor(cfg)).map(([k, v]) => `${k}=${v}`),
            OpenStdin: true,
            Tty: false,
            ExposedPorts: { [`${port}/tcp`]: {}, [`${port}/udp`]: {} },
            HostConfig: {
                Binds: [`${cwd}:/home/container`],
                Memory: cfg.limits.memoryMb * MB,
                NanoCpus: Math.round(cfg.limits.cpuPercent * 1e7),
                PortBindings: {
                    [`${port}/tcp`]: [{ HostIp: cfg.allocation.ip === "0.0.0.0" ? "" : cfg.allocation.ip, HostPort: String(port) }],
                    [`${port}/udp`]: [{ HostIp: cfg.allocation.ip === "0.0.0.0" ? "" : cfg.allocation.ip, HostPort: String(port) }],
                },
            },
        });
        const stream = await container.attach({
            stream: true,
            stdin: true,
            stdout: true,
            stderr: true,
            hijack: true,
        });
        const proc = {
            containerId: container.id,
            stream,
            splitter: new LineSplitter(),
            startedAt: Date.now(),
            intentionalStop: false,
            container,
        };
        this.procs.set(serverId, proc);
        proc.splitter.on("line", (line) => this.events.onOutput(serverId, line));
        const stdoutSink = new Writable({
            write: (chunk, _enc, cb) => {
                proc.splitter.push(chunk);
                cb();
            },
        });
        container.modem.demuxStream(stream, stdoutSink, stdoutSink);
        await container.start();
        void container
            .wait()
            .then((result) => {
            const p = this.procs.get(serverId);
            this.procs.delete(serverId);
            this.events.onOutput(serverId, `[agent] container exited with code ${result?.StatusCode ?? "?"}`);
            this.events.onExit(serverId, p?.intentionalStop ?? false, result?.StatusCode ?? null);
        })
            .catch(() => {
            this.procs.delete(serverId);
        });
    }
    sendCommand(serverId, command) {
        const proc = this.procs.get(serverId);
        if (!proc?.stream)
            return false;
        proc.stream.write(command + "\n");
        return true;
    }
    async stop(serverId, cfg, timeoutSec) {
        const proc = this.procs.get(serverId);
        if (!proc)
            return;
        proc.intentionalStop = true;
        const { stopCommand } = cfg.template;
        if (stopCommand && proc.stream) {
            proc.stream.write(stopCommand + "\n");
            const exited = proc.container.wait().then(() => undefined);
            const timeout = new Promise((r) => setTimeout(r, Math.min(timeoutSec, 60) * 1000));
            await Promise.race([exited, timeout]);
        }
        if (this.procs.has(serverId)) {
            try {
                await proc.container.stop({ t: Math.min(timeoutSec, 60) });
            }
            catch {
                await proc.container.kill().catch(() => { });
            }
        }
    }
    async kill(serverId) {
        const proc = this.procs.get(serverId);
        if (!proc)
            return;
        proc.intentionalStop = true;
        await proc.container.kill().catch(() => { });
    }
    async runInstall(serverId, cfg, cwd, onLine) {
        const script = cfg.template.installScript;
        if (!script)
            return;
        const image = cfg.template.installImage || "debian:bookworm-slim";
        await this.ensureImage(image);
        const container = await this.docker.createContainer({
            name: `strix_install_${serverId}`,
            Image: image,
            Cmd: ["/bin/bash", "-c", script],
            WorkingDir: "/home/container",
            Env: Object.entries(this.envFor(cfg)).map(([k, v]) => `${k}=${v}`),
            HostConfig: { Binds: [`${cwd}:/home/container`] },
        });
        try {
            const logStream = await container.attach({ stream: true, stdout: true, stderr: true });
            const sink = new Writable({
                write: (chunk, _enc, cb) => {
                    chunk.toString().split("\n").filter(Boolean).forEach(onLine);
                    cb();
                },
            });
            container.modem.demuxStream(logStream, sink, sink);
            await container.start();
            const result = (await container.wait());
            if (result.StatusCode !== 0) {
                throw new Error(`install container exited with code ${result.StatusCode}`);
            }
        }
        finally {
            await container.remove({ force: true }).catch(() => { });
        }
    }
    isRunning(serverId) {
        return this.procs.has(serverId);
    }
    async stats(serverId, cfg, cwd) {
        const proc = this.procs.get(serverId);
        if (!proc)
            return null;
        try {
            const s = (await proc.container.stats({ stream: false }));
            const cpuDelta = s.cpu_stats.cpu_usage.total_usage - s.precpu_stats.cpu_usage.total_usage;
            const systemDelta = s.cpu_stats.system_cpu_usage - s.precpu_stats.system_cpu_usage;
            const onlineCpus = s.cpu_stats.online_cpus || 1;
            const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * onlineCpus * 100 : 0;
            let rx = 0;
            let tx = 0;
            for (const net of Object.values(s.networks ?? {})) {
                rx += net.rx_bytes;
                tx += net.tx_bytes;
            }
            return {
                cpuPercent: Math.round(cpuPercent * 10) / 10,
                memoryMb: Math.round((s.memory_stats.usage ?? 0) / MB),
                memoryLimitMb: cfg.limits.memoryMb,
                diskMb: 0,
                diskLimitMb: cfg.limits.diskMb,
                networkRxMb: Math.round((rx / MB) * 100) / 100,
                networkTxMb: Math.round((tx / MB) * 100) / 100,
                uptimeSec: Math.floor((Date.now() - proc.startedAt) / 1000),
                status: "running",
            };
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=docker.js.map