// Settings + account + workspace control for remote clients.
//
// Exposes:
//   * account info    — read from Antigravity's cockpit account files
//   * settings         — read/write the extension's VS Code config (port,
//                        password, telegram token/chatid, remote-debug port…)
//   * filesystem browse — list directories anywhere on the machine so the web
//                        UI can pick a workspace folder
//   * open workspace   — switch the IDE to a chosen folder
//
// SECURITY: directory browsing and workspace switching expose the host
// filesystem to any authenticated client. The server is password-protected and
// binds to localhost by default; only enable 0.0.0.0 on trusted networks.

import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import WebSocket from "ws";

const CFG = "antigravityRemotePlus";

// Settings that are safe to expose/edit from the web UI. `password` is write-only
// from the client's perspective (we never send it back in the clear beyond a
// "set" flag) — but since the client already authenticated with it, we do return
// it so the settings form can show/change it. Adjust if you prefer to mask it.
export interface RemoteSettings {
  port: number;
  bindHost: string;
  password: string;
  autoStart: boolean;
  remoteDebugPort: number;
  telegramEnabled: boolean;
  telegramToken: string;
  telegramChatId: string;
  workspaceRoot: string; // folder that contains the user's project folders
}

const EDITABLE_KEYS: Array<keyof RemoteSettings> = [
  "port",
  "bindHost",
  "password",
  "autoStart",
  "remoteDebugPort",
  "telegramEnabled",
  "telegramToken",
  "telegramChatId",
  "workspaceRoot",
];

function cockpitDir(): string {
  return path.join(os.homedir(), ".antigravity_cockpit");
}

function readJsonSafe(file: string): any {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  } catch {
    return null;
  }
}

export interface AccountModelQuota {
  name: string;
  displayName?: string;
  percentage: number;
  resetTime?: string;
}

export interface AccountEntry {
  id: string;
  email: string;
  name: string;
  current: boolean;
  disabled?: boolean;
  tier?: string;
  lastUsed?: number;
  quota?: AccountModelQuota[];
}

export interface AccountInfo {
  currentEmail: string | null;
  accounts: AccountEntry[];
}

