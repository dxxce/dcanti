// Chat controller: the bridge between remote clients (web / Telegram) and
// Antigravity's Cascade AI.
//
// Actions that *drive* the AI go through VS Code commands (these are what the
// IDE itself uses when you click around the chat panel):
//   antigravity.startNewConversation       -> new chat
//   antigravity.sendTextToChat              -> send a message to the active chat
//   antigravity.sendPromptToAgentPanel      -> send a prompt to the agent panel
//   antigravity.getDiagnostics              -> current cascade ids / recent list
//   workbench.action.smartFocusConversation -> switch active conversation
//
// Reading state (history, current response, quota) goes through the LS client.

import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as cp from "child_process";
import {
  LsClient,
  Trajectory,
  extractSteps,
  isGenerating,
  extractAssistantText,
  TrajectoryStep,
} from "./lsClient";
import { CdpClient } from "./cdpClient";

export interface AskOption {
  id: string;
  text: string;
}
export interface AskQuestion {
  question: string;
  options: AskOption[];
  // Once answered, the option ids the user picked (so the UI can show it as
  // resolved instead of an open prompt).
  selectedOptionIds?: string[];
  skipped?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant" | "tool" | "system" | "plan" | "ask" | "artifact";
  text: string;
  ts?: number;
  // For tool rows: a coarse kind used for icon + grouping, plus an optional
  // short detail (file name, command, query…) shown after the verb.
  kind?: string;
  detail?: string;
  images?: string[];
  // For user messages: the trajectory stepIndex, used to revert code back to
  // the checkpoint created at that message (RevertToCascadeStep).
  stepIndex?: number;
  // For "ask" rows: the ask_question payload + the step index needed to answer
  // it via HandleCascadeUserInteraction. `answered` is true once resolved.
  questions?: AskQuestion[];
  answered?: boolean;
  meta?: Record<string, unknown>;
}

export interface ChatState {
  cascadeId: string;
  generating: boolean;
  statusText: string;
  messages: ChatMessage[];
}

export interface ModelInfo {
  id: string;
  label: string;
  selected?: boolean;
  recommended?: boolean;
  remainingFraction?: number;
  resetTime?: string;
}

export type ChatEvent =
  | { type: "state"; state: ChatState }
  | { type: "state_update"; cascadeId: string; generating: boolean; statusText: string; lastMessage: any }
  | { type: "status"; cascadeId: string; generating: boolean; statusText: string }
  | { type: "models"; models: ModelInfo[] }
  | { type: "quota"; quota: any }
  | { type: "stats_update"; stats: any }
  | { type: "trajectories"; list: Trajectory[] };

const STEP_LABELS: Record<string, string> = {
  USER_MESSAGE: "You",
  PLANNER: "Thinking",
  TOOL_CALL: "Running tool",
  CODE_EDIT: "Editing code",
  PROPOSE_CODE: "Proposing code",
  COMMAND: "Running command",
  BROWSER: "Using browser",
  DONE: "Done",
};

export class ChatController {
  private ls: LsClient;
  private cdp: CdpClient;
  private log: (m: string) => void;
  private listeners = new Set<(e: ChatEvent) => void>();

  private activeCascadeId = "";
  private lastStatusText = "";
  private lastGenerating = false;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastStepSig = "";
  private lastDiagCheck = 0;
  // Throttle + dedupe the trajectory-list re-emit inside the poll so renames
  // and newly-created conversations appear without a manual refresh.
  private lastTrajRefresh = 0;
  private lastTrajSig = "";

  // CDP is the preferred transport: driving/reading the chat through the IDE's
  // remote-debugging port keeps the IDE panel and the web UI perfectly in sync
  // (both usable at once). When CDP is unavailable we fall back to VS Code
  // commands (drive) + the LS trajectory (read).
  private cdpReady = false;
  private preferredDebugPort = 0;
  private lastCdpSig = "";

  // Remembered model preference (LS has no set-model RPC; we persist the user's
  // choice and mark it selected in the list + attempt it via CDP).
  private selectedModelId = "";

  private userSelected = false;
  private generatingTimeout: NodeJS.Timeout | null = null;
  private sendingUntil = 0;
  // Pending "new chat": startNewConversation doesn't create a trajectory until
  // the first message is sent, so we show an empty transcript and suppress the
  // poller until a brand-new cascade id appears (or the user sends a message).
  private pendingNewChat = false;
  private knownIdsAtNewChat = new Set<string>();
  private revertCheckpoints = new Map<string, number>();

  constructor(ls: LsClient, log: (m: string) => void = () => {}) {
    this.ls = ls;
    this.log = log;
    this.cdp = new CdpClient(log);
  }

  /** Try to attach to the IDE's remote-debugging port. Safe to call repeatedly. */
  async connectCdp(preferredPort?: number): Promise<boolean> {
    if (preferredPort) this.preferredDebugPort = preferredPort;
    this.cdpReady = await this.cdp.connect(this.preferredDebugPort || undefined);
    this.log(`[chat] CDP ${this.cdpReady ? "connected" : "unavailable"}`);
    return this.cdpReady;
  }

  cdpConnected(): boolean {
    return this.cdpReady && this.cdp.isConnected();
  }

  cdpPort(): number {
    return this.cdp.activePort;
  }

  // Capture a screenshot of the Mac desktop screen (PNG base64, no data-uri prefix)
  async captureScreenshot(): Promise<string | null> {
    if (process.platform === "darwin") {
      try {
        const tmpPath = path.join(os.tmpdir(), `mac_screenshot_${Date.now()}.png`);
        await new Promise<void>((resolve, reject) => {
          cp.exec(`screencapture -x -t png "${tmpPath}"`, (err: any) => {
            if (err) reject(err);
            else resolve();
          });
        });
        if (fs.existsSync(tmpPath)) {
          const buf = fs.readFileSync(tmpPath);
          fs.unlinkSync(tmpPath);
          return buf.toString("base64");
        }
      } catch (e: any) {
        this.log(`[chat] macOS screencapture failed: ${e?.message ?? e}`);
      }
    }
    if (this.cdpConnected()) {
      return this.cdp.captureScreenshot();
    }
    return null;
  }

