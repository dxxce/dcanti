// Antigravity Language Server (LS) client.
//
// Antigravity's AI ("Cascade") runs inside a local `language_server` process.
// That process exposes a ConnectRPC endpoint on a loopback port, guarded by a
// CSRF token that is passed to it on its own command line. We:
//   1. Find the LS process and scrape --csrf_token / --extension_server_port
//   2. Find the actual LISTENING port it bound (via lsof/netstat)
//   3. POST JSON to /exa.language_server_pb.LanguageServerService/<Method>
//      with header x-codeium-csrf-token
//
// This is the same mechanism the reference "antigravity-with-telegram"
// extension uses; re-implemented cleanly here.

import * as http from "http";
import * as https from "https";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface LsConnection {
  pid: number;
  port: number;
  useTls: boolean;
  csrfToken: string;
  cachedAt: number;
}

export interface TrajectoryStep {
  type?: string;
  status?: string;
  // User's message: userInput.userResponse (or userInput.items[].text)
  userInput?: {
    userResponse?: string;
    items?: Array<{ text?: string }>;
  };
  // Assistant's reply: plannerResponse.response (visible text),
  // plannerResponse.thinking (chain-of-thought), plannerResponse.toolCalls.
  plannerResponse?: {
    messageId?: string;
    response?: string;
    thinking?: string;
    toolCalls?: Array<{ name?: string; toolSummary?: string; argumentsJson?: string }>;
    stopReason?: string;
  };
  // Tool/command steps carry a human summary + output.
  metadata?: {
    toolSummary?: string;
    toolAction?: string;
    toolCall?: { argumentsJson?: string };
    createdAt?: string;
  };
  runCommand?: { commandLine?: string };
  ephemeralMessage?: { content?: string };
  systemMessage?: { message?: string; renderInfo?: { title?: string } };
  [k: string]: unknown;
}

export interface Trajectory {
  id: string;
  title?: string;
  status?: string;
  updatedAt?: string;
  workspaceUri?: string; // absolute workspace folder URI, if any
  workspaceName?: string; // decoded folder name for display
  raw?: unknown;
}

const SERVICE = "exa.language_server_pb.LanguageServerService";

function extractArg(cmdLine: string, argName: string): string | null {
  const eq = cmdLine.match(new RegExp(`--${argName}=([^\\s"]+)`));
  if (eq) return eq[1];
  const sp = cmdLine.match(new RegExp(`--${argName}\\s+([^\\s"]+)`));
  if (sp) return sp[1];
  return null;
}

interface LsProcess {
  pid: number;
  csrfToken: string;
  extPort: number;
}

async function findLsProcess(): Promise<LsProcess | null> {
  const platform = process.platform;
  let output = "";
  try {
    if (platform === "win32") {
      const psScript =
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'language_server' -and $_.CommandLine -match 'csrf_token' -and -not ($_.CommandLine -match 'enable_lsp') } | ForEach-Object { $_.ProcessId.ToString() + '|' + $_.CommandLine }";
      const encoded = Buffer.from(psScript, "utf16le").toString("base64");
      const res = await execAsync(
        `powershell.exe -NoProfile -EncodedCommand ${encoded}`,
        { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 }
      );
      output = String(res.stdout);
    } else {
      // macOS + Linux: ps with full command line.
      const res = await execAsync(`ps -axww -o pid=,command=`, {
        timeout: 8000,
        maxBuffer: 8 * 1024 * 1024,
      });
      output = String(res.stdout);
    }
  } catch {
    return null;
  }

  const lines = output.split("\n");
  for (const line of lines) {
    if (!line.includes("language_server")) continue;
    if (!line.includes("csrf_token")) continue;
    if (line.includes("enable_lsp")) continue;

    let pid: number;
    let rest: string;
    if (platform === "win32") {
      const parts = line.split("|");
      pid = parseInt(parts[0].trim(), 10);
      rest = parts.slice(1).join("|");
    } else {
      const m = line.trim().match(/^(\d+)\s+(.*)$/);
      if (!m) continue;
      pid = parseInt(m[1], 10);
      rest = m[2];
    }
    const csrfToken = extractArg(rest, "csrf_token");
    const extPortStr = extractArg(rest, "extension_server_port");
    const extPort = extPortStr ? parseInt(extPortStr, 10) : 0;
    if (!csrfToken || isNaN(pid)) continue;
    return { pid, csrfToken, extPort };
  }
  return null;
}

