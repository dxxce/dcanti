// WindowClient: Secondary IDE instance connector.
// Connects to the Primary Host server over WebSocket and executes RPC requests locally.

import WebSocket from "ws";
import * as vscode from "vscode";
import { ChatController } from "./chatController";
import { FileController } from "./fileController";
import { GitController } from "./gitController";
import { SettingsController } from "./settingsController";
import { TerminalController } from "./terminalController";
import {
  IdeWindowInfo,
  HostToSecondaryMessage,
  SecondaryToHostMessage,
  WindowRpcRequest,
  WindowRpcResponse,
} from "./windowTypes";

export interface WindowClientOptions {
  port: number;
  host: string;
  token: string;
  windowInfo: IdeWindowInfo;
  log: (m: string) => void;
  onHostDisconnected: () => void;
}

export class WindowClient {
  private opts: WindowClientOptions;
  private chat: ChatController;
  private terminals: TerminalController;
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private isConnected = false;
  private intentionalClose = false;

  constructor(
    opts: WindowClientOptions,
    chat: ChatController,
    terminals: TerminalController
  ) {
    this.opts = opts;
    this.chat = chat;
    this.terminals = terminals;

    // Listen to local chat events and forward them to Host
    this.chat.onEvent((e: any) => {
      if (e.type === "state" && e.state) {
        this.opts.windowInfo.activeCascadeId = e.state.cascadeId;
        this.opts.windowInfo.isGenerating = !!e.state.generating;
        this.opts.windowInfo.statusText = e.state.statusText || "Idle";
      } else if (e.type === "state_update" || e.type === "status") {
        this.opts.windowInfo.isGenerating = !!e.generating;
        this.opts.windowInfo.statusText = e.statusText || "Idle";
      }
      this.sendEvent(e);
    });
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `ws://127.0.0.1:${this.opts.port}/api/ide-ws?token=${encodeURIComponent(
        this.opts.token
      )}`;

      const ws = new WebSocket(url, {
        headers: { Authorization: `Bearer ${this.opts.token}` },
      });
      this.ws = ws;

      const connectionTimeout = setTimeout(() => {
        if (!this.isConnected) {
          ws.close();
          reject(new Error("Connection to Host timed out"));
        }
      }, 5000);

      ws.on("open", () => {
        this.isConnected = true;
        clearTimeout(connectionTimeout);
        this.opts.log(`[win-client] connected to Host server on port ${this.opts.port}`);

        // Register window
        const regMsg: SecondaryToHostMessage = {
          type: "register",
          window: this.opts.windowInfo,
        };
        ws.send(JSON.stringify(regMsg));

        // Start heartbeat
        this.startHeartbeat();
        resolve();
      });

      ws.on("message", async (raw: string | Buffer) => {
        try {
          const msg = JSON.parse(raw.toString("utf8")) as HostToSecondaryMessage;
          if (msg.type === "rpc_call") {
            await this.handleRpc(msg.request);
          }
        } catch (e: any) {
          this.opts.log(`[win-client] error handling message: ${e?.message ?? e}`);
        }
      });

      ws.on("close", () => {
        this.isConnected = false;
        this.stopHeartbeat();
        this.opts.log("[win-client] disconnected from Host server");
        if (!this.intentionalClose) {
          this.opts.onHostDisconnected();
        }
      });

      ws.on("error", (err) => {
        this.opts.log(`[win-client] socket error: ${err.message}`);
        if (!this.isConnected) {
          clearTimeout(connectionTimeout);
          reject(err);
        }
      });
    });
  }

  private sendEvent(event: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const msg: SecondaryToHostMessage = {
        type: "event",
        windowId: this.opts.windowInfo.id,
        event,
      };
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const msg: SecondaryToHostMessage = {
          type: "heartbeat",
          windowId: this.opts.windowInfo.id,
          isGenerating: this.opts.windowInfo.isGenerating,
          statusText: this.opts.windowInfo.statusText,
          activeCascadeId: this.opts.windowInfo.activeCascadeId,
        };
        this.ws.send(JSON.stringify(msg));
      }
    }, 5000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async handleRpc(req: WindowRpcRequest) {
    let response: WindowRpcResponse;
    try {
      const data = await this.executeAction(req.action, req.payload);
      response = { id: req.id, ok: true, data };
    } catch (e: any) {
      response = { id: req.id, ok: false, error: e?.message ?? String(e) };
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const msg: SecondaryToHostMessage = {
        type: "rpc_result",
        response,
      };
      this.ws.send(JSON.stringify(msg));
    }
  }

  private async executeAction(action: string, payload: any = {}): Promise<any> {
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
      case "gh/pr-create":
        return GitController.createPR(String(payload.title ?? ""), String(payload.body ?? ""));
      case "gh/pr-list":
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
        throw new Error(`Unknown action on secondary window: ${action}`);
    }
  }

  stop() {
    this.intentionalClose = true;
    this.stopHeartbeat();
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
  }
}