  onEvent(cb: (e: ChatEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: ChatEvent) {
    for (const l of this.listeners) {
      try {
        l(e);
      } catch {
        /* ignore listener errors */
      }
    }
  }

  async getState(): Promise<ChatState> {
    return this.buildState();
  }

  start() {
    if (this.pollTimer) return;
    // Poll the active trajectory ~2x/sec for realtime-ish streaming.
    this.pollTimer = setInterval(() => this.poll().catch(() => {}), 600);
  }

  stop() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // ---- Discover the currently active cascade id ----
  async resolveActiveCascadeId(): Promise<string> {
    if (this.userSelected && this.activeCascadeId) return this.activeCascadeId;

    // 1. Ask the IDE diagnostics for this specific window first
    try {
      const diag: any = await vscode.commands.executeCommand(
        "antigravity.getDiagnostics"
      );
      const id =
        diag?.recentTrajectories?.[0]?.googleAgentId ??
        diag?.recentTrajectories?.[0]?.cascadeId ??
        "";
      if (id) {
        this.activeCascadeId = String(id);
        return this.activeCascadeId;
      }
    } catch {
      /* command may not exist in all builds */
    }

    // 2. Query trajectories and filter by current window workspace folder
    const list = await this.ls.getAllTrajectories();
    if (list.length > 0) {
      const folders = vscode.workspace.workspaceFolders;
      const curWsUri = folders?.[0]?.uri?.toString();
      const normCur = curWsUri ? decodeURIComponent(curWsUri.replace(/\/+$/, "")).toLowerCase() : "";

      let targetList = list;
      if (normCur) {
        const filtered = list.filter((t) => {
          if (!t.workspaceUri) return false;
          const normT = decodeURIComponent(t.workspaceUri.replace(/\/+$/, "")).toLowerCase();
          return normT === normCur || normCur.includes(normT) || normT.includes(normCur);
        });
        if (filtered.length > 0) targetList = filtered;
      }

      // Prefer a cascade that is actively running; otherwise the most recently
      // modified one for this workspace.
      const running = targetList.find((t) =>
        String(t.status ?? "").toUpperCase().includes("RUNNING")
      );
      this.activeCascadeId = (running ?? targetList[0]).id;
      return this.activeCascadeId;
    }

    return this.activeCascadeId;
  }

  getActiveCascadeId(): string {
    return this.activeCascadeId;
  }

  // ---- Actions ----
  async newChat(): Promise<void> {
    // Antigravity's startNewConversation does NOT create a trajectory until the
    // first message is sent — so there is no "new" cascade id to switch to yet.
    // Instead we enter a *pending* state: show an empty transcript, remember the
    // set of ids that already exist, and stop the poller from snapping back to
    // an older RUNNING chat. When the user sends the first message, sendMessage
    // detects the freshly-created id and adopts it.
    this.knownIdsAtNewChat = new Set(
      (await this.ls.getAllTrajectories()).map((t) => t.id)
    );
    await vscode.commands.executeCommand("antigravity.startNewConversation");
    this.pendingNewChat = true;
    this.userSelected = true;
    this.activeCascadeId = "";
    this.lastStepSig = "";
    this.lastCdpSig = "";
    this.lastGenerating = false;
    this.lastStatusText = "Idle";
    this.log("[chat] new chat: entering pending (empty) state");
    // Emit an empty transcript immediately so the UI clears the old chat.
    this.emit({
      type: "state",
      state: { cascadeId: "", generating: false, statusText: "Idle", messages: [] },
    });
  }

  /** After a message is sent in a pending new chat, adopt the new cascade id. */
  private async adoptNewCascadeIfPending(): Promise<void> {
    if (!this.pendingNewChat) return;
    for (let i = 0; i < 15; i++) {
      await delay(300);
      const list = await this.ls.getAllTrajectories();
      const fresh = list.find((t) => !this.knownIdsAtNewChat.has(t.id));
      if (fresh) {
        this.activeCascadeId = fresh.id;
        this.pendingNewChat = false;
        this.log(`[chat] pending new chat adopted -> ${fresh.id}`);
        await this.pushFullState();
        return;
      }
    }
    // Never appeared — clear pending so the poller resumes normally.
    this.pendingNewChat = false;
    this.log("[chat] pending new chat: no fresh id appeared");
  }

  async sendMessage(text: string, images?: string[]): Promise<void> {
    if (!text.trim() && (!images || images.length === 0)) return;
    // Any send counts as an explicit selection, so the poller stays put.
    this.userSelected = true;
    this.sendingUntil = Date.now() + 6000;
    this.lastGenerating = true;
    this.lastStatusText = "Thinking";
    const isNew = this.pendingNewChat;
    const id = isNew ? "" : (this.activeCascadeId || (await this.resolveActiveCascadeId()));
    if (id) this.revertCheckpoints.delete(id);
    const model =
      this.selectedModelId || (await this.detectActiveModel()) || "MODEL_PLACEHOLDER_M298";

    let sent = false;

    const mediaItems: any[] = [];
    if (images && images.length > 0) {
      const brainDir = path.join(os.homedir(), ".gemini/antigravity-ide/brain");
      const targetDir = id ? path.join(brainDir, id, ".user_uploaded") : path.join(brainDir, "temp_uploads");
      try {
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
      } catch {}

      for (let i = 0; i < images.length; i++) {
        const b64 = images[i];
        let mimeType = "image/png";
        let rawBase64 = b64;
        const m = b64.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (m) {
          mimeType = m[1];
          rawBase64 = m[2];
        }
        const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
        const fileName = `media_${Date.now()}_${i}.${ext}`;
        const filePath = path.join(targetDir, fileName);
        try {
          fs.writeFileSync(filePath, Buffer.from(rawBase64, "base64"));
        } catch {}

        try {
          await this.ls.saveMediaAsArtifact(rawBase64, mimeType);
        } catch {}

        mediaItems.push({
          mimeType,
          inlineData: rawBase64,
          mediaPath: filePath,
        });
      }
    }

    // Try focusing/opening the agent panel and matching conversation in the IDE when chatting from web
    try {
      await vscode.commands.executeCommand("workbench.action.chat.open");
      if (id) {
        await this.switchCascade(id);
      }
    } catch {}

    // Prefer direct LS SendUserCascadeMessage with the explicitly chosen model
    if (!isNew && id) {
      try {
        sent = await this.ls.sendUserCascadeMessage(id, text, mediaItems, model);
        if (sent) this.log(`[chat] sent via LS RPC (model: ${model}) with ${mediaItems.length} media`);
        else this.log(`[chat] LS RPC send failed; trying CDP/commands`);
      } catch (e: any) {
        this.log(`[chat] LS send error: ${e?.message ?? e}`);
      }
    } else if (isNew) {
      // For new chat: try direct RPC with empty cascadeId or commands
      try {
        sent = await this.ls.sendUserCascadeMessage("", text, mediaItems, model);
        if (sent) this.log(`[chat] new chat sent via LS RPC`);
      } catch {}
    }

    if (!sent && this.cdpConnected()) {
      sent = await this.cdp.sendMessage(text);
      if (sent) this.log("[chat] sent via CDP");
      else this.log("[chat] CDP send failed; falling back to commands");
    }

    if (!sent) {
      try {
        await vscode.commands.executeCommand(
          "workbench.action.focusActiveEditorGroup"
        );
      } catch {
        /* best effort */
      }
      try {
        await vscode.commands.executeCommand(
          "antigravity.sendPromptToAgentPanel",
          text
        );
        sent = true;
      } catch {
        sent = false;
      }
      if (!sent) {
        await vscode.commands.executeCommand("antigravity.sendTextToChat", text);
      }
    }

    if (this.pendingNewChat) {
      await this.adoptNewCascadeIfPending();
    } else {
      this.lastStepSig = "";
      this.lastGenerating = true;
      this.lastStatusText = "Thinking";
      // Poll briefly for Language Server to record the new USER_INPUT step into trajectory
      for (let i = 0; i < 12; i++) {
        await delay(100);
        const data = id ? await this.ls.getTrajectory(id) : null;
        const steps = extractSteps(data);
        const hasNewUserStep = steps.some((s: any) => {
          const type = shortType(s?.type);
          if (type !== "USER_INPUT") return false;
          const uText = String(
            s.userInput?.userResponse ??
              s.userInput?.items?.find((it: any) => it?.text)?.text ??
              s.userInput?.items?.[0]?.text ??
              ""
          ).trim();
          return uText === text.trim() || text.trim().includes(uText);
        });
        if (hasNewUserStep) {
          this.sendingUntil = 0;
          break;
        }
      }
      await this.pushFullState();
    }
  }

  // Note: Media sending has been removed per user request.
  async sendWithMedia(
    text: string,
    images: { base64: string; mimeType: string; name?: string }[]
  ): Promise<void> {
    await this.sendMessage(text);
  }

  // Send a message built from arbitrary items — used for slash commands and
  // conversation mentions, which are special item shapes the IDE composer emits:
  //   slash command → { item: { slashCommand: { info: {...} } } }
  //   conversation  → { item: { conversation: { id, title, lastModifiedTime } } }
  // followed by a trailing { text } item. Falls back to plain text on failure.
  private async sendItems(items: any[], fallbackText: string): Promise<void> {
    this.userSelected = true;
    const id = this.activeCascadeId || (await this.resolveActiveCascadeId());
    if (!id) {
      await this.sendMessage(fallbackText);
      return;
    }
    const model =
      this.selectedModelId || (await this.detectActiveModel()) || "MODEL_PLACEHOLDER_M298";
    const ok = await this.ls.sendCascadeItems(id, items, [], model);
    if (!ok) {
      await this.sendMessage(fallbackText);
      return;
    }
    if (this.pendingNewChat) {
      await this.adoptNewCascadeIfPending();
    } else {
      this.lastStepSig = "";
      this.lastGenerating = true;
      this.lastStatusText = "Thinking";
      await this.pushFullState();
    }
  }

  // Invoke a system slash command (grill-me / goal / schedule / learn …). The
  // command's modelFacingText is what actually steers the agent; the visible
  // text is appended as a trailing item.
  async sendSlashCommand(
    name: string,
    modelFacingText: string,
    text = ""
  ): Promise<void> {
    await this.sendItems(
      [
        {
          item: {
            slashCommand: {
              info: { name, modelFacingText, type: "SLASH_COMMAND_TYPE_SYSTEM" },
            },
          },
        },
        // The IDE composer separates the command from the user's text with a
        // leading space (e.g. " làm tiếp"). Preserve that so the message reads
        // naturally; an empty text still sends a lone space (command only).
        { text: text ? ` ${text}` : " " },
      ],
      text || name
    );
  }

  // Mention a previous conversation in the current chat so the agent can pull in
  // its context. `conv` carries the referenced cascade's id/title/time.
  async sendWithConversationMention(
    conv: { id: string; title?: string; lastModifiedTime?: string },
    text: string
  ): Promise<void> {
    await this.sendItems(
      [
        {
          item: {
            conversation: {
              id: conv.id,
              title: conv.title ?? "",
              lastModifiedTime: conv.lastModifiedTime ?? "",
            },
          },
        },
        { text: text || " " },
      ],
      text
    );
  }

  async switchCascade(id: string): Promise<void> {
    if (!id) return;
    // Explicit user choice: pin it and cancel any pending-new-chat state.
    this.userSelected = true;
    this.pendingNewChat = false;
    this.activeCascadeId = id;
    this.lastStepSig = "";
    this.lastCdpSig = "";

    const candidates = [
      "antigravity.openConversation",
      "antigravity.focusConversation",
      "antigravity.openCascade",
      "antigravity.switchCascade",
      "workbench.action.smartFocusConversation",
      "workbench.action.forceFocusManager",
      "windsurf.openCascade",
    ];
    for (const cmd of candidates) {
      try {
        await vscode.commands.executeCommand(cmd, id);
        break;
      } catch {}
    }

    if (this.cdpConnected()) {
      try {
        await this.cdp.openConversation(id);
      } catch {}
    }

    await this.pushFullState();
  }

  async cancel(): Promise<boolean> {
    const id = this.activeCascadeId || (await this.resolveActiveCascadeId());
    if (!id) return false;
    if (this.generatingTimeout) {
      clearTimeout(this.generatingTimeout);
      this.generatingTimeout = null;
    }
    this.lastGenerating = false;
    this.lastStatusText = "Idle";
    this.emit({ type: "status", cascadeId: id, generating: false, statusText: "Idle" });

    try {
      await vscode.commands.executeCommand("antigravity.cancelChat");
    } catch {}

    return this.ls.cancel(id);
  }

  // Real revert: Antigravity's RevertToCascadeStep RPC rolls the workspace code
  // back to the checkpoint at a given trajectory step (each user turn is a
  // checkpoint). This actually restores files — it does NOT just ask the agent.
  // stepIndex comes from the user message's sourceTrajectoryStepInfo.stepIndex.
  async revertToStep(stepIndex: number): Promise<boolean> {
    const id = this.activeCascadeId || (await this.resolveActiveCascadeId());
    if (!id || stepIndex == null || stepIndex < 0) return false;
    await this.cancel();
    await delay(100);
    const model = this.selectedModelId || (await this.detectActiveModel()) || "MODEL_PLACEHOLDER_M36";
    const ok = await this.ls.revertToStep(id, stepIndex, model);

    // Save revert checkpoint so buildState truncates old messages immediately
    this.revertCheckpoints.set(id, stepIndex);

    if (this.cdpConnected()) {
      try {
        await this.cdp.revertToStep(stepIndex);
      } catch {}
    }

    await delay(150);
    this.lastStepSig = "";
    await this.pushFullState();
    this.log(`[chat] revert to step ${stepIndex} -> ${ok ? "ok" : "failed"}`);
    return ok;
  }

  // Revert to the most recent user turn (for the Telegram /revert command,
  // which has no per-message UI). Finds the last USER_INPUT step and reverts to
  // the checkpoint just before it.
  async revertLatest(): Promise<boolean> {
    const id = this.activeCascadeId || (await this.resolveActiveCascadeId());
    if (!id) return false;
    const data = await this.ls.getTrajectory(id);
    const steps = extractSteps(data) as any[];
    let stepIndex = -1;
    for (const step of steps) {
      const type = shortType(step.type);
      const idx = step.metadata?.sourceTrajectoryStepInfo?.stepIndex;
      if (type === "USER_INPUT" && typeof idx === "number") stepIndex = idx;
    }
    if (stepIndex < 0) return false;
    return this.revertToStep(stepIndex);
  }

  getTodayStats(): { totalChats: number; totalTokens: number; totalDurationMs: number } {
    const s = loadTodayStats();
    return {
      totalChats: s.totalChats,
      totalTokens: s.totalTokens,
      totalDurationMs: s.totalDurationMs,
    };
  }

  resetTodayStats(): { totalChats: number; totalTokens: number; totalDurationMs: number } {
    const s = resetTodayStatsFile();
    return {
      totalChats: s.totalChats,
      totalTokens: s.totalTokens,
      totalDurationMs: s.totalDurationMs,
    };
  }

  // Answer an ask_question interaction. `answers` maps question index → chosen
  // Answer an ask_question interaction. `answers` maps question index → chosen
  // option ids (+ optional free text). We rebuild the full responses[] the LS
  // expects (echoing the questions/options) so the agent resumes.
  async answerQuestion(
    stepIndex: number,
    answers: { selectedOptionIds: string[]; freeText?: string }[]
  ): Promise<boolean> {
    // 1. Try CDP direct interaction in the IDE window first
    const optIndices: number[] = [];
    let customText = "";
    for (const a of answers) {
      if (Array.isArray(a.selectedOptionIds)) {
        for (const idStr of a.selectedOptionIds) {
          const n = parseInt(idStr, 10);
          if (!isNaN(n) && n > 0) optIndices.push(n - 1);
        }
      }
      if (a.freeText) customText = a.freeText;
    }
    const cdpOk = await this.cdp.answerQuestion({
      optionIndices: optIndices,
      freeText: customText,
    });

    const id = this.activeCascadeId || (await this.resolveActiveCascadeId());
    if (!id) return cdpOk;
    const data = await this.ls.getTrajectory(id);
    const steps = extractSteps(data) as any[];

    // Find the active ask step (waiting for interaction)
    let step = steps.slice().reverse().find(
      (s) =>
        s?.metadata?.sourceTrajectoryStepInfo?.stepIndex === stepIndex ||
        s?.stepIndex === stepIndex ||
        s?.step_index === stepIndex
    );
    if (!step) {
      step = steps.slice().reverse().find(
        (s) =>
          (s?.type === "CORTEX_STEP_TYPE_ASK_QUESTION" ||
            s?.type === "ASK_QUESTION" ||
            s?.type === "ASK_PERMISSION" ||
            Boolean(s?.askQuestion) ||
            Boolean(s?.requestedInteraction?.askQuestion)) &&
          s?.status !== "CORTEX_STEP_STATUS_DONE" &&
          s?.status !== "CORTEX_STEP_STATUS_COMPLETED"
      );
    }
    if (!step) {
      step = steps.slice().reverse().find(
        (s) =>
          s?.type === "CORTEX_STEP_TYPE_ASK_QUESTION" ||
          s?.type === "ASK_QUESTION" ||
          s?.type === "ASK_PERMISSION" ||
          Boolean(s?.askQuestion) ||
          Boolean(s?.requestedInteraction?.askQuestion)
      );
    }
    if (!step && steps.length > 0) step = steps[steps.length - 1];

    const trajectoryId = String(
      step?.metadata?.sourceTrajectoryStepInfo?.trajectoryId ||
      data?.trajectory?.trajectoryId ||
      data?.trajectory?.metadata?.trajectoryId ||
      id
    );

    const realStepIndex =
      step?.metadata?.sourceTrajectoryStepInfo?.stepIndex ??
      step?.stepIndex ??
      step?.step_index ??
      stepIndex;

    const aq =
      step?.askQuestion ??
      step?.requestedInteraction?.askQuestion ??
      step?.askPermission;
    const rawQList = parseAskQuestions(step);
    const questions: any[] = Array.isArray(aq?.questions) && aq.questions.length > 0
      ? aq.questions
      : rawQList;

    const responses = (questions.length > 0 ? questions : answers).map(
      (q, i) => {
        const a = answers[i] ?? { selectedOptionIds: [] };
        const rawOpts = q?.options ?? [];
        const opts = Array.isArray(rawOpts)
          ? rawOpts.map((o: any, idx: number) => ({
              id: String(o.id ?? idx + 1),
              text: String(o.text ?? o),
            }))
          : [];
        const r: any = {
          question: typeof q === "string" ? q : q?.question ?? "",
          options: opts,
        };
        if (
          Array.isArray(a.selectedOptionIds) &&
          a.selectedOptionIds.length > 0
        ) {
          r.selectedOptionIds = a.selectedOptionIds.map(String);
        }
        if (a.freeText) {
          r.writeInResponse = a.freeText;
        }
        return r;
      }
    );

    const ok = await this.ls.handleUserInteraction(
      id,
      trajectoryId,
      realStepIndex,
      responses
    );

    this.lastStepSig = "";
    await this.pushFullState();
    this.log(
      `[chat] answer question step ${stepIndex} (real: ${realStepIndex}) -> rpc: ${ok ? "ok" : "failed"}, cdp: ${cdpOk ? "ok" : "failed"}`
    );

    if (!ok && !cdpOk) {
      // Fallback: send response as message to unblock the agent
      const choiceTexts: string[] = [];
      for (let i = 0; i < answers.length; i++) {
        const a = answers[i];
        if (a.freeText) {
          choiceTexts.push(a.freeText);
        } else if (Array.isArray(a.selectedOptionIds) && a.selectedOptionIds.length > 0) {
          const q = questions[i];
          const optTexts = a.selectedOptionIds.map((optId) => {
            const idx = parseInt(optId, 10) - 1;
            if (q && Array.isArray(q.options) && q.options[idx]) {
              const o = q.options[idx];
              return typeof o === "string" ? o : o.text || optId;
            }
            return `Lựa chọn ${optId}`;
          });
          choiceTexts.push(optTexts.join(", "));
        }
      }
      if (choiceTexts.length > 0) {
        await this.sendMessage(choiceTexts.join("; "));
        return true;
      }
    }

    return ok || cdpOk;
  }

  // Skip an ask_question interaction (equivalent to the IDE's "skip" — send
  // empty selections so the agent proceeds with its recommendation).
  async skipQuestion(stepIndex: number): Promise<boolean> {
    // 1. Try CDP direct skip in the IDE window
    const cdpOk = await this.cdp.answerQuestion({ isSkip: true });

    const id = this.activeCascadeId || (await this.resolveActiveCascadeId());
    if (!id) return cdpOk;
    const data = await this.ls.getTrajectory(id);
    const steps = extractSteps(data) as any[];

    // Find the active ask step (waiting for interaction)
    let step = steps.slice().reverse().find(
      (s) =>
        s?.metadata?.sourceTrajectoryStepInfo?.stepIndex === stepIndex ||
        s?.stepIndex === stepIndex ||
        s?.step_index === stepIndex
    );
    if (!step) {
      step = steps.slice().reverse().find(
        (s) =>
          (s?.type === "CORTEX_STEP_TYPE_ASK_QUESTION" ||
            s?.type === "ASK_QUESTION" ||
            s?.type === "ASK_PERMISSION" ||
            Boolean(s?.askQuestion) ||
            Boolean(s?.requestedInteraction?.askQuestion)) &&
          s?.status !== "CORTEX_STEP_STATUS_DONE" &&
          s?.status !== "CORTEX_STEP_STATUS_COMPLETED"
      );
    }
    if (!step) {
      step = steps.slice().reverse().find(
        (s) =>
          s?.type === "CORTEX_STEP_TYPE_ASK_QUESTION" ||
          s?.type === "ASK_QUESTION" ||
          s?.type === "ASK_PERMISSION" ||
          Boolean(s?.askQuestion) ||
          Boolean(s?.requestedInteraction?.askQuestion)
      );
    }
    if (!step && steps.length > 0) step = steps[steps.length - 1];

    const trajectoryId = String(
      step?.metadata?.sourceTrajectoryStepInfo?.trajectoryId ||
      data?.trajectory?.trajectoryId ||
      data?.trajectory?.metadata?.trajectoryId ||
      id
    );

    const realStepIndex =
      step?.metadata?.sourceTrajectoryStepInfo?.stepIndex ??
      step?.stepIndex ??
      step?.step_index ??
      stepIndex;

    const aq =
      step?.askQuestion ??
      step?.requestedInteraction?.askQuestion ??
      step?.askPermission;
    const rawQList = parseAskQuestions(step);
    const questions: any[] = Array.isArray(aq?.questions) && aq.questions.length > 0
      ? aq.questions
      : rawQList;

    const responses = (questions.length > 0 ? questions : [{}]).map((q) => {
      const rawOpts = q?.options ?? [];
      const opts = Array.isArray(rawOpts)
        ? rawOpts.map((o: any, idx: number) => ({
            id: String(o.id ?? idx + 1),
            text: String(o.text ?? o),
          }))
        : [];
      return {
        question: typeof q === "string" ? q : q?.question ?? "",
        options: opts,
        selectedOptionIds: [],
        skipped: true,
      };
    });

    const ok = await this.ls.handleUserInteraction(
      id,
      trajectoryId,
      realStepIndex,
      responses
    );
    this.lastStepSig = "";
    await this.pushFullState();
    this.log(
      `[chat] skip question step ${stepIndex} (real: ${realStepIndex}) -> rpc: ${ok ? "ok" : "failed"}, cdp: ${cdpOk ? "ok" : "failed"}`
    );

    if (!ok && !cdpOk) {
      await this.sendMessage("User Skipped");
      return true;
    }

    return ok || cdpOk;
  }

  // Fetch the dynamic slash-command catalog for the active cascade.
  async getSlashCommands(): Promise<any[]> {
    const id = this.activeCascadeId || (await this.resolveActiveCascadeId());
    if (!id) return [];
    const data = await this.ls.getTrajectory(id);
    const uris: string[] =
      data?.trajectory?.metadata?.workspaceUris ??
      data?.trajectory?.metadata?.workspaces?.map(
        (w: any) => w?.workspaceFolderAbsoluteUri
      ).filter(Boolean) ??
      [];
    const model =
      this.selectedModelId || (await this.detectActiveModel()) || "MODEL_PLACEHOLDER_M298";
    return this.ls.getSlashCommands(id, uris, model);
  }

  // Approve or reject a plan artifact (implementation_plan.md etc). The IDE
  // records an artifactComment with the approval status via SendUserCascadeMessage.
  async approvePlan(
    artifactUri: string,
    approved: boolean
  ): Promise<boolean> {
    const id = this.activeCascadeId || (await this.resolveActiveCascadeId());
    if (!id) return false;
    const model =
      this.selectedModelId || (await this.detectActiveModel()) || "MODEL_PLACEHOLDER_M298";
    const ok = await this.ls.approveArtifact(id, artifactUri, approved, model);
    this.lastStepSig = "";
    await this.pushFullState();
    this.log(`[chat] ${approved ? "approve" : "reject"} plan -> ${ok ? "ok" : "failed"}`);
    return ok;
  }

  async getTrajectories(): Promise<Trajectory[]> {
    const list = await this.ls.getAllTrajectories();
    this.emit({ type: "trajectories", list });
    return list;
  }

  // Quota comes from GetUserStatus.planStatus (prompt/flow credits) plus the
  // per-model quotaInfo (remainingFraction + resetTime) from the model configs.
  async getQuota(): Promise<any> {
    const status = await this.ls.getUserStatus();
    if (!status) return null;
    const us = status.userStatus ?? status;
    const plan = us?.planStatus ?? {};
    const info = plan?.planInfo ?? {};
    const credits = {
      promptCredits: {
        available: numOr(plan?.availablePromptCredits),
        monthly: numOr(info?.monthlyPromptCredits),
      },
      flowCredits: {
        available: numOr(plan?.availableFlowCredits),
        monthly: numOr(info?.monthlyFlowCredits),
      },
    };
    // Per-model quota (fraction remaining + reset time).
    const models = await this.getModels();
    const modelQuota = models
      .filter((m) => m.remainingFraction != null)
      .map((m) => ({
        label: m.label,
        remainingFraction: m.remainingFraction,
        resetTime: m.resetTime,
      }));
    return {
      plan: info?.planName ?? us?.userTier?.tier ?? "—",
      account: { name: us?.name, email: us?.email },
      credits,
      modelQuota,
    };
  }

  // Model list comes from GetUserStatus.cascadeModelConfigData.clientModelConfigs
  // — this is exactly the picker shown in the Cascade chat box (nice labels,
  // per-model quota, recommended flag). Falls back to GetAvailableModels.
  async getModels(): Promise<
    Array<{
      id: string;
      label: string;
      selected?: boolean;
      recommended?: boolean;
      remainingFraction?: number;
      resetTime?: string;
    }>
  > {
    const status = await this.ls.getUserStatus();
    const us = status?.userStatus ?? status;
    const configs = us?.cascadeModelConfigData?.clientModelConfigs;
    const activeModel = await this.detectActiveModel();

    if (Array.isArray(configs) && configs.length > 0) {
      // Find if selectedModelId exists in configs
      const hasSelected = configs.some((c: any) => {
        const mid = String(c?.modelOrAlias?.model ?? "");
        const alias = String(c?.modelOrAlias?.alias ?? "");
        const label = String(c?.label ?? "");
        return (
          this.selectedModelId &&
          (this.selectedModelId === mid ||
            this.selectedModelId === alias ||
            this.selectedModelId === label)
        );
      });

      if (!this.selectedModelId || !hasSelected) {
        if (activeModel) {
          const matched = configs.find((c: any) => {
            const mid = String(c?.modelOrAlias?.model ?? "");
            const alias = String(c?.modelOrAlias?.alias ?? "");
            const label = String(c?.label ?? "");
            return activeModel === mid || activeModel === alias || activeModel === label;
          });
          if (matched) {
            this.selectedModelId = String(
              matched?.modelOrAlias?.model ??
                matched?.modelOrAlias?.alias ??
                matched?.label ??
                ""
            );
          }
        }
        if (!this.selectedModelId) {
          // Default to recommended or first config
          const recModel = configs.find((c: any) => c?.isRecommended) || configs[0];
          this.selectedModelId = String(
            recModel?.modelOrAlias?.model ??
              recModel?.modelOrAlias?.alias ??
              recModel?.label ??
              ""
          );
        }
      }

      return configs.map((c: any) => {
        const mid = String(c?.modelOrAlias?.model ?? "");
        const alias = String(c?.modelOrAlias?.alias ?? "");
        const label = String(c?.label ?? "");
        const id = mid || alias || label;
        const isSel = this.selectedModelId
          ? this.selectedModelId === id ||
            this.selectedModelId === mid ||
            this.selectedModelId === alias ||
            this.selectedModelId === label
          : activeModel
          ? activeModel === mid ||
            activeModel === alias ||
            activeModel === label ||
            activeModel === id
          : Boolean(c?.isRecommended);
        return {
          id,
          label: label || mid || alias,
          recommended: Boolean(c?.isRecommended),
          selected: isSel,
          remainingFraction: c?.quotaInfo?.remainingFraction,
          resetTime: c?.quotaInfo?.resetTime,
        };
      });
    }
    // Fallback: GetAvailableModels (object map keyed by model slug).
    const avail = await this.ls.getAvailableModels();
    const map = avail?.response?.models ?? avail?.models;
    if (map && typeof map === "object") {
      return Object.entries(map)
        .filter(([, m]: [string, any]) => m?.displayName) // skip internal models
        .map(([key, m]: [string, any]) => ({
          id: String(m?.model ?? key),
          label: String(m?.displayName ?? key),
          recommended: Boolean(m?.recommended),
          selected: this.selectedModelId === String(m?.model ?? key),
          remainingFraction: m?.quotaInfo?.remainingFraction,
          resetTime: m?.quotaInfo?.resetTime,
        }));
    }
    return [];
  }

  /** Detect the model the active conversation is actually running, by reading
   * the latest planner step's requestedModel/generatorModel from its trajectory. */
  private async detectActiveModel(): Promise<string> {
    const id = this.activeCascadeId;
    if (!id) return "";
    try {
      const data = await this.ls.getTrajectory(id);
      const steps = extractSteps(data);
      for (let i = steps.length - 1; i >= 0; i--) {
        const step: any = steps[i];
        const md: any = step?.metadata;
        const pr: any = step?.plannerResponse;
        const m =
          pr?.requestedModel?.model ||
          pr?.generatorModel ||
          pr?.model ||
          md?.requestedModel?.model ||
          md?.generatorModel ||
          md?.model ||
          "";
        if (m) return String(m);
      }
    } catch {
      /* ignore */
    }
    return "";
  }

  async selectModel(modelId: string): Promise<boolean> {
    // The LS exposes no set-model RPC (all variants 404), and the picker lives
    // in the Cascade webview. We remember the choice locally (so the UI + the
    // next prompt reflect it) and best-effort drive the IDE via CDP/commands.
    this.selectedModelId = modelId;
    if (this.cdpConnected()) {
      try {
        await this.cdp.selectModel(modelId);
      } catch {
        /* best effort */
      }
    }
    const candidates = [
      "antigravity.selectModel",
      "antigravity.setModel",
      "windsurf.selectModel",
    ];
    for (const cmd of candidates) {
      try {
        await vscode.commands.executeCommand(cmd, modelId);
        break;
      } catch {
        /* try next */
      }
    }
    await this.pushFullState();
    return true;
  }

  // ---- Reading the conversation ----
  //
  // The Language Server trajectory is the source of truth: it exposes the full
  // structured conversation (GetCascadeTrajectory) in the exact shape the IDE
  // stores it. CDP DOM scraping proved unreliable across IDE builds, so CDP is
  // used only for *sending* (to keep the IDE composer in sync) — never reading.
  async buildState(cascadeId?: string): Promise<ChatState> {
    // An explicit cascadeId means the user opened a specific conversation — pin
    // it so the poller's resolveActiveCascadeId() can't snap to the newest /
    // running one (which looked like "jumping to a new chat" after a reload).
    if (cascadeId) {
      this.userSelected = true;
      this.pendingNewChat = false;
      this.activeCascadeId = cascadeId;
    }
    if (this.pendingNewChat && !cascadeId) {
      return { cascadeId: "", generating: false, statusText: "Idle", messages: [] };
    }
    const id = cascadeId || this.activeCascadeId || (await this.resolveActiveCascadeId());
    const data = id ? await this.ls.getTrajectory(id) : null;
    let steps = extractSteps(data);

    // If an explicit revert checkpoint is active for this cascade, truncate steps to <= stepIndex
    const revertTarget = id ? this.revertCheckpoints.get(id) : undefined;
    if (typeof revertTarget === "number") {
      const trimmed: TrajectoryStep[] = [];
      for (const s of steps as any[]) {
        const sIdx =
          s.stepIndex ??
          s.step_index ??
          s.metadata?.sourceTrajectoryStepInfo?.stepIndex;
        if (typeof sIdx === "number" && sIdx > revertTarget) {
          break;
        }
        trimmed.push(s);
      }
      steps = trimmed;
    }

    const trajectoryStatus = data?.trajectory?.status ?? data?.status;
    const generating = isGenerating(steps, trajectoryStatus);
    const statusText = describeStatus(steps, generating);
    const messages = stepsToMessages(steps, id || undefined);
    if (id) accumulateStatsFromSteps(id, steps, (s) => this.emit({ type: "stats_update", stats: s }));
    return { cascadeId: id, generating, statusText, messages };
  }

  private async pushFullState() {
    const state = await this.buildState();
    this.emit({ type: "state", state });
  }

  private async poll() {
    // Periodically re-emit the trajectory list so renames (the agent retitles a
    // conversation) and brand-new conversations show up in the sidebar without a
    // manual refresh. Throttled so we don't hammer GetAllCascadeTrajectories.
    const now = Date.now();
    if (now - this.lastTrajRefresh > 4000) {
      this.lastTrajRefresh = now;
      this.ls
        .getAllTrajectories()
        .then((list) => {
          const sig = list.map((t) => `${t.id}:${t.title ?? ""}:${t.status ?? ""}`).join("|");
          if (sig !== this.lastTrajSig) {
            this.lastTrajSig = sig;
            this.emit({ type: "trajectories", list });
          }
        })
        .catch(() => {});
    }

    // While a new chat is pending (no message sent yet), keep the transcript
    // empty and don't snap to any existing cascade.
    if (this.pendingNewChat) return;

    // Periodically check if IDE active chat changed (e.g., user started typing in IDE)
    if (now - this.lastDiagCheck > 1000) {
      this.lastDiagCheck = now;
      let ideId = "";
      try {
        const diag: any = await vscode.commands.executeCommand("antigravity.getDiagnostics");
        ideId = String(
          diag?.recentTrajectories?.[0]?.googleAgentId ??
          diag?.recentTrajectories?.[0]?.cascadeId ??
          ""
        );
      } catch {}

      if (!ideId && !this.userSelected) {
        try {
          const list = await this.ls.getAllTrajectories();
          const folders = vscode.workspace.workspaceFolders;
          const curWsUri = folders?.[0]?.uri?.toString();
          const normCur = curWsUri ? decodeURIComponent(curWsUri.replace(/\/+$/, "")).toLowerCase() : "";
          let targetList = list;
          if (normCur) {
            const filtered = list.filter((t) => {
              if (!t.workspaceUri) return false;
              const normT = decodeURIComponent(t.workspaceUri.replace(/\/+$/, "")).toLowerCase();
              return normT === normCur || normCur.includes(normT) || normT.includes(normCur);
            });
            if (filtered.length > 0) targetList = filtered;
          }

          const running = targetList.find((t) => String(t.status ?? "").toUpperCase().includes("RUNNING"));
          if (running) ideId = running.id;
          else if (targetList.length > 0) ideId = targetList[0].id;
        } catch {}
      }

      if (ideId && ideId !== this.activeCascadeId) {
        this.activeCascadeId = ideId;
        this.userSelected = false;
        this.lastStepSig = "";
      }
    }

    const id = this.activeCascadeId || (await this.resolveActiveCascadeId());
    if (!id) return;
    const data = await this.ls.getTrajectory(id);
    if (!data) return;
    const steps = extractSteps(data);
    const trajectoryStatus = data?.trajectory?.status ?? data?.status;
    const messages = stepsToMessages(steps, id || undefined);
    const generating = isGenerating(steps, trajectoryStatus);
    const statusText = describeStatus(steps, generating);

    accumulateStatsFromSteps(id, steps, (s) => this.emit({ type: "stats_update", stats: s }));

    // Debounce generating = false to prevent Stop button flickering between rapid step transitions
    let effectiveGenerating = generating;
    if (this.sendingUntil && Date.now() < this.sendingUntil) {
      if (!generating) {
        effectiveGenerating = true;
      } else {
        this.sendingUntil = 0;
      }
    } else if (generating) {
      if (this.generatingTimeout) {
        clearTimeout(this.generatingTimeout);
        this.generatingTimeout = null;
      }
    } else if (this.lastGenerating === true && !this.generatingTimeout) {
      // Agent just stopped generating. Wait 500ms to confirm reply is truly finished!
      effectiveGenerating = true; // keep it true for 500ms
      this.generatingTimeout = setTimeout(() => {
        this.generatingTimeout = null;
        if (this.lastGenerating === true) {
          this.lastGenerating = false;
          this.lastStatusText = "Idle";
          this.emit({ type: "status", cascadeId: id, generating: false, statusText: "Idle" });
          // Fire models/quota update ONLY when truly done
          this.getModels().then(m => m && m.length > 0 && this.emit({ type: "models", models: m })).catch(()=>{});
          this.getQuota().then(q => q && this.emit({ type: "quota", quota: q })).catch(()=>{});
        }
      }, 500);
    } else if (this.generatingTimeout) {
      effectiveGenerating = true; // still in debounce period
    }

    // Signature over the rendered messages and steps
    const last = messages[messages.length - 1];
    const lastSig = last ? `${last.role}:${last.text.length}:${last.detail ? last.detail.length : 0}` : "";
    const sig = `${effectiveGenerating}|${statusText}|${steps.length}|${messages.length}|${lastSig}`;

    if (sig !== this.lastStepSig) {
      const prevParts = this.lastStepSig.split("|");
      const curParts = sig.split("|");
      
      const canUpdate =
        this.lastStepSig &&
        prevParts.length === 5 &&
        curParts.length === 5 &&
        prevParts[2] === curParts[2] && // steps.length unchanged
        prevParts[3] === curParts[3];   // messages.length unchanged

      this.lastStepSig = sig;

      if (canUpdate && last) {
        this.emit({
          type: "state_update",
          cascadeId: id,
          generating: effectiveGenerating,
          statusText,
          lastMessage: last,
        });
      } else {
        this.emit({
          type: "state",
          state: { cascadeId: id, generating: effectiveGenerating, statusText, messages },
        });
      }
    }

    if (effectiveGenerating !== this.lastGenerating || statusText !== this.lastStatusText) {
      if (!this.generatingTimeout) {
        this.lastGenerating = effectiveGenerating;
        this.lastStatusText = statusText;
        this.emit({ type: "status", cascadeId: id, generating: effectiveGenerating, statusText });
      } else if (statusText !== this.lastStatusText) {
        this.lastStatusText = statusText;
        this.emit({ type: "status", cascadeId: id, generating: true, statusText });
      }
    }
  }
}

// Map a raw CORTEX step type to a short human label for the status line.
const CORTEX_LABELS: Record<string, string> = {
  USER_INPUT: "You",
  PLANNER_RESPONSE: "Thinking",
  RUN_COMMAND: "Running command",
  VIEW_FILE: "Reading file",
  GREP_SEARCH: "Searching",
  LIST_DIRECTORY: "Listing files",
  CODE_ACTION: "Editing code",
  REPLACE_FILE_CONTENT: "Editing file",
  MULTI_REPLACE_FILE_CONTENT: "Editing files",
  MANAGE_TASK: "Managing task",
  SYSTEM_MESSAGE: "System",
  ERROR_MESSAGE: "Error",
  EPHEMERAL_MESSAGE: "Working",
  CHECKPOINT: "Checkpoint",
};

// Strip the CORTEX_STEP_TYPE_ prefix from a raw type string.
function shortType(rawType: string): string {
  return String(rawType ?? "")
    .toUpperCase()
    .replace(/^CORTEX_STEP_TYPE_/, "");
}

// Parse the arguments blob of a tool call (best-effort).
function toolArgs(step: any): any {
  const tc =
    step?.plannerResponse?.toolCalls?.[0] ??
    step?.metadata?.toolCall ??
    null;
  if (!tc) return {};
  try {
    return tc.argumentsJson ? JSON.parse(tc.argumentsJson) : {};
  } catch {
    return {};
  }
}

// Basename of a path/uri for compact display.
function baseName(p: string): string {
  if (!p) return "";
  return decodeURIComponent(String(p).split(/[\\/]/).pop() || p);
}

// How long a step took, in milliseconds, from its metadata timing (startedAt →
// completedAt). Returns null if the timing isn't available or is non-positive.
function stepDurationMs(step: any): number | null {
  const m = step?.metadata;
  const start = m?.startedAt ? Date.parse(m.startedAt) : NaN;
  if (!Number.isFinite(start)) return null;
  const end = m?.completedAt ? Date.parse(m.completedAt) : Date.now();
  const ms = end - start;
  return ms > 0 ? ms : null;
}

// Extract timestamp in ms from step metadata or timestamps.
function stepTimestamp(step: any): number | undefined {
  const m = step?.metadata;
  const raw =
    m?.completedAt ||
    m?.startedAt ||
    m?.createdAt ||
    m?.timestamp ||
    step?.completedAt ||
    step?.startedAt ||
    step?.createdAt ||
    step?.timestamp;
  if (!raw) return undefined;
  if (typeof raw === "number") {
    return raw < 1e11 ? raw * 1000 : raw;
  }
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const num = Number(raw);
    if (Number.isFinite(num) && num > 0) {
      return num < 1e11 ? num * 1000 : num;
    }
  }
  return undefined;
}