async function listListeningPorts(pid: number): Promise<number[]> {
  const ports: number[] = [];
  let output = "";
  try {
    if (process.platform === "win32") {
      const res = await execAsync(
        `netstat -aon | findstr "LISTENING" | findstr "${pid}"`,
        { timeout: 6000, windowsHide: true, maxBuffer: 1024 * 1024 }
      );
      output = String(res.stdout);
      for (const line of output.split("\n")) {
        const m = line.match(/:(\d+)\s+.*LISTENING\s+(\d+)/);
        if (m && parseInt(m[2], 10) === pid) ports.push(parseInt(m[1], 10));
      }
    } else if (process.platform === "darwin") {
      const res = await execAsync(
        `lsof -iTCP -sTCP:LISTEN -P -n -a -p ${pid}`,
        { timeout: 6000, maxBuffer: 1024 * 1024 }
      );
      output = String(res.stdout);
      for (const line of output.split("\n")) {
        const m = line.match(/:(\d+)\s*\(LISTEN\)/);
        if (m) ports.push(parseInt(m[1], 10));
      }
    } else {
      // linux
      const res = await execAsync(
        `ss -tlnp 2>/dev/null | grep "pid=${pid}," || true`,
        { timeout: 6000, maxBuffer: 1024 * 1024 }
      );
      output = String(res.stdout);
      for (const line of output.split("\n")) {
        const m = line.match(/:(\d+)\s/);
        if (m) ports.push(parseInt(m[1], 10));
      }
    }
  } catch {
    // ignore
  }
  return [...new Set(ports)];
}

