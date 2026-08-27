// Thin API client for the extension's REST endpoints. Auth is a cookie set by
// /api/login; we also keep a bearer token in localStorage as a fallback for
// environments that strip cookies.

const TOKEN_KEY = "arp_token";

let currentWindowId: string | null = null;

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem(TOKEN_KEY);
  const headers: Record<string, string> = {};
  if (t) headers["Authorization"] = `Bearer ${t}`;
  if (currentWindowId) headers["x-window-id"] = currentWindowId;
  return headers;
}

async function req<T>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    ...opts,
    headers: {
      ...(opts.body && !(opts.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...authHeaders(),
      ...(opts.headers ?? {}),
    },
    credentials: "include",
  });
  if (res.status === 401) {
    throw new UnauthorizedError();
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
  }
}

export interface IdeWindowInfo {
  id: string;
  title: string;
  workspaceName: string;
  workspacePath: string | null;
  workspaceFolders: Array<{ name: string; path: string }>;
  isGenerating: boolean;
  statusText: string;
  activeCascadeId?: string;
  pid?: number;
  isHost: boolean;
  lastActive: number;
}

export interface ChatMessage {
  role: "user" | "assistant" | "tool" | "system" | "plan" | "ask" | "artifact";
  text: string;
  ts?: number;
  // Tool rows carry a coarse kind (for icon/grouping) + optional short detail.
  kind?: string;
  detail?: string;
  images?: string[];
  // User messages carry their trajectory stepIndex for per-message revert.
  stepIndex?: number;
  questions?: Array<{
    question: string;
    options: Array<{ id: string; text: string }>;
    selectedOptionIds?: string[];
    skipped?: boolean;
  }>;
  answered?: boolean;
  meta?: Record<string, unknown>;
}

export interface ChatState {
  cascadeId: string;
  generating: boolean;
  statusText: string;
  messages: ChatMessage[];
}

export interface Trajectory {
  id: string;
  title?: string;
  status?: string;
  updatedAt?: string;
  workspaceUri?: string;
  workspaceName?: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  selected?: boolean;
  recommended?: boolean;
  remainingFraction?: number;
  resetTime?: string;
}

export interface QuotaInfo {
  plan: string;
  account?: { name?: string; email?: string };
  credits?: {
    promptCredits?: { available?: number; monthly?: number };
    flowCredits?: { available?: number; monthly?: number };
  };
  modelQuota?: Array<{
    label: string;
    remainingFraction?: number;
    resetTime?: string;
  }>;
}

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "dir";
  size?: number;
}

export interface TodayStats {
  totalChats: number;
  totalTokens: number;
  totalDurationMs: number;
}

export interface RemoteSettings {
  port: number;
  bindHost: string;
  password: string;
  autoStart: boolean;
  remoteDebugPort: number;
  telegramEnabled: boolean;
  telegramToken: string;
  telegramChatId: string;
  workspaceRoot: string;
}

export interface WorkspaceFolders {
  root: string;
  current: string | null; // IDE's currently-open folder path (auto-select this)
  folders: Array<{ name: string; path: string }>;
}

export interface TerminalInfo {
  id: string;
  title: string;
  cwd: string;
  pid?: number;
  alive: boolean;
}