// Count inserted / deleted lines from a CODE_ACTION edit's unified diff.
function diffStats(step: any): { added: number; removed: number } | null {
  const lines =
    step?.codeAction?.actionResult?.edit?.diff?.unifiedDiff?.lines;
  if (!Array.isArray(lines)) return null;
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    const t = String(l?.type ?? "");
    if (t.endsWith("INSERT")) added++;
    else if (t.endsWith("DELETE")) removed++;
  }
  if (added === 0 && removed === 0) return null;
  return { added, removed };
}

// Build a concise (verb, detail) label for a tool step, e.g.
//   VIEW_FILE      -> { verb: "Read",     detail: "Tweak.x" }
//   GREP_SEARCH    -> { verb: "Searched", detail: "SSID|BSSID" }
//   RUN_COMMAND    -> { verb: "Ran",      detail: "tail -n 50 …" }
//   LIST_DIRECTORY -> { verb: "Listed",   detail: "dcvnchanger" }
//   CODE_ACTION    -> { verb: "Edited",   detail: "Tweak.x" }
function toolInfo(step: any): { kind: string; verb: string; detail: string } {
  const type = shortType(step.type);
  const args = toolArgs(step);
  switch (type) {
    case "VIEW_FILE":
      return { kind: "read", verb: "Read", detail: baseName(args.AbsolutePath || args.Path || "") };
    case "GREP_SEARCH":
      return { kind: "search", verb: "Searched", detail: String(args.Query || "").slice(0, 60) };
    case "LIST_DIRECTORY":
      return { kind: "read", verb: "Listed", detail: baseName(args.DirectoryPath || "") };
    case "RUN_COMMAND":
      return { kind: "run", verb: "Ran", detail: String(args.CommandLine || "").replace(/\s+/g, " ").slice(0, 70) };
    case "CODE_ACTION":
    case "REPLACE_FILE_CONTENT":
    case "MULTI_REPLACE_FILE_CONTENT":
      return { kind: "edit", verb: "Edited", detail: baseName(args.AbsolutePath || args.TargetFile || args?.ArtifactMetadata?.Summary || "") };
    case "MANAGE_TASK":
      return { kind: "task", verb: "Task", detail: String(args.toolSummary || "").slice(0, 60) };
    case "BROWSER_SUBAGENT":
    case "BROWSER":
    case "OPEN_BROWSER_URL":
    case "READ_BROWSER_PAGE":
      return { kind: "browser", verb: "Browser", detail: String(args.TaskName || args.TaskSummary || args.Url || args.toolSummary || "").slice(0, 70) };
    case "SEARCH_WEB":
      return { kind: "search", verb: "Search Web", detail: String(args.query || args.Query || "").slice(0, 60) };
    case "READ_URL_CONTENT":
      return { kind: "read", verb: "Read URL", detail: String(args.Url || args.url || "").slice(0, 70) };
    case "GENERATE_IMAGE":
      return { kind: "edit", verb: "Generate Image", detail: String(args.Prompt || args.ImageName || "").slice(0, 60) };
    default: {
      const summary = args.toolSummary || args.toolAction || "";
      return { kind: "tool", verb: summary ? String(summary) : titleCase(type), detail: "" };
    }
  }
}

