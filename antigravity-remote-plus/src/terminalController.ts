// Terminal control: run persistent interactive shells for remote clients.
//
// We don't depend on node-pty (a native module that complicates packaging).
// Instead each terminal is a long-lived login shell spawned with a pipe stdio.
// This handles the vast majority of use — running commands, seeing output,
// chaining shell state (cd, env) — even if it isn't a full PTY (no colored TUI
// apps like vim/htop). Output is streamed to the web UI over the existing SSE
// channel, and a rolling buffer lets a client that (re)connects catch up.

import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import * as os from "os";
import * as fs from "fs";

export interface TerminalInfo {
  id: string;
  title: string;
  cwd: string;
  pid?: number;
  alive: boolean;
}

interface Term {
  id: string;
  title: string;
  cwd: string;
  proc: ChildProcessWithoutNullStreams;
  buffer: string; // rolling output buffer
  alive: boolean;
}

// A terminal output/lifecycle event pushed to the web UI.
export type TerminalEvent =
  | { type: "term-data"; id: string; data: string }
  | { type: "term-exit"; id: string; code: number | null }
  | { type: "term-list"; terminals: TerminalInfo[] };

const MAX_BUFFER = 200_000; // cap rolling buffer per terminal (~200KB)

function defaultShell(): string {
  if (process.platform === "win32") return process.env.COMSPEC || "cmd.exe";
  return process.env.SHELL || "/bin/bash";
}

let counter = 0;

export class TerminalController {
  private terms = new Map<string, Term>();
  private log: (m: string) => void;
  private emit: (e: TerminalEvent) => void;

  constructor(log: (m: string) => void, emit: (e: TerminalEvent) => void) {
    this.log = log;
    this.emit = emit;
  }

  // Resolve a usable cwd: the requested dir if it exists, else home.
  private resolveCwd(cwd?: string): string {
    if (cwd && cwd.trim()) {
      try {
        if (fs.existsSync(cwd) && fs.statSync(cwd).isDirectory()) return cwd;
      } catch {
        /* fall through */
      }
    }
    return os.homedir();
  }

  create(cwd?: string, title?: string): TerminalInfo {
    const id = `t${Date.now()}_${++counter}`;
    const dir = this.resolveCwd(cwd);
    const shell = defaultShell();
    // Interactive login shell so profiles/aliases load; pipe stdio.
    const proc = spawn(shell, process.platform === "win32" ? [] : ["-i"], {
      cwd: dir,
      env: { ...process.env, TERM: "xterm-256color" },
      shell: false,
    });

    const term: Term = {
      id,
      title: title || dirName(dir),
      cwd: dir,
      proc,
      buffer: "",
      alive: true,
    };
    this.terms.set(id, term);

    const onData = (chunk: Buffer) => {
      const s = stripAnsi(chunk.toString("utf8"));
      term.buffer += s;
      if (term.buffer.length > MAX_BUFFER) {
        term.buffer = term.buffer.slice(term.buffer.length - MAX_BUFFER);
      }
      this.emit({ type: "term-data", id, data: s });
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("exit", (code) => {
      term.alive = false;
      this.emit({ type: "term-exit", id, code });
      this.emitList();
    });
    proc.on("error", (e) => {
      const msg = `\r\n[shell error: ${(e as Error).message}]\r\n`;
      term.buffer += msg;
      this.emit({ type: "term-data", id, data: msg });
    });

    this.log(`[term] created ${id} cwd=${dir} pid=${proc.pid}`);
    this.emitList();
    return this.info(term);
  }

  // Send raw input to a terminal. Callers typically append "\n" to run a line.
  write(id: string, data: string): boolean {
    const term = this.terms.get(id);
    if (!term || !term.alive) return false;
    try {
      term.proc.stdin.write(data);
      return true;
    } catch (e) {
      this.log(`[term] write failed ${id}: ${(e as Error).message}`);
      return false;
    }
  }

  kill(id: string): boolean {
    const term = this.terms.get(id);
    if (!term) return false;
    try {
      term.proc.kill();
    } catch {
      /* ignore */
    }
    this.terms.delete(id);
    this.log(`[term] killed ${id}`);
    this.emitList();
    return true;
  }

  // The accumulated output buffer for a terminal (for a fresh client).
  getBuffer(id: string): string {
    return this.terms.get(id)?.buffer ?? "";
  }

  list(): TerminalInfo[] {
    return [...this.terms.values()].map((t) => this.info(t));
  }

  killAll(): void {
    for (const id of [...this.terms.keys()]) this.kill(id);
  }

  private info(t: Term): TerminalInfo {
    return { id: t.id, title: t.title, cwd: t.cwd, pid: t.proc.pid, alive: t.alive };
  }

  private emitList(): void {
    this.emit({ type: "term-list", terminals: this.list() });
  }
}

function dirName(p: string): string {
  const parts = p.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

// Strip ANSI/VT control sequences so the plain-text web terminal doesn't show
// garbage like "\e[?2004h" (bracketed paste), color codes, or cursor moves.
// We keep newlines, tabs, and carriage returns.
function stripAnsi(s: string): string {
  return (
    s
      // CSI sequences: ESC [ ... final-byte  (colors, cursor, ?2004h/l, etc.)
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
      // OSC sequences: ESC ] ... BEL or ESC \  (window title, etc.)
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
      // Single-char escapes: ESC ( B, ESC =, ESC >, etc.
      .replace(/\x1b[()][0-9A-Za-z]/g, "")
      .replace(/\x1b[=>]/g, "")
      // Lone ESC and other C0 controls except \t \n \r
      .replace(/\x1b/g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
  );
}
