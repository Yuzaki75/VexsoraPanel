import { useEffect, useState } from "react";
import type { PublicNode } from "@strixmc/shared";
import * as api from "../../lib/api";

function NodeStatus({ status, lastSeenAt }: { status: string; lastSeenAt: string | null }) {
  if (status === "online") return <span className="badge badge-success">Online</span>;
  if (status === "maintenance") return <span className="badge badge-warning">Maintenance</span>;
  if (status === "unreachable") return <span className="badge badge-error">Unreachable</span>;
  if (lastSeenAt) {
    const diff = Date.now() - new Date(lastSeenAt).getTime();
    const minutes = Math.floor(diff / 60000);
    return <span className="badge badge-warning">Offline ({minutes}m ago)</span>;
  }
  return <span className="badge badge-error">Never connected</span>;
}

export default function NodesPage() {
  const [nodes, setNodes] = useState<PublicNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNodes();
  }, []);

  async function loadNodes() {
    try {
      const response = await api.get<{ nodes: PublicNode[] }>("/nodes");
      setNodes(response.nodes || []);
    } catch (err) {
      console.error("Failed to load nodes:", err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading nodes...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Nodes</h1>
        <button className="btn-primary" disabled>
          Add Node
        </button>
      </div>

      <div className="card">
        <p className="text-gray-600 mb-4">
          Nodes are game server hosts where your servers run. Add a node by installing the StrixMC agent.
        </p>
        {nodes.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No nodes configured. Add your first node to get started.
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
                    Host
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Runtime
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Agent Version
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {nodes.map((node) => (
                  <tr key={node.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="font-medium text-gray-900">{node.name}</div>
                      <div className="text-sm text-gray-500">ID: {node.id.substring(0, 8)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {node.scheme}://{node.fqdn}:{node.port}
                      {node.publicHost && (
                        <div className="text-gray-500">Public: {node.publicHost}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <NodeStatus status={node.status} lastSeenAt={node.lastSeenAt} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {node.runtimeMode}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {node.agentVersion || "unknown"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(node.createdAt).toLocaleDateString()}
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
