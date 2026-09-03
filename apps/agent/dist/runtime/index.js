import Dockerode from "dockerode";
import { config } from "../config.js";
import { NativeRuntime } from "./native.js";
import { DockerRuntime } from "./docker.js";
/** Create the best available runtime: Docker when reachable, native otherwise. */
export async function createRuntime(events) {
    if (config.forceRuntime === "native")
        return new NativeRuntime(events);
    try {
        const docker = new Dockerode();
        await docker.ping();
        console.log("[agent] Docker detected — using container runtime");
        return new DockerRuntime(events);
    }
    catch (err) {
        if (config.forceRuntime === "docker") {
            throw new Error(`Docker forced via STRIX_FORCE_RUNTIME but unavailable: ${err.message}`);
        }
        console.warn("[agent] Docker unavailable — falling back to native (no container isolation)");
        return new NativeRuntime(events);
    }
}
//# sourceMappingURL=index.js.map