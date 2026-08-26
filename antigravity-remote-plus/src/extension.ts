// Antigravity Remote Plus — extension entry point.
//
// On activation we:
//   * create the LS client + chat controller (the AI bridge)
//   * start the local web/API server (password-protected)
//   * optionally start the Telegram bridge
// and expose start/stop/openWeb/showInfo commands + a status bar item.

import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import { LsClient } from "./lsClient";
import { ChatController } from "./chatController";
import { RemoteServer } from "./server";
import { TelegramBridge } from "./telegram";

const CFG = "antigravityRemotePlus";

let output: vscode.OutputChannel;
let statusBar: vscode.StatusBarItem;

let ls: LsClient | null = null;
let chat: ChatController | null = null;
let server: RemoteServer | null = null;
let telegram: TelegramBridge | null = null;
let running = false;

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

  // Try to attach to the IDE's remote-debugging port so the web UI and the IDE
  // chat panel stay in sync (both usable at once). Non-fatal if unavailable —
  // we transparently fall back to VS Code commands + the LS trajectory.
  const debugPort = cfg<number>("remoteDebugPort", 9222);
  const cdpOk = await chat.connectCdp(debugPort);
  if (!cdpOk) {
    log(
      "[ext] CDP not attached — IDE not started with --remote-debugging-port. " +
        "Run 'Antigravity Remote Plus: Relaunch IDE with Remote Debug' to enable IDE⇄web sync."
    );
  }

  const webRoot = path.join(context.extensionPath, "media", "web");
  server = new RemoteServer(
    {
      port,
      host,
      password,
      webRoot,
      log,
      // When settings change via the web UI, restart everything so the new
      // port/password/host/telegram config takes effect immediately.
      onSettingsChanged: () => {
        log("[ext] settings changed via web UI — restarting…");
        // Defer so the HTTP response for the settings PUT flushes first.
        setTimeout(() => {
          stopAll();
          startAll(context).catch((e) =>
            log(`[ext] restart after settings change: ${e}`)
          );
        }, 400);
      },
    },
    chat
  );
  try {
    await server.start();
  } catch (e: any) {
    vscode.window.showErrorMessage(
      `Failed to start server on ${host}:${port} — ${e?.message ?? e}`
    );
    log(`[ext] server start failed: ${e?.message ?? e}`);
    server = null;
    chat.stop();
    running = false;
    updateStatusBar();
    return;
  }

  // Telegram (optional).
  if (cfg<boolean>("telegramEnabled", false)) {
    const token = cfg<string>("telegramToken", "");
    const chatId = cfg<string>("telegramChatId", "");
    if (token) {
      telegram = new TelegramBridge({ token, chatId, log }, chat);
      await telegram.start();
    } else {
      log("[ext] telegram enabled but no token set");
    }
  }

  running = true;
  updateStatusBar();
  const activePort = server.activePort;
  if (activePort !== port) {
    log(`[ext] requested port ${port} was busy; bound to ${activePort} instead`);
  }
  const lan = host === "0.0.0.0" ? lanIps() : [];
  const urls = [
    `http://127.0.0.1:${activePort}`,
    ...lan.map((ip) => `http://${ip}:${activePort}`),
  ];
  log(`[ext] started. URLs: ${urls.join(", ")}`);
  // Prefer showing the LAN URL so other machines on the network know the
  // address to open (e.g. http://192.168.1.x:7377). Falls back to localhost.
  const primary = lan.length > 0 ? `http://${lan[0]}:${activePort}` : urls[0];
  const msg =
    lan.length > 0
      ? `Antigravity Remote Plus on LAN: ${primary}  (password required)`
      : `Antigravity Remote Plus running on ${primary}`;
  const actions = lan.length > 0 ? ["Open Web UI", "Copy LAN URL"] : ["Open Web UI"];
  vscode.window.showInformationMessage(msg, ...actions).then((choice) => {
    if (choice === "Open Web UI") openWeb();
    else if (choice === "Copy LAN URL") {
      vscode.env.clipboard.writeText(primary);
      vscode.window.showInformationMessage(`Copied: ${primary}`);
    }
  });
}

function stopAll() {
  telegram?.stop();
  telegram = null;
  server?.stop();
  server = null;
  chat?.stop();
  chat = null;
  ls = null;
  running = false;
  updateStatusBar();
  log("[ext] stopped");
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
  vscode.window.showInformationMessage(
    `${running ? "Running" : "Stopped"} — ${urls.join("  ")} (password protected)`
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
  // Persist the flag into argv.json so the port survives the reload.
  try {
    const argvPath = path.join(os.homedir(), ".antigravity-ide", "argv.json");
    let argv: any = {};
    if (fs.existsSync(argvPath)) {
      const raw = fs.readFileSync(argvPath, "utf8").replace(/^﻿/, "");
      // argv.json allows // comments; strip them before parsing.
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
  const sync = running && chat?.cdpConnected() ? " $(link)" : "";
  statusBar.text = running
    ? `$(radio-tower) Remote+${sync}`
    : "$(circle-slash) Remote+";
  statusBar.tooltip = running
    ? `Antigravity Remote Plus: running${
        chat?.cdpConnected()
          ? ` (IDE⇄web synced on CDP port ${chat.cdpPort()})`
          : " (CDP not attached — command fallback)"
      }\nClick to stop.`
    : "Antigravity Remote Plus: stopped — click to start";
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
    )
  );

  if (cfg<boolean>("autoStart", true)) {
    // Defer slightly so the LS process is up.
    setTimeout(() => startAll(context).catch((e) => log(`[ext] autostart: ${e}`)), 2500);
  }
}

export function deactivate() {
  stopAll();
}
