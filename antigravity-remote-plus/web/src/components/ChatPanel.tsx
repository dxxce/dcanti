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
  id?: string;
  role: string;
  text: string;
  kind?: string;
  detail?: string;
  images?: string[];
  stepIndex?: number;
  timestamp?: number;
  meta?: Record<string, unknown>;
}

// A rendered block is either a single user/assistant/plan message, or a
// collapsible timeline grouping consecutive tool/system steps.
type Block =
  | { type: "msg"; msg: ChatMsg; index: number; id: string }
  | { type: "timeline"; steps: ChatMsg[]; id: string };

// Fold consecutive tool/system steps into one timeline block so they take up
// little space and leave room for the real user/assistant messages.
function toBlocks(messages: ChatMsg[]): Block[] {
  const blocks: Block[] = [];
  let buffer: ChatMsg[] = [];
  let timelineStartIndex = 0;

  const flush = () => {
    if (buffer.length) {
      const firstStep = buffer[0];
      const id = `timeline-${timelineStartIndex}-${firstStep.stepIndex ?? ""}`;
      blocks.push({ type: "timeline", steps: buffer, id });
      buffer = [];
    }
  };

  messages.forEach((m, index) => {
    if (m.role === "tool" || m.role === "system") {
      if (buffer.length === 0) timelineStartIndex = index;
      buffer.push(m);
    } else {
      flush();
      const id = m.id || `msg-${index}-${m.stepIndex ?? ""}-${m.role}`;
      blocks.push({ type: "msg", msg: m, index, id });
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
  const PAGE_SIZE = 40;
  const totalBlocks = blocks.length;

  // Number of blocks hidden at the top of the chat
  const [hiddenTopCount, setHiddenTopCount] = useState(() =>
    Math.max(0, totalBlocks - PAGE_SIZE)
  );

  // When switching to a different cascade, re-initialize hiddenTopCount
  const lastCascadeId = useRef(state.cascadeId);
  if (lastCascadeId.current !== state.cascadeId) {
    lastCascadeId.current = state.cascadeId;
    setHiddenTopCount(Math.max(0, totalBlocks - PAGE_SIZE));
  }

  const hasMore = hiddenTopCount > 0;
  const hiddenCount = hiddenTopCount;

  const previousScrollRef = useRef<{ height: number; top: number } | null>(null);
  const isLoadingMore = useRef(false);

  const loadMore = () => {
    if (isLoadingMore.current || !hasMore) return;
    const el = listRef.current;
    if (el) {
      previousScrollRef.current = { height: el.scrollHeight, top: el.scrollTop };
    }
    isLoadingMore.current = true;
    setHiddenTopCount((prev) => Math.max(0, prev - PAGE_SIZE));
  };

  const visibleBlocks = useMemo(() => {
    if (hiddenTopCount <= 0) return blocks;
    return blocks.slice(hiddenTopCount);
  }, [blocks, hiddenTopCount]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 80;
    stickToBottom.current = nearBottom;
    setShowJump(!nearBottom);

    if (el.scrollTop < 30 && hasMore && !isLoadingMore.current) {
      loadMore();
    }
  };

  const scrollToBottomDirect = () => {
    stickToBottom.current = true;
    setShowJump(false);
    const el = listRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  };

  useEffect(() => {
    stickToBottom.current = true;
    setShowJump(false);
    const doScroll = () => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    };
    doScroll();
    requestAnimationFrame(doScroll);
    const t1 = setTimeout(doScroll, 100);
    const t2 = setTimeout(doScroll, 300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [state.cascadeId]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (isLoadingMore.current && previousScrollRef.current) {
      const heightDiff = el.scrollHeight - previousScrollRef.current.height;
      el.scrollTop = previousScrollRef.current.top + heightDiff;
      previousScrollRef.current = null;
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
    if (screenshotLoading) return;
    setScreenshotLoading(true);
    try {
      const r = await api.screenshot();
      if (r.ok && r.dataUri) {
        setScreenshotUri(r.dataUri);
      } else {
        alert("Không thể chụp màn hình Mac.");
      }
    } catch {
      alert("Lỗi khi kết nối API chụp màn hình.");
    } finally {
      setScreenshotLoading(false);
    }
  };

  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
  const [confirmRevertStepIndex, setConfirmRevertStepIndex] = useState<number | null>(null);
  const [reverting, setReverting] = useState(false);

  const handleConfirmRevert = async () => {
    if (confirmRevertStepIndex == null) return;
    setReverting(true);
    try {
      await onRevert(confirmRevertStepIndex);
    } finally {
      setReverting(false);
      setConfirmRevertStepIndex(null);
    }
  };

  const selectedModel =
    (localSelectedId ? models.find((m) => m.id === localSelectedId || m.label === localSelectedId) : null) ??
    models.find((m) => m.selected) ??
    models.find((m) => m.recommended) ??
    models[0];

  const modelGroups = useMemo(
    () => groupModels(models, selectedModel?.id || localSelectedId || undefined),
    [models, selectedModel, localSelectedId]
  );

  const activeGroup = useMemo(
    () => modelGroups.find((g) => g.key === activeGroupKey) || null,
    [modelGroups, activeGroupKey]
  );

  const cleanModelName = (name: string) => {
    if (!name) return "";
    return name.replace(/^MODEL_PLACEHOLDER_/, "").trim();
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
              <button
                type="button"
                className="ghost sm load-more-btn"
                onClick={loadMore}
                disabled={isLoadingMore.current}
              >
                <Icon name="arrowUp" size={13} />
                <span>Tải thêm tin nhắn cũ ({hiddenCount} tin nhắn phía trên)</span>
              </button>
            </div>
          )}

          {visibleBlocks.map((b, i) => {
            const isLastBlock = i === visibleBlocks.length - 1;
            return b.type === "timeline" ? (
              <Timeline
                key={b.id}
                steps={b.steps}
                live={state.generating && isLastBlock}
                statusText={state.statusText}
                onOpenFile={onOpenFile}
              />
            ) : (
              <MessageRow
                key={b.id}
                msg={b.msg}
                onRequestRevert={(stepIndex) => setConfirmRevertStepIndex(stepIndex)}
                onApprovePlan={onApprovePlan}
                onAnswerQuestion={onAnswerQuestion}
                onSkipQuestion={onSkipQuestion}
                onOpenFile={onOpenFile}
                onEditPlan={() => taRef.current?.focus()}
                onPreviewImage={(src) => setLightboxImage(src)}
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
                    <div
                      className="picker-backdrop"
                      onClick={() => {
                        setModelOpen(false);
                        setActiveGroupKey(null);
                      }}
                    />
                    <div className="model-menu">
                      <div className="model-menu-title">Model &amp; Quota</div>
                      {modelGroups.length === 0 && (
                        <div className="muted pad">Không có model.</div>
                      )}
                      {modelGroups.map((g) => {
                        const hasSub = g.variants.length > 1;
                        const isExpanded = activeGroupKey === g.key;
                        const pct =
                          g.remainingFraction != null
                            ? Math.round(g.remainingFraction * 100)
                            : null;

                        return (
                          <div key={g.key} className="model-group-wrapper">
                            <button
                              type="button"
                              className={
                                "model-item" +
                                (g.isSelected ? " active" : "") +
                                (isExpanded ? " expanded" : "")
                              }
                              onClick={() => {
                                if (hasSub) {
                                  setActiveGroupKey((prev) =>
                                    prev === g.key ? null : g.key
                                  );
                                } else {
                                  const single = g.variants[0];
                                  setLocalSelectedId(single.id);
                                  onSelectModel(single.id);
                                  setModelOpen(false);
                                  setActiveGroupKey(null);
                                }
                              }}
                            >
                              <div className="model-item-left">
                                <span className="model-item-name">{g.title}</span>
                                {g.levelSuffix && (
                                  <span className="model-item-level">{g.levelSuffix}</span>
                                )}
                              </div>
                              <div className="model-item-right">
                                {g.isFast && (
                                  <span
                                    className="model-badge-fast"
                                    title="Mô hình tốc độ cao"
                                  >
                                    Fast <span className="fast-info-glyph">ⓘ</span>
                                  </span>
                                )}
                                {pct != null && (
                                  <span
                                    className={
                                      "model-quota-tag " +
                                      quotaClass(g.remainingFraction ?? 1)
                                    }
                                  >
                                    {pct}%
                                  </span>
                                )}
                                {hasSub ? (
                                  <Icon
                                    name="chevronDown"
                                    size={13}
                                    className={
                                      "model-chevron" + (isExpanded ? " rotated" : "")
                                    }
                                  />
                                ) : (
                                  g.isSelected && (
                                    <Icon
                                      name="check"
                                      size={13}
                                      className="model-check-icon"
                                    />
                                  )
                                )}
                              </div>
                            </button>

                            {/* Sublevels Accordion List directly below this model */}
                            {hasSub && isExpanded && (
                              <div className="model-inline-sublevels">
                                {g.variants.map((v) => {
                                  const isVariantSelected =
                                    v.id === selectedModel?.id ||
                                    v.id === localSelectedId ||
                                    v.selected;
                                  const vPct =
                                    v.remainingFraction != null
                                      ? Math.round(v.remainingFraction * 100)
                                      : null;
                                  return (
                                    <button
                                      key={v.id}
                                      type="button"
                                      className={
                                        "model-sublevel-item" +
                                        (isVariantSelected ? " active" : "")
                                      }
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setLocalSelectedId(v.id);
                                        onSelectModel(v.id);
                                        setModelOpen(false);
                                        setActiveGroupKey(null);
                                      }}
                                    >
                                      <div className="sublevel-left">
                                        <span className="sublevel-dot" />
                                        <span className="sublevel-title">
                                          {v.level || v.label}
                                        </span>
                                      </div>
                                      <div className="sublevel-right">
                                        {vPct != null && (
                                          <span
                                            className={
                                              "model-quota-tag " +
                                              quotaClass(v.remainingFraction ?? 1)
                                            }
                                          >
                                            {vPct}%
                                          </span>
                                        )}
                                        {isVariantSelected && (
                                          <Icon
                                            name="check"
                                            size={13}
                                            className="sublevel-check"
                                          />
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
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
                          <span className="tools-menu-item-title">Chụp màn hình Mac</span>
                          <span className="tools-menu-item-desc">Chụp toàn màn hình Mac và gửi ngay vào đoạn chat</span>
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
        <ImageViewer
          src={screenshotUri}
          title="Ảnh chụp màn hình máy Mac"
          onClose={() => setScreenshotUri(null)}
          extraActions={
            <>
              <button
                className="btn primary sm"
                onClick={async () => {
                  const uri = screenshotUri;
                  setScreenshotUri(null);
                  if (uri) {
                    await onSend("Đây là ảnh chụp màn hình máy Mac của tôi", [uri]);
                  }
                }}
              >
                <Icon name="upload" size={13} /> <span>Gửi vào chat</span>
              </button>
              <a
                className="btn ghost sm"
                href={screenshotUri}
                download={`mac_screenshot_${Date.now()}.png`}
              >
                <Icon name="save" size={13} /> <span>Tải về</span>
              </a>
              <button className="btn ghost sm" onClick={captureScreenshot} disabled={screenshotLoading}>
                <Icon name={screenshotLoading ? "spinner" : "refresh"} size={13} className={screenshotLoading ? "spin" : ""} />
                <span>Chụp lại</span>
              </button>
              <button className="btn ghost sm" onClick={() => setScreenshotUri(null)}>
                <span>Đóng</span>
              </button>
            </>
          }
        />
      )}

      {confirmRevertStepIndex != null && (
        <div
          className="revert-modal-overlay"
          onClick={() => !reverting && setConfirmRevertStepIndex(null)}
        >
          <div className="revert-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="revert-modal-icon">
              <Icon name="revert" size={24} />
            </div>
            <div className="revert-modal-title">Xác nhận khôi phục (Revert)</div>
            <div className="revert-modal-desc">
              Bạn có chắc chắn muốn hoàn tác mã nguồn và lịch sử hội thoại về bước này (Bước #{confirmRevertStepIndex})? Tất cả các thay đổi và tin nhắn sau bước này sẽ bị hủy bỏ.
            </div>
            <div className="revert-modal-actions">
              <button
                type="button"
                className="ghost"
                disabled={reverting}
                onClick={() => setConfirmRevertStepIndex(null)}
              >
                Hủy
              </button>
              <button
                type="button"
                className="danger"
                disabled={reverting}
                onClick={handleConfirmRevert}
              >
                {reverting ? (
                  <Icon name="spinner" size={14} className="spin" />
                ) : (
                  <Icon name="revert" size={14} />
                )}
                <span>{reverting ? "Đang khôi phục…" : "Xác nhận khôi phục"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {lightboxImage && (
        <ImageViewer
          src={lightboxImage}
          title="Xem ảnh phóng to"
          onClose={() => setLightboxImage(null)}
        />
      )}
    </section>
  );
}

// Full-featured Zoom & Pan Image Viewer Modal
function ImageViewer({
  src,
  title,
  onClose,
  extraActions,
}: {
  src: string;
  title?: string;
  onClose: () => void;
  extraActions?: React.ReactNode;
}) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const zoomIn = () => setScale((s) => Math.min(Number((s + 0.5).toFixed(1)), 4));
  const zoomOut = () => {
    setScale((s) => {
      const next = Math.max(Number((s - 0.5).toFixed(1)), 1);
      if (next === 1) setPos({ x: 0, y: 0 });
      return next;
    });
  };
  const resetZoom = () => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  };

  const handleDoubleClick = () => {
    if (scale > 1) {
      resetZoom();
    } else {
      setScale(2.5);
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoomIn();
      else if (e.key === "-") zoomOut();
      else if (e.key === "0") resetZoom();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPos({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
  };
  const handleMouseUp = () => setIsDragging(false);

  const lastTap = useRef<number>(0);
  const handleTouchStart = (e: React.TouchEvent) => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      handleDoubleClick();
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    if (e.touches.length === 1 && scale > 1) {
      setIsDragging(true);
      dragStart.current = { x: e.touches[0].clientX - pos.x, y: e.touches[0].clientY - pos.y };
    }
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    setPos({ x: e.touches[0].clientX - dragStart.current.x, y: e.touches[0].clientY - dragStart.current.y });
  };
  const handleTouchEnd = () => setIsDragging(false);

  return (
    <div className="img-viewer-backdrop" onClick={onClose} ref={containerRef}>
      <div className="img-viewer-card" onClick={(e) => e.stopPropagation()}>
        <div className="img-viewer-header">
          <div className="img-viewer-title">
            <Icon name="eye" size={15} />
            <span>{title || "Xem ảnh"}</span>
            {scale > 1 && <span className="zoom-badge">{Math.round(scale * 100)}%</span>}
          </div>
          <div className="img-viewer-controls">
            <button className="icon-btn sm" onClick={zoomOut} disabled={scale <= 1} title="Thu nhỏ (-)">
              <span style={{ fontSize: "16px", fontWeight: "bold", lineHeight: 1 }}>−</span>
            </button>
            <button className="icon-btn sm" onClick={resetZoom} disabled={scale === 1 && pos.x === 0 && pos.y === 0} title="Mặc định (100%)">
              <span style={{ fontSize: "11px", fontWeight: "bold" }}>1x</span>
            </button>
            <button className="icon-btn sm" onClick={zoomIn} disabled={scale >= 4} title="Phóng to (+)">
              <Icon name="plus" size={14} />
            </button>
            <button className="icon-btn sm" onClick={toggleFullscreen} title="Toàn màn hình">
              <Icon name="eye" size={14} />
            </button>
            <a
              className="icon-btn sm"
              href={src}
              download={`image_${Date.now()}.png`}
              target="_blank"
              rel="noopener noreferrer"
              title="Tải về"
            >
              <Icon name="save" size={14} />
            </a>
            <button className="icon-btn sm danger-hover" onClick={onClose} title="Đóng (Esc)">
              <Icon name="close" size={16} />
            </button>
          </div>
        </div>

        <div
          className={`img-viewer-stage ${scale > 1 ? "is-zoomed" : ""} ${isDragging ? "is-dragging" : ""}`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onDoubleClick={handleDoubleClick}
        >
          <img
            src={src}
            alt="Preview"
            className="img-viewer-img"
            style={{
              transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`,
              cursor: scale > 1 ? (isDragging ? "grabbing" : "grab") : "zoom-in",
            }}
            draggable={false}
          />
        </div>

        {extraActions && (
          <div className="img-viewer-footer">
            {extraActions}
          </div>
        )}
      </div>
    </div>
  );
}

// Map a remaining-quota fraction (0..1) to a color bucket: green when plenty
// left, amber when getting low, red when nearly exhausted.
interface ModelVariant {
  id: string;
  label: string;
  level: string;
  selected: boolean;
  remainingFraction?: number;
  resetTime?: string;
}

interface ModelGroup {
  key: string;
  title: string;
  levelSuffix: string;
  isFast: boolean;
  variants: ModelVariant[];
  selectedVariant: ModelVariant;
  isSelected: boolean;
  remainingFraction?: number;
}

function groupModels(list: ModelInfo[], selectedId?: string): ModelGroup[] {
  if (!list || list.length === 0) return [];

  const map = new Map<string, { title: string; isFast: boolean; variants: ModelVariant[] }>();

  for (const m of list) {
    const raw = (m.label || "").replace(/^MODEL_PLACEHOLDER_/, "").trim();
    let base = raw;
    let level = "";
    let isFast = false;

    if (/flash/i.test(raw)) {
      isFast = true;
    }

    const levelMatch =
      raw.match(/\((High|Medium|Low)\)/i) || raw.match(/\b(High|Medium|Low)\b/i);
    if (levelMatch) {
      level = levelMatch[1].charAt(0).toUpperCase() + levelMatch[1].slice(1).toLowerCase();
      base = raw
        .replace(/\((High|Medium|Low)\)/i, "")
        .replace(/\b(High|Medium|Low)\b/i, "")
        .trim();
    }

    if (!map.has(base)) {
      map.set(base, { title: base, isFast, variants: [] });
    }

    const isSel = Boolean(
      m.selected || (selectedId && (m.id === selectedId || m.label === selectedId))
    );
    map.get(base)!.variants.push({
      id: m.id,
      label: m.label,
      level: level || "",
      selected: isSel,
      remainingFraction: m.remainingFraction,
      resetTime: m.resetTime,
    });
  }

  const ORDER = [
    "Gemini 3.7 Flash",
    "Gemini 3.6 Flash",
    "Gemini 3.5 Flash",
    "Gemini 3.1 Pro",
    "Claude Sonnet 4.6 (Thinking)",
    "Claude Opus 4.6 (Thinking)",
    "GPT-OSS 120B (Medium)",
  ];

  const groups: ModelGroup[] = [];

  for (const [key, val] of map.entries()) {
    const levelRank: Record<string, number> = { High: 1, Medium: 2, Low: 3, "": 4 };
    val.variants.sort((a, b) => (levelRank[a.level] || 9) - (levelRank[b.level] || 9));

    const sel = val.variants.find((v) => v.selected) || val.variants[0];
    const isSelected = val.variants.some((v) => v.selected);
    const fraction =
      sel.remainingFraction ??
      val.variants.find((v) => v.remainingFraction != null)?.remainingFraction;

    groups.push({
      key,
      title: val.title,
      levelSuffix: sel.level || "",
      isFast: val.isFast,
      variants: val.variants,
      selectedVariant: sel,
      isSelected,
      remainingFraction: fraction,
    });
  }

  groups.sort((a, b) => {
    const idxA = ORDER.indexOf(a.title);
    const idxB = ORDER.indexOf(b.title);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.title.localeCompare(b.title);
  });

  return groups;
}

function quotaClass(fraction: number): string {
  const pct = fraction * 100;
  if (pct >= 50) return "q-good";
  if (pct >= 20) return "q-warn";
  return "q-low";
}

function parseModelInfo(label: string) {
  let raw = label.replace(/^MODEL_PLACEHOLDER_/, "").trim();

  let isFast = false;
  if (/flash/i.test(raw)) {
    isFast = true;
  }

  let level = "";
  const m = raw.match(/\b(High|Medium|Low)\b/i) || raw.match(/\((High|Medium|Low)\)/i);
  if (m) {
    level = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    raw = raw.replace(/\((High|Medium|Low)\)/i, "").replace(/\b(High|Medium|Low)\b/i, "").trim();
  }

  return {
    title: raw,
    level,
    isFast,
  };
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

function getStepKey(s: ChatMsg, index: number): string {
  if (s.id) return s.id;
  if (s.stepIndex != null) return `step-${s.stepIndex}`;
  const textSig = (s.text || "").slice(0, 30);
  const dur = s.meta?.durationMs ?? "";
  const tok = s.meta?.tokens ?? "";
  return `step-${index}-${s.kind || ""}-${textSig}-${dur}-${tok}`;
}

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
  // Default to expanded so steps are never unexpectedly hidden/collapsed.
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);

  // Set of opened step keys — preserves opened state across step additions and live updates!
  const [openStepKeys, setOpenStepKeys] = useState<Set<string>>(() => new Set());

  const toggleStep = (key: string) => {
    setOpenStepKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isExpanded = userExpanded !== null ? userExpanded : true;
  const hidden = Math.max(0, steps.length - TIMELINE_VISIBLE);
  const visibleSteps = isExpanded ? steps : steps.slice(steps.length - TIMELINE_VISIBLE);

  return (
    <div className="timeline">
      {hidden > 0 && (
        <button
          type="button"
          className="timeline-head"
          onClick={() => setUserExpanded(!isExpanded)}
        >
          <Icon name={isExpanded ? "chevronDown" : "chevronRight"} size={13} />
          <Icon name="terminal" size={13} className="timeline-icon" />
          <span className="timeline-summary">
            {isExpanded ? "Ẩn bớt" : `Xem thêm ${hidden} bước trước`}
          </span>
        </button>
      )}
      <ul className="timeline-list">
        {visibleSteps.map((s, i) => {
          const actualIndex = isExpanded ? i : steps.length - TIMELINE_VISIBLE + i;
          const stepKey = getStepKey(s, actualIndex);
          const isOpen = openStepKeys.has(stepKey);

          return (
            <TimelineStep
              key={stepKey}
              step={s}
              open={isOpen}
              onToggle={() => toggleStep(stepKey)}
              onOpenFile={onOpenFile}
            />
          );
        })}
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
  open,
  onToggle,
  onOpenFile,
}: {
  step: ChatMsg;
  open: boolean;
  onToggle: () => void;
  onOpenFile?: (path: string) => void | Promise<void>;
}) {
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
        onClick={() => hasDetail && onToggle()}
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
  onRequestRevert,
  onApprovePlan,
  onAnswerQuestion,
  onSkipQuestion,
  onOpenFile,
  onEditPlan,
  onPreviewImage,
}: {
  msg: ChatMsg;
  onRequestRevert?: (stepIndex: number) => void;
  onApprovePlan: (artifactUri: string, approved: boolean) => void | Promise<void>;
  onAnswerQuestion: (
    stepIndex: number,
    answers: { selectedOptionIds: string[]; freeText?: string }[]
  ) => void | Promise<void>;
  onSkipQuestion: (stepIndex: number) => void | Promise<void>;
  onOpenFile: (path: string) => void | Promise<void>;
  onEditPlan: () => void;
  onPreviewImage?: (src: string) => void;
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
        onPreviewImage={onPreviewImage}
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
              {Array.isArray(msg.images) && msg.images.length > 0 && (
                <div className="msg-images">
                  {msg.images.map((img, idx) => {
                    const src = img.startsWith("data:") || img.startsWith("http") ? img : `/api/media?path=${encodeURIComponent(img)}`;
                    return (
                      <img
                        key={idx}
                        src={src}
                        alt="attachment"
                        className="msg-img-thumb"
                        onClick={() => onPreviewImage && onPreviewImage(src)}
                      />
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <Markdown text={msg.text} onOpenFile={onOpenFile} onPreviewImage={onPreviewImage} />
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
            onClick={() => onRequestRevert && onRequestRevert(msg.stepIndex!)}
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
  onPreviewImage,
}: {
  msg: ChatMsg;
  onApprovePlan: (artifactUri: string, approved: boolean) => void | Promise<void>;
  onOpenFile: (path: string) => void | Promise<void>;
  onEditPlan: () => void;
  onPreviewImage?: (src: string) => void;
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
          <Markdown text={msg.text} onOpenFile={onOpenFile} onPreviewImage={onPreviewImage} />
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
