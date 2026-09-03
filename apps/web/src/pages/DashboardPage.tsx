import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PublicServer } from "@strixmc/shared";
import * as api from "../lib/api";

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: "badge-success",
    stopped: "badge-info",
    starting: "badge-warning",
    stopping: "badge-warning",
    installing: "badge-warning",
    crashed: "badge-error",
    offline: "badge-error",
  };
  return <span className={`badge ${colors[status] || "badge-info"}`}>{status}</span>;
}

export default function DashboardPage() {
  const [servers, setServers] = useState<PublicServer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadServers();
  }, []);

  async function loadServers() {
    try {
      const response = await api.get<{ servers: PublicServer[] }>("/servers");
      setServers(response.servers);
    } catch (err) {
      console.error("Failed to load servers:", err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading servers...</div>
      </div>
    );
  }

  const runningCount = servers.filter((s) => s.status === "running").length;
  const stoppedCount = servers.filter((s) => s.status === "stopped").length;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        <div className="card">
          <div className="text-sm font-medium text-gray-500">Total Servers</div>
          <div className="mt-2 text-3xl font-semibold text-gray-900">{servers.length}</div>
        </div>
        <div className="card">
          <div className="text-sm font-medium text-gray-500">Running</div>
          <div className="mt-2 text-3xl font-semibold text-green-600">{runningCount}</div>
        </div>
        <div className="card">
          <div className="text-sm font-medium text-gray-500">Stopped</div>
          <div className="mt-2 text-3xl font-semibold text-gray-600">{stoppedCount}</div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Your Servers</h2>
        {servers.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No servers yet. Contact an administrator to create one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Template
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Node
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Resources
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {servers.map((server) => (
                  <tr key={server.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{server.name}</div>
                      <div className="text-sm text-gray-500">
                        {server.allocationIp}:{server.allocationPort}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <StatusBadge status={server.status} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {server.templateName || server.templateId}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {server.nodeName}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {server.memoryMb}MB / {server.diskMb}MB / {server.cpuPercent}%
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <Link
                        to={`/servers/${server.id}/console`}
                        className="text-primary-600 hover:text-primary-900"
                      >
                        Manage
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