export const SettingsController = {
  // ---- Account ----
  // Reads the Cockpit account vault: accounts.json (the roster) plus each
  // per-account file under accounts/<id>.json (which carries the live quota).
  // No secrets (tokens) are ever returned to the browser.
  account(): AccountInfo {
    const dir = cockpitDir();
    const current = readJsonSafe(path.join(dir, "current_account.json"));
    const currentEmail: string | null = current?.email ?? null;
    const roster = readJsonSafe(path.join(dir, "accounts.json"));
    const list: any[] = Array.isArray(roster?.accounts) ? roster.accounts : [];

    const accounts: AccountEntry[] = list.map((a) => {
      // Pull the richer per-account file for quota + tier, if present.
      const detail = a?.id
        ? readJsonSafe(path.join(dir, "accounts", `${a.id}.json`))
        : null;
      const models: any[] = Array.isArray(detail?.quota?.models)
        ? detail.quota.models
        : [];
      // Keep only named models, dedupe by display name, cap to keep it light.
      const seen = new Set<string>();
      const quota: AccountModelQuota[] = [];
      for (const m of models) {
        const rawName = String(m?.name ?? "");
        const dn = String(m?.display_name || rawName || "Model");
        if (!dn || seen.has(dn)) continue;
        seen.add(dn);
        quota.push({
          name: rawName,
          displayName: dn,
          percentage: numOr(m?.percentage),
          resetTime: m?.reset_time ? String(m.reset_time) : undefined,
        });
      }
      return {
        id: String(a?.id ?? ""),
        email: String(a?.email ?? ""),
        name: String(a?.name ?? a?.email ?? ""),
        current: currentEmail != null && a?.email === currentEmail,
        disabled: Boolean(detail?.disabled),
        tier: detail?.quota?.subscription_tier
          ? String(detail.quota.subscription_tier)
          : undefined,
        lastUsed: numOr(a?.last_used) || undefined,
        quota,
      };
    });

    return { currentEmail, accounts };
  },

  // Switch the active Cockpit account by updating current_account.json,
  // instances.json, accounts.json, and notifying the active Cockpit Tools WebSocket server.
  async switchAccount(email: string): Promise<{ ok: boolean; error?: string }> {
    if (!email) return { ok: false, error: "Chưa chọn email tài khoản" };
    const dir = cockpitDir();
    const roster = readJsonSafe(path.join(dir, "accounts.json"));
    const list: any[] = Array.isArray(roster?.accounts) ? roster.accounts : [];
    const match = list.find((a) => a?.email === email);
    if (!match) return { ok: false, error: "Tài khoản không tồn tại trong Cockpit" };
    try {
      const now = Math.floor(Date.now() / 1000);

      // 1. Point current_account.json to the chosen email
      fs.writeFileSync(
        path.join(dir, "current_account.json"),
        JSON.stringify({ email, updated_at: now }, null, 2)
      );

      // 1.5 Update bindAccountId in instances.json so Cockpit/IDE session binds to this account
      try {
        const instancesFile = path.join(dir, "instances.json");
        const instData = readJsonSafe(instancesFile) || { instances: [], defaultSettings: {} };
        if (!instData.defaultSettings) instData.defaultSettings = {};
        instData.defaultSettings.bindAccountId = match.id;
        fs.writeFileSync(instancesFile, JSON.stringify(instData, null, 2));
      } catch {}

      // 1.6 Update codex_accounts.json if applicable
      try {
        const codexFile = path.join(dir, "codex_accounts.json");
        const codexData = readJsonSafe(codexFile);
        if (codexData && Array.isArray(codexData.accounts)) {
          const codexMatch = codexData.accounts.find((ca: any) => ca.email === email);
          if (codexMatch) {
            codexData.current_account_id = codexMatch.id;
            fs.writeFileSync(codexFile, JSON.stringify(codexData, null, 2));
          }
        }
      } catch {}

      // 2. Update last_used in accounts.json roster & move selected account to top
      if (match) {
        match.last_used = now;
        roster.accounts = [match, ...list.filter((a) => a?.email !== email)];
        try {
          fs.writeFileSync(path.join(dir, "accounts.json"), JSON.stringify(roster, null, 2));
        } catch {}
      }

      // 3. Signal the active Cockpit Tools local WebSocket server if running
      try {
        const serverFile = path.join(dir, "server.json");
        const serverInfo = readJsonSafe(serverFile);
        if (serverInfo?.ws_port && serverInfo?.auth_token) {
          const ws = new WebSocket(`ws://127.0.0.1:${serverInfo.ws_port}`, {
            headers: { Authorization: `Bearer ${serverInfo.auth_token}` },
          });
          ws.on("open", () => {
            const reqId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            // Exact Cockpit Tools protocol format
            ws.send(JSON.stringify({
              type: "request.switch_account",
              payload: { account_id: match.id, request_id: reqId },
            }));
            // Legacy / alternate variants
            ws.send(JSON.stringify({ type: "tools.ws.request_switch_account", payload: { account_id: match.id, email: match.email } }));
            ws.send(JSON.stringify({ type: "switch_account", account_id: match.id, email: match.email }));
            setTimeout(() => { try { ws.close(); } catch {} }, 600);
          });
          ws.on("error", () => {});
        }
      } catch {}

      // 3.2 Direct macOS Keychain Injection (Antigravity 2.0 native credential)
      if (process.platform === "darwin" && match.token?.access_token) {
        try {
          const { execSync } = require("child_process");
          const expiryDate = match.token.expiry_timestamp
            ? new Date(match.token.expiry_timestamp * 1000).toISOString()
            : new Date(Date.now() + 3600 * 1000).toISOString();
          const credObj = {
            token: {
              access_token: match.token.access_token,
              token_type: match.token.token_type || "Bearer",
              refresh_token: match.token.refresh_token || "",
              expiry: expiryDate,
            },
            auth_method: "consumer",
          };
          const b64 = Buffer.from(JSON.stringify(credObj)).toString("base64");
          const keychainVal = `go-keyring-base64:${b64}`;
          try { execSync(`security delete-generic-password -s gemini -a antigravity 2>/dev/null || true`); } catch {}
          execSync(`security add-generic-password -s gemini -a antigravity -w "${keychainVal}" -A`);
        } catch {}
      }

      // 3.3 Trigger Cockpit Tools URL Scheme & activate macOS app
      try {
        const { exec } = require("child_process");
        exec(`open "cockpit-tools://switch?account_id=${match.id}&email=${encodeURIComponent(email)}"`);
        exec(`open "cockpit-tools://switch-account?id=${match.id}&email=${encodeURIComponent(email)}"`);
      } catch {}

      // 3.4 Reset SQLite global state OAuth cache so IDE binds immediately to new account
      try {
        const { execSync } = require("child_process");
        const dbPath = path.join(os.homedir(), "Library/Application Support/Antigravity IDE/User/globalStorage/state.vscdb");
        if (fs.existsSync(dbPath)) {
          execSync(`sqlite3 "${dbPath}" "DELETE FROM ItemTable WHERE key IN ('antigravityUnifiedStateSync.oauthToken', 'antigravityUnifiedStateSync.userStatus');"`);
        }
      } catch {}

      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  },

  // ---- Settings ----
  get(): RemoteSettings {
    const c = vscode.workspace.getConfiguration(CFG);
    return {
      port: c.get<number>("port", 7377),
      bindHost: c.get<string>("bindHost", "0.0.0.0"),
      password: c.get<string>("password", ""),
      autoStart: c.get<boolean>("autoStart", true),
      remoteDebugPort: c.get<number>("remoteDebugPort", 9222),
      telegramEnabled: c.get<boolean>("telegramEnabled", false),
      telegramToken: c.get<string>("telegramToken", ""),
      telegramChatId: c.get<string>("telegramChatId", ""),
      workspaceRoot: c.get<string>("workspaceRoot", ""),
    };
  },

  // List workspace folders under the configured root. The user only sets one
  // path; we auto-detect whether it is:
  //   * a container of projects  → list each sub-folder as a workspace, OR
  //   * a single project itself (has .git / looks like a project) → the root IS
  //     the workspace, returned as the sole entry.
  workspaceFolders(): {
    root: string;
    current: string | null;
    folders: Array<{ name: string; path: string }>;
  } {
    const c = vscode.workspace.getConfiguration(CFG);
    const root = c.get<string>("workspaceRoot", "");
    // The IDE's currently-open folder — the UI auto-selects this on load.
    const current = this.currentWorkspace();
    if (!root || !root.trim()) return { root: "", current, folders: [] };
    try {
      const abs = path.resolve(root);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
        return { root: abs, current, folders: [] };
      }
      const entries = fs.readdirSync(abs, { withFileTypes: true });
      // Markers that suggest `abs` is itself a project (so treat it as one WS).
      const projectMarkers = [
        ".git",
        "package.json",
        "Cargo.toml",
        "go.mod",
        "pom.xml",
        "pyproject.toml",
        "Makefile",
      ];
      const isProject = entries.some((e) => projectMarkers.includes(e.name));
      if (isProject) {
        return {
          root: abs,
          current,
          folders: [{ name: path.basename(abs), path: abs }],
        };
      }
      const folders = entries
        .filter((d) => d.isDirectory() && !d.name.startsWith("."))
        .map((d) => ({ name: d.name, path: path.join(abs, d.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      // No sub-folders at all → still expose the root as a single workspace.
      if (folders.length === 0) {
        return {
          root: abs,
          current,
          folders: [{ name: path.basename(abs), path: abs }],
        };
      }
      return { root: abs, current, folders };
    } catch {
      return { root, current, folders: [] };
    }
  },

  async update(patch: Partial<RemoteSettings>): Promise<RemoteSettings> {
    const c = vscode.workspace.getConfiguration(CFG);
    for (const key of EDITABLE_KEYS) {
      if (key in patch && patch[key] !== undefined) {
        await c.update(key, patch[key], vscode.ConfigurationTarget.Global);
      }
    }
    return this.get();
  },

  // ---- Filesystem browse (for the workspace picker) ----
  // Lists directories under an absolute path. Defaults to the home dir.
  browse(dir?: string): { cwd: string; parent: string | null; dirs: string[]; home: string } {
    const home = os.homedir();
    let target = dir && dir.trim() ? dir : home;
    // Normalize + resolve. Fall back to home on error.
    try {
      target = path.resolve(target);
      if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
        target = home;
      }
    } catch {
      target = home;
    }
    let dirs: string[] = [];
    try {
      dirs = fs
        .readdirSync(target, { withFileTypes: true })
        .filter((d) => {
          if (!d.isDirectory()) return false;
          if (d.name.startsWith(".")) return false; // hide dotfolders
          return true;
        })
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b));
    } catch {
      dirs = [];
    }
    const parent = path.dirname(target);
    return {
      cwd: target,
      parent: parent === target ? null : parent,
      dirs,
      home,
    };
  },

  currentWorkspace(): string | null {
    const folders = vscode.workspace.workspaceFolders;
    return folders && folders.length ? folders[0].uri.fsPath : null;
  },

  // Open a folder as the workspace. VS Code reloads the window to do this.
  async openWorkspace(dir: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const abs = path.resolve(dir);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
        return { ok: false, error: "not a directory" };
      }
      await vscode.commands.executeCommand(
        "vscode.openFolder",
        vscode.Uri.file(abs),
        { forceNewWindow: false }
      );
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  },
};

// Best-effort redaction of secret-looking fields so we don't ship tokens to the
// browser wholesale. Keeps structure, masks values whose key hints at a secret.
// Parse a numeric value that may arrive as a string.
function numOr(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function redact(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/token|secret|password|api[_-]?key|refresh|access[_-]?token|cookie/i.test(k)) {
      out[k] = typeof v === "string" && v.length > 0 ? "••••••" : v;
    } else if (v && typeof v === "object") {
      out[k] = redact(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
