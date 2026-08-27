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

  // Sticky selection: once the user picks a conversation or creates a new one,
  // the poller must NOT auto-jump back to whatever cascade happens to be RUNNING
  // (an older long-running chat). We only auto-resolve when nothing is chosen.
  private userSelected = false;
  // Pending "new chat": startNewConversation doesn't create a trajectory until
  // the first message is sent, so we show an empty transcript and suppress the
  // poller until a brand-new cascade id appears (or the user sends a message).
  private pendingNewChat = false;
  private knownIdsAtNewChat = new Set<string>();

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

  // Capture a screenshot of the IDE workbench window (PNG base64, no data-uri
  // prefix). Requires the CDP connection; returns null if unavailable.
  async captureScreenshot(): Promise<string | null> {
    if (!this.cdpConnected()) {
      // Try once to connect (the port may have appeared since startup).
      this.cdpReady = await this.cdp.connect(this.preferredDebugPort || undefined);
      if (!this.cdpConnected()) return null;
    }
    return this.cdp.captureScreenshot();
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
    const id = this.activeCascadeId || (await this.resolveActiveCascadeId());
    const model =
      this.selectedModelId || (await this.detectActiveModel()) || "MODEL_PLACEHOLDER_M16";

    let sent = false;

    const mediaItems = (images || []).map((b64) => {
      let mimeType = "image/png";
      let base64 = b64;
      const m = b64.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (m) {
        mimeType = m[1];
        base64 = m[2];
      }
      return { inlineData: { mimeType, data: base64 } };
    });

    // Prefer direct LS SendUserCascadeMessage with the explicitly chosen model
    if (id) {
      try {
        sent = await this.ls.sendUserCascadeMessage(id, text, mediaItems, model);
        if (sent) this.log(`[chat] sent via LS RPC (model: ${model})`);
        else this.log(`[chat] LS RPC send failed; trying CDP/commands`);
      } catch (e: any) {
        this.log(`[chat] LS send error: ${e?.message ?? e}`);
      }
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
      this.selectedModelId || (await this.detectActiveModel()) || "MODEL_PLACEHOLDER_M16";
    const ok = await this.ls.sendCascadeItems(id, items, [], model);
    if (!ok) {
      await this.sendMessage(fallbackText);
      return;
    }
    if (this.pendingNewChat) {
      await this.adoptNewCascadeIfPending();
    } else {
      this.lastStepSig = "";
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
    try {
      await vscode.commands.executeCommand(
        "workbench.action.smartFocusConversation",
        id
      );
    } catch {
      try {
        await vscode.commands.executeCommand(
          "workbench.action.forceFocusManager",
          id
        );
      } catch {
        /* ignore */
      }
    }
    this.activeCascadeId = id;
    this.lastStepSig = "";
    this.lastCdpSig = "";
    await this.pushFullState();
  }

  async cancel(): Promise<boolean> {
    const id = this.activeCascadeId || (await this.resolveActiveCascadeId());
    if (!id) return false;
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
    await delay(150);
    const model = this.selectedModelId || (await this.detectActiveModel()) || "MODEL_PLACEHOLDER_M36";
    const ok = await this.ls.revertToStep(id, stepIndex, model);
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
  // option ids (+ optional free text). We rebuild the full responses[] the LS
  // expects (echoing the questions/options) so the agent resumes.
  async answerQuestion(
    stepIndex: number,
    answers: { selectedOptionIds: string[]; freeText?: string }[]
  ): Promise<boolean> {
    const id = this.activeCascadeId || (await this.resolveActiveCascadeId());
    if (!id) return false;
    const data = await this.ls.getTrajectory(id);
    const trajectoryId = String(data?.trajectory?.trajectoryId ?? "");
    const steps = extractSteps(data) as any[];

    let step = steps.find(
      (s, idx) =>
        s?.metadata?.sourceTrajectoryStepInfo?.stepIndex === stepIndex ||
        s?.stepIndex === stepIndex ||
        s?.step_index === stepIndex ||
        idx === stepIndex
    );
    if (!step && steps.length > 0) step = steps[steps.length - 1];

    const realStepIndex =
      step?.metadata?.sourceTrajectoryStepInfo?.stepIndex ??
      step?.stepIndex ??
      step?.step_index ??
      stepIndex;

    const aq = step?.askQuestion ?? step?.requestedInteraction?.askQuestion ?? step?.askPermission;
    const questions: any[] = Array.isArray(aq?.questions) ? aq.questions : [];

    const responses = (questions.length > 0 ? questions : answers).map((q, i) => {
      const a = answers[i] ?? { selectedOptionIds: [] };
      const r: any = {
        question: typeof q === "string" ? q : (q?.question ?? ""),
        options: q?.options ?? [],
      };
      if (Array.isArray(a.selectedOptionIds) && a.selectedOptionIds.length > 0) {
        r.selectedOptionIds = a.selectedOptionIds;
      }
      if (a.freeText) {
        r.writeInResponse = a.freeText;
      }
      return r;
    });

    const ok = await this.ls.handleUserInteraction(id, trajectoryId, realStepIndex, responses);

    this.lastStepSig = "";
    await this.pushFullState();
    this.log(`[chat] answer question step ${stepIndex} (real: ${realStepIndex}) -> ${ok ? "ok" : "failed"}`);
    return ok;
  }

  // Skip an ask_question interaction (equivalent to the IDE's "skip" — send
  // empty selections so the agent proceeds with its recommendation).
  async skipQuestion(stepIndex: number): Promise<boolean> {
    const id = this.activeCascadeId || (await this.resolveActiveCascadeId());
    if (!id) return false;
    const data = await this.ls.getTrajectory(id);
    const trajectoryId = String(data?.trajectory?.trajectoryId ?? "");
    if (!trajectoryId) return false;
    const steps = extractSteps(data) as any[];
    const step = steps.find(
      (s) => s?.metadata?.sourceTrajectoryStepInfo?.stepIndex === stepIndex
    );
    const aq = step?.askQuestion ?? step?.requestedInteraction?.askQuestion;
    const questions: any[] = Array.isArray(aq?.questions) ? aq.questions : [];
    const responses = questions.map((q) => ({
      question: q?.question ?? "",
      options: q?.options ?? [],
      selectedOptionIds: [],
      skipped: true,
    }));
    const ok = await this.ls.handleUserInteraction(id, trajectoryId, stepIndex, responses);
    this.lastStepSig = "";
    await this.pushFullState();
    return ok;
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
      this.selectedModelId || (await this.detectActiveModel()) || "MODEL_PLACEHOLDER_M16";
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
      this.selectedModelId || (await this.detectActiveModel()) || "MODEL_PLACEHOLDER_M16";
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
    // Which model to mark selected: the user's explicit pick if any, otherwise
    // the model the active conversation is actually running (from the latest
    // planner step's requestedModel), otherwise the recommended default.
    const activeModel = await this.detectActiveModel();
    if (Array.isArray(configs) && configs.length > 0) {
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
          ? activeModel === mid || activeModel === alias || activeModel === label || activeModel === id
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
    const id = cascadeId || this.activeCascadeId || (await this.resolveActiveCascadeId());
    const data = id ? await this.ls.getTrajectory(id) : null;
    const steps = extractSteps(data);
    const generating = isGenerating(steps);
    const statusText = describeStatus(steps);
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
    const id = this.activeCascadeId || (await this.resolveActiveCascadeId());
    if (!id) return;
    const data = await this.ls.getTrajectory(id);
    if (!data) return;
    const steps = extractSteps(data);
    const messages = stepsToMessages(steps);
    const generating = isGenerating(steps);
    const statusText = describeStatus(steps);

    accumulateStatsFromSteps(id, steps, (s) => this.emit({ type: "stats_update", stats: s }));

    // Signature over the rendered messages so we only push on real changes
    // (message count + last message length catches streaming updates).
    const last = messages[messages.length - 1];
    const sig =
      `${generating}|${messages.length}|` +
      `${last ? `${last.role}:${last.text.length}` : ""}`;

    if (sig !== this.lastStepSig) {
      const oldSigParts = this.lastStepSig.split("|");
      const newSigParts = sig.split("|");
      
      if (
        this.lastStepSig &&
        oldSigParts[0] === newSigParts[0] &&
        oldSigParts[1] === newSigParts[1] &&
        last &&
        oldSigParts[2] &&
        last.role === oldSigParts[2].split(":")[0]
      ) {
        this.lastStepSig = sig;
        this.emit({ type: "state_update", cascadeId: id, generating, statusText, lastMessage: last });
      } else {
        this.lastStepSig = sig;
        this.emit({
          type: "state",
          state: { cascadeId: id, generating, statusText, messages },
        });
      }
    }
    if (generating !== this.lastGenerating || statusText !== this.lastStatusText) {
      const wasGenerating = this.lastGenerating;
      this.lastGenerating = generating;
      this.lastStatusText = statusText;
      this.emit({ type: "status", cascadeId: id, generating, statusText });

      // When the agent reply ends (transition from generating to not generating)
      if (wasGenerating && !generating) {
        this.getModels()
          .then((models) => {
            if (models && models.length > 0) this.emit({ type: "models", models });
          })
          .catch(() => {});
        this.getQuota()
          .then((quota) => {
            if (quota) this.emit({ type: "quota", quota });
          })
          .catch(() => {});
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
    default: {
      const summary = args.toolSummary || args.toolAction || "";
      return { kind: "tool", verb: summary ? String(summary) : titleCase(type), detail: "" };
    }
  }
}

function describeStatus(steps: TrajectoryStep[]): string {
  if (steps.length === 0) return "Idle";
  const last = steps[steps.length - 1] as any;
  const type = shortType(last.type);
  if (type === "PLANNER_RESPONSE") return "Thinking";
  const info = toolInfo(last);
  return info.detail ? `${info.verb} ${info.detail}` : info.verb;
}

// Is this CODE_ACTION step an implementation plan awaiting user approval?
function isPlanStep(step: any): boolean {
  const args = toolArgs(step);
  const meta = args?.ArtifactMetadata;
  return Boolean(meta && (meta.RequestFeedback || meta.UserFacing) &&
    /plan/i.test(String(meta.Summary || "")));
}

// Extract the output / stdout / error result or detailed execution args of a step.
function stepDetailText(step: any): string | undefined {
  const type = shortType(step?.type ?? "");
  const args = toolArgs(step);
  let rawContent = typeof step?.content === "string" ? step.content.trim() : "";
  if (rawContent.length > 25000) {
    rawContent = rawContent.slice(0, 10000) + "\n\n...[TRUNCATED_BY_ANTIGRAVITY_REMOTE]...\n\n" + rawContent.slice(-10000);
  }

  if (type === "RUN_COMMAND") {
    const cmd = args.CommandLine || "";
    let text = cmd ? `$ ${cmd}` : "";
    if (rawContent) {
      text += text ? `\n\n${rawContent}` : rawContent;
    }
    return text || undefined;
  }

  if (type === "CODE_ACTION" || type === "REPLACE_FILE_CONTENT" || type === "MULTI_REPLACE_FILE_CONTENT") {
    const desc = args.Description || args.Instruction || "";
    let target = args.TargetContent || "";
    let replacement = args.ReplacementContent || "";
    if (target.length > 5000) target = target.slice(0, 5000) + "\n...[TRUNCATED]";
    if (replacement.length > 5000) replacement = replacement.slice(0, 5000) + "\n...[TRUNCATED]";
    
    let text = desc ? `Description: ${desc}` : "";
    if (target || replacement) {
      if (text) text += "\n\n";
      if (target) text += `--- Target:\n${target}\n`;
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
    let text = `File: ${file}` + (start != null ? ` (lines ${start}-${end})` : "");
    if (rawContent) text += `\n\n${rawContent}`;
    return text;
  }

  if (rawContent) return rawContent;
  const desc = args.Description || args.Instruction || args.toolSummary || args.toolAction;
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

// Convert raw CORTEX trajectory steps into a clean transcript.
function stepsToMessages(steps: TrajectoryStep[], cascadeId?: string): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  const answeredArtifacts = new Set<string>();

  for (const step of steps as any[]) {
    const comments =
      step?.userInput?.artifactComments ??
      step?.artifactComments ??
      null;
    if (Array.isArray(comments)) {
      for (const c of comments) {
        const uri = String(c?.artifactUri ?? "");
        if (uri && c?.approvalStatus) answeredArtifacts.add(uri);
      }
    }
  }

  let turnTokens = 0;
  let turnDurationMs = 0;

  for (const step of steps as any[]) {
    const type = shortType(step.type);
    const durationMs = stepDurationMs(step);
    const stepTok = stepTokenCount(step);
    const stepOut = stepDetailText(step);

    if (durationMs != null && durationMs > 0) turnDurationMs += durationMs;
    if (stepTok != null && stepTok > 0) turnTokens += stepTok;

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

      const stepIndex = step.metadata?.sourceTrajectoryStepInfo?.stepIndex;
      if (t)
        msgs.push({
          role: "user",
          text: t,
          stepIndex: typeof stepIndex === "number" ? stepIndex : undefined,
        });
      continue;
    }

    if (type === "PLANNER_RESPONSE") {
      const resp = String(step.plannerResponse?.response ?? "").trim();
      if (resp) {
        msgs.push({
          role: "assistant",
          text: resp,
          meta: {
            type,
            tokens: stepTok ?? undefined,
            turnTokens: turnTokens > 0 ? turnTokens : undefined,
            turnDurationMs: turnDurationMs > 0 ? turnDurationMs : undefined,
          },
        });
      }
      const calls = step.plannerResponse?.toolCalls;
      if (Array.isArray(calls)) {
        for (const tc of calls) {
          const toolName = String(tc?.name || "").toLowerCase();
          if (toolName === "ask_permission" || toolName === "ask_question") {
            try {
              const args = typeof tc?.argumentsJson === "string" ? JSON.parse(tc.argumentsJson) : (tc?.args || {});
              const targetPath = args.Target || args.path || args.target || args.AbsolutePath || "";
              const actionType = args.Action || args.action || "read access";
              const questions = [{
                question: args.question || args.Reason || `Allow ${actionType} to this path?`,
                description: targetPath,
                options: Array.isArray(args.options)
                  ? args.options.map((o: any, idx: number) => typeof o === "string" ? { id: String(idx + 1), text: o } : o)
                  : [
                      { id: "1", text: "Yes, allow this time" },
                      { id: "2", text: "Yes, and always allow" },
                      { id: "3", text: "No (tell the agent what to do instead)" }
                    ]
              }];
              const stepIndex = step.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? step.stepIndex ?? step.step_index;
              msgs.push({
                role: "ask",
                text: questions.map((q: any) => String(q?.question ?? "")).join("\n"),
                stepIndex: typeof stepIndex === "number" ? stepIndex : undefined,
                meta: {
                  type: "ASK_PERMISSION",
                  questions,
                  answered: false,
                  selected: [],
                },
              });
              continue;
            } catch {}
          }

          const fakeStep = {
            type: `CORTEX_STEP_TYPE_${String(tc?.name || "").toUpperCase()}`,
            plannerResponse: { toolCalls: [tc] },
          };
          const info = toolInfo(fakeStep);
          const callOut = stepDetailText(fakeStep) || JSON.stringify(tc?.argumentsJson ? JSON.parse(tc.argumentsJson) : {}, null, 2);
          msgs.push({
            role: "tool",
            text: `${info.verb}${info.detail ? " " + info.detail : ""}`,
            kind: info.kind,
            detail: info.detail,
            meta: {
              type,
              output: callOut,
              ...(stepTok != null ? { tokens: stepTok } : {}),
            },
          });
        }
      }
      continue;
    }

    if (type === "SYSTEM_MESSAGE" || type === "ERROR_MESSAGE") {
      const t = String(
        step.systemMessage?.message ??
          step.systemMessage?.renderInfo?.title ??
          ""
      ).trim();
      if (t) msgs.push({ role: "system", text: t, kind: type === "ERROR_MESSAGE" ? "error" : "system", meta: { type } });
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
      const ri = step.requestedInteraction || step.permissionRequest || step.requestedPermission || step.toolPermissionRequest || {};
      const aq = step.askQuestion || ri.askQuestion || step.askPermission || ri.askPermission || step.permissionRequest || step.requestedPermission || step.toolPermissionRequest || ri.toolPermissionRequest || ri.permissionRequest || ri;

      // Deep scan step object recursively for any target / path / file / resource string
      let targetPath = "";
      const scanObj = (o: any, depth = 0) => {
        if (!o || typeof o !== "object" || depth > 5) return;
        if (!targetPath) {
          const found = o.targetPath || o.target || o.path || o.resource || o.file || o.filePath || o.Target || o.TargetFile || o.Path || o.Resource || o.uri || "";
          if (found && typeof found === "string" && found.length > 1) {
            targetPath = found;
            return;
          }
        }
        for (const k of Object.keys(o)) {
          if (o[k] && typeof o[k] === "object" && k !== "options" && k !== "questions" && k !== "plannerResponse") {
            scanObj(o[k], depth + 1);
            if (targetPath) return;
          }
        }
      };
      scanObj(step);

      let actionType = ri.permissionType || ri.action || aq.action || aq.permissionType || "read access";
      let reasonText = aq.reason || aq.question || aq.title || ri.reason || "";

      // Deduplicate: If an ask card with generic reason and no targetPath comes right after another ask card, skip duplicate!
      if (!targetPath && (!reasonText || reasonText.toLowerCase().includes("allow read access")) && lastMsg && lastMsg.role === "ask") {
        continue;
      }

      if (!reasonText) {
        reasonText = targetPath ? `Cấp quyền truy cập cho tệp tin / thư mục:` : `Allow ${actionType} to this path?`;
      }

      let questions: any[] = [];
      if (Array.isArray(aq?.questions) && aq.questions.length > 0) {
        questions = aq.questions.map((q: any) => ({
          ...q,
          description: q.description || q.targetPath || q.target || q.path || targetPath
        }));
      } else {
        questions = [{
          question: reasonText,
          description: targetPath,
          options: [
            { id: "1", text: "Yes, allow this time" },
            { id: "2", text: "Yes, and always allow" },
            { id: "3", text: "No (tell the agent what to do instead)" }
          ]
        }];
      }

      if (questions.length === 0 && step.plannerResponse?.toolCalls) {
        for (const tc of step.plannerResponse.toolCalls) {
          if (tc.name === "ask_permission" || tc.name === "ask_question") {
            try {
              const args = tc.argumentsJson ? JSON.parse(tc.argumentsJson) : (tc.args || {});
              const targetPath = args.Target || args.path || args.target || "";
              const actionType = args.Action || args.action || "read access";
              questions = [{
                question: args.question || args.Reason || `Allow ${actionType} to this path?`,
                description: targetPath,
                options: Array.isArray(args.options)
                  ? args.options.map((o: any, idx: number) => typeof o === "string" ? { id: String(idx + 1), text: o } : o)
                  : [
                      { id: "1", text: "Yes, allow this time" },
                      { id: "2", text: "Yes, and always allow" },
                      { id: "3", text: "No (tell the agent what to do instead)" }
                    ]
              }];
            } catch {}
          }
        }
      }

      if (questions.length > 0) {
        const answered =
          Array.isArray(step.completedInteractions) && step.completedInteractions.length > 0
            ? true
            : questions.some(
                (q: any) =>
                  q?.skipped === true ||
                  (Array.isArray(q?.selectedOptionIds) && q.selectedOptionIds.length > 0)
              );
        const stepIndex = step.metadata?.sourceTrajectoryStepInfo?.stepIndex ?? step.stepIndex ?? step.step_index;
        const selected: string[] = [];
        for (const q of questions) {
          if (Array.isArray(q?.selectedOptionIds)) selected.push(...q.selectedOptionIds);
        }
        msgs.push({
          role: "ask",
          text: questions.map((q: any) => String(q?.question ?? "")).join("\n"),
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

    if (type === "CODE_ACTION" && isPlanStep(step)) {
      const args = toolArgs(step);
      const spec = step?.codeAction?.actionSpec?.createFile;
      const body = String(
        spec?.instruction || args.CodeContent || args?.ArtifactMetadata?.Summary || ""
      ).trim();
      const artifactUri = String(spec?.path?.absoluteUri ?? "");
      const answered =
        (artifactUri && answeredArtifacts.has(artifactUri)) ||
        (Array.isArray(step?.completedInteractions) &&
          step.completedInteractions.length > 0);
      if (body) {
        msgs.push({
          role: "plan",
          text: body,
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
  return msgs;
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
