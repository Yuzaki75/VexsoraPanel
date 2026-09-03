import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../../lib/api";
import type { PublicServer } from "@strixmc/shared";

export default function ServerSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [server, setServer] = useState<PublicServer | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    cpu_limit: 0,
    memory_limit: 0,
    disk_limit: 0,
  });

  useEffect(() => {
    loadServer();
  }, [id]);

  async function loadServer() {
    try {
      const response = await api.get<{ server: PublicServer }>(`/servers/${id}`);
      setServer(response.server);
      setFormData({
        name: response.server.name,
        cpu_limit: response.server.cpu_limit || 0,
        memory_limit: response.server.memory_limit || 0,
        disk_limit: response.server.disk_limit || 0,
      });
    } catch (err) {
      console.error("Failed to load server:", err);
    } finally {
      setLoading(false);
    }
  }

  async function saveSettings() {
    setSaving(true);
    try {
      await api.patch(`/servers/${id}`, formData);
      alert("Settings saved successfully");
      loadServer();
    } catch (err) {
      console.error("Failed to save settings:", err);
      alert("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function deleteServer() {
    if (!confirm("WARNING: This will permanently delete the server and all its data. This action cannot be undone!")) return;
    if (!confirm("Are you absolutely sure? All files, backups, and databases will be deleted.")) return;

    try {
      await api.delete(`/servers/${id}`);
      navigate("/servers");
    } catch (err) {
      console.error("Failed to delete server:", err);
      alert("Failed to delete server");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">Server Settings</h1>

      <div className="card bg-neutral-900 border border-neutral-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">General Information</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Server Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="input-field w-full max-w-md"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">CPU Limit (%)</label>
              <input
                type="number"
                value={formData.cpu_limit}
                onChange={(e) => setFormData({ ...formData, cpu_limit: parseInt(e.target.value) || 0 })}
                className="input-field w-full"
                min="0"
                max="100"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Memory Limit (MB)</label>
              <input
                type="number"
                value={formData.memory_limit}
                onChange={(e) => setFormData({ ...formData, memory_limit: parseInt(e.target.value) || 0 })}
                className="input-field w-full"
                min="0"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Disk Limit (GB)</label>
              <input
                type="number"
                value={formData.disk_limit}
                onChange={(e) => setFormData({ ...formData, disk_limit: parseInt(e.target.value) || 0 })}
                className="input-field w-full"
                min="0"
              />
            </div>
          </div>

          <button onClick={saveSettings} disabled={saving} className="btn btn-primary">
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>

      <div className="card bg-neutral-900 border border-neutral-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Danger Zone</h2>
        
        <div className="space-y-4">
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <h3 className="font-medium text-red-400 mb-2">Delete Server</h3>
            <p className="text-sm text-gray-400 mb-4">
              Permanently delete this server and all associated data including files, backups, and databases.
            </p>
            <button onClick={deleteServer} className="btn btn-danger">
              Delete Server
            </button>
          </div>
        </div>
      </div>

      <div className="card bg-neutral-900 border border-neutral-800 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">Server Information</h2>
        
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-400">Server ID:</span>
            <span className="ml-2 text-white font-mono">{server?.id}</span>
          </div>
          <div>
            <span className="text-gray-400">Game:</span>
            <span className="ml-2 text-white">{server?.game}</span>
          </div>
          <div>
            <span className="text-gray-400">Node:</span>
            <span className="ml-2 text-white">{server?.node_id}</span>
          </div>
          <div>
            <span className="text-gray-400">Created:</span>
            <span className="ml-2 text-white">{server?.created_at ? new Date(server.created_at).toLocaleString() : "N/A"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
