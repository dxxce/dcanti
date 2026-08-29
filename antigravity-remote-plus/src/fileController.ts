// File control: browse the workspace, read/write files, upload images/files
// from remote clients into the workspace.

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export interface FileEntry {
  name: string;
  path: string; // workspace-relative
  type: "file" | "dir";
  size?: number;
}

function workspaceRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  return folders[0].uri.fsPath;
}

function resolveSafe(rel: string): string | null {
  const root = workspaceRoot();
  if (!root) return null;
  // Accept an absolute path that already points inside the workspace (chat
  // file links pass absolute paths). Otherwise treat the value as relative to
  // the root. Either way we re-check containment below.
  const abs = path.isAbsolute(rel)
    ? path.resolve(rel)
    : path.resolve(root, rel.replace(/^[/\\]+/, ""));
  // Prevent escaping the workspace root.
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

export const FileController = {
  hasWorkspace(): boolean {
    return workspaceRoot() !== null;
  },

  root(): string | null {
    return workspaceRoot();
  },

  list(rel = ""): FileEntry[] {
    const abs = resolveSafe(rel);
    const root = workspaceRoot();
    if (!abs || !root) return [];
    if (!fs.existsSync(abs)) return [];
    const stat = fs.statSync(abs);
    if (!stat.isDirectory()) return [];
    const items = fs.readdirSync(abs, { withFileTypes: true });
    const out: FileEntry[] = [];
    for (const it of items) {
      if (it.name === ".git" || it.name === "node_modules") continue;
      const childAbs = path.join(abs, it.name);
      const relPath = path.relative(root, childAbs).split(path.sep).join("/");
      if (it.isDirectory()) {
        out.push({ name: it.name, path: relPath, type: "dir" });
      } else {
        let size = 0;
        try {
          size = fs.statSync(childAbs).size;
        } catch {
          /* ignore */
        }
        out.push({ name: it.name, path: relPath, type: "file", size });
      }
    }
    out.sort((a, b) =>
      a.type === b.type
        ? a.name.localeCompare(b.name)
        : a.type === "dir"
        ? -1
        : 1
    );
    return out;
  },

  searchFiles(query = "", limit = 60): FileEntry[] {
    const root = workspaceRoot();
    if (!root || !fs.existsSync(root)) return [];

    const q = query.trim().toLowerCase();
    const results: FileEntry[] = [];
    const IGNORE_DIRS = new Set([
      ".git",
      "node_modules",
      ".next",
      "dist",
      "out",
      ".gemini",
      "build",
      ".vscode",
      ".idea",
    ]);

    const walk = (dir: string, currentDepth: number) => {
      if (results.length >= limit || currentDepth > 8) return;
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (results.length >= limit) break;
        if (IGNORE_DIRS.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(root, fullPath).split(path.sep).join("/");

        const matches = !q || entry.name.toLowerCase().includes(q) || relPath.toLowerCase().includes(q);

        if (entry.isDirectory()) {
          if (matches) {
            results.push({ name: entry.name, path: relPath, type: "dir" });
          }
          walk(fullPath, currentDepth + 1);
        } else if (entry.isFile()) {
          if (matches) {
            let size = 0;
            try {
              size = fs.statSync(fullPath).size;
            } catch {}
            results.push({ name: entry.name, path: relPath, type: "file", size });
          }
        }
      }
    };

    walk(root, 0);

    // Sort: directories first or exact matches first, then alphabetically
    results.sort((a, b) => {
      const aExact = a.name.toLowerCase() === q;
      const bExact = b.name.toLowerCase() === q;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      if (a.type === b.type) return a.path.localeCompare(b.path);
      return a.type === "dir" ? -1 : 1;
    });

    return results.slice(0, limit);
  },

  read(rel: string): { text: string } | { error: string } {
    const abs = resolveSafe(rel);
    if (!abs) return { error: "invalid path" };
    if (!fs.existsSync(abs)) return { error: "not found" };
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) return { error: "is a directory" };
    if (stat.size > 2 * 1024 * 1024) return { error: "file too large (>2MB)" };
    try {
      return { text: fs.readFileSync(abs, "utf8") };
    } catch (e: any) {
      return { error: String(e?.message ?? e) };
    }
  },

  readBinary(rel: string): Buffer | null {
    const abs = resolveSafe(rel);
    if (!abs || !fs.existsSync(abs)) return null;
    try {
      return fs.readFileSync(abs);
    } catch {
      return null;
    }
  },

  write(rel: string, text: string): { ok: true } | { error: string } {
    const abs = resolveSafe(rel);
    if (!abs) return { error: "invalid path" };
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, text, "utf8");
      return { ok: true };
    } catch (e: any) {
      return { error: String(e?.message ?? e) };
    }
  },

  // Save an uploaded file/image (buffer) into the workspace, default under
  // an `uploads/` folder. Returns the workspace-relative path.
  saveUpload(
    filename: string,
    data: Buffer,
    subdir = "uploads"
  ): { path: string; abs: string } | { error: string } {
    const root = workspaceRoot();
    if (!root) return { error: "no workspace open" };
    const safeName = path.basename(filename).replace(/[^\w.\-]+/g, "_");
    const relPath = path.posix.join(subdir, `${Date.now()}_${safeName}`);
    const abs = resolveSafe(relPath);
    if (!abs) return { error: "invalid path" };
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, data);
      return { path: relPath, abs };
    } catch (e: any) {
      return { error: String(e?.message ?? e) };
    }
  },

  delete(rel: string): { ok: true } | { error: string } {
    const abs = resolveSafe(rel);
    if (!abs) return { error: "invalid path" };
    if (!fs.existsSync(abs)) return { error: "not found" };
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) fs.rmSync(abs, { recursive: true, force: true });
      else fs.unlinkSync(abs);
      return { ok: true };
    } catch (e: any) {
      return { error: String(e?.message ?? e) };
    }
  },

  async openInEditor(rel: string): Promise<boolean> {
    const abs = resolveSafe(rel);
    if (!abs || !fs.existsSync(abs)) return false;
    try {
      const doc = await vscode.workspace.openTextDocument(abs);
      await vscode.window.showTextDocument(doc);
      return true;
    } catch {
      return false;
    }
  },
};