function describeStatus(steps: TrajectoryStep[], generating?: boolean): string {
  if (!generating || steps.length === 0) return "Idle";
  const last = steps[steps.length - 1] as any;
  const type = shortType(last.type);
  if (type === "PLANNER_RESPONSE") {
    const status = String(last.status ?? "").toUpperCase();
    if (status.includes("RUNNING") || status.includes("PENDING") || status.includes("GENERATING")) {
      return "Thinking";
    }
    return "Idle";
  }
  if (type === "USER_INPUT") return "Thinking";
  const info = toolInfo(last);
  return info.detail ? `${info.verb} ${info.detail}` : info.verb;
}

// Is this step an implementation plan awaiting user approval?
function isPlanStep(step: any): boolean {
  const args = toolArgs(step);
  const targetFile = String(
    args.TargetFile ||
      args.AbsolutePath ||
      step?.codeAction?.actionSpec?.createFile?.path?.absoluteUri ||
      ""
  );
  const base = baseName(targetFile).toLowerCase();

  // Explicitly ignore walkthroughs, tasks, scratch files, and source code
  if (
    !base ||
    base.includes("walkthrough") ||
    base.includes("task") ||
    base.includes("scratch") ||
    base.endsWith(".ts") ||
    base.endsWith(".tsx") ||
    base.endsWith(".js") ||
    base.endsWith(".jsx") ||
    base.endsWith(".css") ||
    base.endsWith(".html") ||
    base.endsWith(".json")
  ) {
    return false;
  }

  // Must strictly be implementation_plan.md or plan.md
  const isStrictPlanFile =
    base === "implementation_plan.md" ||
    base === "implementation_plan" ||
    base === "plan.md" ||
    targetFile.toLowerCase().endsWith("/implementation_plan.md") ||
    targetFile.toLowerCase().endsWith("/plan.md");

  if (!isStrictPlanFile) return false;

  const meta = args?.ArtifactMetadata;
  // It must explicitly request feedback from the user
  return meta?.RequestFeedback === true || meta?.RequestFeedback === "true";
}

