import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, type ChatState, type ModelInfo } from "../api";
import { Icon, type IconName } from "./Icon";
import { Markdown } from "./Markdown";

interface Props {
  state: ChatState;
  models: ModelInfo[];
  onSend: (text: string, images?: string[]) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  onRevert: (stepIndex: number) => void | Promise<void>;
  onSelectModel: (id: string) => void | Promise<void>;
  onSlashCommand: (name: string, modelFacingText: string, text: string) => void | Promise<void>;
  onApprovePlan: (artifactUri: string, approved: boolean) => void | Promise<void>;
  onAnswerQuestion: (
    stepIndex: number,
    answers: { selectedOptionIds: string[]; freeText?: string }[]
  ) => void | Promise<void>;
  onSkipQuestion: (stepIndex: number) => void | Promise<void>;
  onOpenFile: (path: string) => void | Promise<void>;
}

interface ChatMsg {
  role: string;
  text: string;
  kind?: string;
  detail?: string;
  stepIndex?: number;
  meta?: Record<string, unknown>;
}

// A rendered block is either a single user/assistant/plan message, or a
// collapsible timeline grouping consecutive tool/system steps.
type Block =
  | { type: "msg"; msg: ChatMsg; index: number }
  | { type: "timeline"; steps: ChatMsg[] };

// Fold consecutive tool/system steps into one timeline block so they take up
// little space and leave room for the real user/assistant messages.
function toBlocks(messages: ChatMsg[]): Block[] {
  const blocks: Block[] = [];
  let buffer: ChatMsg[] = [];
  const flush = () => {
    if (buffer.length) {
      blocks.push({ type: "timeline", steps: buffer });
      buffer = [];
    }
  };
  messages.forEach((m, index) => {
    if (m.role === "tool" || m.role === "system") {
      buffer.push(m);
    } else {
      flush();
      blocks.push({ type: "msg", msg: m, index });
    }
  });
  flush();
  return blocks;
}

const KIND_ICON: Record<string, IconName> = {
  read: "file",
  search: "search",
  run: "terminal",
  edit: "edit",
  task: "check",
  error: "close",
  system: "cpu",
  tool: "terminal",
};

