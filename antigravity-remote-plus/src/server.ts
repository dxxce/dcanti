// Local HTTP server: serves the built web UI and exposes a REST + SSE API + WebSocket RPC hub.
// Auth is a single shared password (config) checked via a signed cookie token
// or an Authorization: Bearer header. Binds to 127.0.0.1 by default; when
// bound to 0.0.0.0 the password is mandatory.

import * as http from "http";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { URL } from "url";
import * as vscode from "vscode";
import { ChatController } from "./chatController";
import { FileController } from "./fileController";
import { GitController } from "./gitController";
import { SettingsController, RemoteSettings } from "./settingsController";
import { TerminalController } from "./terminalController";
import { WindowManager } from "./windowManager";
import { IdeWindowInfo } from "./windowTypes";

export interface ServerOptions {
  port: number;
  host: string;
  password: string;
  webRoot: string; // dir with built web assets
  log: (m: string) => void;
  // Called after settings are changed via the web UI, so the extension can
  // restart the server / telegram bridge to apply port/password/token changes.
  onSettingsChanged?: (settings: RemoteSettings) => void;
}

interface MultipartFile {
  filename: string;
  data: Buffer;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

export class RemoteServer {
  private opts: ServerOptions;
  private chat: ChatController;
  private server: http.Server | null = null;
  private sseClients = new Set<http.ServerResponse>();
  private boundPort = 0;
  private terminals: TerminalController;
  public windowManager: WindowManager;

  constructor(opts: ServerOptions, chat: ChatController, localWindowInfo: IdeWindowInfo) {
    this.opts = opts;
    this.chat = chat;
    // Terminal output/lifecycle events ride the same SSE channel as chat events.
    this.terminals = new TerminalController(opts.log, (e) =>
      this.broadcast({ ...e, windowId: localWindowInfo.id })
    );

    this.windowManager = new WindowManager(
      localWindowInfo,
      chat,
      this.terminals,
      opts.log,
      (e) => this.broadcast(e)
    );
  }

  /** The port the server actually bound to (may differ from opts.port if it
   * was busy and we fell back to the next free port). */
  get activePort(): number {
    return this.boundPort || this.opts.port;
  }

  // Token is derived deterministically from the password so it stays valid
  // across server restarts / IDE reloads — otherwise a random per-boot secret
  // would log the user out on every reload.
  public token(): string {
    return crypto
      .createHmac("sha256", "antigravity-remote-plus/v1")
      .update(this.opts.password)
      .digest("hex");
  }

  public isAuthed(req: http.IncomingMessage): boolean {
    if (!this.opts.password) return true; // no password set
    const auth = req.headers["authorization"];
    if (auth && auth === `Bearer ${this.token()}`) return true;
    const cookie = req.headers["cookie"] ?? "";
    const m = /(?:^|;\s*)arp_token=([^;]+)/.exec(cookie);
    if (m && m[1] === this.token()) return true;

    // Check query token for WebSocket / EventSource upgrade
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      const queryToken = url.searchParams.get("token");
      if (queryToken && queryToken === this.token()) return true;
    } catch {}

    return false;
  }