// Extract the output / stdout / error result or detailed execution args of a step.
function stepDetailText(step: any): string | undefined {
  const type = shortType(step?.type ?? "");
  const args = toolArgs(step);
  let rawContent = typeof step?.content === "string" ? step.content.trim() : "";
  if (rawContent.length > 35000) {
    rawContent =
      rawContent.slice(0, 15000) +
      "\n\n...[TRUNCATED_BY_ANTIGRAVITY_REMOTE]...\n\n" +
      rawContent.slice(-15000);
  }

  if (type === "RUN_COMMAND") {
    const cmd = args.CommandLine || "";
    let text = cmd ? `$ ${cmd}` : "";
    if (rawContent) {
      text += text ? `\n\n${rawContent}` : rawContent;
    }
    return text || undefined;
  }

  if (type === "WRITE_TO_FILE") {
    const file = args.TargetFile || args.AbsolutePath || "";
    const desc = args.Description || "";
    const code = args.CodeContent || "";
    let text = file ? `Target: ${file}` : "";
    if (desc) text += (text ? `\nDescription: ` : "") + desc;
    if (code) text += (text ? `\n\n` : "") + code;
    if (rawContent) text += (text ? `\n\n` : "") + rawContent;
    return text || undefined;
  }

  if (
    type === "CODE_ACTION" ||
    type === "REPLACE_FILE_CONTENT" ||
    type === "MULTI_REPLACE_FILE_CONTENT"
  ) {
    const file = args.TargetFile || args.AbsolutePath || "";
    const desc = args.Description || args.Instruction || "";
    let target = args.TargetContent || "";
    let replacement = args.ReplacementContent || "";
    if (target.length > 8000) target = target.slice(0, 8000) + "\n...[TRUNCATED]";
    if (replacement.length > 8000)
      replacement = replacement.slice(0, 8000) + "\n...[TRUNCATED]";

    let text = file ? `File: ${file}\n` : "";
    if (desc) text += `Description: ${desc}\n`;
    if (target || replacement) {
      if (text) text += "\n";
      if (target) text += `--- Target:\n${target}\n\n`;
      if (replacement) text += `+++ Replacement:\n${replacement}`;
    }
    if (rawContent) {
      text += text ? `\n\n${rawContent}` : rawContent;
    }
    return text || undefined;
  }

  if (type === "GREP_SEARCH") {
    const q = args.Query || "";
    const path = args.SearchPath || "";
    let text = `Query: "${q}"\nPath: ${path}`;
    if (rawContent) text += `\n\n${rawContent}`;
    return text;
  }

  if (type === "VIEW_FILE") {
    const file = args.AbsolutePath || args.Path || "";
    const start = args.StartLine;
    const end = args.EndLine;
    let text =
      `File: ${file}` + (start != null ? ` (lines ${start}-${end})` : "");
    if (rawContent) text += `\n\n${rawContent}`;
    return text;
  }

  if (type === "LIST_DIRECTORY") {
    const dir = args.DirectoryPath || args.Path || "";
    let text = `Directory: ${dir}`;
    if (rawContent) text += `\n\n${rawContent}`;
    return text;
  }

  if (
    type === "BROWSER_SUBAGENT" ||
    type === "BROWSER" ||
    type === "OPEN_BROWSER_URL" ||
    type === "READ_BROWSER_PAGE"
  ) {
    const taskName = args.TaskName || "";
    const task = args.Task || "";
    const taskSummary = args.TaskSummary || "";
    const url = args.Url || args.url || "";
    let text = taskName ? `Task: ${taskName}\n` : "";
    if (taskSummary) text += `Summary: ${taskSummary}\n`;
    if (url) text += `URL: ${url}\n`;
    if (task) text += `\nInstructions:\n${task}\n`;
    if (rawContent) text += (text ? `\n\nResult:\n` : "") + rawContent;
    return text || undefined;
  }

  if (rawContent) return rawContent;
  const desc =
    args.Description ||
    args.Instruction ||
    args.toolSummary ||
    args.toolAction;
  if (desc) return String(desc);
  if (Object.keys(args).length > 0) {
    return JSON.stringify(args, null, 2);
  }
  return undefined;
}

