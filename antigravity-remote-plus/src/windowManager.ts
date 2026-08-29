// WindowManager: Central registry and RPC router for all Antigravity IDE windows.
// Runs inside the Primary Host instance and coordinates both local and remote IDE windows.

import * as http from "http";
import * as crypto from "crypto";
import * as vscode from "vscode";
import WebSocket, { WebSocketServer } from "ws";
import { ChatController } from "./chatController";
import { FileController } from "./fileController";
import { GitController } from "./gitController";
import { SettingsController } from "./settingsController";
import { TerminalController } from "./terminalController";
import {
  IdeWindowInfo,
  WindowRpcRequest,
  WindowRpcResponse,
  SecondaryToHostMessage,
  HostToSecondaryMessage,
} from "./windowTypes";

interface RemoteWindowSession {
  info: IdeWindowInfo;
  ws: WebSocket;
  pendingRpcs: Map<
    string,
    {
      resolve: (val: any) => void;
      reject: (err: any) => void;
      timer: NodeJS.Timeout;
    }
  >;
}

export class WindowManager {
  private localInfo: IdeWindowInfo;
  private chat: ChatController;
  private terminals: TerminalController;
  private log: (m: string) => void;
  private broadcastToWeb: (e: any) => void;
  private remoteWindows = new Map<string, RemoteWindowSession>();
  private wss: WebSocketServer | null = null;
  private rpcCounter = 0;

  constructor(
    localInfo: IdeWindowInfo,
    chat: ChatController,
    terminals: TerminalController,
    log: (m: string) => void,
    broadcastToWeb: (e: any) => void
  ) {
    this.localInfo = localInfo;
    this.chat = chat;
    this.terminals = terminals;
    this.log = log;
    this.broadcastToWeb = broadcastToWeb;

    // Listen to local chat events and forward them with local windowId.
    this.chat.onEvent((e: any) => {
      if (e.type === "state" && e.state) {
        this.localInfo.activeCascadeId = e.state.cascadeId;
        this.localInfo.isGenerating = !!e.state.generating;
        this.localInfo.statusText = e.state.statusText || "Idle";
      } else if (e.type === "state_update" || e.type === "status") {
        this.localInfo.isGenerating = !!e.generating;
        this.localInfo.statusText = e.statusText || "Idle";
      }
      this.broadcastToWeb({ ...e, windowId: this.localInfo.id });
    });
  }

  updateLocalInfo(updates: Partial<IdeWindowInfo>) {
    Object.assign(this.localInfo, updates);
    this.broadcastWindows();
  }

  getLocalWindowId(): string {
    return this.localInfo.id;
  }

