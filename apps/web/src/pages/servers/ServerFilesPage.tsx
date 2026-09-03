import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import * as api from "../../lib/api";

interface FileItem {
  name: string;
  type: "file" | "directory";
  size: number;
  modified_at: string;
}

export default function ServerFilesPage() {
  const { id } = useParams<{ id: string }>();
  const [currentPath, setCurrentPath] = useState("/");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    loadFiles();
  }, [id, currentPath]);

  async function loadFiles() {
    setLoading(true);
    try {
      const response = await api.get(`/servers/${id}/files/list?path=${encodeURIComponent(currentPath)}`);
      setFiles(response.files || []);
    } catch (err) {
      console.error("Failed to load files:", err);
    } finally {
      setLoading(false);
    }
  }

  function navigateTo(path: string) {
    setCurrentPath(path);
  }

  function goUp() {
    const parts = currentPath.split("/").filter(Boolean);
    if (parts.length > 0) {
      parts.pop();
      setCurrentPath("/" + parts.join("/") || "/");
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      await api.post(`/servers/${id}/files/upload?path=${encodeURIComponent(currentPath)}`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      loadFiles();
    } catch (err) {
      console.error("Failed to upload file:", err);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function createFolder() {
    const name = prompt("Enter folder name:");
    if (!name) return;

    try {
      await api.post(`/servers/${id}/files/create-folder`, { path: currentPath, name });
      loadFiles();
    } catch (err) {
      console.error("Failed to create folder:", err);
    }
  }

  async function deleteFile(file: FileItem) {
    if (!confirm(`Are you sure you want to delete ${file.name}?`)) return;

    try {
      await api.delete(`/servers/${id}/files/delete?path=${encodeURIComponent(currentPath + "/" + file.name)}`);
      loadFiles();
    } catch (err) {
      console.error("Failed to delete file:", err);
    }
  }

  async function downloadFile(file: FileItem) {
    window.open(`/api/servers/${id}/files/download?path=${encodeURIComponent(currentPath + "/" + file.name)}`, "_blank");
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
        <h1 className="text-2xl font-bold text-white">File Manager</h1>
        
        <div className="flex items-center gap-2">
          <button onClick={goUp} disabled={currentPath === "/"} className="btn btn-secondary text-sm">
            ↑ Up
          </button>
          <button onClick={createFolder} className="btn btn-secondary text-sm">
            New Folder
          </button>
          <label className="btn btn-primary text-sm cursor-pointer">
            Upload
            <input type="file" onChange={handleFileUpload} className="hidden" disabled={uploading} />
          </label>
        </div>
      </div>

      <div className="card bg-neutral-900 border border-neutral-800 overflow-hidden">
        <div className="border-b border-neutral-800 px-4 py-3 bg-neutral-900/50">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span className="text-yellow-500">📁</span>
            <span className="font-mono">{currentPath}</span>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading files...</div>
        ) : files.length === 0 ? (
          <div className="p-8 text-center text-gray-400">This directory is empty</div>
        ) : (
          <div className="divide-y divide-neutral-800">
            {files.map((file) => (
              <div
                key={file.name}
                className="flex items-center justify-between px-4 py-3 hover:bg-neutral-800/50 transition-colors"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="text-lg">
                    {file.type === "directory" ? "📁" : "📄"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-white truncate">{file.name}</div>
                    <div className="text-xs text-gray-400">
                      {new Date(file.modified_at).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-400">{formatSize(file.size)}</span>
                  
                  <div className="flex items-center gap-1">
                    {file.type === "file" && (
                      <>
                        <button
                          onClick={() => downloadFile(file)}
                          className="p-1.5 text-gray-400 hover:text-white hover:bg-neutral-700 rounded"
                          title="Download"
                        >
                          ↓
                        </button>
                        <button
                          onClick={() => deleteFile(file)}
                          className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-neutral-700 rounded"
                          title="Delete"
                        >
                          🗑
                        </button>
                      </>
                    )}
                    
                    {file.type === "directory" ? (
                      <button
                        onClick={() => navigateTo(currentPath + "/" + file.name)}
                        className="px-3 py-1.5 text-sm text-white bg-neutral-700 hover:bg-neutral-600 rounded"
                      >
                        Open
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