// Extract token usage count for a step if provided by LS, with dynamic length-based fallback.
function stepTokenCount(step: any): number {
  const m = step?.metadata;
  const pr = step?.plannerResponse;
  const u = pr?.usageMetadata || pr?.tokenUsage || pr?.usage || m?.tokenUsage || m?.usage || {};

  const total = u.totalTokenCount || u.totalTokens || u.total_tokens || m?.totalTokens || m?.tokenCount;
  if (typeof total === "number" && total > 0) return total;

  const prompt = u.promptTokenCount || u.promptTokens || u.prompt_tokens || 0;
  const candidate = u.candidatesTokenCount || u.completionTokens || u.completion_tokens || 0;
  const sum = prompt + candidate;
  if (sum > 0) return sum;

  const detail = stepDetailText(step) || "";
  const raw = String(step?.content || pr?.response || "").trim();
  const textToMeasure = detail.length > raw.length ? detail : raw;
  if (textToMeasure.length > 0) {
    return Math.max(12, Math.round(textToMeasure.length / 3.4));
  }
  const typeLen = String(step?.type || "").length;
  return 18 + ((typeLen * 9) % 27);
}

function parseAskQuestions(step: any, tc?: any): any[] {
  let rawArgs: any = {};
  if (tc) {
    if (typeof tc.argumentsJson === "string") {
      try {
        rawArgs = JSON.parse(tc.argumentsJson);
      } catch {
        rawArgs = {};
      }
    } else {
      rawArgs = tc.args || {};
    }
  } else {
    rawArgs = toolArgs(step);
  }

  const ri =
    step?.requestedInteraction ||
    step?.permissionRequest ||
    step?.requestedPermission ||
    step?.toolPermissionRequest ||
    {};
  const aq =
    step?.askQuestion ||
    ri?.askQuestion ||
    step?.askPermission ||
    ri?.askPermission ||
    step?.permissionRequest ||
    step?.requestedPermission ||
    step?.toolPermissionRequest ||
    ri?.toolPermissionRequest ||
    ri?.permissionRequest ||
    ri ||
    {};

  // 1. Array of questions in rawArgs.questions or aq.questions
  let rawQList =
    rawArgs.questions ||
    aq.questions ||
    ri.questions ||
    step?.questions;

  if (typeof rawQList === "string") {
    try {
      rawQList = JSON.parse(rawQList);
    } catch {}
  }

  if (Array.isArray(rawQList) && rawQList.length > 0) {
    return rawQList.map((q: any, qIdx: number) => {
      if (typeof q === "string") {
        return {
          question: q,
          description: "",
          options: [
            { id: "1", text: "Yes" },
            { id: "2", text: "No" },
          ],
        };
      }
      const qText = String(
        q.question || q.title || q.Reason || q.reason || `Câu hỏi ${qIdx + 1}`
      ).trim();
      const desc =
        q.description ||
        q.toolAction ||
        q.toolSummary ||
        q.targetPath ||
        q.path ||
        "";
      let opts = q.options;
      if (typeof opts === "string") {
        try {
          opts = JSON.parse(opts);
        } catch {}
      }
      const parsedOptions = Array.isArray(opts)
        ? opts.map((o: any, idx: number) =>
            typeof o === "string"
              ? { id: String(idx + 1), text: o }
              : { id: String(o.id ?? idx + 1), text: String(o.text ?? o) }
          )
        : [
            { id: "1", text: "Yes, allow this time" },
            { id: "2", text: "Yes, and always allow" },
            { id: "3", text: "No (tell the agent what to do instead)" },
          ];
      return {
        question: qText,
        description: desc,
        options: parsedOptions,
        is_multi_select: Boolean(q.is_multi_select || q.isMultiSelect),
      };
    });
  }

  // 2. Single question
  const singleQ =
    rawArgs.question ||
    aq.question ||
    aq.title ||
    rawArgs.Reason ||
    aq.reason;

  if (singleQ) {
    let opts = rawArgs.options || aq.options;
    if (typeof opts === "string") {
      try {
        opts = JSON.parse(opts);
      } catch {}
    }
    const parsedOptions = Array.isArray(opts)
      ? opts.map((o: any, idx: number) =>
          typeof o === "string"
            ? { id: String(idx + 1), text: o }
            : { id: String(o.id ?? idx + 1), text: String(o.text ?? o) }
        )
      : [
          { id: "1", text: "Yes, allow this time" },
          { id: "2", text: "Yes, and always allow" },
          { id: "3", text: "No (tell the agent what to do instead)" },
        ];
    return [
      {
        question: String(singleQ),
        description:
          rawArgs.description ||
          rawArgs.toolAction ||
          rawArgs.toolSummary ||
          rawArgs.targetPath ||
          "",
        options: parsedOptions,
        is_multi_select: Boolean(rawArgs.is_multi_select || rawArgs.isMultiSelect),
      },
    ];
  }

  // 3. Permission request fallback
  let targetPath = "";
  const scanObj = (o: any, depth = 0) => {
    if (!o || typeof o !== "object" || depth > 5) return;
    if (!targetPath) {
      const found =
        o.targetPath ||
        o.target ||
        o.path ||
        o.resource ||
        o.file ||
        o.filePath ||
        o.Target ||
        o.TargetFile ||
        o.Path ||
        o.Resource ||
        o.uri ||
        "";
      if (found && typeof found === "string" && found.length > 1) {
        targetPath = found;
        return;
      }
    }
    for (const k of Object.keys(o)) {
      if (
        o[k] &&
        typeof o[k] === "object" &&
        k !== "options" &&
        k !== "questions" &&
        k !== "plannerResponse"
      ) {
        scanObj(o[k], depth + 1);
        if (targetPath) return;
      }
    }
  };
  scanObj(step);
  if (!targetPath && tc) scanObj(rawArgs);

  const actionType =
    rawArgs.Action ||
    rawArgs.action ||
    ri.permissionType ||
    ri.action ||
    aq.action ||
    aq.permissionType ||
    "read access";
  const reasonText = targetPath
    ? `Cấp quyền truy cập cho tệp tin / thư mục:`
    : `Allow ${actionType} to this path?`;

  return [
    {
      question: reasonText,
      description: targetPath,
      options: [
        { id: "1", text: "Yes, allow this time" },
        { id: "2", text: "Yes, and always allow" },
        { id: "3", text: "No (tell the agent what to do instead)" },
      ],
    },
  ];
}

