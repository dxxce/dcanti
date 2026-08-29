// Antigravity Remote Plus — extension entry point.
//
// Supports single shared server across all open Antigravity IDE instances:
//   * The first IDE instance acts as the Primary Host on port 7377.
//   * Subsequent IDE instances detect the running server and connect as
//     Secondary Nodes over an internal authenticated WebSocket.
//   * Failover / Leader election: If the Host window closes, a Secondary
//     instance automatically assumes the Host role.

import * as vscode from "vscode";
import * as http from "http";
import * as crypto from "crypto";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { LsClient } from "./lsClient";
import { ChatController } from "./chatController";
import { RemoteServer } from "./server";
import { TelegramBridge } from "./telegram";
import { TerminalController } from "./terminalController";
import { WindowClient } from "./windowClient";
import { IdeWindowInfo } from "./windowTypes";

const CFG = "antigravityRemotePlus";

let output: vscode.OutputChannel;
let statusBar: vscode.StatusBarItem;

let ls: LsClient | null = null;
let chat: ChatController | null = null;
let server: RemoteServer | null = null;
let client: WindowClient | null = null;
let terminals: TerminalController | null = null;
let telegram: TelegramBridge | null = null;
let running = false;
let isHost = false;

// Persistent unique ID for this IDE window instance
const windowId = `win_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function log(msg: string) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  output?.appendLine(line);
}

function cfg<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration(CFG).get<T>(key, fallback);
}

function lanIps(): string[] {
  const nets = os.networkInterfaces();
  const ips: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] ?? []) {
      if (ni.family === "IPv4" && !ni.internal) ips.push(ni.address);
    }
  }
  return ips;
}

function getLocalWindowInfo(): IdeWindowInfo {
  const wsFolders = (vscode.workspace.workspaceFolders || []).map((f) => ({
    name: f.name,
    path: f.uri.fsPath,
  }));
  const wsName = vscode.workspace.name || wsFolders[0]?.name || "Workspace";
  const wsPath = wsFolders[0]?.path || null;

  return {
    id: windowId,
    title: wsName,
    workspaceName: wsName,
    workspacePath: wsPath,
    workspaceFolders: wsFolders,
    isGenerating: false,
    statusText: "Idle",
    pid: process.pid,
    isHost: false,
    lastActive: Date.now(),
  };
}

function checkServerHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      `http://127.0.0.1:${port}/api/health`,
      { timeout: 600 },
      (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          resolve(false);
        }
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function startAll(context: vscode.ExtensionContext) {
  if (running) {
    vscode.window.showInformationMessage("Antigravity Remote Plus already running.");
    return;
  }

  const port = cfg<number>("port", 7377);
  const host = cfg<string>("bindHost", "0.0.0.0");
  const password = cfg<string>("password", "Maiyeu3m");

  if (host === "0.0.0.0" && !password) {
    vscode.window.showErrorMessage(
      "Refusing to bind to 0.0.0.0 without a password. Set antigravityRemotePlus.password."
    );
    return;
  }

  ls = new LsClient(log);
  chat = new ChatController(ls, log);
  chat.start();
  await chat.resolveActiveCascadeId();

  // Try to attach to the IDE's remote-debugging port
  const debugPort = cfg<number>("remoteDebugPort", 9222);
  const cdpOk = await chat.connectCdp(debugPort);
  if (!cdpOk) {
    log(
      "[ext] CDP not attached — IDE not started with --remote-debugging-port. " +
        "Run 'Antigravity Remote Plus: Relaunch IDE with Remote Debug' to enable IDE⇄web sync."
    );
  }

  const windowInfo = getLocalWindowInfo();

  // Check if a Primary Host is already running on port
  const isServerRunning = await checkServerHealth(port);

  if (!isServerRunning) {
    // ---- MODE A: Primary Host ----
    log(`[ext] starting as Primary Host on port ${port}…`);
    windowInfo.isHost = true;
    const webRoot = path.join(context.extensionPath, "media", "web");

    server = new RemoteServer(
      {
        port,
        host,
        password,
        webRoot,
        log,
        onSettingsChanged: () => {
          log("[ext] settings changed via web UI — restarting…");
          setTimeout(() => {
            stopAll();
            startAll(context).catch((e) =>
              log(`[ext] restart after settings change: ${e}`)
            );
          }, 400);
        },
      },
      chat,
      windowInfo
    );

    try {
      await server.start();
      isHost = true;
      running = true;
    } catch (e: any) {
      log(`[ext] host server start failed: ${e?.message ?? e}`);
      server = null;
      // Fallback check if another window won the race
      const fallbackRunning = await checkServerHealth(port);
      if (fallbackRunning) {
        log("[ext] another instance bound the port; falling back to Secondary client");
        await startSecondary(port, host, password, windowInfo, context);
        return;
      }
      chat.stop();
      running = false;
      isHost = false;
      updateStatusBar();
      vscode.window.showErrorMessage(`Failed to start server on ${host}:${port} — ${e?.message ?? e}`);
      return;
    }

    // Telegram (optional on Host).
    await restartTelegram();

    updateStatusBar();
    const activePort = server.activePort;
    const lan = host === "0.0.0.0" ? lanIps() : [];
    const urls = [
      `http://127.0.0.1:${activePort}`,
      ...lan.map((ip) => `http://${ip}:${activePort}`),
    ];
    log(`[ext] Host started. URLs: ${urls.join(", ")}`);
    const primary = lan.length > 0 ? `http://${lan[0]}:${activePort}` : urls[0];
    const msg =
      lan.length > 0
        ? `Antigravity Remote Plus [Host] on LAN: ${primary}`
        : `Antigravity Remote Plus [Host] running on ${primary}`;
    const actions = lan.length > 0 ? ["Open Web UI", "Copy LAN URL"] : ["Open Web UI"];
    vscode.window.showInformationMessage(msg, ...actions).then((choice) => {
      if (choice === "Open Web UI") openWeb();
      else if (choice === "Copy LAN URL") {
        vscode.env.clipboard.writeText(primary);
        vscode.window.showInformationMessage(`Copied: ${primary}`);
      }
    });
  } else {
    // ---- MODE B: Secondary Client ----
    await startSecondary(port, host, password, windowInfo, context);
  }
}

