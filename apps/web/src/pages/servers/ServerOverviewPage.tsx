import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import type { PublicServer } from "@strixmc/shared";
import * as api from "../../lib/api";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "bg-green-900/50 text-green-400 border-green-800",
    stopped: "bg-gray-800 text-gray-400 border-gray-700",
    starting: "bg-yellow-900/50 text-yellow-400 border-yellow-800",
    stopping: "bg-yellow-900/50 text-yellow-400 border-yellow-800",
    installing: "bg-blue-900/50 text-blue-400 border-blue-800",
    crashed: "bg-red-900/50 text-red-400 border-red-800",
    offline: "bg-red-900/50 text-red-400 border-red-800",
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${colors[status] || "bg-gray-800 text-gray-400 border-gray-700"}`}>
      {status}
    </span>
  );
}

export default function ServerOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const [server, setServer] = useState<PublicServer | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    cpuUsage: 0,
    memoryUsage: 0,
    diskUsage: 0,
    networkRx: 0,
    networkTx: 0,
    uptimeMs: 0,
    playerCount: 0,
  });
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    loadServer();
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, [id]);

  async function loadServer() {
    try {
      const response = await api.get<{ server: PublicServer }>(`/servers/${id}`);
      setServer(response.server);
    } catch (err) {
      console.error("Failed to load server:", err);
    } finally {
      setLoading(false);
    }
  }

  async function loadStats() {
    try {
      const response = await api.get<{ stats: typeof stats }>(`/servers/${id}/stats`);
      setStats(response.stats);
    } catch (err) {
      // Stats might not be available yet
    }
  }

  async function handlePower(action: "start" | "stop" | "restart" | "kill") {
    if (!confirm(`Are you sure you want to ${action} this server?`)) return;
    setActionLoading(action);
    try {
      await api.post(`/servers/${id}/power`, { action });
      await loadServer();
    } catch (err) {
      alert(`Failed to ${action}: ${(err as Error).message}`);
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading server...</div>
      </div>
    );
  }

  if (!server) {
    return (
      <div className="card bg-neutral-900 border border-neutral-800">
        <div className="text-center py-8 text-gray-400">
          Server not found
          <Link to="/servers" className="block mt-4 text-yellow-500 hover:text-yellow-400">
            ← Back to servers
          </Link>
        </div>
      </div>
    );
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatUptime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{server.name}</h1>
          <p className="text-sm text-gray-400 mt-1">
            {server.allocationIp}:{server.allocationPort} • {server.templateName || server.templateId}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={server.status} />
        </div>
      </div>

      {/* Power Actions */}
      <div className="card bg-neutral-900 border border-neutral-800">
        <h2 className="text-lg font-semibold text-white mb-4">Power Controls</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => handlePower("start")}
            disabled={actionLoading !== null || server.status === "running" || server.status === "starting"}
            className="btn bg-green-700 text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {actionLoading === "start" ? "Starting..." : "Start"}
          </button>
          <button
            onClick={() => handlePower("stop")}
            disabled={actionLoading !== null || server.status === "stopped" || server.status === "offline"}
            className="btn bg-yellow-700 text-white hover:bg-yellow-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {actionLoading === "stop" ? "Stopping..." : "Stop"}
          </button>
          <button
            onClick={() => handlePower("restart")}
            disabled={actionLoading !== null || server.status === "stopped" || server.status === "offline"}
            className="btn bg-blue-700 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {actionLoading === "restart" ? "Restarting..." : "Restart"}
          </button>
          <button
            onClick={() => handlePower("kill")}
            disabled={actionLoading !== null || server.status === "stopped" || server.status === "offline"}
            className="btn bg-red-700 text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {actionLoading === "kill" ? "Killing..." : "Kill"}
          </button>
        </div>
      </div>

      {/* Resource Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card bg-neutral-900 border border-neutral-800">
          <div className="text-sm font-medium text-gray-400">CPU Usage</div>
          <div className="mt-2 text-2xl font-semibold text-white">
            {(stats.cpuUsage / 100).toFixed(1)}%
          </div>
          <div className="mt-2 h-2 bg-neutral-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-yellow-500 transition-all duration-500"
              style={{ width: `${Math.min(stats.cpuUsage / 100, 100)}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-gray-500">Limit: {server.cpuPercent}%</div>
        </div>

        <div className="card bg-neutral-900 border border-neutral-800">
          <div className="text-sm font-medium text-gray-400">Memory Usage</div>
          <div className="mt-2 text-2xl font-semibold text-white">
            {formatBytes(stats.memoryUsage)}
          </div>
          <div className="mt-2 h-2 bg-neutral-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-500"
              style={{ width: `${Math.min((stats.memoryUsage / (server.memoryMb * 1024 * 1024)) * 100, 100)}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-gray-500">Limit: {server.memoryMb} MB</div>
        </div>

        <div className="card bg-neutral-900 border border-neutral-800">
          <div className="text-sm font-medium text-gray-400">Disk Usage</div>
          <div className="mt-2 text-2xl font-semibold text-white">
            {formatBytes(stats.diskUsage)}
          </div>
          <div className="mt-2 h-2 bg-neutral-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 transition-all duration-500"
              style={{ width: `${Math.min((stats.diskUsage / (server.diskMb * 1024 * 1024)) * 100, 100)}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-gray-500">Limit: {server.diskMb} MB</div>
        </div>

        <div className="card bg-neutral-900 border border-neutral-800">
          <div className="text-sm font-medium text-gray-400">Network I/O</div>
          <div className="mt-2 text-sm text-white">
            <div>↓ {formatBytes(stats.networkRx)}</div>
            <div>↑ {formatBytes(stats.networkTx)}</div>
          </div>
        </div>
      </div>

      {/* Server Info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card bg-neutral-900 border border-neutral-800">
          <h2 className="text-lg font-semibold text-white mb-4">Server Information</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-gray-400">Node</dt>
              <dd className="text-white">{server.nodeName}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Game</dt>
              <dd className="text-white">{server.templateName}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Connection</dt>
              <dd className="text-white font-mono">{server.allocationIp}:{server.allocationPort}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Owner</dt>
              <dd className="text-white">{server.ownerEmail}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Created</dt>
              <dd className="text-white">{new Date(server.createdAt).toLocaleDateString()}</dd>
            </div>
          </dl>
        </div>

        <div className="card bg-neutral-900 border border-neutral-800">
          <h2 className="text-lg font-semibold text-white mb-4">Resource Allocation</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-gray-400">CPU Limit</dt>
              <dd className="text-white">{server.cpuPercent}%</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Memory</dt>
              <dd className="text-white">{server.memoryMb} MB</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Disk</dt>
              <dd className="text-white">{server.diskMb} MB</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Uptime</dt>
              <dd className="text-white">{formatUptime(stats.uptimeMs)}</dd>
            </div>
            {stats.playerCount > 0 && (
              <div className="flex justify-between">
                <dt className="text-gray-400">Players</dt>
                <dd className="text-white">{stats.playerCount}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}