function isErrorLikeJson(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  if (t.startsWith("{") && t.endsWith("}")) {
    try {
      const parsed = JSON.parse(t);
      if (
        parsed.error ||
        parsed.errorMessage ||
        parsed.userErrorMessage ||
        parsed.user_error_message ||
        parsed.code === 429 ||
        parsed.status === "RESOURCE_EXHAUSTED" ||
        parsed.status === "ERROR"
      ) {
        return true;
      }
    } catch {}
  }
  return false;
}

function extractErrorString(step: any): string {
  if (!step) return "Đã xảy ra lỗi khi thực thi.";

  let errId =
    step.errorId ||
    step.error_id ||
    step.error?.errorId ||
    step.error?.error_id ||
    step.error?.id ||
    step.id ||
    "";

  const queue = [
    step.error?.userErrorMessage,
    step.error?.user_error_message,
    step.userErrorMessage,
    step.user_error_message,
    step.errorMessage,
    step.error_message,
    step.error?.message,
    step.error?.description,
    step.error?.error?.message,
    step.error?.error?.userErrorMessage,
    step.error?.details,
    step.systemMessage?.message,
    step.systemMessage?.renderInfo?.description,
    step.systemMessage?.renderInfo?.title,
    step.failureReason,
    step.error,
    step.content,
  ];

  let rawMessage = "";

  for (const item of queue) {
    if (!item) continue;
    if (typeof item === "string" && item.trim()) {
      const s = item.trim();
      if (s.startsWith("{") && s.endsWith("}")) {
        try {
          const parsed = JSON.parse(s);
          const msg =
            parsed.userErrorMessage ||
            parsed.user_error_message ||
            parsed.error?.userErrorMessage ||
            parsed.error?.message ||
            parsed.message ||
            parsed.description;
          if (msg) {
            rawMessage = String(msg).trim();
            if (parsed.errorId || parsed.id || parsed.error?.id) {
              errId = parsed.errorId || parsed.id || parsed.error?.id;
            }
            break;
          }
        } catch {}
      }
      rawMessage = s;
      break;
    }
    if (typeof item === "object") {
      const msg =
        item.userErrorMessage ||
        item.user_error_message ||
        item.error?.userErrorMessage ||
        item.error?.message ||
        item.message ||
        item.description ||
        item.title;
      if (typeof msg === "string" && msg.trim()) {
        rawMessage = msg.trim();
        if (item.errorId || item.id || item.error_id || item.error?.id) {
          errId = item.errorId || item.id || item.error_id || item.error?.id;
        }
        break;
      }
    }
  }

  if (!rawMessage || rawMessage === "[object Object]") {
    rawMessage = "Đã xảy ra lỗi khi thực thi tác vụ.";
  }

  // If rawMessage is still a JSON string, try parsing it
  if (rawMessage.startsWith("{") && rawMessage.endsWith("}")) {
    try {
      const parsed = JSON.parse(rawMessage);
      const msg =
        parsed.userErrorMessage ||
        parsed.user_error_message ||
        parsed.error?.userErrorMessage ||
        parsed.error?.message ||
        parsed.message ||
        parsed.description;
      if (msg) rawMessage = String(msg).trim();
      if (parsed.errorId || parsed.id || parsed.error?.id) {
        errId = parsed.errorId || parsed.id || parsed.error?.id;
      }
    } catch {}
  }

  // Remove redundant Error: prefix
  rawMessage = rawMessage.replace(/^Error:\s*/i, "").trim();

  let formatted = rawMessage;
  if (errId && !formatted.includes(String(errId))) {
    formatted += `\n\n**Error ID:** \`${errId}\``;
  }
  return formatted;
}

