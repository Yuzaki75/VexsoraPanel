import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import * as api from "../../lib/api";
import { useAuth } from "../../contexts/AuthContext";

interface Server {
  id: string;
  name: string;
  game: string;
  node_id: string;
  status: "offline" | "running" | "starting" | "stopping" | "error";
  cpu_usage: number;
  memory_usage: number;
  disk_usage: number;
  owner_id: string;
  created_at: string;
}

export default function ServersListPage() {
  const { user } = useAuth();
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadServers();
  }, []);

  async function loadServers() {
    try {
      const data = await api.get("/api/servers");
      setServers(data as Server[]);
    } catch (err) {
      console.error("Failed to load servers:", err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading servers...</div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Servers</h1>
        {user?.role === "admin" && (
          <Link to="/admin/servers/create" className="btn btn-primary">
            Create Server
          </Link>
        )}
      </div>

      {servers.length === 0 ? (
        <div className="card bg-neutral-900 border border-neutral-800 p-8 text-center">
          <p className="text-gray-400 mb-4">No servers found</p>
          {user?.role === "admin" && (
            <Link to="/admin/servers/create" className="btn btn-primary">
              Create your first server
            </Link>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {servers.map((server) => (
            <Link
              key={server.id}
              to={`/servers/${server.id}`}
              className="card bg-neutral-900 border border-neutral-800 hover:border-yellow-500/50 transition-colors"
            >
              <div className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-white">{server.name}</h3>
                    <p className="text-sm text-gray-400">{server.game}</p>
                  </div>
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${
                      server.status === "running"
                        ? "bg-green-500/20 text-green-400"
                        : server.status === "offline"
                        ? "bg-gray-500/20 text-gray-400"
                        : "bg-yellow-500/20 text-yellow-400"
                    }`}
                  >
                    {server.status}
                  </span>
                </div>

                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>CPU</span>
                      <span>{server.cpu_usage.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-yellow-500 transition-all"
                        style={{ width: `${Math.min(server.cpu_usage, 100)}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>RAM</span>
                      <span>{(server.memory_usage / 1024 / 1024).toFixed(0)} MB</span>
                    </div>
                    <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all"
                        style={{ width: `${Math.min((server.memory_usage / 1024 / 1024 / 512) * 100, 100)}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1">
                      <span>Disk</span>
                      <span>{(server.disk_usage / 1024 / 1024 / 1024).toFixed(1)} GB</span>
                    </div>
                    <div className="h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-purple-500 transition-all"
                        style={{ width: `${Math.min((server.disk_usage / 1024 / 1024 / 1024 / 10) * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