function lsPost(
  conn: LsConnection,
  method: string,
  payloadObj: unknown
): Promise<string | null> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(payloadObj ?? {});
    const mod = conn.useTls ? https : http;
    const req = mod.request(
      {
        host: "127.0.0.1",
        port: conn.port,
        path: `/${SERVICE}/${method}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "x-codeium-csrf-token": conn.csrfToken,
        },
        rejectUnauthorized: false,
        timeout: 8000,
      } as https.RequestOptions,
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c.toString()));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body);
          } else {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.write(payload);
    req.end();
  });
}

// Probe a port with both http and https to see which the LS speaks.
async function probePort(
  port: number,
  csrfToken: string
): Promise<LsConnection | null> {
  for (const useTls of [false, true]) {
    const conn: LsConnection = {
      pid: 0,
      port,
      useTls,
      csrfToken,
      cachedAt: Date.now(),
    };
    const body = await lsPost(conn, "GetUserStatus", {});
    if (body !== null) return conn;
  }
  return null;
}

export class LsClient {
  private conn: LsConnection | null = null;
  private discovering: Promise<LsConnection | null> | null = null;
  private log: (msg: string) => void;
  private stepCache = new Map<string, any[]>();

  constructor(log: (msg: string) => void = () => {}) {
    this.log = log;
  }

  private async discover(): Promise<LsConnection | null> {
    const proc = await findLsProcess();
    if (!proc) {
      this.log("[LS] no language_server process found");
      return null;
    }
    // Candidate ports: the advertised ext port first, then everything the
    // process is actually listening on.
    const listening = await listListeningPorts(proc.pid);
    const candidates = [
      ...(proc.extPort ? [proc.extPort] : []),
      ...listening,
    ].filter((v, i, a) => a.indexOf(v) === i);

    for (const port of candidates) {
      const conn = await probePort(port, proc.csrfToken);
      if (conn) {
        conn.pid = proc.pid;
        if (!this.conn || this.conn.pid !== proc.pid || this.conn.port !== port) {
          this.log(
            `[LS] connected: pid=${proc.pid} port=${port} tls=${conn.useTls}`
          );
        }
        return conn;
      }
    }
    this.log("[LS] found process but no ConnectRPC port responded");
    return null;
  }

  async getConnection(force = false): Promise<LsConnection | null> {
    if (!force && this.conn && Date.now() - this.conn.cachedAt < 30_000) {
      return this.conn;
    }
    if (this.discovering) return this.discovering;
    this.discovering = this.discover().then((c) => {
      this.conn = c;
      this.discovering = null;
      return c;
    });
    return this.discovering;
  }

  private async call(
    method: string,
    payload: unknown
  ): Promise<string | null> {
    let conn = await this.getConnection();
    if (!conn) return null;
    let body = await lsPost(conn, method, payload);
    if (body === null) {
      // Stale connection — rediscover once.
      conn = await this.getConnection(true);
      if (!conn) return null;
      body = await lsPost(conn, method, payload);
    }
    return body;
  }

  async getUserStatus(): Promise<any | null> {
    const body = await this.call("GetUserStatus", {});
    if (!body) return null;
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }

  async getAvailableModels(): Promise<any | null> {
    const body = await this.call("GetAvailableModels", {});
    if (!body) return null;
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }

  async getAllTrajectories(): Promise<Trajectory[]> {
    const listMap = new Map<string, Trajectory>();

    // 1. Query LS ConnectRPC
    try {
      const body = await this.call("GetAllCascadeTrajectories", {});
      if (body) {
        const parsed = JSON.parse(body);
        const summaries = parsed?.trajectorySummaries;
        if (summaries && typeof summaries === "object" && !Array.isArray(summaries)) {
          for (const [cascadeId, s] of Object.entries<any>(summaries)) {
            const wsUri = String(
              s?.workspaces?.[0]?.workspaceFolderAbsoluteUri ??
                s?.trajectoryMetadata?.workspaces?.[0]?.workspaceFolderAbsoluteUri ??
                s?.trajectoryMetadata?.workspaceUris?.[0] ??
                ""
            );
            listMap.set(cascadeId, {
              id: cascadeId,
              title: s?.summary ?? s?.title ?? s?.name ?? undefined,
              status: s?.status ?? undefined,
              updatedAt:
                s?.lastModifiedTime ??
                s?.lastUserInputTime ??
                s?.createdTime ??
                undefined,
              workspaceUri: wsUri || undefined,
              workspaceName: wsUri ? decodeURIComponent(wsUri.split("/").pop() || wsUri) : undefined,
              raw: s,
            });
          }
        }
      }
    } catch (e: any) {
      this.log(`[LS] GetAllCascadeTrajectories RPC error: ${e?.message ?? e}`);
    }

    // 2. Supplement with all historical trajectories from ~/.gemini/antigravity-ide/brain/
    try {
      const brainDir = path.join(os.homedir(), ".gemini", "antigravity-ide", "brain");
      if (fs.existsSync(brainDir)) {
        const entries = fs.readdirSync(brainDir);
        for (const id of entries) {
          if (id.startsWith(".") || id === "tempmediaStorage") continue;
          if (listMap.has(id)) continue; // Keep live RPC data if already present
          const transcriptPath = path.join(brainDir, id, ".system_generated", "logs", "transcript.jsonl");
          if (!fs.existsSync(transcriptPath)) continue;

          try {
            const stat = fs.statSync(transcriptPath);
            const fd = fs.openSync(transcriptPath, "r");
            const buf = Buffer.alloc(12288);
            const bytesRead = fs.readSync(fd, buf, 0, 12288, 0);
            fs.closeSync(fd);
            const text = buf.toString("utf8", 0, bytesRead);
            const lines = text.split("\n");

            let wsUri = "";
            let title = "";

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const step = JSON.parse(line);
                const content = String(step.content || "");
                if (!wsUri) {
                  const mUser = content.match(/<user_information>[\s\S]*?([\/][^\s\n\r\-]+)\s*->/);
                  const mDoc = content.match(/Active Document:\s*([\/][^\n\r]+)/);
                  if (mUser) {
                    wsUri = "file://" + mUser[1].trim();
                  } else if (mDoc) {
                    const fullDoc = mDoc[1].trim().split(" ")[0];
                    const parts = fullDoc.split("/");
                    if (parts.length >= 4) {
                      wsUri = "file://" + parts.slice(0, 4).join("/");
                    }
                  }
                }
                if (!title && step.type === "CONVERSATION_HISTORY") {
                  const tm = content.match(/## Conversation [^:]+:\s*([^\n\r]+)/);
                  if (tm) title = tm[1].trim();
                }
                if (!title && step.type === "USER_INPUT") {
                  const req = content.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
                  if (req) {
                    title = req[1].split("\n")[0].slice(0, 65).trim();
                  }
                }
              } catch {}
            }

            const wsName = wsUri ? decodeURIComponent(wsUri.split("/").pop() || wsUri) : undefined;
            listMap.set(id, {
              id,
              title: title || `Conversation ${id.slice(0, 8)}`,
              status: "CASCADE_RUN_STATUS_IDLE",
              updatedAt: stat.mtime.toISOString(),
              workspaceUri: wsUri || undefined,
              workspaceName: wsName || undefined,
            });
          } catch {}
        }
      }
    } catch (e: any) {
      this.log(`[LS] brain disk scan warning: ${e?.message ?? e}`);
    }

    const list = Array.from(listMap.values());
    list.sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
    return list;
  }

  private transcriptCache = new Map<string, { mtime: number; steps: any[] }>();

  async getTrajectory(cascadeId: string): Promise<any | null> {
    let allSteps: any[] = [];

    // 1. Read historical transcript from disk cache or reload if modified
    try {
      const brainDir = path.join(os.homedir(), ".gemini", "antigravity-ide", "brain");
      const transcriptPath = path.join(brainDir, cascadeId, ".system_generated", "logs", "transcript.jsonl");
      if (fs.existsSync(transcriptPath)) {
        const stat = fs.statSync(transcriptPath);
        const cached = this.transcriptCache.get(cascadeId);
        if (cached && cached.mtime === stat.mtimeMs) {
          allSteps = [...cached.steps];
        } else {
          const raw = fs.readFileSync(transcriptPath, "utf8");
          const lines = raw.split("\n");
          let lastPlannerToolCalls: any = null;
          const parsedSteps: any[] = [];

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === "USER_INPUT") {
                let userText = parsed.content || "";
                const req = userText.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/);
                if (req) userText = req[1];
                parsedSteps.push({
                  type: "CORTEX_STEP_TYPE_USER_INPUT",
                  status: "CORTEX_STEP_STATUS_DONE",
                  userInput: { userResponse: userText },
                  metadata: {
                    sourceTrajectoryStepInfo: { stepIndex: parsed.step_index ?? parsedSteps.length },
                    createdAt: parsed.created_at,
                  },
                });
              } else if (parsed.type === "PLANNER_RESPONSE") {
                lastPlannerToolCalls = parsed.tool_calls;
                parsedSteps.push({
                  type: "CORTEX_STEP_TYPE_PLANNER_RESPONSE",
                  status: "CORTEX_STEP_STATUS_DONE",
                  plannerResponse: {
                    response: parsed.content || "",
                    toolCalls: parsed.tool_calls,
                  },
                  metadata: {
                    sourceTrajectoryStepInfo: { stepIndex: parsed.step_index ?? parsedSteps.length },
                    createdAt: parsed.created_at,
                  },
                });
              } else if (
                parsed.type !== "CHECKPOINT" &&
                parsed.type !== "CONVERSATION_HISTORY" &&
                parsed.type !== "SYSTEM_MESSAGE" &&
                parsed.type !== "EPHEMERAL_MESSAGE"
              ) {
                const tc = parsed.tool_calls?.[0] || lastPlannerToolCalls?.[0];
                parsedSteps.push({
                  type: `CORTEX_STEP_TYPE_${tc?.name ? tc.name.toUpperCase() : "TOOL"}`,
                  status: "CORTEX_STEP_STATUS_DONE",
                  content: parsed.content,
                  metadata: {
                    sourceTrajectoryStepInfo: { stepIndex: parsed.step_index ?? parsedSteps.length },
                    toolAction: tc?.name || parsed.type,
                    toolSummary: tc?.toolSummary || tc?.args?.toolSummary?.replace(/"/g, ""),
                    toolCall: { argumentsJson: JSON.stringify(tc?.parameters || tc?.args || tc?.arguments || {}) },
                    createdAt: parsed.created_at,
                  },
                });
                lastPlannerToolCalls = null; // consume it
              }
            } catch {}
          }
          this.transcriptCache.set(cascadeId, { mtime: stat.mtimeMs, steps: parsedSteps });
          allSteps = [...parsedSteps];
        }
      }
    } catch {}

    // 2. Fetch LS RPC GetCascadeTrajectory for live streaming chunks and merge
    let trajectoryStatus: string | undefined;
    try {
      const body = await this.call("GetCascadeTrajectory", { cascadeId });
      if (body) {
        const parsed = JSON.parse(body);
        trajectoryStatus = parsed?.trajectory?.status ?? parsed?.status;
        const rpcSteps = parsed?.trajectory?.steps || [];
        if (Array.isArray(rpcSteps) && rpcSteps.length > 0) {
          if (allSteps.length === 0) {
            return parsed;
          }
          for (const rpc of rpcSteps) {
            const idx =
              rpc.metadata?.sourceTrajectoryStepInfo?.stepIndex ??
              rpc.stepIndex ??
              rpc.step_index;
            if (typeof idx === "number") {
              const existingIdx = allSteps.findIndex((s) => {
                const sIdx =
                  s.metadata?.sourceTrajectoryStepInfo?.stepIndex ??
                  s.stepIndex ??
                  s.step_index;
                return sIdx === idx;
              });
              if (existingIdx !== -1) {
                // Overwrite with live RPC step for streaming updates
                allSteps[existingIdx] = rpc;
              } else {
                // Append newly running steps not yet on disk
                allSteps.push(rpc);
              }
            }
          }
        }
      }
    } catch {}

    if (allSteps.length > 0) {
      allSteps.sort((a, b) => {
        const ai = a.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? 0;
        const bi = b.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? 0;
        return ai - bi;
      });

      return {
        trajectory: {
          trajectoryId: cascadeId,
          status: trajectoryStatus,
          steps: allSteps,
        },
      };
    }

    return null;
  }

  async cancel(cascadeId: string): Promise<boolean> {
    const body = await this.call("CancelCascadeInvocation", { cascadeId });
    return body !== null;
  }

  // Upload an image (base64, no data-uri prefix) as a cascade media artifact.
  // Returns the media entry (mimeType/inlineData/uri/thumbnail/description) the
  // send call needs, or null on failure.
  async saveMediaAsArtifact(
    base64: string,
    mimeType: string,
    description?: string
  ): Promise<any | null> {
    const cleanBase64 = base64.includes(",") ? base64.split(",")[1] : base64;
    const body = await this.call("SaveMediaAsArtifact", {
      media: { mimeType, inlineData: cleanBase64 },
    });
    if (!body) return null;
    try {
      const parsed = JSON.parse(body);
      // The LS may return the media entry directly, under `media`, or as an
      // array — normalize to a single entry and ensure inlineData is present.
      const entry =
        (Array.isArray(parsed?.media) ? parsed.media[0] : parsed?.media) ??
        parsed?.artifact ??
        parsed;
      const media = { ...entry };
      if (!media.mimeType) media.mimeType = mimeType;
      if (!media.inlineData) media.inlineData = base64;
      if (description && !media.description) media.description = description;
      return media;
    } catch {
      return { mimeType, inlineData: base64, description };
    }
  }

  // Send a user message (optionally with media) to a cascade. This is the real
  // send RPC — it carries the media array so images arrive as true attachments.
  async sendUserCascadeMessage(
    cascadeId: string,
    text: string,
    media: any[],
    modelId: string
  ): Promise<boolean> {
    return this.sendCascadeItems(cascadeId, [{ text }], media, modelId);
  }

  // Lower-level send: pass the raw `items` array so callers can include a slash
  // command ({item:{slashCommand:{info:{…}}}}) or a conversation mention
  // ({item:{conversation:{id,title,lastModifiedTime}}}) alongside text items.
  async sendCascadeItems(
    cascadeId: string,
    items: any[],
    media: any[],
    modelId: string
  ): Promise<boolean> {
    const payload: any = {
      cascadeId,
      items,
      cascadeConfig: buildCascadeConfig(modelId),
      conversationHistoryConfig: { enabled: true },
    };
    if (Array.isArray(media) && media.length > 0) {
      payload.media = media.map((m) => ({
        mimeType: m?.mimeType || "image/png",
        inlineData: typeof m === "string" ? (m.startsWith("data:") ? m.split(",")[1] : m) : (m?.inlineData?.data || m?.inlineData || m?.data || m?.base64),
        mediaPath: m?.mediaPath || m?.path || undefined,
      }));
    }
    const body = await this.call("SendUserCascadeMessage", payload);
    return body !== null;
  }

  // Approve / reject a plan (or any artifact) the agent is waiting feedback on.
  // The IDE sends this through SendUserCascadeMessage with an artifactComments
  // array carrying the artifact URI + approval status. `approved=false` marks it
  // rejected so the agent revises instead of proceeding.
  async approveArtifact(
    cascadeId: string,
    artifactUri: string,
    approved: boolean,
    modelId: string
  ): Promise<boolean> {
    const body = await this.call("SendUserCascadeMessage", {
      cascadeId,
      cascadeConfig: buildCascadeConfig(modelId),
      conversationHistoryConfig: { enabled: true },
      artifactComments: [
        {
          artifactUri,
          fullFile: {},
          approvalStatus: approved
            ? "ARTIFACT_APPROVAL_STATUS_APPROVED"
            : "ARTIFACT_APPROVAL_STATUS_REJECTED",
        },
      ],
    });
    return body !== null;
  }

  // Fetch the available slash commands (goal / schedule / grill-me / learn …)
  // for a cascade. Returns the raw command list ({info,title,description}[]).
  async getSlashCommands(
    cascadeId: string,
    workspaceUris: string[],
    modelId: string
  ): Promise<any[]> {
    const body = await this.call("GetSlashCommands", {
      cascadeId,
      workspaceUris,
      cascadeConfig: buildCascadeConfig(modelId),
    });
    if (!body) return [];
    try {
      const parsed = JSON.parse(body);
      return Array.isArray(parsed?.commands) ? parsed.commands : [];
    } catch {
      return [];
    }
  }

  // Answer an ask_question interaction. The agent pauses on an ASK_QUESTION step;
  // this submits the user's selected option ids (and/or free text) so it resumes.
  async handleUserInteraction(
    cascadeId: string,
    trajectoryId: string,
    stepIndex: number,
    responses: any[]
  ): Promise<boolean> {
    // The IDE wraps the interaction payload in an `interaction` object and
    // includes the cascadeId at the top level (not just the trajectoryId).
    const body = await this.call("HandleCascadeUserInteraction", {
      cascadeId,
      interaction: {
        trajectoryId,
        stepIndex,
        askQuestion: { responses },
      },
    });
    return body !== null;
  }

  // Revert code + conversation back to a specific step (checkpoint). This is
  // the real Antigravity revert: it restores files to the state they were in at
  // that step. Requires an overrideConfig carrying a valid requestedModel.
  async revertToStep(
    cascadeId: string,
    stepIndex: number,
    modelId: string
  ): Promise<boolean> {
    const body = await this.call("RevertToCascadeStep", {
      cascadeId,
      stepIndex,
      overrideConfig: buildOverrideConfig(modelId),
    });
    return body !== null;
  }
}

// The cascadeConfig the IDE sends with SendUserCascadeMessage. Mirrors the real
// payload the IDE uses (a valid requestedModel is mandatory).
function buildCascadeConfig(modelId: string): any {
  return {
    plannerConfig: {
      conversational: {
        plannerMode: "CONVERSATIONAL_PLANNER_MODE_DEFAULT",
        agenticMode: true,
      },
      toolConfig: {
        runCommand: {
          autoCommandConfig: {
            autoExecutionPolicy: "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER",
          },
        },
        notifyUser: { artifactReviewMode: "ARTIFACT_REVIEW_MODE_ALWAYS" },
        permissionConfig: { defaultGrants: { ask: ["read_url(*)"] } },
      },
      requestedModel: { model: modelId || "MODEL_PLACEHOLDER_M36" },
      ephemeralMessagesConfig: { enabled: true },
      knowledgeConfig: { enabled: true },
    },
    conversationHistoryConfig: { enabled: true },
  };
}

// The overrideConfig blob the IDE sends with revert / step calls. A valid
// requestedModel is mandatory (the LS rejects the call otherwise).
function buildOverrideConfig(modelId: string): any {
  return {
    plannerConfig: {
      conversational: {
        plannerMode: "CONVERSATIONAL_PLANNER_MODE_DEFAULT",
        agenticMode: true,
      },
      toolConfig: {
        runCommand: {
          autoCommandConfig: {
            autoExecutionPolicy: "CASCADE_COMMANDS_AUTO_EXECUTION_EAGER",
          },
        },
        notifyUser: { artifactReviewMode: "ARTIFACT_REVIEW_MODE_ALWAYS" },
      },
      requestedModel: { model: modelId || "MODEL_PLACEHOLDER_M36" },
      ephemeralMessagesConfig: { enabled: true },
      knowledgeConfig: { enabled: true },
    },
    conversationHistoryConfig: { enabled: true },
  };
}

// --- helpers for interpreting a trajectory ---

export function extractSteps(trajectoryData: any): TrajectoryStep[] {
  const steps =
    trajectoryData?.trajectory?.steps ??
    trajectoryData?.steps ??
    [];
  return Array.isArray(steps) ? steps : [];
}

// The trajectory is "generating" if the overall cascade status is RUNNING/PENDING
// or any recent step is still in the GENERATING / PENDING / RUNNING state.
export function isGenerating(steps: TrajectoryStep[], trajectoryStatus?: string): boolean {
  if (trajectoryStatus) {
    const s = String(trajectoryStatus).toUpperCase();
    if (s.includes("RUNNING") || s.includes("PENDING") || s.includes("GENERATING")) {
      return true;
    }
    if (s.includes("DONE") || s.includes("COMPLETED") || s.includes("CANCELLED") || s.includes("ERROR") || s.includes("IDLE")) {
      return false;
    }
  }

  if (steps.length === 0) return false;
  // Scan the tail — check recent 12 steps
  const tail = steps.slice(-12);
  for (const step of tail) {
    const status = String(step.status ?? "").toUpperCase();
    if (
      status.includes("GENERATING") ||
      status.includes("PENDING") ||
      status.includes("RUNNING")
    ) {
      return true;
    }
  }
  return false;
}

// Pull the latest assistant response text out of the trajectory steps.
// Assistant text lives at plannerResponse.response.
export function extractAssistantText(steps: TrajectoryStep[]): string {
  let text = "";
  for (const step of steps) {
    const r = step.plannerResponse?.response;
    if (typeof r === "string" && r.trim()) text = r;
  }
  return text.trim();
}