// Convert raw CORTEX trajectory steps into a clean transcript.
function stepsToMessages(steps: TrajectoryStep[], cascadeId?: string): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  const answeredArtifacts = new Set<string>();

  // Filter out any reverted/deleted/undone steps from trajectory
  const validSteps = (steps as any[]).filter((step) => {
    if (!step) return false;
    if (
      step.metadata?.isReverted ||
      step.metadata?.deleted ||
      step.metadata?.undone ||
      step.isDeleted ||
      step.reverted ||
      step.undone
    ) {
      return false;
    }
    const status = String(step.status ?? "").toUpperCase();
    if (status === "REVERTED" || status === "DELETED" || status === "UNDONE") {
      return false;
    }
    return true;
  });

  for (const step of validSteps) {
    const comments =
      step?.userInput?.artifactComments ??
      step?.artifactComments ??
      null;
    if (Array.isArray(comments)) {
      for (const c of comments) {
        const uri = String(c?.artifactUri ?? "");
        if (uri && c?.approvalStatus) {
          answeredArtifacts.add(uri);
          answeredArtifacts.add(baseName(uri));
        }
      }
    }
  }

  let turnTokens = 0;
  let turnDurationMs = 0;

  for (const step of validSteps) {
    const type = shortType(step.type);
    const durationMs = stepDurationMs(step);
    const stepTok = stepTokenCount(step);
    const stepOut = stepDetailText(step);

    if (durationMs != null && durationMs > 0) turnDurationMs += durationMs;
    if (stepTok != null && stepTok > 0) turnTokens += stepTok;

    const stepTs = stepTimestamp(step);

    if (type === "USER_INPUT") {
      // Reset turn counters when user starts a new message
      turnTokens = 0;
      turnDurationMs = 0;
      const t = String(
        step.userInput?.userResponse ??
          step.userInput?.items?.find((i: any) => i?.text)?.text ??
          step.userInput?.items?.[0]?.text ??
          ""
      ).trim();

      const images: string[] = [];
      if (Array.isArray(step.userInput?.items)) {
        for (const it of step.userInput.items) {
          const m = it?.media;
          if (m) {
            const mime = m.mimeType || "image/png";
            const data = m.inlineData || m.data;
            if (data && typeof data === "string") {
              const src = data.startsWith("data:") ? data : `data:${mime};base64,${data}`;
              images.push(src);
            }
          }
        }
      }
      if (Array.isArray(step.userInput?.media)) {
        for (const m of step.userInput.media) {
          const mime = m?.mimeType || "image/png";
          const data = m?.inlineData || m?.data;
          if (data && typeof data === "string") {
            const src = data.startsWith("data:") ? data : `data:${mime};base64,${data}`;
            images.push(src);
          }
        }
      }

      const stepIndex = step.metadata?.sourceTrajectoryStepInfo?.stepIndex;
      if (t || images.length > 0)
        msgs.push({
          role: "user",
          text: t,
          ts: stepTs,
          images: images.length > 0 ? images : undefined,
          stepIndex: typeof stepIndex === "number" ? stepIndex : undefined,
        });
      continue;
    }

    if (type === "PLANNER_RESPONSE") {
      const resp = String(step.plannerResponse?.response ?? "").trim();
      if (resp) {
        if (isErrorLikeJson(resp)) {
          const cleanErr = extractErrorString({ ...step, errorMessage: resp });
          const lastMsg = msgs[msgs.length - 1];
          if (lastMsg && lastMsg.kind === "error" && lastMsg.text === cleanErr) {
            continue;
          }
          msgs.push({
            role: "assistant",
            text: cleanErr,
            kind: "error",
            ts: stepTs,
            meta: {
              type,
              isError: true,
              tokens: stepTok ?? undefined,
              turnTokens: turnTokens > 0 ? turnTokens : undefined,
              turnDurationMs: turnDurationMs > 0 ? turnDurationMs : undefined,
            },
          });
          continue;
        }

        msgs.push({
          role: "assistant",
          text: resp,
          ts: stepTs,
          meta: {
            type,
            tokens: stepTok ?? undefined,
            turnTokens: turnTokens > 0 ? turnTokens : undefined,
            turnDurationMs: turnDurationMs > 0 ? turnDurationMs : undefined,
          },
        });
      }
      continue;
    }

    const isError =
      type === "ERROR_MESSAGE" ||
      type === "FAILURE" ||
      String(step.status ?? "").toUpperCase() === "ERROR" ||
      String(step.status ?? "").toUpperCase() === "FAILED" ||
      Boolean(step.errorMessage) ||
      Boolean(step.error);

    if (isError && type !== "USER_INPUT") {
      const errText = extractErrorString(step);
      if (errText) {
        // Deduplicate: Don't push consecutive identical error messages
        const lastMsg = msgs[msgs.length - 1];
        if (lastMsg && lastMsg.kind === "error" && lastMsg.text === errText) {
          continue;
        }
        msgs.push({
          role: "assistant",
          text: errText,
          kind: "error",
          ts: stepTs,
          meta: { type: "ERROR_MESSAGE", isError: true, output: stepOut || undefined },
        });
        continue;
      }
    }

    if (type === "SYSTEM_MESSAGE") {
      const t = String(
        step.systemMessage?.message ??
          step.systemMessage?.renderInfo?.title ??
          ""
      ).trim();
      if (t) {
        if (isErrorLikeJson(t)) {
          const cleanErr = extractErrorString({ ...step, errorMessage: t });
          const lastMsg = msgs[msgs.length - 1];
          if (lastMsg && lastMsg.kind === "error" && lastMsg.text === cleanErr) {
            continue;
          }
          msgs.push({
            role: "assistant",
            text: cleanErr,
            kind: "error",
            ts: stepTs,
            meta: { type, isError: true },
          });
          continue;
        }
        msgs.push({
          role: "system",
          text: t,
          kind: "system",
          ts: stepTs,
          meta: { type },
        });
      }
      continue;
    }

    const isAskStep =
      type === "ASK_QUESTION" ||
      type === "ASK_PERMISSION" ||
      type === "REQUESTED_INTERACTION" ||
      type === "PERMISSION_REQUEST" ||
      type === "TOOL_PERMISSION_REQUEST" ||
      Boolean(step.askQuestion) ||
      Boolean(step.askPermission) ||
      Boolean(step.requestedInteraction) ||
      Boolean(step.permissionRequest) ||
      Boolean(step.requestedPermission) ||
      Boolean(step.toolPermissionRequest);

    if (isAskStep) {
      const lastMsg = msgs[msgs.length - 1];
      const questions = parseAskQuestions(step);

      // Deduplicate: If an ask card with generic reason comes right after another ask card, skip duplicate
      const qFirst = String(questions[0]?.question || "");
      if (
        qFirst.toLowerCase().includes("allow read access") &&
        lastMsg &&
        lastMsg.role === "ask"
      ) {
        continue;
      }

      if (questions.length > 0) {
        const answered =
          Array.isArray(step.completedInteractions) &&
          step.completedInteractions.length > 0
            ? true
            : questions.some(
                (q: any) =>
                  q?.skipped === true ||
                  (Array.isArray(q?.selectedOptionIds) &&
                    q.selectedOptionIds.length > 0)
              );
        const stepIndex =
          step.metadata?.sourceTrajectoryStepInfo?.stepIndex ??
          step.stepIndex ??
          step.step_index;
        const selected: string[] = [];
        for (const q of questions) {
          if (Array.isArray(q?.selectedOptionIds))
            selected.push(...q.selectedOptionIds);
        }
        msgs.push({
          role: "ask",
          text: questions
            .map((q: any) => String(q?.question ?? ""))
            .join("\n"),
          ts: stepTs,
          stepIndex: typeof stepIndex === "number" ? stepIndex : undefined,
          meta: {
            type,
            questions,
            answered,
            selected,
          },
        });
        continue;
      }
    }

    if (
      type === "CHECKPOINT" ||
      type === "EPHEMERAL_MESSAGE" ||
      type === "CONVERSATION_HISTORY" ||
      type === "KNOWLEDGE_ARTIFACTS" ||
      type === "USER_INPUT"
    ) {
      continue;
    }

    if ((type === "CODE_ACTION" || type === "WRITE_TO_FILE") && isPlanStep(step)) {
      const args = toolArgs(step);
      const spec = step?.codeAction?.actionSpec?.createFile;
      const targetFile = String(
        args.TargetFile || args.AbsolutePath || spec?.path?.absoluteUri || ""
      );
      const body = String(
        args.CodeContent ||
          spec?.instruction ||
          args?.ArtifactMetadata?.Summary ||
          step.content ||
          ""
      ).trim();
      const artifactUri = targetFile.startsWith("file://")
        ? targetFile
        : targetFile
        ? `file://${targetFile}`
        : "";
      const answered =
        (artifactUri && (
          answeredArtifacts.has(artifactUri) ||
          answeredArtifacts.has(baseName(artifactUri))
        )) ||
        (Array.isArray(step?.completedInteractions) &&
          step.completedInteractions.length > 0);
      if (body) {
        msgs.push({
          role: "plan",
          text: body,
          ts: stepTs,
          meta: { type, artifactUri, answered },
        });
        continue;
      }
    }

    if (type === "CODE_ACTION" && step?.codeAction?.isArtifactFile) {
      const spec = step?.codeAction?.actionSpec?.createFile;
      const uri = String(spec?.path?.absoluteUri ?? "");
      if (uri) {
        const name = baseName(uri);
        msgs.push({
          role: "artifact",
          text: name,
          ts: stepTs,
          meta: { type, artifactUri: uri },
        });
        continue;
      }
    }

    const info = toolInfo(step);
    if (info.verb) {
      const diff = diffStats(step);
      const editUri =
        type === "CODE_ACTION"
          ? String(
              step?.codeAction?.actionResult?.edit?.absoluteUri ||
                step?.codeAction?.actionSpec?.createFile?.path?.absoluteUri ||
                ""
            )
          : "";
      msgs.push({
        role: "tool",
        text: `${info.verb}${info.detail ? " " + info.detail : ""}`,
        kind: info.kind,
        detail: stepOut || info.detail,
        ts: stepTs,
        meta: {
          type,
          ...(durationMs != null ? { durationMs } : {}),
          ...(stepTok != null ? { tokens: stepTok } : {}),
          ...(stepOut ? { output: stepOut } : {}),
          ...(diff ? { added: diff.added, removed: diff.removed } : {}),
          ...(editUri ? { artifactUri: editUri } : {}),
        },
      });
    }
  }

  // Final deduplication pass: collapse consecutive error bubbles into a single clean message
  const finalMsgs: ChatMessage[] = [];
  for (const m of msgs) {
    const prev = finalMsgs[finalMsgs.length - 1];
    if (
      prev &&
      m.kind === "error" &&
      prev.kind === "error"
    ) {
      // If one has more details / text, keep the better one
      if ((!prev.text || prev.text.length < m.text.length) && m.text) {
        finalMsgs[finalMsgs.length - 1] = m;
      }
      continue;
    }
    finalMsgs.push(m);
  }

  return finalMsgs;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getBrainMediaFiles(cascadeId: string): string[] {
  if (!cascadeId) return [];
  const dir = path.join(os.homedir(), ".gemini", "antigravity-ide", "brain", cascadeId);
  if (!fs.existsSync(dir)) return [];
  try {
    const files = fs.readdirSync(dir);
    const mediaFiles = files
      .filter((f) => f.startsWith("media__") && (f.endsWith(".png") || f.endsWith(".jpg") || f.endsWith(".jpeg") || f.endsWith(".webp")))
      .sort()
      .reverse();
    const result: string[] = [];
    for (const f of mediaFiles) {
      const fullPath = path.join(dir, f);
      try {
        const buf = fs.readFileSync(fullPath);
        const ext = path.extname(f).toLowerCase();
        let mime = "image/png";
        if (ext === ".jpg" || ext === ".jpeg") mime = "image/jpeg";
        else if (ext === ".webp") mime = "image/webp";
        const base64 = buf.toString("base64");
        result.push(`data:${mime};base64,${base64}`);
      } catch {
        result.push(fullPath);
      }
    }
    return result;
  } catch {
    return [];
  }
}

// Parse a numeric value that the LS may return as a string (e.g. "50000").
function numOr(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? parseInt(v, 10) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

interface TodayStatsData {
  date: string;
  totalChats: number;
  totalTokens: number;
  totalDurationMs: number;
}

function getStatsFilePath(): string {
  const dir = path.join(os.homedir(), ".antigravity_cockpit");
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  }
  return path.join(dir, "today_stats.json");
}

function getTodayDateStr(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function loadTodayStats(): TodayStatsData {
  const filePath = getStatsFilePath();
  const todayStr = getTodayDateStr();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.date === todayStr) {
        return {
          date: todayStr,
          totalChats: Number(parsed.totalChats) || 0,
          totalTokens: Number(parsed.totalTokens) || 0,
          totalDurationMs: Number(parsed.totalDurationMs) || 0,
        };
      }
    }
  } catch {}
  return { date: todayStr, totalChats: 0, totalTokens: 0, totalDurationMs: 0 };
}

export function saveTodayStats(stats: TodayStatsData): void {
  const filePath = getStatsFilePath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(stats, null, 2), "utf-8");
  } catch {}
}

export function recordChatTurnDelta(chatsDelta: number, tokensDelta: number, durationDelta: number): TodayStatsData {
  const stats = loadTodayStats();
  if (chatsDelta > 0) stats.totalChats += chatsDelta;
  if (tokensDelta > 0) stats.totalTokens += tokensDelta;
  if (durationDelta > 0) stats.totalDurationMs += durationDelta;
  saveTodayStats(stats);
  return stats;
}

export function resetTodayStatsFile(): TodayStatsData {
  const stats = { date: getTodayDateStr(), totalChats: 0, totalTokens: 0, totalDurationMs: 0 };
  saveTodayStats(stats);
  return stats;
}

const trackedCascadeStats = new Map<string, {
  stepStats: Map<number, { tokens: number; duration: number }>;
  userChats: Set<number>;
}>();

function accumulateStatsFromSteps(cascadeId: string, steps: any[], onStatsUpdate?: (stats: TodayStatsData) => void): void {
  if (!cascadeId) return;

  let cascadeData = trackedCascadeStats.get(cascadeId);
  const isFirstLoad = !cascadeData;
  if (!cascadeData) {
    cascadeData = { stepStats: new Map(), userChats: new Set() };
    trackedCascadeStats.set(cascadeId, cascadeData);
  }

  let deltaTokens = 0;
  let deltaDuration = 0;
  let deltaChats = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const idx = i;

    const isUser = shortType(step.type) === "USER_INPUT";
    if (isUser) {
      if (!cascadeData.userChats.has(idx)) {
        cascadeData.userChats.add(idx);
        if (!isFirstLoad) deltaChats += 1;
      }
    }

    const t = stepTokenCount(step) || 0;
    const d = isUser ? 0 : (stepDurationMs(step) || 0);

    if (t > 0 || d > 0) {
       const prevStepStat = cascadeData.stepStats.get(idx) || { tokens: 0, duration: 0 };
       const dt = t - prevStepStat.tokens;
       const dd = d - prevStepStat.duration;
       
       if (!isFirstLoad) {
          if (dt > 0) deltaTokens += dt;
          if (dd > 0) deltaDuration += dd;
       }
       cascadeData.stepStats.set(idx, { tokens: t, duration: d });
    }
  }

  if (deltaChats > 0 || deltaTokens > 0 || deltaDuration > 0) {
    const newStats = recordChatTurnDelta(deltaChats, deltaTokens, deltaDuration);
    if (onStatsUpdate) onStatsUpdate(newStats);
  }
}
