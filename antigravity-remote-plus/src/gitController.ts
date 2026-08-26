// Git + GitHub control. Uses the git CLI (present wherever the IDE runs) and,
// when available, the `gh` CLI for GitHub operations. All commands run inside
// the workspace root.

import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

function cwd(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  return folders[0].uri.fsPath;
}

async function run(
  cmd: string,
  timeout = 20000
): Promise<{ stdout: string; stderr: string; ok: boolean }> {
  const dir = cwd();
  if (!dir) return { stdout: "", stderr: "no workspace open", ok: false };
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd: dir,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { stdout: String(stdout), stderr: String(stderr), ok: true };
  } catch (e: any) {
    return {
      stdout: String(e?.stdout ?? ""),
      stderr: String(e?.stderr ?? e?.message ?? e),
      ok: false,
    };
  }
}

export interface GitStatusFile {
  path: string;
  index: string;
  work: string;
}

export const GitController = {
  async isRepo(): Promise<boolean> {
    const r = await run("git rev-parse --is-inside-work-tree");
    return r.ok && r.stdout.trim() === "true";
  },

  async status(): Promise<{
    branch: string;
    files: GitStatusFile[];
    ahead: number;
    behind: number;
  }> {
    const r = await run("git status --porcelain=v1 --branch");
    const files: GitStatusFile[] = [];
    let branch = "";
    let ahead = 0;
    let behind = 0;
    for (const line of r.stdout.split("\n")) {
      if (!line) continue;
      if (line.startsWith("##")) {
        const m = line.match(/##\s+([^\s.]+)/);
        if (m) branch = m[1];
        const a = line.match(/ahead (\d+)/);
        const b = line.match(/behind (\d+)/);
        if (a) ahead = parseInt(a[1], 10);
        if (b) behind = parseInt(b[1], 10);
        continue;
      }
      const index = line[0];
      const work = line[1];
      const path = line.slice(3);
      files.push({ path, index, work });
    }
    return { branch, files, ahead, behind };
  },

  async diff(file?: string): Promise<string> {
    const cmd = file
      ? `git diff -- ${JSON.stringify(file)}`
      : "git diff";
    const r = await run(cmd);
    return r.stdout || r.stderr;
  },

  async log(limit = 20): Promise<
    Array<{ hash: string; author: string; date: string; subject: string }>
  > {
    const sep = "";
    const r = await run(
      `git log -n ${limit} --pretty=format:%h${sep}%an${sep}%ad${sep}%s --date=short`
    );
    const out: Array<{
      hash: string;
      author: string;
      date: string;
      subject: string;
    }> = [];
    for (const line of r.stdout.split("\n")) {
      if (!line) continue;
      const [hash, author, date, subject] = line.split(sep);
      out.push({ hash, author, date, subject });
    }
    return out;
  },

  async stageAll(): Promise<{ ok: boolean; message: string }> {
    const r = await run("git add -A");
    return { ok: r.ok, message: r.stderr || "staged all changes" };
  },

  async stage(file: string): Promise<{ ok: boolean; message: string }> {
    const r = await run(`git add -- ${JSON.stringify(file)}`);
    return { ok: r.ok, message: r.stderr || `staged ${file}` };
  },

  // Flexible stage: accepts "." / "-A" for everything, a single path string,
  // or an array of paths. Used by the REST API's git/add route.
  async add(
    files: string | string[]
  ): Promise<{ ok: boolean; message: string }> {
    if (files === "." || files === "-A" || files === "*") {
      return this.stageAll();
    }
    const list = Array.isArray(files) ? files : [files];
    const safe = list
      .filter(Boolean)
      .map((f) => JSON.stringify(f))
      .join(" ");
    if (!safe) return this.stageAll();
    const r = await run(`git add -- ${safe}`);
    return { ok: r.ok, message: r.stderr || `staged ${list.join(", ")}` };
  },

  async commit(message: string): Promise<{ ok: boolean; message: string }> {
    // Write message via stdin-safe here-string to avoid quoting issues.
    const escaped = message.replace(/"/g, '\\"');
    const r = await run(`git commit -m "${escaped}"`);
    return { ok: r.ok, message: r.stdout || r.stderr };
  },

  async push(
    branch?: string,
    setUpstream = false
  ): Promise<{ ok: boolean; message: string }> {
    let cmd = "git push";
    const target = branch || (setUpstream ? (await this.status()).branch : "");
    if (setUpstream && target) {
      cmd = `git push -u origin ${JSON.stringify(target)}`;
    } else if (target) {
      cmd = `git push origin ${JSON.stringify(target)}`;
    }
    const r = await run(cmd, 60000);
    return { ok: r.ok, message: r.stdout || r.stderr };
  },

  async pull(): Promise<{ ok: boolean; message: string }> {
    const r = await run("git pull", 60000);
    return { ok: r.ok, message: r.stdout || r.stderr };
  },

  async createBranch(name: string): Promise<{ ok: boolean; message: string }> {
    const safe = name.replace(/[^\w./\-]+/g, "-");
    const r = await run(`git checkout -b ${JSON.stringify(safe)}`);
    return { ok: r.ok, message: r.stdout || r.stderr };
  },

  async checkout(ref: string): Promise<{ ok: boolean; message: string }> {
    const r = await run(`git checkout ${JSON.stringify(ref)}`);
    return { ok: r.ok, message: r.stdout || r.stderr };
  },

  async branches(): Promise<{ current: string; all: string[] }> {
    const r = await run("git branch --format=%(refname:short)");
    const cur = await run("git rev-parse --abbrev-ref HEAD");
    return {
      current: cur.stdout.trim(),
      all: r.stdout.split("\n").map((s) => s.trim()).filter(Boolean),
    };
  },

  // --- GitHub via gh CLI (optional) ---

  async ghAvailable(): Promise<boolean> {
    const r = await run("gh --version", 5000);
    return r.ok;
  },

  async createPR(
    title: string,
    body: string
  ): Promise<{ ok: boolean; message: string }> {
    if (!(await this.ghAvailable()))
      return { ok: false, message: "gh CLI not installed" };
    const t = title.replace(/"/g, '\\"');
    const b = body.replace(/"/g, '\\"');
    const r = await run(
      `gh pr create --title "${t}" --body "${b}"`,
      60000
    );
    return { ok: r.ok, message: r.stdout || r.stderr };
  },

  async listPRs(): Promise<{ ok: boolean; message: string }> {
    if (!(await this.ghAvailable()))
      return { ok: false, message: "gh CLI not installed" };
    const r = await run(
      "gh pr list --limit 20 --json number,title,author,state 2>/dev/null || gh pr list"
    );
    return { ok: r.ok, message: r.stdout || r.stderr };
  },
};