  start(): Promise<void> {
    const port = this.opts.port;
    const maxAttempts = 5;
    const retryDelayMs = 300;

    const attempt = (n: number): Promise<void> =>
      new Promise((resolve, reject) => {
        const server = http.createServer((req, res) =>
          this.handle(req, res).catch((e) => {
            this.opts.log(`[server] handler error: ${e?.message ?? e}`);
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "internal error" }));
            }
          })
        );

        const onError = (err: NodeJS.ErrnoException) => {
          server.removeListener("error", onError);
          server.close();
          if (err.code === "EADDRINUSE" && n < maxAttempts) {
            this.opts.log(
              `[server] port ${port} busy (attempt ${n}/${maxAttempts}), retrying in ${retryDelayMs}ms…`
            );
            setTimeout(() => attempt(n + 1).then(resolve, reject), retryDelayMs);
          } else if (err.code === "EADDRINUSE") {
            reject(
              new Error(
                `port ${port} is still in use after ${maxAttempts} attempts.`
              )
            );
          } else {
            reject(err);
          }
        };

        server.on("error", onError);
        server.listen(port, this.opts.host, () => {
          server.removeListener("error", onError);
          this.server = server;
          this.boundPort = port;
          // Attach WebSocket RPC server for Secondary IDE windows
          this.windowManager.attachWebSocketServer(server, (req) => this.isAuthed(req));

          // Keep the server alive on later runtime errors instead of crashing.
          server.on("error", (e) =>
            this.opts.log(`[server] runtime error: ${(e as Error).message}`)
          );
          this.opts.log(`[server] listening on http://${this.opts.host}:${port}`);
          resolve();
        });
      });

    return attempt(1);
  }

  stop() {
    this.windowManager.stop();
    for (const c of this.sseClients) {
      try {
        c.end();
      } catch {
        /* ignore */
      }
    }
    this.sseClients.clear();
    this.server?.close();
    this.server = null;
  }

  private broadcast(e: unknown) {
    const data = `data: ${JSON.stringify(e)}\n\n`;
    for (const c of this.sseClients) {
      try {
        c.write(data);
      } catch {
        /* ignore */
      }
    }
  }

  private json(res: http.ServerResponse, code: number, body: unknown) {
    const s = JSON.stringify(body);
    res.writeHead(code, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(s),
    });
    res.end(s);
  }

  private async readBody(req: http.IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let total = 0;
    return new Promise((resolve, reject) => {
      req.on("data", (c: Buffer) => {
        total += c.length;
        if (total > 25 * 1024 * 1024) {
          reject(new Error("payload too large"));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  private async readJson(req: http.IncomingMessage): Promise<any> {
    const buf = await this.readBody(req);
    if (buf.length === 0) return {};
    try {
      return JSON.parse(buf.toString("utf8"));
    } catch {
      return {};
    }
  }

  // Minimal multipart/form-data parser (single/multiple file fields).
  private parseMultipart(
    buf: Buffer,
    contentType: string
  ): { fields: Record<string, string>; files: MultipartFile[] } {
    const fields: Record<string, string> = {};
    const files: MultipartFile[] = [];
    const bm = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
    if (!bm) return { fields, files };
    const boundary = "--" + (bm[1] ?? bm[2]).trim();
    const sep = Buffer.from(boundary);
    let start = buf.indexOf(sep);
    if (start === -1) return { fields, files };
    start += sep.length;
    while (start < buf.length) {
      // Skip CRLF after boundary; check for closing "--".
      if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break;
      if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
      const headerEnd = buf.indexOf("\r\n\r\n", start, "utf8");
      if (headerEnd === -1) break;
      const header = buf.toString("utf8", start, headerEnd);
      const bodyStart = headerEnd + 4;
      const next = buf.indexOf(sep, bodyStart);
      if (next === -1) break;
      // body ends with CRLF before boundary
      const bodyEnd = next - 2;
      const part = buf.subarray(bodyStart, bodyEnd);
      const nameM = /name="([^"]+)"/.exec(header);
      const fileM = /filename="([^"]*)"/.exec(header);
      const name = nameM ? nameM[1] : "";
      if (fileM && fileM[1]) {
        files.push({ filename: fileM[1], data: Buffer.from(part) });
      } else if (name) {
        fields[name] = part.toString("utf8");
      }
      start = next + sep.length;
    }
    return { fields, files };
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const host = req.headers.host || "127.0.0.1";
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://${host}`);
    } catch {
      url = new URL("/", "http://127.0.0.1");
    }
    const pathName = url.pathname;

    // --- Public: Health check probe ---
    if (pathName === "/api/health") {
      return this.json(res, 200, { ok: true, activePort: this.activePort });
    }

    // --- Public: login endpoint ---
    if (pathName === "/api/login" && req.method === "POST") {
      const body = await this.readJson(req);
      if (!this.opts.password || body.password === this.opts.password) {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Set-Cookie": `arp_token=${this.token()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`,
        });
        res.end(JSON.stringify({ ok: true, token: this.token() }));
      } else {
        this.json(res, 401, { error: "wrong password" });
      }
      return;
    }

    // --- Localhost / Authed: Reload Window endpoint ---
    if (pathName === "/api/reload-window" && req.method === "POST") {
      const addr = req.socket.remoteAddress || "";
      const isLocal = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1" || this.isAuthed(req);
      if (!isLocal) {
        return this.json(res, 401, { error: "unauthorized" });
      }
      try {
        if (typeof this.windowManager.broadcastRpc === "function") {
          this.windowManager.broadcastRpc("reload-window", {});
        }
      } catch {}
      setTimeout(() => {
        vscode.commands.executeCommand("workbench.action.reloadWindow");
      }, 150);
      return this.json(res, 200, { ok: true });
    }

    // --- API auth gate ---
    if (pathName.startsWith("/api/")) {
      if (!this.isAuthed(req)) {
        this.json(res, 401, { error: "unauthorized" });
        return;
      }
      return this.handleApi(pathName, req, res, url);
    }

    // --- Static web assets ---
    this.serveStatic(pathName, res);
  }

  private async handleApi(
    pathName: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: URL
  ) {
    const route = pathName.replace(/^\/api\//, "");

    // SSE stream of chat/terminal/window events.
    if (route === "events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`retry: 2000\n\n`);
      this.sseClients.add(res);
      req.on("close", () => this.sseClients.delete(res));

      // Push initial windows list
      res.write(
        `data: ${JSON.stringify({
          type: "windows",
          windows: this.windowManager.listWindows(),
        })}\n\n`
      );

      // Push initial state for local window
      this.chat.buildState().then((state) => {
        res.write(
          `data: ${JSON.stringify({
            type: "state",
            windowId: this.windowManager.getLocalWindowId(),
            state,
          })}\n\n`
        );
      });
      return;
    }

    // --- Windows list endpoint ---
    if (route === "windows") {
      return this.json(res, 200, { windows: this.windowManager.listWindows() });
    }

    // --- Reload Window endpoint ---
    if (route === "reload-window" && req.method === "POST") {
      this.windowManager.broadcastRpc("reload-window", {});
      setTimeout(() => {
        vscode.commands.executeCommand("workbench.action.reloadWindow");
      }, 150);
      return this.json(res, 200, { ok: true });
    }

    // Resolve target windowId
    let windowId =
      url.searchParams.get("windowId") ||
      (req.headers["x-window-id"] as string) ||
      undefined;

    // Helper for executing RPC actions on the target window
    const rpc = async (action: string, payload?: any) => {
      try {
        const result = await this.windowManager.executeRpc(windowId, action, payload);
        return this.json(res, 200, result);
      } catch (e: any) {
        return this.json(res, 500, { ok: false, error: e?.message ?? e });
      }
    };

    switch (route) {
      case "state": {
        const cascadeId = url.searchParams.get("cascadeId") ?? undefined;
        return rpc("state", { cascadeId });
      }
      case "trajectories":
        return rpc("trajectories");
      case "quota":
        return rpc("quota");
      case "models":
        return rpc("models");
      case "screenshot":
        return rpc("screenshot");
      case "new-chat":
        return rpc("new-chat");
      case "send": {
        const body = await this.readJson(req);
        if (body.windowId) windowId = body.windowId;
        return rpc("send", {
          text: String(body.text || ""),
          images: Array.isArray(body.images) ? body.images : undefined,
        });
      }
      case "slash-command": {
        const body = await this.readJson(req);
        if (body.windowId) windowId = body.windowId;
        return rpc("slash-command", {
          name: body.name,
          modelFacingText: body.modelFacingText,
          text: body.text,
        });
      }
      case "mention-conversation": {
        const body = await this.readJson(req);
        if (body.windowId) windowId = body.windowId;
        return rpc("mention-conversation", {
          mention: {
            id: String(body.id ?? ""),
            title: body.title ? String(body.title) : undefined,
            lastModifiedTime: body.lastModifiedTime ? String(body.lastModifiedTime) : undefined,
          },
          text: String(body.text ?? ""),
        });
      }
      case "switch": {
        const body = await this.readJson(req);
        if (body.windowId) windowId = body.windowId;
        return rpc("switch", { cascadeId: body.cascadeId });
      }
      case "select-model": {
        const body = await this.readJson(req);
        if (body.windowId) windowId = body.windowId;
        return rpc("select-model", { modelId: body.modelId });
      }
      case "cancel":
        return rpc("cancel");
      case "revert": {
        const body = await this.readJson(req);
        if (body.windowId) windowId = body.windowId;
        return rpc("revert", { stepIndex: body.stepIndex });
      }
      case "answer-question": {
        const body = await this.readJson(req);
        if (body.windowId) windowId = body.windowId;
        return rpc("answer-question", {
          stepIndex: body.stepIndex,
          answers: body.answers,
        });
      }
      case "skip-question": {
        const body = await this.readJson(req);
        if (body.windowId) windowId = body.windowId;
        return rpc("skip-question", { stepIndex: body.stepIndex });
      }
      case "slash-commands":
        return rpc("slash-commands");
      case "approve-plan": {
        const body = await this.readJson(req);
        if (body.windowId) windowId = body.windowId;
        return rpc("approve-plan", {
          artifactUri: body.artifactUri,
          approved: body.approved,
        });
      }
      case "stats":
        return rpc("stats");
      case "reset-stats":
        return rpc("reset-stats");

      // Files
      case "files": {
        const rel = url.searchParams.get("path") ?? "";
        return rpc("files", { path: rel });
      }
      case "file": {
        if (req.method === "GET") {
          const rel = url.searchParams.get("path") ?? "";
          return rpc("file-read", { path: rel });
        }
        if (req.method === "PUT" || req.method === "POST") {
          const body = await this.readJson(req);
          if (body.windowId) windowId = body.windowId;
          return rpc("file-write", { path: body.path, text: body.text });
        }
        if (req.method === "DELETE") {
          const rel = url.searchParams.get("path") ?? "";
          return rpc("file-delete", { path: rel });
        }
        break;
      }
      case "file-open": {
        const body = await this.readJson(req);
        if (body.windowId) windowId = body.windowId;
        return rpc("file-open", { path: body.path });
      }
      case "upload": {
        const ct = String(req.headers["content-type"] ?? "");
        const buf = await this.readBody(req);
        const { fields, files } = this.parseMultipart(buf, ct);
        const targetWinId = fields.windowId || windowId;
        const saved: string[] = [];
        const absPaths: string[] = [];

        for (const f of files) {
          try {
            const res = await this.windowManager.executeRpc(targetWinId, "file-upload", {
              filename: f.filename,
              dataBase64: f.data.toString("base64"),
              subdir: fields.subdir || "uploads",
            });
            if (res && "path" in res) {
              saved.push(res.path);
              absPaths.push(res.abs);
            }
          } catch (e: any) {
            this.opts.log(`[upload] error saving file to window ${targetWinId}: ${e?.message ?? e}`);
          }
        }
        return this.json(res, 200, { saved, absPaths });
      }

      // Git
      case "git/status":
        return rpc("git/status");
      case "git/log": {
        const limit = Number(url.searchParams.get("limit") ?? 20);
        return rpc("git/log", { limit });
      }
      case "git/diff": {
        const file = url.searchParams.get("file") ?? undefined;
        return rpc("git/diff", { file });
      }
      case "git/add": {
        const body = await this.readJson(req);
        if (body.windowId) windowId = body.windowId;
        return rpc("git/add", { files: body.files });
      }
      case "git/commit": {
        const body = await this.readJson(req);
        if (body.windowId) windowId = body.windowId;
        return rpc("git/commit", { message: body.message });
      }
      case "git/push": {
        const body = await this.readJson(req);
        if (body.windowId) windowId = body.windowId;
        return rpc("git/push", { branch: body.branch, setUpstream: body.setUpstream });
      }
      case "git/pull":
        return rpc("git/pull");
      case "git/branch": {
        if (req.method === "POST") {
          const body = await this.readJson(req);
          if (body.windowId) windowId = body.windowId;
          return rpc("git/branch-create", { name: body.name });
        }
        return rpc("git/branch");
      }
      case "git/checkout": {
        const body = await this.readJson(req);
        if (body.windowId) windowId = body.windowId;
        return rpc("git/checkout", { branch: body.branch });
      }
      case "gh/pr-create": {
        const body = await this.readJson(req);
        if (body.windowId) windowId = body.windowId;
        return rpc("gh/pr-create", { title: body.title, body: body.body });
      }
      case "gh/pr-list":
        return rpc("gh/pr-list");

      // Media Serving
      case "media": {
        const u = new URL(req.url ?? "", "http://localhost");
        let filePath = u.searchParams.get("path") || "";
        if (filePath.startsWith("file://")) {
          filePath = decodeURIComponent(filePath.replace(/^file:\/\//, ""));
        }
        if (!filePath || !fs.existsSync(filePath)) {
          return this.json(res, 404, { error: "file not found" });
        }
        let ext = path.extname(filePath).toLowerCase();
        let contentType = "image/png";
        if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
        else if (ext === ".webp") contentType = "image/webp";
        else if (ext === ".gif") contentType = "image/gif";
        else if (ext === ".svg") contentType = "image/svg+xml";
        else {
          try {
            const buf = Buffer.alloc(8);
            const fd = fs.openSync(filePath, "r");
            fs.readSync(fd, buf, 0, 8, 0);
            fs.closeSync(fd);
            if (buf[0] === 0xff && buf[1] === 0xd8) contentType = "image/jpeg";
            else if (buf[0] === 0x89 && buf[1] === 0x50) contentType = "image/png";
            else if (buf[0] === 0x47 && buf[1] === 0x49) contentType = "image/gif";
            else if (buf[0] === 0x52 && buf[1] === 0x49) contentType = "image/webp";
          } catch {}
        }
        res.writeHead(200, {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      // Settings & Global
      case "account":
        return this.json(res, 200, SettingsController.account());
      case "switch-account": {
        const body = await this.readJson(req);
        const r = await SettingsController.switchAccount(String(body.email ?? ""));
        return this.json(res, 200, r);
      }
      case "settings": {
        if (req.method === "GET") {
          return this.json(res, 200, SettingsController.get());
        }
        if (req.method === "PUT" || req.method === "POST") {
          const body = await this.readJson(req);
          const updated = await SettingsController.update(body ?? {});
          this.opts.onSettingsChanged?.(updated);
          return this.json(res, 200, updated);
        }
        break;
      }
      case "workspace": {
        if (req.method === "GET") {
          return rpc("workspace");
        }
        if (req.method === "POST") {
          const body = await this.readJson(req);
          if (body.windowId) windowId = body.windowId;
          return rpc("workspace-open", { path: body.path });
        }
        break;
      }
      case "browse": {
        const dir = url.searchParams.get("path") ?? undefined;
        return this.json(res, 200, SettingsController.browse(dir));
      }
      case "workspace-folders":
        return rpc("workspace-folders");
      case "workspace-create": {
        if (req.method === "POST") {
          const body = await this.readJson(req);
          const name = String(body.name ?? "").trim();
          if (!name) return this.json(res, 400, { ok: false, error: "name required" });

          try {
            const root = SettingsController.get().workspaceRoot;
            if (!root) throw new Error("Workspace root not configured");
            const target = path.join(root, name);
            if (!target.startsWith(root)) throw new Error("Invalid name");
            fs.mkdirSync(target, { recursive: true });
            return this.json(res, 200, { ok: true, path: target });
          } catch (e: any) {
            return this.json(res, 500, { ok: false, error: e.message });
          }
        }
        break;
      }

      // Terminal
      case "term/list":
        return rpc("term/list");
      case "term/create": {
        const body = await this.readJson(req);
        if (body.windowId) windowId = body.windowId;
        return rpc("term/create", { cwd: body.cwd, title: body.title });
      }
      case "term/input": {
        const body = await this.readJson(req);
        if (body.windowId) windowId = body.windowId;
        return rpc("term/input", { id: body.id, data: body.data });
      }
      case "term/kill": {
        const body = await this.readJson(req);
        if (body.windowId) windowId = body.windowId;
        return rpc("term/kill", { id: body.id });
      }
      case "term/buffer": {
        const id = url.searchParams.get("id") ?? "";
        return rpc("term/buffer", { id });
      }
    }

    this.json(res, 404, { error: "not found" });
  }

  private serveStatic(pathName: string, res: http.ServerResponse) {
    let rel = pathName === "/" ? "/index.html" : pathName;
    rel = rel.split("?")[0];
    const abs = path.join(this.opts.webRoot, rel);
    if (!abs.startsWith(this.opts.webRoot)) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }
    fs.readFile(abs, (err, data) => {
      if (err) {
        const indexPath = path.join(this.opts.webRoot, "index.html");
        fs.readFile(indexPath, (err2, idx) => {
          if (err2) {
            res.writeHead(404);
            res.end("not found");
          } else {
            res.writeHead(200, { "Content-Type": MIME[".html"] });
            res.end(idx);
          }
        });
        return;
      }
      const ext = path.extname(abs).toLowerCase();
      res.writeHead(200, {
        "Content-Type": MIME[ext] ?? "application/octet-stream",
      });
      res.end(data);
    });
  }
}