export function ChatPanel({
  state,
  models,
  onSend,
  onCancel,
  onRevert,
  onSelectModel,
  onSlashCommand,
  onApprovePlan,
  onAnswerQuestion,
  onSkipQuestion,
  onOpenFile,
}: Props) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string[]>([]);
  const [modelOpen, setModelOpen] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [slashCommands, setSlashCommands] = useState<
    { name: string; label: string; desc: string; modelFacingText: string }[]
  >([]);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const blocks = useMemo(() => toBlocks(state.messages), [state.messages]);
  const [offset, setOffset] = useState(0);

  const PAGE_SIZE = 10;
  const totalBlocks = blocks.length;
  const hasMore = totalBlocks > offset + PAGE_SIZE;

  const previousScrollRef = useRef({ height: 0, top: 0 });
  const isLoadingMore = useRef(false);

  const loadMore = () => {
    if (isLoadingMore.current) return;
    const el = listRef.current;
    if (el) {
      previousScrollRef.current = { height: el.scrollHeight, top: el.scrollTop };
    }
    isLoadingMore.current = true;
    setOffset((prev) => prev + PAGE_SIZE);
  };

  const visibleBlocks = useMemo(() => {
    if (totalBlocks <= PAGE_SIZE) return blocks;
    const end = totalBlocks - offset;
    const start = Math.max(0, end - PAGE_SIZE);
    return blocks.slice(start, end);
  }, [blocks, totalBlocks, offset]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    stickToBottom.current = nearBottom;
    setShowJump(!nearBottom);

    if (el.scrollTop < 60 && hasMore && !isLoadingMore.current) {
      loadMore();
    }
  };

  const scrollToBottomDirect = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  useEffect(() => {
    setOffset(0);
    stickToBottom.current = true;
    const doScroll = () => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    };
    doScroll();
    requestAnimationFrame(doScroll);
    const t1 = setTimeout(doScroll, 100);
    const t2 = setTimeout(doScroll, 300);
    const t3 = setTimeout(doScroll, 600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [state.cascadeId]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (isLoadingMore.current) {
      const heightDiff = el.scrollHeight - previousScrollRef.current.height;
      el.scrollTop = previousScrollRef.current.top + heightDiff;
      isLoadingMore.current = false;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [state.messages, state.statusText, state.generating, visibleBlocks]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
  }, [text]);

  // Load the live slash-command catalog once (per cascade). The pending command
  // (chosen from the menu) is applied only when the message is actually sent.
  const [pendingSlash, setPendingSlash] = useState<{
    name: string;
    modelFacingText: string;
  } | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .slashCommands()
      .then((r) => {
        if (!alive) return;
        const cmds = (r.commands ?? []).map((c) => ({
          name: c.info?.name ?? c.title ?? "",
          label: "/" + (c.info?.name ?? c.title ?? ""),
          desc: c.description ?? "",
          modelFacingText: c.info?.modelFacingText ?? "",
        }));
        setSlashCommands(cmds.filter((c) => c.name));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [state.cascadeId]);

  const forceScrollBottom = () => {
    stickToBottom.current = true;
    scrollToBottomDirect();
    setTimeout(scrollToBottomDirect, 50);
    setTimeout(scrollToBottomDirect, 150);
  };

  const submit = async () => {
    const t = text.trim();
    if (!t && !pendingSlash && pending.length === 0) return;
    const slash = pendingSlash;
    const imgs = [...pending];
    setText("");
    setPendingSlash(null);
    setPending([]);
    forceScrollBottom();
    if (slash) {
      await onSlashCommand(slash.name, slash.modelFacingText, t);
      forceScrollBottom();
      return;
    }
    await onSend(t, imgs.length > 0 ? imgs : undefined);
    forceScrollBottom();
  };

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      const reader = new FileReader();
      reader.onload = () => setPending((cur) => [...cur, String(reader.result)]);
      reader.readAsDataURL(f);
    }
    e.target.value = "";
  };

  // Filter the slash menu by whatever follows the leading "/". The menu opens
  // when the input starts with "/" and no space has been typed yet.
  const slashQuery =
    text.startsWith("/") && !text.includes(" ") ? text.slice(1).toLowerCase() : null;
  const slashMatches =
    slashQuery != null
      ? slashCommands.filter((c) => c.name.toLowerCase().startsWith(slashQuery))
      : [];
  const showSlash = slashOpen && slashMatches.length > 0;

  // Selecting a command does NOT send — it becomes a pending chip and clears the
  // "/…" text so the user can type an accompanying message, then hit send.
  const chooseSlash = (cmd: (typeof slashCommands)[number]) => {
    setSlashOpen(false);
    setPendingSlash({ name: cmd.name, modelFacingText: cmd.modelFacingText });
    setText("");
    taRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlash && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
      e.preventDefault();
      chooseSlash(slashMatches[0]);
      return;
    }
    if (e.key === "Escape" && showSlash) {
      setSlashOpen(false);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const removePending = (name: string) => {};

  const [screenshotUri, setScreenshotUri] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);

  const captureScreenshot = async () => {
    setScreenshotLoading(true);
    try {
      const r = await api.screenshot();
      if (r.ok && r.dataUri) {
        setPending((prev) => [...prev, r.dataUri!]);
      } else {
        alert("Không thể chụp màn hình IDE (CDP chưa kết nối).");
      }
    } catch {
      alert("Lỗi khi kết nối API chụp màn hình.");
    } finally {
      setScreenshotLoading(false);
    }
  };

  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);

  const selectedModel =
    (localSelectedId ? models.find((m) => m.id === localSelectedId || m.label === localSelectedId) : null) ??
    models.find((m) => m.selected) ??
    models.find((m) => m.recommended) ??
    models[0];

  const cleanModelName = (name: string) => {
    if (!name) return "";
    return name.replace(/^(Gemini\s*|Claude\s*|GPT-\s*)/i, '').trim();
  };

  // Plan approval: last assistant message asks to confirm a plan, or a dedicated
  // plan message is present.
  const lastAssistant = [...state.messages]
    .reverse()
    .find((m) => m.role === "assistant");
  const planPrompt =
    !state.generating &&
    ((lastAssistant && isPlanPrompt(lastAssistant.text)) ||
      state.messages[state.messages.length - 1]?.role === "plan");

  // Auto-accept is temporarily DISABLED (it mis-fired) — plans are approved
  // explicitly via the plan card buttons instead.

  return (
    <section className="chat">
      <div className="messages" ref={listRef} onScroll={onScroll}>
        <div className="messages-inner">
          {state.messages.length === 0 && !state.generating && (
            <div className="empty-chat">
              <Icon name="message" size={38} className="empty-icon" />
              <p>Chưa có tin nhắn. Bắt đầu trò chuyện với AI.</p>
            </div>
          )}

          {hasMore && (
            <div className="load-more-container">
              <button className="ghost sm load-more-btn" onClick={loadMore}>
                <Icon name="arrowUp" size={13} />
                <span>Tải thêm tin nhắn cũ ({totalBlocks - offset - PAGE_SIZE} tin nhắn)</span>
              </button>
            </div>
          )}

          {visibleBlocks.map((b, i) => {
            const isLastBlock = i === visibleBlocks.length - 1;
            return b.type === "timeline" ? (
              <Timeline
                key={`t${i}`}
                steps={b.steps}
                live={state.generating && isLastBlock}
                statusText={state.statusText}
                onOpenFile={onOpenFile}
              />
            ) : (
              <MessageRow
                key={`m${b.index}`}
                msg={b.msg}
                onRevert={onRevert}
                onApprovePlan={onApprovePlan}
                onAnswerQuestion={onAnswerQuestion}
                onSkipQuestion={onSkipQuestion}
                onOpenFile={onOpenFile}
                onEditPlan={() => taRef.current?.focus()}
              />
            );
          })}

          {/* When the agent is working but the last block isn't a live timeline
              (e.g. right after the user sends, before any tool step arrives),
              show a standalone step-style loading row so the timeline always
              reflects activity — not just the "thinking" bubble. */}
          {state.generating &&
            blocks[blocks.length - 1]?.type !== "timeline" && (
              <div className="timeline">
                <ul className="timeline-list">
                  <li className="timeline-step timeline-live">
                    <span className="timeline-step-head">
                      <Icon name="spinner" size={12} className="tstep-icon spin" />
                      <span className="tstep-text muted">
                        {state.statusText || "Đang xử lý…"}
                      </span>
                    </span>
                  </li>
                </ul>
              </div>
            )}
        </div>

      </div>

      <div className="composer">
        {showJump && (
          <button className="jump-latest" onClick={scrollToBottomDirect} title="Tin mới nhất">
            <Icon name="arrowDown" size={16} />
          </button>
        )}
        <div className="composer-inner">
          <div className="composer-box">
            {showSlash && (
              <div className="slash-menu">
                {slashMatches.map((c) => (
                  <button
                    key={c.name}
                    className="slash-item"
                    onClick={() => chooseSlash(c)}
                  >
                    <span className="slash-item-name">{c.label}</span>
                    <span className="slash-item-desc">{c.desc}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="composer-top">
              <div className="model-picker">
                <button
                  className="model-trigger"
                  onClick={async () => {
                    const next = !modelOpen;
                    setModelOpen(next);
                    if (next) {
                      try {
                        const m = await api.models();
                        if (Array.isArray(m?.models)) {
                          // refresh models from API
                        }
                      } catch {}
                    }
                  }}
                  title="Chọn model"
                >
                  <Icon name="cpu" size={14} />
                  <span className="model-current">
                    {cleanModelName(selectedModel?.label ?? "Chọn model")}
                  </span>
                  {selectedModel?.remainingFraction != null && (
                    <span
                      className={
                        "model-current-quota " +
                        quotaClass(selectedModel.remainingFraction)
                      }
                    >
                      {Math.round(selectedModel.remainingFraction * 100)}%
                    </span>
                  )}
                  <Icon name="chevronDown" size={12} />
                </button>
                {modelOpen && (
                  <>
                    <div className="picker-backdrop" onClick={() => setModelOpen(false)} />
                    <div className="model-menu">
                      <div className="model-menu-title">Model &amp; quota</div>
                      {models.length === 0 && (
                        <div className="muted pad">Không có model.</div>
                      )}
                      {models.map((m) => (
                        <button
                          key={m.id}
                          className={"model-item" + ((m.id === selectedModel?.id || m.selected) ? " active" : "")}
                          onClick={() => {
                            setLocalSelectedId(m.id);
                            onSelectModel(m.id);
                            setModelOpen(false);
                          }}
                        >
                          <span className="model-item-main">
                            <span className="model-item-name">
                              {m.selected && <Icon name="check" size={13} />}
                              {cleanModelName(m.label)}
                            </span>
                            {m.remainingFraction != null && (
                              <span className="model-item-meter">
                                <i
                                  style={{
                                    width: `${Math.round(m.remainingFraction * 100)}%`,
                                  }}
                                />
                              </span>
                            )}
                          </span>
                          {m.remainingFraction != null && (
                            <span className="model-quota-mini">
                              {Math.round(m.remainingFraction * 100)}%
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Stop lives top-right so the send button stays free — you can
                  queue another message while the agent is still working. */}
              {state.generating && (
                <button
                  className="composer-stop"
                  onClick={() => onCancel()}
                  title="Dừng agent"
                >
                  <Icon name="stop" size={13} /> <span>Dừng</span>
                </button>
              )}
            </div>

            {pendingSlash && (
              <div className="attach-chips">
                <span className="attach-chip slash" title={pendingSlash.name}>
                  <Icon name="terminal" size={12} />
                  <span className="attach-chip-name">/{pendingSlash.name}</span>
                  <button
                    className="attach-chip-x"
                    onClick={() => setPendingSlash(null)}
                    title="Bỏ lệnh"
                  >
                    <Icon name="close" size={11} />
                  </button>
                </span>
              </div>
            )}

            {pending.length > 0 && (
              <div className="attach-chips">
                {pending.map((p, i) => (
                  <span className="attach-chip image" key={i}>
                    <img src={p} alt="" className="attach-chip-thumb" />
                    <button
                      className="attach-chip-x"
                      onClick={() => setPending(cur => cur.filter((_, idx) => idx !== i))}
                      title="Xóa ảnh"
                    >
                      <Icon name="close" size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}



            <textarea
              ref={taRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                // Open the slash menu as soon as the line starts with "/".
                setSlashOpen(e.target.value.startsWith("/"));
              }}
              onKeyDown={onKeyDown}
              placeholder="Nhắn tin cho AI…  (Enter để gửi, Shift+Enter xuống dòng)"
              rows={1}
            />

            <div className="composer-actions">


              <div className="tools-menu-wrapper">
                <button
                  className={"ghost icon-btn composer-tools-trigger " + (toolsMenuOpen ? "active" : "")}
                  title="Công cụ & Tiện ích"
                  onClick={() => setToolsMenuOpen(!toolsMenuOpen)}
                >
                  <Icon name="plus" size={18} />
                </button>
                <label className="ghost icon-btn composer-tools-trigger" title="Tải ảnh lên" style={{ marginLeft: 4, cursor: "pointer" }}>
                  <input type="file" multiple accept="image/*" style={{ display: "none" }} onChange={onUpload} />
                  <Icon name="upload" size={16} />
                </label>

                {toolsMenuOpen && (
                  <>
                    <div className="menu-backdrop" onClick={() => setToolsMenuOpen(false)} />
                    <div className="tools-dropdown-menu">
                      <div className="tools-menu-header">Công cụ & Tiện ích</div>
                      
                      <button
                        className="tools-menu-item"
                        disabled={screenshotLoading}
                        onClick={async () => {
                          setToolsMenuOpen(false);
                          await captureScreenshot();
                        }}
                      >
                        <Icon name={screenshotLoading ? "spinner" : "camera"} size={16} className={screenshotLoading ? "spin" : ""} />
                        <div className="tools-menu-item-info">
                          <span className="tools-menu-item-title">Chụp màn hình IDE</span>
                          <span className="tools-menu-item-desc">Chụp ảnh màn hình IDE và đính kèm vào tin nhắn</span>
                        </div>
                      </button>

                      {pending.length > 0 && (
                        <button className="tools-menu-item danger" onClick={() => { setToolsMenuOpen(false); setPending([]); }}>
                          <Icon name="close" size={16} />
                          <div className="tools-menu-item-info">
                            <span className="tools-menu-item-title">Xóa tất cả đính kèm</span>
                            <span className="tools-menu-item-desc">Loại bỏ {pending.length} tệp đã chọn khỏi danh sách</span>
                          </div>
                        </button>
                      )}

                      </div>
                    </>
                  )}
                </div>

              <div className="spacer" />

              {/* Send is always available — the user can queue a message even
                  while the agent is working. Stop lives at the top-right. */}
              <button
                className="primary composer-send"
                onClick={submit}
                disabled={!text.trim() && !pendingSlash && pending.length === 0}
                title="Gửi"
              >
                <Icon name="send" size={15} /> <span>Gửi</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {screenshotUri && (
        <div className="modal-backdrop" onClick={() => setScreenshotUri(null)}>
          <div className="modal-card screenshot-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <Icon name="camera" size={16} /> <span>Màn hình IDE chụp realtime</span>
              </div>
              <button className="icon-btn" onClick={() => setScreenshotUri(null)}>
                <Icon name="close" size={14} />
              </button>
            </div>
            <div className="modal-body screenshot-body">
              <img src={screenshotUri} alt="IDE Screenshot" />
            </div>
            <div className="modal-actions">
              <a
                className="btn primary sm"
                href={screenshotUri}
                download={`ide_screenshot_${Date.now()}.png`}
              >
                <Icon name="upload" size={13} /> <span>Tải về</span>
              </a>
              <button className="ghost sm" onClick={captureScreenshot} disabled={screenshotLoading}>
                <Icon name={screenshotLoading ? "spinner" : "refresh"} size={13} className={screenshotLoading ? "spin" : ""} />
                <span>Chụp lại</span>
              </button>
              <button className="ghost sm" onClick={() => setScreenshotUri(null)}>
                <span>Đóng</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// Map a remaining-quota fraction (0..1) to a color bucket: green when plenty
// left, amber when getting low, red when nearly exhausted.
function quotaClass(fraction: number): string {
  const pct = fraction * 100;
  if (pct >= 50) return "q-good";
  if (pct >= 20) return "q-warn";
  return "q-low";
}

function isPlanPrompt(text: string): boolean {
  const t = text.toLowerCase();
  const hasPlanWord =
    /implementation plan|kế hoạch|plan above|proposed plan|following plan/.test(t);
  const asksApproval =
    /approve|proceed|shall i|should i proceed|đồng ý|tiến hành|xác nhận|duyệt|bạn có muốn/.test(
      t
    );
  return hasPlanWord && asksApproval;
}

// Read a File into a bare base64 string (no data-uri prefix), which is what
// SaveMediaAsArtifact expects for inlineData.
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// A timeline of tool/system steps. By default it shows the most recent ~5
// steps (so the reader sees what the agent is doing without the list eating the
// whole view); older steps collapse behind a "show all" toggle.
const TIMELINE_VISIBLE = 5;
function Timeline({
  steps,
  live,
  statusText,
  onOpenFile,
}: {
  steps: ChatMsg[];
  live?: boolean;
  statusText?: string;
  onOpenFile?: (path: string) => void | Promise<void>;
}) {
  const [showAll, setShowAll] = useState(false);
  const hidden = Math.max(0, steps.length - TIMELINE_VISIBLE);
  const visible = showAll ? steps : steps.slice(steps.length - TIMELINE_VISIBLE);

  return (
    <div className="timeline">
      {hidden > 0 && (
        <button className="timeline-head" onClick={() => setShowAll((v) => !v)}>
          <Icon name={showAll ? "chevronDown" : "chevronRight"} size={13} />
          <Icon name="terminal" size={13} className="timeline-icon" />
          <span className="timeline-summary">
            {showAll ? "Ẩn bớt" : `Xem thêm ${hidden} bước trước`}
          </span>
        </button>
      )}
      <ul className="timeline-list">
        {visible.map((s, i) => (
          <TimelineStep key={i} step={s} onOpenFile={onOpenFile} />
        ))}
        {live && (
          <li className="timeline-step timeline-live">
            <span className="timeline-step-head">
              <Icon name="spinner" size={12} className="tstep-icon spin" />
              <span className="tstep-text muted">
                {statusText || "Đang thực hiện…"}
              </span>
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}

// Format a duration in ms as a compact "1.2s" / "850ms" / "2m 3s".
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

function TimelineStep({
  step,
  onOpenFile,
}: {
  step: ChatMsg;
  onOpenFile?: (path: string) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const icon = KIND_ICON[step.kind || "tool"] || "terminal";
  const durationMs = typeof step.meta?.durationMs === "number" ? step.meta.durationMs : 0;
  const tokens = typeof step.meta?.tokens === "number" ? step.meta.tokens : 0;
  const outputText = typeof step.meta?.output === "string" ? step.meta.output : undefined;
  const detail = outputText || step.detail;
  const hasDetail = Boolean(detail);
  const added = typeof step.meta?.added === "number" ? step.meta.added : null;
  const removed = typeof step.meta?.removed === "number" ? step.meta.removed : null;
  const editUri = String(step.meta?.artifactUri ?? "");
  const editPath = editUri ? decodeURIComponent(editUri.replace(/^file:\/\//, "")) : "";
  const hasDiff = added != null || removed != null;

  return (
    <li className="timeline-step">
      <span
        className="timeline-step-head"
        onClick={() => hasDetail && setOpen((v) => !v)}
        style={{ cursor: hasDetail ? "pointer" : "default" }}
      >
        <span className="tstep-left">
          <Icon name={icon} size={12} className="tstep-icon" />
          <span className="tstep-text" title={step.text}>{step.text}</span>
          {hasDiff && (
            <span
              className={"tstep-diff" + (editPath ? " clickable" : "")}
              title={editPath ? `Xem thay đổi: ${editPath}` : undefined}
              onClick={(e) => {
                e.stopPropagation();
                if (editPath && onOpenFile) onOpenFile(editPath);
              }}
            >
              {added ? <span className="diff-add">+{added}</span> : null}
              {removed ? <span className="diff-del">-{removed}</span> : null}
            </span>
          )}
        </span>
        <span className="tstep-right">
          <span className="tstep-tokens" title="Số lượng token đã dùng">
            <Icon name="cpu" size={11} /> {tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens}
          </span>
          <span className="tstep-time" title="Thời gian chạy">
            {fmtDuration(durationMs)}
          </span>
          <span className="tstep-chev" title={hasDetail ? (open ? "Thu gọn log" : "Xem log chi tiết") : undefined}>
            {hasDetail ? (
              <Icon name={open ? "chevronDown" : "chevronRight"} size={12} />
            ) : (
              <span className="tstep-chev-blank" />
            )}
          </span>
        </span>
      </span>
      {open && hasDetail && (
        <div className="tstep-detail-box">
          <pre className="tstep-detail">{detail}</pre>
        </div>
      )}
    </li>
  );
}

// A real message: user / assistant / plan / ask get an avatar + bubble.
function MessageRow({
  msg,
  onRevert,
  onApprovePlan,
  onAnswerQuestion,
  onSkipQuestion,
  onOpenFile,
  onEditPlan,
}: {
  msg: ChatMsg;
  onRevert: (stepIndex: number) => void | Promise<void>;
  onApprovePlan: (artifactUri: string, approved: boolean) => void | Promise<void>;
  onAnswerQuestion: (
    stepIndex: number,
    answers: { selectedOptionIds: string[]; freeText?: string }[]
  ) => void | Promise<void>;
  onSkipQuestion: (stepIndex: number) => void | Promise<void>;
  onOpenFile: (path: string) => void | Promise<void>;
  onEditPlan: () => void;
}) {
  // The agent asked a question — render an inline card with the options.
  if (msg.role === "ask") {
    return (
      <AskQuestion
        msg={msg}
        onAnswer={onAnswerQuestion}
        onSkip={onSkipQuestion}
      />
    );
  }

  // A produced artifact file (walkthrough.md, task.md…) — a clickable chip that
  // opens the file in the Files tab.
  if (msg.role === "artifact") {
    const uri = String(msg.meta?.artifactUri ?? "");
    const path = decodeURIComponent(uri.replace(/^file:\/\//, ""));
    return (
      <div className="msg assistant artifact-row">
        <div className="msg-avatar">
          <Icon name="bot" size={15} />
        </div>
        <div className="msg-body">
          <button
            className="artifact-chip"
            title={path}
            onClick={() => path && onOpenFile(path)}
          >
            <Icon name="file" size={14} />
            <span>{msg.text}</span>
          </button>
        </div>
      </div>
    );
  }

  if (msg.role === "plan") {
    return (
      <PlanCard
        msg={msg}
        onApprovePlan={onApprovePlan}
        onOpenFile={onOpenFile}
        onEditPlan={onEditPlan}
      />
    );
  }

  const isUser = msg.role === "user";
  return (
    <div className={`msg ${msg.role}`}>
      <div className="msg-avatar">
        <Icon name={isUser ? "user" : "bot"} size={15} />
      </div>
      <div className="msg-body">
        <div className="bubble">
          {isUser ? (
            <>
              {msg.text && <pre>{msg.text}</pre>}

            </>
          ) : (
            <Markdown text={msg.text} onOpenFile={onOpenFile} />
          )}
        </div>
        {!isUser && (msg.meta?.turnTokens != null || msg.meta?.tokens != null) && (
          <div className="msg-meta-footer">
            <span className="meta-item tokens" title="Tổng số token đã tiêu tốn cho lượt này">
              <Icon name="zap" size={11} />
              <span>
                {((msg.meta?.turnTokens || msg.meta?.tokens || 0) as number) >= 1000
                  ? `${(((msg.meta?.turnTokens || msg.meta?.tokens || 0) as number) / 1000).toFixed(1)}k tokens`
                  : `${msg.meta?.turnTokens || msg.meta?.tokens} tokens`}
              </span>
            </span>
            {msg.meta?.turnDurationMs != null && (
              <span className="meta-item time" title="Tổng thời gian thực thi của lượt">
                <Icon name="clock" size={11} />
                <span>{fmtDuration(msg.meta.turnDurationMs as number)}</span>
              </span>
            )}
          </div>
        )}
        {isUser && msg.stepIndex != null && (
          <button
            className="msg-revert"
            title="Hoàn tác code về đúng thời điểm này"
            onClick={() => onRevert(msg.stepIndex!)}
          >
            <Icon name="revert" size={12} /> <span>Revert về đây</span>
          </button>
        )}
      </div>
    </div>
  );
}

// Plan card: renders the implementation plan + centered Đồng ý / Từ chối / Sửa.
// Once the plan is answered (agent recorded an approval), the buttons vanish.
// Clicking approve/reject shows a spinner until the poll reflects the answer.
function PlanCard({
  msg,
  onApprovePlan,
  onOpenFile,
  onEditPlan,
}: {
  msg: ChatMsg;
  onApprovePlan: (artifactUri: string, approved: boolean) => void | Promise<void>;
  onOpenFile: (path: string) => void | Promise<void>;
  onEditPlan: () => void;
}) {
  const artifactUri = String(msg.meta?.artifactUri ?? "");
  const answered = Boolean(msg.meta?.answered);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  // Once the agent records the answer, the card re-renders with answered=true
  // and the buttons disappear — so clear any local busy flag.
  useEffect(() => {
    if (answered) setBusy(null);
  }, [answered]);

  const act = async (approved: boolean) => {
    setBusy(approved ? "approve" : "reject");
    await onApprovePlan(artifactUri, approved);
  };

  return (
    <div className="msg assistant plan-msg">
      <div className="msg-avatar">
        <Icon name="bot" size={15} />
      </div>
      <div className="msg-body">
        <div className="plan-tag">
          <Icon name="check" size={12} /> <span>Kế hoạch triển khai</span>
        </div>
        <div className="bubble">
          <Markdown text={msg.text} onOpenFile={onOpenFile} />
        </div>
        {!answered && artifactUri && (
          <div className="plan-actions">
            <button
              className="primary sm"
              disabled={busy != null}
              onClick={() => act(true)}
            >
              {busy === "approve" ? (
                <Icon name="spinner" size={14} className="spin" />
              ) : (
                <Icon name="check" size={14} />
              )}
              <span>Đồng ý</span>
            </button>
            <button
              className="warn sm"
              disabled={busy != null}
              onClick={() => act(false)}
            >
              {busy === "reject" ? (
                <Icon name="spinner" size={14} className="spin" />
              ) : (
                <Icon name="close" size={14} />
              )}
              <span>Từ chối</span>
            </button>
            <button className="ghost sm" disabled={busy != null} onClick={onEditPlan}>
              <Icon name="edit" size={14} /> <span>Sửa</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Inline ask-question card: shows each question's options as selectable chips
// and a Submit / Skip pair. Single-select per question (matches the IDE). Once
// answered it locks so the choice is visible but not re-submittable.
function AskQuestion({
  msg,
  onAnswer,
  onSkip,
}: {
  msg: ChatMsg;
  onAnswer: (
    stepIndex: number,
    answers: { selectedOptionIds: string[]; freeText?: string }[]
  ) => void | Promise<void>;
  onSkip: (stepIndex: number) => void | Promise<void>;
}) {
  const questions: any[] = Array.isArray(msg.meta?.questions)
    ? (msg.meta!.questions as any[])
    : [];
  const answered = Boolean(msg.meta?.answered);
  const preSelected: string[] = Array.isArray(msg.meta?.selected)
    ? (msg.meta!.selected as string[])
    : [];
  const [picks, setPicks] = useState<Record<number, string[]>>({});
  const [freeText, setFreeText] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const toggle = (qi: number, id: string) => {
    if (busy || answered) return;
    setPicks((prev) => ({ ...prev, [qi]: prev[qi]?.[0] === id ? [] : [id] }));
  };

  const stepIdx = typeof msg.stepIndex === "number" ? msg.stepIndex : (typeof msg.meta?.stepIndex === "number" ? msg.meta.stepIndex : 0);

  const submit = async () => {
    const answers = questions.map((_, qi) => ({
      selectedOptionIds: picks[qi] ?? [],
      freeText: freeText[qi] || undefined,
    }));
    setBusy(true);
    try {
      await onAnswer(stepIdx, answers);
    } catch {
      setBusy(false);
    }
  };

  const skip = async () => {
    setBusy(true);
    try {
      await onSkip(stepIdx);
    } catch {
      setBusy(false);
    }
  };

  const canSubmit =
    !answered &&
    !busy &&
    questions.some((_, qi) => (picks[qi]?.length ?? 0) > 0 || freeText[qi]);

  return (
    <div className="msg assistant ask-msg">
      <div className="msg-avatar">
        <Icon name="bot" size={15} />
      </div>
      <div className="msg-body">
        <div className="ask-card">
          {questions.map((q, qi) => {
            const desc =
              q?.description ||
              q?.targetPath ||
              q?.resource ||
              q?.filePath ||
              q?.file ||
              q?.target ||
              q?.path ||
              msg.meta?.targetPath ||
              msg.meta?.resource ||
              msg.meta?.filePath ||
              msg.meta?.path ||
              msg.meta?.file ||
              msg.meta?.target;
            const options: any[] = Array.isArray(q?.options) ? q.options : [];
            return (
              <div key={qi} className="ask-q">
                <div className="ask-q-header">
                  <Icon name="file" size={15} className="ask-q-icon" />
                  <span className="ask-q-title">{q?.question || "Yêu cầu cấp quyền / trả lời:"}</span>
                </div>
                {desc && (
                  <div className="ask-q-desc">
                    <code>{desc}</code>
                  </div>
                )}
                <div className="ask-options-list">
                  {options.map((o: any, idx: number) => {
                    const optId = String(o.id ?? idx + 1);
                    const optText = String(o.text ?? o);
                    const sel =
                      (picks[qi]?.includes(optId) ?? false) ||
                      (answered && preSelected.includes(optId));
                    return (
                      <button
                        key={optId}
                        className={"ask-option-row" + (sel ? " sel" : "")}
                        disabled={answered}
                        onClick={() => toggle(qi, optId)}
                      >
                        <span className="opt-num">{idx + 1}</span>
                        <span className="opt-label">{optText}</span>
                      </button>
                    );
                  })}
                </div>
                {!answered && (
                  <input
                    className="ask-free"
                    placeholder="Hoặc nhập câu trả lời tùy chỉnh…"
                    value={freeText[qi] ?? ""}
                    onChange={(e) =>
                      setFreeText((prev) => ({ ...prev, [qi]: e.target.value }))
                    }
                  />
                )}
              </div>
            );
          })}
          {answered ? (
            <div className="ask-answered">
              <Icon name="check" size={13} /> <span>Đã gửi phản hồi</span>
            </div>
          ) : (
            <div className="ask-actions">
              <button className="ghost sm" disabled={busy} onClick={skip}>
                <span>Skip</span>
              </button>
              <button className="primary sm" disabled={!canSubmit} onClick={submit}>
                {busy ? (
                  <Icon name="spinner" size={13} className="spin" />
                ) : (
                  <Icon name="send" size={13} />
                )}
                <span>{busy ? "Đang gửi…" : "Submit"}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
