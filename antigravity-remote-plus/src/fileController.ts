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