async function startSecondary(
  port: number,
  host: string,
  password: string,
  windowInfo: IdeWindowInfo,
  context: vscode.ExtensionContext
) {
  log(`[ext] existing Host detected on port ${port}; connecting as Secondary Node…`);
  const token = crypto
    .createHmac("sha256", "antigravity-remote-plus/v1")
    .update(password)
    .digest("hex");

  terminals = new TerminalController(log, () => {});

  client = new WindowClient(
    {
      port,
      host,
      token,
      windowInfo,
      log,
      onHostDisconnected: () => {
        log("[ext] Host disconnected — preparing failover election…");
        if (running && !isHost) {
          stopAll();
          // Jittered backoff to avoid thundering herd on failover
          const delay = 300 + Math.floor(Math.random() * 600);
          setTimeout(() => {
            startAll(context).catch((e) => log(`[ext] failover start: ${e}`));
          }, delay);
        }
      },
    },
    chat!,
    terminals
  );

  try {
    await client.connect();
    isHost = false;
    running = true;
    updateStatusBar();
    log(`[ext] Secondary connected successfully to Host (windowId=${windowInfo.id})`);
    vscode.window.showInformationMessage(
      `Antigravity Remote Plus: Connected to Host server on port ${port} (${windowInfo.title})`
    );
  } catch (e: any) {
    log(`[ext] failed to connect to Host: ${e?.message ?? e}`);
    client = null;
    chat?.stop();
    running = false;
    updateStatusBar();
  }
}

function stopAll() {
  telegram?.stop();
  telegram = null;
  server?.stop();
  server = null;
  client?.stop();
  client = null;
  chat?.stop();
  chat = null;
  terminals = null;
  ls = null;
  running = false;
  isHost = false;
  updateStatusBar();
  log("[ext] stopped");
}

async function restartTelegram() {
  if (telegram) {
    telegram.stop();
    telegram = null;
  }
  if (!isHost || !chat) return;
  if (cfg<boolean>("telegramEnabled", false)) {
    const token = cfg<string>("telegramToken", "");
    const chatId = cfg<string>("telegramChatId", "");
    const notifyOnComplete = cfg<boolean>("telegramNotifyOnComplete", true);
    if (token) {
      telegram = new TelegramBridge({ token, chatId, notifyOnComplete, log }, chat);
      await telegram.start();
      log(`[ext] telegram started/reloaded (chatId: ${chatId || "any"}, notifyOnComplete: ${notifyOnComplete})`);
    } else {
      log("[ext] telegram enabled but no token set");
    }
  }
}

function openWeb() {
  const port = server?.activePort ?? cfg<number>("port", 7377);
  vscode.env.openExternal(vscode.Uri.parse(`http://127.0.0.1:${port}`));
}

