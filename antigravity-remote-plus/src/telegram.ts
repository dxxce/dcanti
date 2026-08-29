// Telegram bridge: mirrors the web UI's core actions into a Telegram bot.
//
// Uses the Bot API directly over HTTPS long-polling (getUpdates) so we need no
// external dependency. Only the configured chat id is allowed to control the
// IDE. While the AI is generating we keep ONE status message and edit it
// (Sent → Thinking → done); the final answer is delivered as separate
// message(s), split when it exceeds Telegram's length limit.

import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import { ChatController, ChatEvent } from "./chatController";
import { FileController } from "./fileController";
import { GitController } from "./gitController";

export interface TelegramOptions {
  token: string;
  chatId: string; // allowed chat id; empty => first chat that /start's becomes owner
  notifyOnComplete?: boolean;
  log: (m: string) => void;
}

interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    caption?: string;
    document?: { file_id: string; file_name?: string; mime_type?: string };
    photo?: Array<{ file_id: string }>;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id: number };
  };
}

// Telegram hard-caps a text message at 4096 chars; stay under it with margin.
const TG_LIMIT = 3900;

function api(
  token: string,
  method: string,
  body: unknown
): Promise<any> {
  const payload = JSON.stringify(body ?? {});
  return new Promise((resolve) => {
    const req = https.request(
      {
        host: "api.telegram.org",
        path: `/bot${token}/${method}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 65000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c.toString()));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
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

const HELP = [
  "*Antigravity Remote Plus*",
  "",
  "Send any text to chat with the AI.",
  "Send a photo/file to attach it to the workspace.",
  "",
  "/new — new chat",
  "/history — list conversations",
  "/cancel — stop generation",
  "/revert — undo last change",
  "/quota — model quota",
  "/models — list models",
  "/screenshot — capture IDE screen",
  "/file <path> — send a workspace file (images shown as photo)",
  "/status — git status",
  "/commit <msg> — stage all + commit",
  "/push — git push",
  "/pull — git pull",
  "/help — this help",
].join("\n");

// Split a long string into Telegram-sized chunks, preferring to break on
// newlines so we don't cut mid-line where possible.
function splitChunks(text: string, limit = TG_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = limit; // no good newline — hard cut
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) chunks.push(rest);
  return chunks;
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

export class TelegramBridge {
  private opts: TelegramOptions;
  private chat: ChatController;
  private offset = 0;
  private running = false;
  private ownerChatId: string;
  private statusMsgId: number | null = null;
  private lastStatusText = "";
  // Text of every assistant message we've already forwarded to Telegram.
  // Using a Set (keyed by first 200 chars) prevents re-delivery across polls
  // while still catching genuinely new messages even if they appear at a
  // non-last position in the messages array.
  private deliveredAssistantTexts = new Set<string>();
  private unsub: (() => void) | null = null;
  // A "turn" is active from when the user sends a message until the agent's
  // answer is delivered. We only manage the single status message during a turn
  // — idle status events (e.g. the poller settling) must NOT spawn "AI: xong".
  private turnActive = false;
  // Each call to beginTurn() increments this counter. Async status/finishTurn
  // callbacks capture the counter at dispatch time and bail out early if a
  // newer turn has already started — this prevents the race condition where
  // status events from turn N edit the status message created for turn N+1.
  private turnId = 0;
  // The cascade we're currently mirroring. When it changes (user switched or
  // the bridge (re)started), we seed our "seen" markers from the loaded
  // transcript WITHOUT re-sending it — that's what caused old messages to be
  // resent on reconnect/switch.
  private currentCascade = "";
  // Artifact URIs we've already offered a view-button for, so we don't repeat.
  private deliveredArtifacts = new Set<string>();
  // Step indices of ask_question cards we've already presented to Telegram.
  private deliveredQuestions = new Set<string>();
  // Map of short keys (e.g. u_1) -> full file URIs to stay under Telegram's 64-byte callback_data cap.
  private uriMap = new Map<string, string>();
  private notifyOnComplete = true;
  private externalGenerating = false;

  private encodeUriKey(uri: string): string {
    if (!uri) return "";
    for (const [k, v] of this.uriMap.entries()) {
      if (v === uri) return k;
    }
    const key = `u_${this.uriMap.size + 1}`;
    this.uriMap.set(key, uri);
    return key;
  }

  private resolveUriKey(key: string): string {
    return this.uriMap.get(key) || key;
  }

  constructor(opts: TelegramOptions, chat: ChatController) {
    this.opts = opts;
    this.chat = chat;
    this.ownerChatId = opts.chatId?.trim() ?? "";
    this.notifyOnComplete = opts.notifyOnComplete !== false;
  }

  setNotifyOnComplete(enabled: boolean) {
    this.notifyOnComplete = enabled;
  }

  async start() {
    if (this.running) return;
    if (!this.opts.token) {
      this.opts.log("[telegram] no token configured; not starting");
      return;
    }
    this.running = true;
    this.opts.log("[telegram] starting long-poll");
    // Drop any backlog of updates that queued while the bot was offline so we
    // don't replay old commands on (re)start.
    await this.drainBacklog();
    // Push AI responses / status to the owner chat.
    this.unsub = this.chat.onEvent((e) => this.onChatEvent(e));
    this.loop().catch((err) =>
      this.opts.log(`[telegram] loop error: ${err?.message ?? err}`)
    );
    // Confirm the bot token works, then greet the owner so they know it's live.
    if (this.ownerChatId) {
      const me = await api(this.opts.token, "getMe", {});
      const uname = me?.result?.username ? `@${me.result.username}` : "bot";
      await this.send(
        this.ownerChatId,
        `*Antigravity Remote Plus* đã kết nối (${uname}).\nGửi tin nhắn để chat với AI, hoặc /help để xem lệnh.`,
        "Markdown"
      );
    }
  }

  stop() {
    this.running = false;
    this.unsub?.();
    this.unsub = null;
  }

  // Fast-forward past any updates that queued while offline (getUpdates with a
  // large offset after reading the current backlog) so a restart doesn't replay
  // stale messages/commands.
  private async drainBacklog() {
    const res = await api(this.opts.token, "getUpdates", { timeout: 0, offset: -1 });
    if (res?.ok && Array.isArray(res.result) && res.result.length) {
      this.offset = res.result[res.result.length - 1].update_id + 1;
    }
  }

  private allowed(chatId: string | number): boolean {
    const id = String(chatId);
    if (!this.ownerChatId) {
      // First chat to talk becomes owner.
      this.ownerChatId = id;
      return true;
    }
    return id === this.ownerChatId;
  }

  private async loop() {
    while (this.running) {
      const res = await api(this.opts.token, "getUpdates", {
        offset: this.offset,
        timeout: 50,
        allowed_updates: ["message", "callback_query"],
      });
      if (!res || !res.ok) {
        await delay(2000);
        continue;
      }
      for (const u of res.result as TgUpdate[]) {
        this.offset = u.update_id + 1;
        try {
          await this.handleUpdate(u);
        } catch (err: any) {
          this.opts.log(`[telegram] handle error: ${err?.message ?? err}`);
        }
      }
    }
  }

  private async handleUpdate(u: TgUpdate) {
    if (u.callback_query) {
      const cq = u.callback_query;
      const chatId = cq.message?.chat.id;
      if (chatId === undefined || !this.allowed(chatId)) return;
      await api(this.opts.token, "answerCallbackQuery", {
        callback_query_id: cq.id,
      });
      const data = cq.data ?? "";
      if (data.startsWith("switch:")) {
        await this.chat.switchCascade(data.slice(7));
        await this.send(String(chatId), "Switched conversation.");
      } else if (data.startsWith("model:")) {
        const ok = await this.chat.selectModel(data.slice(6));
        await this.send(String(chatId), ok ? "Model selected." : "Could not switch model.");
      } else if (data.startsWith("view:")) {
        // View an artifact file (plan/walkthrough/task) — send its contents.
        const key = data.slice(5);
        const fullUri = this.resolveUriKey(key);
        await this.sendFile(String(chatId), fullUri);
      } else if (data.startsWith("plan:")) {
        // plan:<approve|reject>:<key>
        const rest = data.slice(5);
        const sep = rest.indexOf(":");
        const verdict = rest.slice(0, sep);
        const key = rest.slice(sep + 1);
        const fullUri = this.resolveUriKey(key);
        await this.beginTurn();
        const ok = await this.chat.approvePlan(fullUri, verdict === "approve");
        if (ok) {
          await this.updateStatus(
            String(chatId),
            verdict === "approve"
              ? "[OK] Đã đồng ý kế hoạch. AI đang tiến hành thực thi…"
              : "[Từ chối] Đã từ chối kế hoạch.",
          );
        } else {
          await this.send(String(chatId), "Không gửi được phản hồi kế hoạch.");
        }
      } else if (data.startsWith("ask:")) {
        // ask:<stepIndex>:<qIndex>:<optId>
        const parts = data.split(":");
        const stepIdx = parseInt(parts[1], 10);
        const qIdx = parseInt(parts[2], 10);
        const optId = parts[3];
        if (!isNaN(stepIdx) && optId) {
          await this.beginTurn();
          const ok = await this.chat.answerQuestion(stepIdx, [
            { selectedOptionIds: [optId] },
          ]);
          if (ok) {
            await this.updateStatus(String(chatId), "[Gửi] Đã gửi lựa chọn cho AI. Đang xử lý…");
          } else {
            await this.send(String(chatId), "[Lỗi] Không gửi được lựa chọn.");
          }
        }
      } else if (data.startsWith("ask_skip:")) {
        const stepIdx = parseInt(data.slice(9), 10);
        if (!isNaN(stepIdx)) {
          await this.beginTurn();
          const ok = await this.chat.skipQuestion(stepIdx);
          if (ok) {
            await this.updateStatus(String(chatId), "[OK] Đã bỏ qua câu hỏi. Đang xử lý…");
          } else {
            await this.send(String(chatId), "[Lỗi] Không bỏ qua được câu hỏi.");
          }
        }
      }
      return;
    }

    const msg = u.message;
    if (!msg) return;
    const chatId = msg.chat.id;
    if (!this.allowed(chatId)) {
      await this.send(String(chatId), "Not authorized.");
      return;
    }
    const chatIdStr = String(chatId);

    // Files / photos -> save into workspace uploads.
    if (msg.document || msg.photo) {
      await this.handleIncomingFile(msg, chatIdStr);
      return;
    }

    const text = (msg.text ?? "").trim();
    if (!text) return;

    if (text.startsWith("/")) {
      await this.handleCommand(text, chatIdStr);
      return;
    }

    // Plain text -> send to AI. Begin a turn: create ONE fresh status message
    // that we then edit in place (Đã gửi → Thinking → xong).
    await this.beginTurn();
    await this.chat.sendMessage(text);
    await this.updateStatus(chatIdStr, "[Gửi] Đã gửi cho AI. Đang xử lý…");
  }

  private async handleCommand(text: string, chatId: string) {
    const [cmd, ...rest] = text.split(/\s+/);
    const arg = rest.join(" ").trim();
    switch (cmd.toLowerCase()) {
      case "/start":
      case "/help":
        await this.send(chatId, HELP, "Markdown");
        break;
      case "/new":
        await this.chat.newChat();
        await this.send(chatId, "Started a new chat.");
        break;
      case "/cancel":
        await this.chat.cancel();
        await this.send(chatId, "Cancelled.");
        break;
      case "/revert": {
        const ok = await this.chat.revertLatest();
        await this.send(
          chatId,
          ok ? "Reverted to the last checkpoint." : "Nothing to revert."
        );
        break;
      }
      case "/screenshot":
      case "/cap": {
        await this.updateStatus(chatId, "[Chụp ảnh] Đang chụp màn hình IDE…");
        const b64 = await this.chat.captureScreenshot();
        if (b64) {
          const buf = Buffer.from(b64, "base64");
          await this.sendPhoto(chatId, buf, `ide_screenshot_${Date.now()}.png`);
        } else {
          await this.send(chatId, "[Lỗi] Không thể chụp màn hình IDE (CDP chưa kết nối).");
        }
        break;
      }
      case "/file": {
        if (!arg) {
          await this.send(chatId, "Usage: /file <workspace-relative-or-absolute path>");
          break;
        }
        await this.sendFile(chatId, arg);
        break;
      }
      case "/quota": {
        const q = await this.chat.getQuota();
        await this.send(chatId, "```\n" + JSON.stringify(q?.usage ?? q ?? {}, null, 2).slice(0, 3500) + "\n```", "Markdown");
        break;
      }
      case "/models": {
        const models = await this.chat.getModels();
        if (!models.length) {
          await this.send(chatId, "No models reported.");
          break;
        }
        await api(this.opts.token, "sendMessage", {
          chat_id: chatId,
          text: "Choose a model:",
          reply_markup: {
            inline_keyboard: models.map((m) => [
              { text: (m.selected ? "* " : "") + m.label, callback_data: `model:${m.id}` },
            ]),
          },
        });
        break;
      }
      case "/history": {
        const list = await this.chat.getTrajectories();
        if (!list.length) {
          await this.send(chatId, "No conversations found.");
          break;
        }
        const recent = list.slice(0, 10);
        await api(this.opts.token, "sendMessage", {
          chat_id: chatId,
          text: "Recent conversations:",
          reply_markup: {
            inline_keyboard: recent.map((t) => [
              {
                text: (t.title ?? t.id).slice(0, 50),
                callback_data: `switch:${t.id}`,
              },
            ]),
          },
        });
        break;
      }
      case "/status": {
        const st = await GitController.status();
        const lines = [
          `Branch: ${st.branch} (ahead ${st.ahead}, behind ${st.behind})`,
          ...st.files.slice(0, 40).map((f) => `${f.index}${f.work} ${f.path}`),
        ];
        await this.send(chatId, "```\n" + lines.join("\n").slice(0, 3500) + "\n```", "Markdown");
        break;
      }
      case "/commit": {
        if (!arg) {
          await this.send(chatId, "Usage: /commit <message>");
          break;
        }
        await GitController.stageAll();
        const r = await GitController.commit(arg);
        await this.send(chatId, r.message.slice(0, 3500) || (r.ok ? "Committed." : "Commit failed."));
        break;
      }
      case "/push": {
        const r = await GitController.push();
        await this.send(chatId, r.message.slice(0, 3500) || (r.ok ? "Pushed." : "Push failed."));
        break;
      }
      case "/pull": {
        const r = await GitController.pull();
        await this.send(chatId, r.message.slice(0, 3500) || (r.ok ? "Pulled." : "Pull failed."));
        break;
      }
      default:
        await this.send(chatId, "Unknown command. /help for options.");
    }
  }

  // Send a workspace or brain artifact file to the chat. Images go as a photo;
  // text files send inline formatted HTML; larger files send as a document.
  private async sendFile(chatId: string, rawPath: string) {
    const filePath = rawPath.replace(/^file:\/\//, "");
    let data: Buffer | null = null;

    // 1. Absolute paths directly on disk (e.g. brain artifact files outside workspace root)
    if (path.isAbsolute(filePath) && fs.existsSync(filePath)) {
      try {
        data = fs.readFileSync(filePath);
      } catch {
        data = null;
      }
    }
    // 2. Fall back to FileController for workspace-relative paths
    if (!data) {
      data = FileController.readBinary(filePath);
    }

    if (!data) {
      await this.send(chatId, `[Lỗi] Không đọc được tệp: ${rawPath}`);
      return;
    }
    const name = filePath.split(/[\\/]/).pop() || "file";
    if (IMAGE_EXT.test(name)) {
      await this.sendPhoto(chatId, data, name);
    } else if (data.length < 3800 && /\.(md|txt|json|ya?ml|js|ts|py|sh|css|html?)$/i.test(name)) {
      const content = data.toString("utf8").slice(0, 3800);
      await api(this.opts.token, "sendMessage", {
        chat_id: chatId,
        text: `[File] <b>${name}</b>\n\n${mdToTgHtml(content)}`,
        parse_mode: "HTML",
      });
    } else {
      await this.sendDocument(chatId, data, name);
    }
  }

  private async handleIncomingFile(
    msg: NonNullable<TgUpdate["message"]>,
    chatId: string
  ) {
    const isPhoto = Boolean(msg.photo && msg.photo.length);
    const fileId = msg.document?.file_id ?? msg.photo?.[msg.photo.length - 1]?.file_id;
    const name = msg.document?.file_name ?? `photo_${Date.now()}.jpg`;
    if (!fileId) return;
    const info = await api(this.opts.token, "getFile", { file_id: fileId });
    const filePath = info?.result?.file_path;
    if (!filePath) {
      await this.send(chatId, "[Lỗi] Could not fetch file.");
      return;
    }
    const data = await this.download(
      `https://api.telegram.org/file/bot${this.opts.token}/${filePath}`
    );
    if (!data) {
      await this.send(chatId, "[Lỗi] Download failed.");
      return;
    }
    // Images (a Telegram photo, or a document with an image mime/extension) are
    // sent to the AI as real attachments — exactly like the web chat — so the
    // agent actually sees the picture. The optional caption becomes the prompt.
    const mime =
      msg.document?.mime_type ||
      (IMAGE_EXT.test(name) ? `image/${(name.split(".").pop() || "png").toLowerCase().replace("jpg", "jpeg")}` : "");
    const isImage = isPhoto || (mime.startsWith("image/") ?? false) || IMAGE_EXT.test(name);
    if (isImage) {
      const caption = (msg.caption ?? "").trim();
      await this.beginTurn();
      await this.chat.sendWithMedia(caption, [
        {
          base64: data.toString("base64"),
          mimeType: mime || "image/jpeg",
          name,
        },
      ]);
      await this.updateStatus(chatId, "[Gửi] Đã gửi ảnh cho AI. Đang xử lý…");
      return;
    }
    // Non-image files are saved into the workspace as before.
    const r = FileController.saveUpload(name, data);
    if ("path" in r) {
      await this.send(chatId, `[OK] Saved to workspace: ${r.path}`);
    } else {
      await this.send(chatId, `[Lỗi] Save failed: ${r.error}`);
    }
  }

  private download(url: string): Promise<Buffer | null> {
    return new Promise((resolve) => {
      https
        .get(url, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c as Buffer));
          res.on("end", () => resolve(Buffer.concat(chunks)));
        })
        .on("error", () => resolve(null));
    });
  }

  // Begin a turn when the user sends a message: force a FRESH status message on
  // the next update (so we never edit a previous turn's message) and mark the
  // turn active so status events are mirrored. Incrementing turnId ensures that
  // any in-flight async callbacks from the previous turn will see a mismatched
  // id and abort rather than editing this turn's status message.
  private async beginTurn() {
    this.turnId++;
    this.turnActive = true;
    this.statusMsgId = null;
    this.lastStatusText = "";
    // Snapshot all current assistant messages, artifacts, and questions from the
    // existing state into the delivered sets so past messages are NEVER re-delivered.
    // Only newly generated messages during this turn will be pushed to Telegram.
    const state = await this.chat.getState().catch(() => null);
    const currentMsgs = state?.messages ?? [];
    for (const m of currentMsgs) {
      if (m.role === "assistant" && m.text) {
        this.deliveredAssistantTexts.add(assistantKey(m.text));
      }
      if ((m.role === "artifact" || m.role === "plan") && m.meta?.artifactUri) {
        this.deliveredArtifacts.add(String(m.meta.artifactUri));
      }
      if (m.role === "ask") {
        this.deliveredQuestions.add(`ask_${m.stepIndex ?? m.text}`);
      }
    }
    this.opts.log(
      `[tg] beginTurn id=${this.turnId}, seeded deliveredAssistants=${this.deliveredAssistantTexts.size}`
    );
  }

  private async handleExternalCompletion() {
    if (!this.notifyOnComplete || !this.ownerChatId) return;
    try {
      const state = await this.chat.getState();
      const assistant = state.messages.filter((m) => m.role === "assistant" && m.text);
      if (assistant.length === 0) return;
      const lastMsg = assistant[assistant.length - 1];
      const key = assistantKey(lastMsg.text);
      if (this.deliveredAssistantTexts.has(key)) return;
      this.deliveredAssistantTexts.add(key);

      this.opts.log(`[tg] notify on complete -> delivering finished reply (${lastMsg.text.length} chars) to ${this.ownerChatId}`);
      await this.deliverText(
        this.ownerChatId,
        `🔔 **Agent đã trả lời xong:**\n\n${lastMsg.text}`
      );
    } catch (err: any) {
      this.opts.log(`[tg] notify on complete error: ${err?.message ?? err}`);
    }
  }

  private onChatEvent(e: ChatEvent) {
    if (!this.ownerChatId) return;
    // Capture the current turn id at the moment this event fires so that any
    // async work we spawn (updateStatus / finishTurn) can bail out early if a
    // newer turn has already been started by the time they actually run.
    const myTurnId = this.turnId;
    if (e.type === "state") {
      // When the mirrored conversation changes (user switched, or bridge
      // (re)started and loaded a transcript), seed our "seen" markers from the
      // current state WITHOUT sending anything — this prevents re-delivering the
      // old conversation's messages.
      if (e.state.cascadeId !== this.currentCascade) {
        this.opts.log(
          `[tg] cascade switch: ${this.currentCascade || '(none)'} -> ${e.state.cascadeId || '(empty)'} turnActive=${this.turnActive}`
        );
        this.currentCascade = e.state.cascadeId;
        const assistant = e.state.messages.filter((m) => m.role === "assistant");
        // Seed lastPushedAssistant so old messages aren't re-delivered.
        // IMPORTANT: only reset lastPushedAssistant when NOT in an active turn.
        // If a turn is active, the cascade switch is just the chat controller
        // resolving the real cascade id (e.g. after the first message is sent),
        // and we must NOT overwrite lastPushedAssistant or kill the active turn.
        if (!this.turnActive) {
          this.deliveredAssistantTexts = new Set(
            assistant.map((m) => assistantKey(m.text))
          );
          this.deliveredArtifacts = new Set(
            e.state.messages
              .filter((m) => m.role === "artifact" || m.role === "plan")
              .map((m) => String(m.meta?.artifactUri ?? ""))
              .filter(Boolean)
          );
          this.deliveredQuestions = new Set();
          this.statusMsgId = null;
          this.externalGenerating = Boolean(e.state.generating);
          return;
        }
      }

      // If turn was started from Telegram:
      if (this.turnActive) {
        this.opts.log(
          `[tg] state event: cascade=${e.state.cascadeId.slice(0,8)} generating=${e.state.generating} msgs=${e.state.messages.length} delivered=${this.deliveredAssistantTexts.size}`
        );

        // Deliver any new assistant messages immediately as soon as they appear,
        // without waiting for generating to flip false.
        const assistant = e.state.messages.filter((m) => m.role === "assistant");
        const newMsgs: any[] = [];
        for (const m of assistant) {
          if (!m.text) continue;
          const key = assistantKey(m.text);
          if (!this.deliveredAssistantTexts.has(key)) {
            this.deliveredAssistantTexts.add(key);
            newMsgs.push(m);
          }
        }
        if (newMsgs.length > 0) {
          this.opts.log(
            `[tg] delivering ${newMsgs.length} new assistant message(s) (generating=${e.state.generating})` +
              (newMsgs[0] ? ` first="${newMsgs[0].text.slice(0, 60)}"` : "")
          );
          for (const msg of newMsgs) {
            void this.finishTurn(this.ownerChatId, msg.text, e.state.messages, myTurnId);
          }
        }

        // Always deliver interactive elements (artifacts, plans, ask questions)
        void this.deliverInteractiveElements(this.ownerChatId, e.state.messages);
        return;
      }

      // If turn was started externally (from Web UI or IDE) and notifyOnComplete is enabled:
      const isGenerating = Boolean(e.state.generating);
      if (this.externalGenerating && !isGenerating) {
        this.externalGenerating = false;
        void this.handleExternalCompletion();
      } else {
        this.externalGenerating = isGenerating;
      }
    } else if (e.type === "status") {
      // Mirror progress ONLY during an active turn, all in the one status
      // message (edited in place).
      if (this.turnActive) {
        if (e.generating) {
          this.opts.log(`[tg] status: ${e.statusText}`);
          void this.updateStatus(
            this.ownerChatId,
            `[AI] ${e.statusText || "đang xử lý…"}`,
            myTurnId
          );
        }
      } else {
        const isGenerating = Boolean(e.generating);
        if (this.externalGenerating && !isGenerating) {
          this.externalGenerating = false;
          void this.handleExternalCompletion();
        } else {
          this.externalGenerating = isGenerating;
        }
      }
    }
  }

  // Deliver an assistant answer from the current turn. Multi-step agents
  // (plan → tool calls → final reply) can produce multiple assistant messages
  // within one turn. We deliver each new one as it appears and keep the turn
  // active so subsequent answers are not missed. The turn only truly ends when
  // the user sends a new message (beginTurn) or the cascade switches.
  //
  // `turnId` is captured at event-dispatch time. If a newer turn has already
  // started, we skip the status-message edit but still deliver the text.
  private async finishTurn(chatId: string, answer: string, messages: any[], turnId: number) {
    this.opts.log(`[tg] finishTurn: answer="${answer.slice(0, 80)}" isCurrent=${turnId === this.turnId}`);

    const isCurrent = turnId === this.turnId;
    if (isCurrent) {
      // Update the status chip to "xong" for this answer. We do NOT kill
      // turnActive here — the agent may continue with more tool calls and
      // produce further assistant messages that we still need to deliver.
      // turnActive is only cleared by beginTurn() (user sends new msg) or
      // by the cascade-switch handler (user switched conversation).
      await this.updateStatus(chatId, "[Done] AI: xong", turnId);
      // Null the status msg id so the NEXT tool-step status creates a fresh
      // message rather than editing the "xong" one.
      this.statusMsgId = null;
    }

    // Deliver the actual answer text regardless of whether a newer turn started.
    this.opts.log(`[tg] delivering answer (${answer.length} chars)`);
    await this.deliverText(chatId, answer);
    await this.deliverInteractiveElements(chatId, messages);
    this.opts.log(`[tg] finishTurn complete`);
  }

  // Send any not-yet-seen artifact files as inline "view" buttons, plans as
  // approve/reject buttons, and ask_question prompts as option button cards.
  private async deliverInteractiveElements(chatId: string, messages: any[]) {
    for (const m of messages as any[]) {
      if (m.role === "artifact" || m.role === "plan") {
        const uri = String(m.meta?.artifactUri ?? "");
        if (!uri || this.deliveredArtifacts.has(uri)) continue;
        this.deliveredArtifacts.add(uri);
        const uriKey = this.encodeUriKey(uri);
        const name = decodeURIComponent(uri.split(/[\\/]/).pop() || "file");
        const rows: any[] = [];
        if (m.role === "plan" && !m.meta?.answered) {
          rows.push([
            { text: "[OK] Đồng ý (Approve)", callback_data: `plan:approve:${uriKey}` },
            { text: "[X] Từ chối (Reject)", callback_data: `plan:reject:${uriKey}` },
          ]);
        }
        rows.push([{ text: `[File] Xem tệp ${name}`, callback_data: `view:${uriKey}` }]);

        let planText = m.role === "plan"
          ? `📋 *Kế hoạch triển khai:*\n\n${mdToTgHtml(m.text || "")}`
          : `📎 Tệp đính kèm: ${name}`;
        if (planText.length > 3800) {
          planText = planText.slice(0, 3800) + "\n\n...(bấm Xem tệp để đọc đầy đủ)";
        }

        await api(this.opts.token, "sendMessage", {
          chat_id: chatId,
          text: planText,
          parse_mode: "HTML",
          reply_markup: { inline_keyboard: rows },
        });
      } else if (m.role === "ask") {
        const stepIndex = m.stepIndex;
        const qKey = `ask_${stepIndex ?? m.text}`;
        if (this.deliveredQuestions.has(qKey) || m.meta?.answered) continue;
        this.deliveredQuestions.add(qKey);

        const questions: any[] = Array.isArray(m.meta?.questions) ? m.meta.questions : [];
        if (questions.length === 0) continue;

        for (let qi = 0; qi < questions.length; qi++) {
          const q = questions[qi];
          const questionTitle = q?.question ?? m.text ?? "Agent có câu hỏi:";
          const options: any[] = Array.isArray(q?.options) ? q.options : [];

          const rows: any[] = [];
          for (let oi = 0; oi < options.length; oi++) {
            const opt = options[oi];
            const optId = String(opt.id ?? oi);
            const optText = String(opt.text ?? `Option ${oi + 1}`);
            rows.push([
              {
                text: `${oi + 1}. ${optText}`,
                callback_data: `ask:${stepIndex}:${qi}:${optId}`,
              },
            ]);
          }
          rows.push([
            {
              text: "⏭ Bỏ qua (Skip)",
              callback_data: `ask_skip:${stepIndex}`,
            },
          ]);

          this.opts.log(`[tg] delivering ask question: "${questionTitle.slice(0, 40)}" with ${options.length} options`);
          await api(this.opts.token, "sendMessage", {
            chat_id: chatId,
            text: `❓ *Câu hỏi từ Agent:*\n\n${mdToTgHtml(questionTitle)}`,
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: rows },
          });
        }
      }
    }
  }

  // Deliver a possibly-long text as one or more messages, converting the AI's
  // markdown to Telegram HTML format (parse_mode=HTML). Automatically detects
  // artifact file links (implementation_plan.md, walkthrough.md, etc.) embedded in
  // the text and appends action buttons (Approve / Reject / View) to the last chunk.
  private async deliverText(chatId: string, text: string) {
    const artifactButtons: any[] = [];
    const extracted = extractFileLinks(text);

    for (const item of extracted) {
      const isPlan = /plan/i.test(item.fileName) || /plan/i.test(item.label) || /kế hoạch/i.test(item.label);
      const displayTitle = item.label.includes(".") ? item.label : item.fileName;
      const uriKey = this.encodeUriKey(item.fileUri);
      if (!this.deliveredArtifacts.has(item.fileUri)) {
        this.deliveredArtifacts.add(item.fileUri);
        if (isPlan) {
          artifactButtons.push([
            { text: "✅ Đồng ý (Approve)", callback_data: `plan:approve:${uriKey}` },
            { text: "❌ Từ chối (Reject)", callback_data: `plan:reject:${uriKey}` },
          ]);
          artifactButtons.push([
            { text: `📄 Xem tệp ${displayTitle}`, callback_data: `view:${uriKey}` },
          ]);
        } else {
          artifactButtons.push([
            { text: `📄 Xem tệp ${displayTitle}`, callback_data: `view:${uriKey}` },
          ]);
        }
      }
    }

    const chunks = splitChunks(text);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const isLastChunk = i === chunks.length - 1;
      const html = mdToTgHtml(chunk);
      const body: any = { chat_id: chatId, text: html, parse_mode: "HTML" };

      if (isLastChunk && artifactButtons.length > 0) {
        body.reply_markup = { inline_keyboard: artifactButtons };
      }

      const r = await api(this.opts.token, "sendMessage", body);
      if (!r?.ok) {
        this.opts.log(`[tg] HTML parse failed (${r?.description ?? 'unknown error'}), falling back to plain text`);
        // Fallback: send plain text
        const fallbackBody: any = { chat_id: chatId, text: chunk };
        if (isLastChunk && artifactButtons.length > 0) {
          fallbackBody.reply_markup = { inline_keyboard: artifactButtons };
        }
        await api(this.opts.token, "sendMessage", fallbackBody);
      }
    }
  }

  private async updateStatus(chatId: string, text: string, forTurnId?: number) {
    // If a newer turn has already started, this update is stale — abort.
    if (forTurnId !== undefined && forTurnId !== this.turnId) return;
    // Dedup: Telegram rejects an edit to identical text ("message is not
    // modified"), which previously triggered the fallback and spawned a new
    // message. Skip no-op updates entirely.
    if (text === this.lastStatusText && this.statusMsgId) return;
    this.lastStatusText = text;
    if (this.statusMsgId) {
      const r = await api(this.opts.token, "editMessageText", {
        chat_id: chatId,
        message_id: this.statusMsgId,
        text,
      });
      if (r?.ok) return;
      // Telegram returns ok:false with "not modified" when the text is
      // unchanged — that's harmless, keep the same message. Only drop the id on
      // a real failure (message deleted), then fall through to a fresh send.
      const desc = String(r?.description ?? "");
      if (/not modified/i.test(desc)) return;
      this.statusMsgId = null;
    }
    // Re-check turn id after the (possibly slow) edit API call above.
    if (forTurnId !== undefined && forTurnId !== this.turnId) return;
    const r = await api(this.opts.token, "sendMessage", {
      chat_id: chatId,
      text,
    });
    if (r?.ok) this.statusMsgId = r.result.message_id;
  }

  private async send(chatId: string, text: string, parseMode?: string) {
    for (const chunk of splitChunks(text)) {
      const body: any = { chat_id: chatId, text: chunk };
      if (parseMode) body.parse_mode = parseMode;
      await api(this.opts.token, "sendMessage", body);
    }
  }

  private sendPhoto(chatId: string, data: Buffer, name: string): Promise<void> {
    return this.sendMultipart(chatId, "sendPhoto", "photo", data, name);
  }
  private sendDocument(chatId: string, data: Buffer, name: string): Promise<void> {
    return this.sendMultipart(chatId, "sendDocument", "document", data, name);
  }

  // Minimal multipart/form-data upload for photos/documents (no dependency).
  private sendMultipart(
    chatId: string,
    method: string,
    field: string,
    data: Buffer,
    filename: string
  ): Promise<void> {
    return new Promise((resolve) => {
      const boundary = "----arp" + Date.now().toString(16);
      const pre =
        `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
        `Content-Type: application/octet-stream\r\n\r\n`;
      const post = `\r\n--${boundary}--\r\n`;
      const payload = Buffer.concat([
        Buffer.from(pre, "utf8"),
        data,
        Buffer.from(post, "utf8"),
      ]);
      const req = https.request(
        {
          host: "api.telegram.org",
          path: `/bot${this.opts.token}/${method}`,
          method: "POST",
          headers: {
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": payload.length,
          },
          timeout: 65000,
        },
        (res) => {
          res.on("data", () => {});
          res.on("end", () => resolve());
        }
      );
      req.on("error", () => resolve());
      req.on("timeout", () => {
        req.destroy();
        resolve();
      });
      req.write(payload);
      req.end();
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Convert AI markdown to Telegram HTML (parse_mode="HTML").
// Handles code blocks, inline code, bold, italic, links, bullets, and headings cleanly.
function mdToTgHtml(text: string): string {
  if (!text) return "";
  // Step 1: escape HTML special chars first
  let s = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Step 2: protect fenced code blocks (```lang\ncode```) with tokens
  const codeBlocks: string[] = [];
  s = s.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    const tag = lang
      ? `<pre><code class="language-${lang}">${code.trim()}</code></pre>`
      : `<pre><code>${code.trim()}</code></pre>`;
    codeBlocks.push(tag);
    return `___CODE_BLOCK_${idx}___`;
  });

  // Step 3: protect inline code (`code`) with tokens
  const inlineCodes: string[] = [];
  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${code}</code>`);
    return `___INLINE_CODE_${idx}___`;
  });

  // Step 4: headings # H1 ## H2 … → <b>H1</b>
  s = s.replace(/^#{1,6}\s+(.+)$/gm, (_, t) => `<b>${t.trim()}</b>`);

  // Step 5: bold **text** or __text__
  s = s.replace(/\*\*([^*\n]+?)\*\*/g, (_, t) => `<b>${t}</b>`);
  s = s.replace(/__([^_\n]+?)__/g, (_, t) => `<b>${t}</b>`);

  // Step 6: italic *text* or _text_ (excluding bullets)
  s = s.replace(/(^|\s)\*([^*\n]+?)\*(\s|$|[.,!?;:])/g, (_, p1, t, p2) => `${p1}<i>${t}</i>${p2}`);
  s = s.replace(/(^|\s)_([^_\n]+?)_(\s|$|[.,!?;:])/g, (_, p1, t, p2) => `${p1}<i>${t}</i>${p2}`);

  // Step 7: markdown links [label](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    if (url.startsWith("file://") || url.startsWith("#")) {
      return `<b>📄 ${label}</b>`;
    }
    return `<a href="${url}">${label}</a>`;
  });

  // Step 8: bullets - / * at start of line → •
  s = s.replace(/^(\s*)[-*+]\s+/gm, "$1• ");

  // Step 9: horizontal rules --- / *** / ___ → a separator line
  s = s.replace(/^[-*_]{3,}$/gm, "─────────────────");

  // Step 10: restore protected tokens
  s = s.replace(/___INLINE_CODE_(\d+)___/g, (_, idx) => inlineCodes[Number(idx)] || "");
  s = s.replace(/___CODE_BLOCK_(\d+)___/g, (_, idx) => codeBlocks[Number(idx)] || "");

  return s;
}

// Extract file markdown links [label](file:///...) safely.
function extractFileLinks(text: string): { label: string; fileUri: string; fileName: string }[] {
  const results: { label: string; fileUri: string; fileName: string }[] = [];
  const regex = /\[([^\]]+)\]\((file:\/\/\/[^)]+)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const label = m[1];
    const fileUri = m[2];
    if (fileUri.toLowerCase().endsWith(".md")) {
      const parts = fileUri.split(/[\\/]/);
      const fileName = parts[parts.length - 1] || "file.md";
      results.push({ label, fileUri, fileName });
    }
  }
  return results;
}

// Key used to deduplicate assistant messages. Uses length + prefix + suffix
// to form a unique key, preventing duplicate deliveries even during race conditions.
function assistantKey(text: string): string {
  if (text.length <= 300) return text;
  return `${text.length}:${text.slice(0, 150)}:${text.slice(-150)}`;
}
