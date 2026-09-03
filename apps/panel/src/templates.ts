import fs from "node:fs";
import path from "node:path";
import { ServerTemplate } from "@strixmc/shared";
import { config } from "./config.js";

let cache: { mtime: number; templates: ServerTemplate[] } | null = null;

function loadFromDisk(): { mtime: number; templates: ServerTemplate[] } {
  let latestMtime = 0;
  const files: string[] = [];
  if (fs.existsSync(config.templateDir)) {
    for (const f of fs.readdirSync(config.templateDir)) {
      if (!f.endsWith(".json")) continue;
      const full = path.join(config.templateDir, f);
      const st = fs.statSync(full);
      if (st.isFile()) {
        latestMtime = Math.max(latestMtime, st.mtimeMs);
        files.push(full);
      }
    }
  }
  if (cache && cache.mtime === latestMtime) return cache;
  const templates: ServerTemplate[] = [];
  for (const file of files) {
    try {
      const parsed = ServerTemplate.parse(JSON.parse(fs.readFileSync(file, "utf8")));
      templates.push(parsed);
    } catch (err) {
      console.error(`[templates] invalid template ${file}:`, (err as Error).message);
    }
  }
  cache = { mtime: latestMtime, templates };
  return cache;
}

export function listTemplates(): ServerTemplate[] {
  return loadFromDisk().templates;
}

export function getTemplate(id: string): ServerTemplate | null {
  return listTemplates().find((t) => t.id === id) ?? null;
}

/** Resolve user-provided variable values against a template's definitions. */
export function resolveVariables(
  template: ServerTemplate,
  provided: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const v of template.variables) {
    const value = (provided[v.key] ?? v.default).toString();
    if (v.required && !value.trim()) {
      throw new Error(`Missing required variable: ${v.key}`);
    }
    if (v.choices && value && !v.choices.includes(value)) {
      throw new Error(`Invalid value for ${v.key}: must be one of ${v.choices.join(", ")}`);
    }
    out[v.key] = value;
  }
  return out;
}

/** Replace {{VAR}} placeholders in a template string with resolved values. */
export function renderTemplateString(input: string, vars: Record<string, string>): string {
  return input.replace(/\{\{\s*([A-Z_][A-Z0-9_]*)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}
