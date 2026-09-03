import { useEffect, useState } from "react";
import type { ServerTemplate } from "@strixmc/shared";
import * as api from "../../lib/api";

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<ServerTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTemplates();
  }, []);

  async function loadTemplates() {
    try {
      const response = await api.get<{ templates: ServerTemplate[] }>("/templates");
      setTemplates(response.templates || []);
    } catch (err) {
      console.error("Failed to load templates:", err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading templates...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Templates</h1>
        <button className="btn-primary" disabled>
          Add Template
        </button>
      </div>

      <div className="card">
        <p className="text-gray-600 mb-4">
          Templates define game server configurations. Add JSON files to the templates directory.
        </p>
        {templates.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No templates found. Add template JSON files to the templates directory.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {templates.map((template) => (
              <div key={template.id} className="card hover:shadow-lg transition-shadow">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{template.name}</h3>
                    <p className="text-sm text-gray-500">{template.game}</p>
                  </div>
                  <span className="badge badge-info">{template.id}</span>
                </div>

                <p className="text-gray-600 text-sm mb-4 line-clamp-3">
                  {template.description || "No description"}
                </p>

                <div className="space-y-2 mb-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Docker Image:</span>
                    <span className="text-gray-900 truncate ml-2">{template.dockerImage || "native"}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Min Memory:</span>
                    <span className="text-gray-900">{template.minMemoryMb} MB</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-500">Variables:</span>
                    <span className="text-gray-900">{template.variables.length}</span>
                  </div>
                </div>

                <div className="flex justify-between items-center">
                  <button className="btn-sm btn-primary" disabled>
                    Use Template
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
