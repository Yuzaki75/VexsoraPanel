import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import * as api from "../../lib/api";

interface Backup {
  id: string;
  name: string;
  size: number;
  created_at: string;
  status: "pending" | "processing" | "completed" | "failed";
}

export default function ServerBackupsPage() {
  const { id } = useParams<{ id: string }>();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadBackups();
  }, [id]);

  async function loadBackups() {
    setLoading(true);
    try {
      const response = await api.get(`/servers/${id}/backups`);
      setBackups(response.backups || []);
    } catch (err) {
      console.error("Failed to load backups:", err);
    } finally {
      setLoading(false);
    }
  }

  async function createBackup() {
    const name = prompt("Enter backup name (optional):") || undefined;
    if (creating) return;

    setCreating(true);
    try {
      await api.post(`/servers/${id}/backups`, { name });
      loadBackups();
    } catch (err) {
      console.error("Failed to create backup:", err);
    } finally {
      setCreating(false);
    }
  }

  async function deleteBackup(backupId: string) {
    if (!confirm("Are you sure you want to delete this backup?")) return;

    try {
      await api.delete(`/servers/${id}/backups/${backupId}`);
      loadBackups();
    } catch (err) {
      console.error("Failed to delete backup:", err);
    }
  }

  async function restoreBackup(backupId: string) {
    if (!confirm("WARNING: Restoring a backup will overwrite all current server files. Continue?")) return;

    try {
      await api.post(`/servers/${id}/backups/${backupId}/restore`);
    } catch (err) {
      console.error("Failed to restore backup:", err);
    }
  }

  function downloadBackup(backupId: string) {
    window.open(`/api/servers/${id}/backups/${backupId}/download`, "_blank");
  }

  function formatSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-white">Backups</h1>
        
        <button onClick={createBackup} disabled={creating} className="btn btn-primary">
          {creating ? "Creating..." : "Create Backup"}
        </button>
      </div>

      {loading ? (
        <div className="card bg-neutral-900 border border-neutral-800 p-8 text-center text-gray-400">
          Loading backups...
        </div>
      ) : backups.length === 0 ? (
        <div className="card bg-neutral-900 border border-neutral-800 p-8 text-center">
          <p className="text-gray-400 mb-4">No backups found</p>
          <button onClick={createBackup} className="btn btn-primary">
            Create your first backup
          </button>
        </div>
      ) : (
        <div className="card bg-neutral-900 border border-neutral-800 overflow-hidden">
          <div className="divide-y divide-neutral-800">
            {backups.map((backup) => (
              <div
                key={backup.id}
                className="flex items-center justify-between px-4 py-3 hover:bg-neutral-800/50 transition-colors"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-2xl">💾</span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-white truncate">{backup.name}</div>
                    <div className="text-xs text-gray-400">
                      Created {new Date(backup.created_at).toLocaleString()} • {formatSize(backup.size)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    backup.status === "completed"
                      ? "bg-green-500/20 text-green-400"
                      : backup.status === "failed"
                      ? "bg-red-500/20 text-red-400"
                      : "bg-yellow-500/20 text-yellow-400"
                  }`}>
                    {backup.status}
                  </span>

                  {backup.status === "completed" && (
                    <>
                      <button
                        onClick={() => restoreBackup(backup.id)}
                        className="btn btn-secondary text-sm"
                        title="Restore"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => downloadBackup(backup.id)}
                        className="btn btn-secondary text-sm"
                        title="Download"
                      >
                        Download
                      </button>
                      <button
                        onClick={() => deleteBackup(backup.id)}
                        className="btn btn-danger text-sm"
                        title="Delete"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