export interface SlashCommand {
  info?: { name?: string; modelFacingText?: string; type?: string };
  title?: string;
  description?: string;
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

export interface BrowseResult {
  cwd: string;
  parent: string | null;
  dirs: string[];
  home: string;
}

export const api = {
  setWindowId(id: string | null) {
    currentWindowId = id;
  },
  getWindowId(): string | null {
    return currentWindowId;
  },

  async login(password: string): Promise<boolean> {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
      credentials: "same-origin",
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
    return Boolean(data.ok);
  },

  windows: () => req<{ windows: IdeWindowInfo[] }>("windows"),

  state: (cascadeId?: string) =>
    req<ChatState>(`state${cascadeId ? `?cascadeId=${encodeURIComponent(cascadeId)}` : ""}`),
  trajectories: () => req<{ list: Trajectory[] }>("trajectories"),
  quota: () => req<any>("quota"),
  models: () => req<{ models: ModelInfo[] }>("models"),
  newChat: () => req<{ ok: boolean }>("new-chat", { method: "POST" }),
  send: (text: string, images?: string[]) =>
    req<{ ok: boolean }>("send", {
      method: "POST",
      body: JSON.stringify({ text, images: images && images.length > 0 ? images : undefined }),
    }),
  slashCommand: (name: string, modelFacingText: string, text = "") =>
    req<{ ok: boolean }>("slash-command", {
      method: "POST",
      body: JSON.stringify({ name, modelFacingText, text }),
    }),
  mentionConversation: (
    conv: { id: string; title?: string; lastModifiedTime?: string },
    text: string
  ) =>
    req<{ ok: boolean }>("mention-conversation", {
      method: "POST",
      body: JSON.stringify({ ...conv, text }),
    }),
  switchCascade: (cascadeId: string) =>
    req<{ ok: boolean }>("switch", { method: "POST", body: JSON.stringify({ cascadeId }) }),
  selectModel: (modelId: string) =>
    req<{ ok: boolean }>("select-model", { method: "POST", body: JSON.stringify({ modelId }) }),
  cancel: () => req<{ ok: boolean }>("cancel", { method: "POST" }),
  revert: (stepIndex: number) =>
    req<{ ok: boolean }>("revert", {
      method: "POST",
      body: JSON.stringify({ stepIndex }),
    }),
  answerQuestion: (
    stepIndex: number,
    answers: { selectedOptionIds: string[]; freeText?: string }[]
  ) =>
    req<{ ok: boolean }>("answer-question", {
      method: "POST",
      body: JSON.stringify({ stepIndex, answers }),
    }),
  skipQuestion: (stepIndex: number) =>
    req<{ ok: boolean }>("skip-question", {
      method: "POST",
      body: JSON.stringify({ stepIndex }),
    }),
  slashCommands: () => req<{ commands: SlashCommand[] }>("slash-commands"),
  approvePlan: (artifactUri: string, approved: boolean) =>
    req<{ ok: boolean }>("approve-plan", {
      method: "POST",
      body: JSON.stringify({ artifactUri, approved }),
    }),

  files: (path = "") =>
    req<{ root: string; entries: FileEntry[] }>(`files?path=${encodeURIComponent(path)}`),
  readFile: (path: string) =>
    req<{ text?: string; error?: string }>(`file?path=${encodeURIComponent(path)}`),
  writeFile: (path: string, text: string) =>
    req<{ ok?: boolean; error?: string }>("file", {
      method: "PUT",
      body: JSON.stringify({ path, text }),
    }),
  deleteFile: (path: string) =>
    req<{ ok?: boolean; error?: string }>(`file?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
    }),
  openFile: (path: string) =>
    req<{ ok: boolean }>("file-open", { method: "POST", body: JSON.stringify({ path }) }),
  upload: (files: File[] | FileList) => {
    const fd = new FormData();
    if (currentWindowId) fd.append("windowId", currentWindowId);
    for (const f of Array.from(files)) fd.append("file", f, f.name);
    return req<{ saved: string[]; absPaths: string[] }>("upload", {
      method: "POST",
      body: fd,
    });
  },

  gitStatus: () =>
    req<{ branch: string; files: { path: string; index: string; work: string }[]; ahead: number; behind: number }>(
      "git/status"
    ),
  gitLog: (limit = 20) =>
    req<{ commits: { hash: string; author: string; date: string; subject: string }[] }>(
      `git/log?limit=${limit}`
    ),
  gitDiff: (file?: string) =>
    req<{ diff: string }>(`git/diff${file ? `?file=${encodeURIComponent(file)}` : ""}`),
  gitAdd: (files: string | string[] = ".") =>
    req<{ ok: boolean; message: string }>("git/add", {
      method: "POST",
      body: JSON.stringify({ files }),
    }),
  gitCommit: (message: string) =>
    req<{ ok: boolean; message: string }>("git/commit", {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  gitPush: (branch?: string, setUpstream = false) =>
    req<{ ok: boolean; message: string }>("git/push", {
      method: "POST",
      body: JSON.stringify({ branch, setUpstream }),
    }),
  gitPull: () => req<{ ok: boolean; message: string }>("git/pull", { method: "POST" }),
  gitBranches: () =>
    req<{ branches: { current: string; all: string[] } }>("git/branch"),
  gitCreateBranch: (name: string) =>
    req<{ ok: boolean; message: string }>("git/branch", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  gitCheckout: (branch: string) =>
    req<{ ok: boolean; message: string }>("git/checkout", {
      method: "POST",
      body: JSON.stringify({ branch }),
    }),
  prCreate: (title: string, body: string) =>
    req<{ ok: boolean; message: string }>("gh/pr-create", {
      method: "POST",
      body: JSON.stringify({ title, body }),
    }),
  prList: () => req<{ prs: { ok: boolean; message: string } }>("gh/pr-list"),

  // ---- Settings / account / workspace ----
  account: () => req<AccountInfo>("account"),
  switchAccount: (email: string) =>
    req<{ ok: boolean; error?: string }>("switch-account", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  getSettings: () => req<RemoteSettings>("settings"),
  saveSettings: (patch: Partial<RemoteSettings>) =>
    req<RemoteSettings>("settings", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  workspace: () => req<{ current: string | null }>("workspace"),
  openWorkspace: (path: string) =>
    req<{ ok: boolean; error?: string }>("workspace", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  browse: (path?: string) =>
    req<BrowseResult>(`browse${path ? `?path=${encodeURIComponent(path)}` : ""}`),
  workspaceFolders: () => req<WorkspaceFolders>("workspace-folders"),
  createWorkspaceFolder: (name: string) =>
    req<{ ok: boolean; path?: string; error?: string }>("workspace-create", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),

  // ---- Terminal ----
  termList: () => req<{ terminals: TerminalInfo[] }>("term/list"),
  termCreate: (cwd?: string, title?: string) =>
    req<TerminalInfo>("term/create", {
      method: "POST",
      body: JSON.stringify({ cwd, title }),
    }),
  termInput: (id: string, data: string) =>
    req<{ ok: boolean }>("term/input", {
      method: "POST",
      body: JSON.stringify({ id, data }),
    }),
  termKill: (id: string) =>
    req<{ ok: boolean }>("term/kill", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  termBuffer: (id: string) =>
    req<{ buffer: string }>(`term/buffer?id=${encodeURIComponent(id)}`),
  screenshot: () => req<{ ok: boolean; dataUri?: string }>("screenshot"),
  stats: () => req<TodayStats>("stats"),
  resetStats: () => req<TodayStats>("reset-stats", { method: "POST" }),
};