  attachWebSocketServer(server: http.Server, tokenValidator: (req: http.IncomingMessage) => boolean) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      if (url.pathname === "/api/ide-ws") {
        if (!tokenValidator(req)) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        this.wss?.handleUpgrade(req, socket, head, (ws) => {
          this.wss?.emit("connection", ws, req);
        });
      }
    });

    this.wss.on("connection", (ws: WebSocket) => {
      let registeredWindowId: string | null = null;

      ws.on("message", (raw: string | Buffer) => {
        try {
          const msg = JSON.parse(raw.toString("utf8")) as SecondaryToHostMessage;
          if (msg.type === "register") {
            registeredWindowId = msg.window.id;
            const session: RemoteWindowSession = {
              info: { ...msg.window, isHost: false, lastActive: Date.now() },
              ws,
              pendingRpcs: new Map(),
            };
            this.remoteWindows.set(registeredWindowId, session);
            this.log(`[win-mgr] secondary window registered: ${registeredWindowId} (${msg.window.title})`);
            const reply: HostToSecondaryMessage = { type: "registered", ok: true };
            ws.send(JSON.stringify(reply));
            this.broadcastWindows();
          } else if (msg.type === "heartbeat") {
            const session = registeredWindowId ? this.remoteWindows.get(registeredWindowId) : null;
            if (session) {
              session.info.lastActive = Date.now();
              if (msg.isGenerating !== undefined) session.info.isGenerating = msg.isGenerating;
              if (msg.statusText !== undefined) session.info.statusText = msg.statusText;
              if (msg.activeCascadeId !== undefined) session.info.activeCascadeId = msg.activeCascadeId;
              this.broadcastWindows();
            }
          } else if (msg.type === "event") {
            // Forward event to Web UI SSE clients with windowId
            this.broadcastToWeb({ ...msg.event, windowId: msg.windowId });
          } else if (msg.type === "rpc_result") {
            const session = registeredWindowId ? this.remoteWindows.get(registeredWindowId) : null;
            if (session) {
              const pending = session.pendingRpcs.get(msg.response.id);
              if (pending) {
                clearTimeout(pending.timer);
                session.pendingRpcs.delete(msg.response.id);
                if (msg.response.ok) {
                  pending.resolve(msg.response.data);
                } else {
                  pending.reject(new Error(msg.response.error || "RPC failed"));
                }
              }
            }
          }
        } catch (e: any) {
          this.log(`[win-mgr] error processing message from secondary: ${e?.message ?? e}`);
        }
      });

      ws.on("close", () => {
        if (registeredWindowId) {
          const session = this.remoteWindows.get(registeredWindowId);
          if (session) {
            for (const [, p] of session.pendingRpcs) {
              clearTimeout(p.timer);
              p.reject(new Error("Secondary window disconnected"));
            }
          }
          this.remoteWindows.delete(registeredWindowId);
          this.log(`[win-mgr] secondary window disconnected: ${registeredWindowId}`);
          this.broadcastWindows();
        }
      });

      ws.on("error", (err) => {
        this.log(`[win-mgr] secondary socket error: ${err.message}`);
      });
    });
  }

  listWindows(): IdeWindowInfo[] {
    const list: IdeWindowInfo[] = [
      {
        ...this.localInfo,
        isHost: true,
        lastActive: Date.now(),
      },
    ];
    for (const session of this.remoteWindows.values()) {
      list.push({ ...session.info, isHost: false });
    }
    return list;
  }

  broadcastWindows() {
    this.broadcastToWeb({
      type: "windows",
      windows: this.listWindows(),
    });
  }

  broadcastRpc(action: string, payload: any = {}) {
    for (const winId of this.remoteWindows.keys()) {
      this.executeRpc(winId, action, payload).catch(() => {});
    }
  }

  async executeRpc(windowId: string | undefined, action: string, payload?: any): Promise<any> {
    const targetId = windowId || this.localInfo.id;

    // Local execution
    if (targetId === this.localInfo.id) {
      return this.executeLocal(action, payload);
    }

    // Remote execution
    const session = this.remoteWindows.get(targetId);
    if (!session || session.ws.readyState !== WebSocket.OPEN) {
      // Fallback to local if remote not found
      this.log(`[win-mgr] window ${targetId} not found, falling back to local window`);
      return this.executeLocal(action, payload);
    }

    const rpcId = `rpc_${Date.now()}_${++this.rpcCounter}`;
    const request: WindowRpcRequest = { id: rpcId, action, payload };
    const msg: HostToSecondaryMessage = { type: "rpc_call", request };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pendingRpcs.delete(rpcId);
        reject(new Error(`RPC timeout for action ${action} on window ${targetId}`));
      }, 30000);

      session.pendingRpcs.set(rpcId, { resolve, reject, timer });
      session.ws.send(JSON.stringify(msg));
    });
  }

  private async executeLocal(action: string, payload: any = {}): Promise<any> {
    switch (action) {
      case "state":
        return this.chat.buildState(payload.cascadeId);
      case "trajectories":
        return { list: await this.chat.getTrajectories() };
      case "quota":
        return (await this.chat.getQuota()) ?? {};
      case "models":
        return { models: await this.chat.getModels() };
      case "screenshot": {
        const b64 = await this.chat.captureScreenshot();
        return b64 ? { ok: true, dataUri: `data:image/png;base64,${b64}` } : { ok: false };
      }
      case "new-chat":
        await this.chat.newChat();
        return { ok: true };
      case "send":
        await this.chat.sendMessage(payload.text || "", payload.images);
        return { ok: true };
      case "slash-command":
        await this.chat.sendSlashCommand(
          String(payload.name ?? ""),
          String(payload.modelFacingText ?? ""),
          String(payload.text ?? "")
        );
        return { ok: true };
      case "mention-conversation":
        await this.chat.sendWithConversationMention(payload.mention, String(payload.text ?? ""));
        return { ok: true };
      case "switch":
        await this.chat.switchCascade(String(payload.cascadeId ?? ""));
        return { ok: true };
      case "select-model":
        return { ok: await this.chat.selectModel(String(payload.modelId ?? "")) };
      case "cancel":
        return { ok: await this.chat.cancel() };
      case "revert":
        return { ok: await this.chat.revertToStep(Number(payload.stepIndex)) };
      case "answer-question":
        return {
          ok: await this.chat.answerQuestion(
            Number(payload.stepIndex),
            Array.isArray(payload.answers) ? payload.answers : []
          ),
        };
      case "skip-question":
        return { ok: await this.chat.skipQuestion(Number(payload.stepIndex)) };
      case "slash-commands":
        return { commands: await this.chat.getSlashCommands() };
      case "approve-plan":
        return {
          ok: await this.chat.approvePlan(String(payload.artifactUri ?? ""), payload.approved !== false),
        };
      case "stats":
        return this.chat.getTodayStats();
      case "reset-stats":
        return this.chat.resetTodayStats();

      // Files
      case "files":
        return {
          root: FileController.root(),
          entries: FileController.list(payload.path ?? ""),
        };
      case "files-search":
        return {
          root: FileController.root(),
          entries: FileController.searchFiles(String(payload.query ?? ""), Number(payload.limit || 60)),
        };
      case "file-read":
        return FileController.read(payload.path ?? "");
      case "file-write":
        return FileController.write(String(payload.path ?? ""), String(payload.text ?? ""));
      case "file-delete":
        return FileController.delete(payload.path ?? "");
      case "file-open":
        return { ok: await FileController.openInEditor(String(payload.path ?? "")) };
      case "file-upload": {
        const buf = Buffer.from(payload.dataBase64 || "", "base64");
        return FileController.saveUpload(payload.filename, buf, payload.subdir);
      }

      // Git
      case "git/status":
        return GitController.status();
      case "git/log":
        return { commits: await GitController.log(Number(payload.limit ?? 20)) };
      case "git/diff":
        return { diff: await GitController.diff(payload.file) };
      case "git/add":
        return GitController.add(payload.files ?? ".");
      case "git/commit":
        return GitController.commit(String(payload.message ?? ""));
      case "git/push":
        return GitController.push(payload.branch, payload.setUpstream);
      case "git/pull":
        return GitController.pull();
      case "git/branch":
        return { branches: await GitController.branches() };
      case "git/branch-create":
        return GitController.createBranch(String(payload.name ?? ""));
      case "git/checkout":
        return GitController.checkout(String(payload.branch ?? ""));
      case "gh/pr-list":
        return { prs: await GitController.listPRs() };
      case "reload-window":
        setTimeout(() => {
          vscode.commands.executeCommand("workbench.action.reloadWindow");
        }, 150);
        return { ok: true };

      // Workspace & Settings
      case "workspace":
        return { current: SettingsController.currentWorkspace() };
      case "workspace-folders":
        return SettingsController.workspaceFolders();
      case "workspace-open":
        return SettingsController.openWorkspace(String(payload.path ?? ""));

      // Terminal
      case "term/list":
        return { terminals: this.terminals.list() };
      case "term/create":
        return this.terminals.create(payload.cwd, payload.title);
      case "term/input":
        return { ok: this.terminals.write(String(payload.id ?? ""), String(payload.data ?? "")) };
      case "term/kill":
        return { ok: this.terminals.kill(String(payload.id ?? "")) };
      case "term/buffer":
        return { buffer: this.terminals.getBuffer(String(payload.id ?? "")) };

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  stop() {
    this.wss?.close();
    this.wss = null;
    for (const session of this.remoteWindows.values()) {
      try {
        session.ws.close();
      } catch {
        /* ignore */
      }
    }
    this.remoteWindows.clear();
  }
}