function showInfo() {
  const port = server?.activePort ?? cfg<number>("port", 7377);
  const host = cfg<string>("bindHost", "0.0.0.0");
  const urls = [
    `http://127.0.0.1:${port}`,
    ...(host === "0.0.0.0" ? lanIps().map((ip) => `http://${ip}:${port}`) : []),
  ];
  const role = isHost ? "Host Server" : "Connected Client";
  vscode.window.showInformationMessage(
    `${running ? `Running (${role})` : "Stopped"} — ${urls.join("  ")}`
  );
}

function toggle(context: vscode.ExtensionContext) {
  if (running) stopAll();
  else startAll(context).catch((e) => log(`[ext] toggle start: ${e}`));
}

async function relaunchWithRemoteDebug() {
  const port = cfg<number>("remoteDebugPort", 9222);
  const choice = await vscode.window.showWarningMessage(
    `This will reload the IDE window with --remote-debugging-port=${port} so the ` +
      `web UI and IDE chat panel stay in sync. Continue?`,
    { modal: true },
    "Relaunch"
  );
  if (choice !== "Relaunch") return;
  try {
    const argvPath = path.join(os.homedir(), ".antigravity-ide", "argv.json");
    let argv: any = {};
    if (fs.existsSync(argvPath)) {
      const raw = fs.readFileSync(argvPath, "utf8").replace(/^﻿/, "");
      const stripped = raw.replace(/^\s*\/\/.*$/gm, "");
      try {
        argv = JSON.parse(stripped);
      } catch {
        argv = {};
      }
    }
    argv["remote-debugging-port"] = port;
    fs.writeFileSync(argvPath, JSON.stringify(argv, null, 2), "utf8");
    log(`[ext] wrote remote-debugging-port=${port} to ${argvPath}`);
  } catch (e: any) {
    log(`[ext] failed to update argv.json: ${e?.message ?? e}`);
    vscode.window.showErrorMessage(
      `Couldn't update argv.json automatically: ${e?.message ?? e}`
    );
    return;
  }
  await vscode.commands.executeCommand("workbench.action.reloadWindow");
}

function updateStatusBar() {
  if (!statusBar) return;
  if (running) {
    if (isHost) {
      const sync = chat?.cdpConnected() ? " $(link)" : "";
      statusBar.text = `$(radio-tower) Remote+ [Host: ${server?.activePort}]${sync}`;
      statusBar.tooltip = `Antigravity Remote Plus: Host on port ${server?.activePort}\nClick to stop.`;
    } else {
      statusBar.text = `$(link) Remote+ [Connected]`;
      statusBar.tooltip = `Antigravity Remote Plus: Connected to shared server\nClick to stop.`;
    }
  } else {
    statusBar.text = "$(circle-slash) Remote+";
    statusBar.tooltip = "Antigravity Remote Plus: stopped — click to start";
  }
  statusBar.command = "antigravityRemotePlus.toggle";
  statusBar.show();
}

export async function activate(context: vscode.ExtensionContext) {
  output = vscode.window.createOutputChannel("Antigravity Remote Plus");
  context.subscriptions.push(output);

  statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  context.subscriptions.push(statusBar);
  updateStatusBar();

  context.subscriptions.push(
    vscode.commands.registerCommand("antigravityRemotePlus.start", () =>
      startAll(context)
    ),
    vscode.commands.registerCommand("antigravityRemotePlus.stop", () => stopAll()),
    vscode.commands.registerCommand("antigravityRemotePlus.toggle", () =>
      toggle(context)
    ),
    vscode.commands.registerCommand("antigravityRemotePlus.openWeb", openWeb),
    vscode.commands.registerCommand("antigravityRemotePlus.showInfo", showInfo),
    vscode.commands.registerCommand(
      "antigravityRemotePlus.relaunchWithRemoteDebug",
      relaunchWithRemoteDebug
    ),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration("antigravityRemotePlus")) {
        if (
          e.affectsConfiguration("antigravityRemotePlus.telegramEnabled") ||
          e.affectsConfiguration("antigravityRemotePlus.telegramToken") ||
          e.affectsConfiguration("antigravityRemotePlus.telegramChatId") ||
          e.affectsConfiguration("antigravityRemotePlus.telegramNotifyOnComplete")
        ) {
          log("[ext] telegram configuration changed -> restarting telegram bridge");
          await restartTelegram();
        }
      }
    })
  );

  if (cfg<boolean>("autoStart", true)) {
    setTimeout(() => startAll(context).catch((e) => log(`[ext] autostart: ${e}`)), 2000);
  }
}

export function deactivate() {
  stopAll();
}
