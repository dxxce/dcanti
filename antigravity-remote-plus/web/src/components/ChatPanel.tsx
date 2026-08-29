import { useEffect, useLayoutEffect, useMemo, useRef, useState, memo, useCallback } from "react";
import { api, type ChatState, type ModelInfo } from "../api";
import { Icon, type IconName } from "./Icon";
import { Markdown } from "./Markdown";
import hljs from "highlight.js/lib/common";

interface Props {
  state: ChatState;
  models: ModelInfo[];
  loading?: boolean;
  onSend: (text: string, images?: string[]) => void | Promise<void>;
  onCancel: () => void | Promise<void>;
  onRevert: (stepIndex: number) => void | Promise<void>;
  onSelectModel: (id: string) => void | Promise<void>;
  onSlashCommand: (name: string, modelFacingText: string, text: string) => void | Promise<void>;
  onMentionConversation?: (
    conv: { id: string; title?: string; lastModifiedTime?: string },
    text: string
  ) => Promise<any> | void;
  onApprovePlan: (artifactUri: string, approved: boolean) => Promise<any> | void;
  onAnswerQuestion: (
    stepIndex: number,
    answers: { selectedOptionIds: string[]; freeText?: string }[]
  ) => Promise<any> | void;
  onSkipQuestion: (stepIndex: number) => Promise<any> | void;
  onOpenFile: (path: string) => Promise<any> | void;
}

interface ChatMsg {
  id?: string;
  role: string;
  text: string;
  ts?: number;
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
    if (m.kind === "error" || m.role === "error") {
      flush();
      const id = m.id || `msg-${index}-${m.stepIndex ?? ""}-error`;
      blocks.push({ type: "msg", msg: m, index, id });
    } else if (m.role === "tool" || m.role === "system") {
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
  browser: "browser",
  error: "close",
  system: "cpu",
  tool: "terminal",
};

export function ChatPanel({
  state,
  models,
  loading = false,
  onSend,
  onCancel,
  onRevert,
  onSelectModel,
  onSlashCommand,
  onMentionConversation,
  onApprovePlan,
  onAnswerQuestion,
  onSkipQuestion,
  onOpenFile,
}: Props) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string[]>([]);
  const [modelOpen, setModelOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [attachModalOpen, setAttachModalOpen] = useState(false);
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
    if (!text && taRef.current) {
      taRef.current.style.height = "auto";
    }
  }, [text]);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 180) + "px";

    if (val.startsWith("/") && !val.includes(" ")) {
      setPickerOpen("slash");
      setPickerTab("slash");
      setPickerSearch(val.slice(1));
      setPickerSelectedIndex(0);
    } else if (/@(\S*)$/.test(val)) {
      const match = val.match(/@(\S*)$/);
      setPickerOpen("mention");
      setPickerTab("all");
      setPickerSearch(match ? match[1] : "");
      setPickerSelectedIndex(0);
    } else if (pickerOpen && !val.startsWith("/") && !val.includes("@")) {
      setPickerOpen(false);
    }
  };

  // Pending mentions & slash commands
  const [pendingSlash, setPendingSlash] = useState<{
    name: string;
    modelFacingText: string;
  } | null>(null);
  const [pendingMentions, setPendingMentions] = useState<{
    id: string;
    type: "file" | "folder" | "chat" | "slash";
    label: string;
    sublabel?: string;
    value: string;
    meta?: any;
    modelFacingText?: string;
  }[]>([]);

  const [pickerOpen, setPickerOpen] = useState<false | "slash" | "mention">(false);
  const [pickerTab, setPickerTab] = useState<"all" | "slash" | "file" | "folder" | "chat">("all");
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerSelectedIndex, setPickerSelectedIndex] = useState(0);

  // Lock background messages scroll when any composer modal is open
  useEffect(() => {
    const isAnyModalOpen = Boolean(modelOpen || pickerOpen || toolsMenuOpen || attachModalOpen);
    if (isAnyModalOpen) {
      document.body.classList.add("modal-scroll-lock");
    } else {
      document.body.classList.remove("modal-scroll-lock");
    }
    return () => {
      document.body.classList.remove("modal-scroll-lock");
    };
  }, [modelOpen, pickerOpen, toolsMenuOpen, attachModalOpen]);

  const [fileResults, setFileResults] = useState<{ name: string; path: string; type: "file" | "dir" }[]>([]);
  const [trajectories, setTrajectories] = useState<{ id: string; title?: string; updatedAt?: string }[]>([]);

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

  useEffect(() => {
    if (!pickerOpen) return;
    let alive = true;
    if (pickerOpen === "mention" || pickerTab === "file" || pickerTab === "folder" || pickerTab === "all") {
      api.searchFiles(pickerSearch, 40).then((res) => {
        if (alive && Array.isArray(res?.entries)) {
          setFileResults(res.entries);
        }
      }).catch(() => {});
    }
    if (pickerOpen === "mention" || pickerTab === "chat" || pickerTab === "all") {
      api.trajectories().then((res) => {
        if (alive && Array.isArray(res)) {
          setTrajectories(res);
        }
      }).catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [pickerOpen, pickerTab, pickerSearch]);

  const pickerItems = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    const items: {
      id: string;
      type: "file" | "folder" | "chat" | "slash";
      label: string;
      sublabel?: string;
      value: string;
      meta?: any;
      modelFacingText?: string;
    }[] = [];

    // 1. Slash commands
    if (pickerOpen === "slash" || pickerTab === "slash" || pickerTab === "all") {
      const matchedCmds = slashCommands.filter(
        (c) => !q || c.name.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)
      );
      matchedCmds.forEach((c) => {
        items.push({
          id: `slash-${c.name}`,
          type: "slash",
          label: `/${c.name}`,
          sublabel: c.desc,
          value: c.name,
          modelFacingText: c.modelFacingText,
        });
      });
    }

    // 2. Folders & Files
    if (pickerOpen === "mention" || pickerTab === "all" || pickerTab === "file" || pickerTab === "folder") {
      fileResults.forEach((f) => {
        if (f.type === "dir" && (pickerTab === "all" || pickerTab === "folder")) {
          items.push({
            id: `folder-${f.path}`,
            type: "folder",
            label: f.name + "/",
            sublabel: f.path,
            value: f.path,
          });
        } else if (f.type === "file" && (pickerTab === "all" || pickerTab === "file")) {
          items.push({
            id: `file-${f.path}`,
            type: "file",
            label: f.name,
            sublabel: f.path,
            value: f.path,
          });
        }
      });
    }

    // 3. Past Chats
    if (pickerOpen === "mention" || pickerTab === "all" || pickerTab === "chat") {
      const matchedChats = trajectories.filter(
        (t) => t.id !== state.cascadeId && (!q || (t.title && t.title.toLowerCase().includes(q)) || t.id.includes(q))
      );
      matchedChats.forEach((c) => {
        items.push({
          id: `chat-${c.id}`,
          type: "chat",
          label: c.title || "Cuộc trò chuyện",
          sublabel: c.updatedAt ? new Date(c.updatedAt).toLocaleString() : c.id.slice(0, 8),
          value: c.id,
          meta: c,
        });
      });
    }

    return items;
  }, [pickerOpen, pickerTab, pickerSearch, slashCommands, fileResults, trajectories, state.cascadeId]);

  const selectPickerItem = (item: (typeof pickerItems)[number]) => {
    if (item.type === "slash") {
      setPendingSlash({ name: item.value, modelFacingText: item.modelFacingText || "" });
      setText((cur) => cur.replace(/^\/\S*\s*/, ""));
    } else {
      setPendingMentions((prev) => {
        if (prev.some((m) => m.id === item.id)) return prev;
        return [...prev, item];
      });
      setText((cur) => cur.replace(/@\S*$/, ""));
    }
    setPickerOpen(false);
    setPickerSearch("");
    setPickerSelectedIndex(0);
    taRef.current?.focus();
  };

  const forceScrollBottom = () => {
    stickToBottom.current = true;
    scrollToBottomDirect();
    setTimeout(scrollToBottomDirect, 50);
    setTimeout(scrollToBottomDirect, 150);
  };

  const submit = async () => {
    const t = text.trim();
    const hasAttachments = pendingSlash || pendingMentions.length > 0 || pending.length > 0;
    if (!t && !hasAttachments) return;

    const slash = pendingSlash;
    const mentions = [...pendingMentions];
    const imgs = [...pending];

    setText("");
    if (taRef.current) {
      taRef.current.style.height = "auto";
    }
    setPendingSlash(null);
    setPendingMentions([]);
    setPending([]);
    setPickerOpen(false);
    forceScrollBottom();

    // 1. If Slash command
    if (slash) {
      let prompt = t;
      if (mentions.length > 0) {
        const mentionContext = mentions
          .map((m) => {
            if (m.type === "file") return `[Tham chiếu tệp: ${m.value}]`;
            if (m.type === "folder") return `[Tham chiếu thư mục: ${m.value}]`;
            if (m.type === "chat") return `[Tham chiếu phiên chat: ${m.label} (${m.value})]`;
            return "";
          })
          .filter(Boolean)
          .join("\n");
        prompt = prompt ? `${prompt}\n\n${mentionContext}` : mentionContext;
      }
      await onSlashCommand(slash.name, slash.modelFacingText, prompt);
      forceScrollBottom();
      return;
    }

    // 2. If single conversation mention and onMentionConversation is provided
    const chatMention = mentions.find((m) => m.type === "chat");
    const fileMentions = mentions.filter((m) => m.type === "file" || m.type === "folder");

    if (chatMention && fileMentions.length === 0 && onMentionConversation) {
      await onMentionConversation(
        {
          id: chatMention.value,
          title: chatMention.label,
          lastModifiedTime: chatMention.meta?.updatedAt,
        },
        t
      );
      forceScrollBottom();
      return;
    }

    // 3. Regular send with formatted mention context
    let fullPrompt = t;
    if (mentions.length > 0) {
      const refs = mentions
        .map((m) => {
          if (m.type === "file") return `@${m.value}`;
          if (m.type === "folder") return `@${m.value}/`;
          if (m.type === "chat") return `[Tham chiếu chat: ${m.label}]`;
          return "";
        })
        .filter(Boolean)
        .join(" ");
      fullPrompt = fullPrompt ? `${refs} ${fullPrompt}` : refs;
    }

    await onSend(fullPrompt, imgs.length > 0 ? imgs : undefined);
    forceScrollBottom();
  };

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      if (f.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () => setPending((cur) => [...cur, String(reader.result)]);
        reader.readAsDataURL(f);
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          const content = String(reader.result);
          setText((prev) => (prev ? prev + "\n\n" : "") + `\`\`\`${f.name}\n${content}\n\`\`\``);
        };
        reader.readAsText(f);
      }
    }
    e.target.value = "";
    setAttachModalOpen(false);
    setToolsMenuOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (pickerOpen && pickerItems.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPickerSelectedIndex((prev) => (prev + 1) % pickerItems.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPickerSelectedIndex((prev) => (prev - 1 + pickerItems.length) % pickerItems.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        const target = pickerItems[pickerSelectedIndex] || pickerItems[0];
        if (target) selectPickerItem(target);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPickerOpen(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const removePendingMention = (id: string) => {
    setPendingMentions((prev) => prev.filter((m) => m.id !== id));
  };

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

  const handleRequestRevert = useCallback((stepIndex: number) => setConfirmRevertStepIndex(stepIndex), []);
  const handleEditPlan = useCallback(() => taRef.current?.focus(), []);
  const handlePreviewImage = useCallback((src: string) => setLightboxImage(src), []);

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
    let s = name.replace(/^MODEL_PLACEHOLDER_/, "").trim();
    s = s.replace(/^(Gemini|Claude|Google|Anthropic|OpenAI)\s+/i, "");
    return s.trim();
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const exportChatToMarkdown = () => {
    if (state.messages.length === 0) return;
    const lines = [`# Trajectory Session: ${state.cascadeId || "Chat"}\n`];
    state.messages.forEach((m) => {
      const roleName =
        m.role === "user"
          ? "### 👤 User"
          : m.role === "assistant"
          ? "### 🤖 Assistant"
          : `### 📌 ${m.role}`;
      lines.push(`${roleName}\n\n${m.text}\n`);
      if (m.detail) {
        lines.push(`\`\`\`\n${m.detail}\n\`\`\`\n`);
      }
    });
    const blob = new Blob([lines.join("\n---\n\n")], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trajectory-${state.cascadeId || Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const quickPrompts = [
    {
      label: "Review Code",
      icon: "search" as IconName,
      prompt: "Hãy review toàn bộ code vừa thay đổi và tìm các lỗi tiềm ẩn",
    },
    {
      label: "Viết Unit Test",
      icon: "code" as IconName,
      prompt: "Hãy viết unit test đầy đủ cho các module vừa triển khai",
    },
    {
      label: "Tối ưu Code",
      icon: "zap" as IconName,
      prompt: "Hãy tối ưu hiệu năng và dọn dẹp code sạch đẹp hơn",
    },
    {
      label: "Giải thích",
      icon: "sparkles" as IconName,
      prompt: "Hãy giải thích chi tiết các bước xử lý vừa rồi",
    },
    {
      label: "Sửa lỗi",
      icon: "check" as IconName,
      prompt: "Kiểm tra và sửa toàn bộ lỗi lint / build hiện tại",
    },
  ];

  const filteredBlocks = useMemo(() => {
    if (!searchQuery.trim()) return visibleBlocks;
    const q = searchQuery.toLowerCase();
    return visibleBlocks.filter((b) => {
      if (b.type === "msg") {
        return (
          String(b.msg?.text || "").toLowerCase().includes(q) ||
          String(b.msg?.detail || "").toLowerCase().includes(q)
        );
      }
      return b.steps.some(
        (s) =>
          String(s?.text || "").toLowerCase().includes(q) ||
          String(s?.detail || "").toLowerCase().includes(q)
      );
    });
  }, [visibleBlocks, searchQuery]);

  return (
    <section className="chat">
      {loading && (
        <div className="chat-loading-overlay">
          <Icon name="spinner" size={34} className="spin text-accent" />
          <div className="chat-loading-text">Đang tải đoạn chat…</div>
        </div>
      )}
      <div className="chat-top-bar">
        <div className="chat-top-left">
          <span className="chat-session-badge">
            <Icon name="chat" size={13} />
            <span>{state.cascadeId ? `${state.cascadeId.slice(0, 8)}…` : "Phiên làm việc"}</span>
          </span>
          <span className="chat-msg-count">{state.messages.length} tin nhắn</span>
        </div>
        <div className="chat-top-right">
          <button
            type="button"
            className={"ghost sm icon-btn" + (showSearch ? " active" : "")}
            onClick={() => setShowSearch(!showSearch)}
            title="Tìm kiếm trong cuộc trò chuyện"
          >
            <Icon name="search" size={13} />
          </button>
          <button
            type="button"
            className="ghost sm icon-btn"
            onClick={exportChatToMarkdown}
            title="Xuất lịch sử chat sang Markdown (.md)"
          >
            <Icon name="download" size={13} />
          </button>
        </div>
      </div>

      {showSearch && (
        <div className="chat-search-bar">
          <Icon name="search" size={13} className="chat-search-icon" />
          <input
            type="text"
            placeholder="Tìm kiếm nội dung tin nhắn, lệnh terminal, file..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          {searchQuery && (
            <button
              type="button"
              className="ghost icon-btn sm"
              onClick={() => setSearchQuery("")}
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      )}

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

          {filteredBlocks.map((b, i) => {
            const isLastBlock = i === filteredBlocks.length - 1;
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
                onRequestRevert={handleRequestRevert}
                onApprovePlan={onApprovePlan}
                onAnswerQuestion={onAnswerQuestion}
                onSkipQuestion={onSkipQuestion}
                onOpenFile={onOpenFile}
                onEditPlan={handleEditPlan}
                onPreviewImage={handlePreviewImage}
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
          {/* Quick Prompts Bar */}
          <div className="quick-prompts-bar">
            {quickPrompts.map((qp, idx) => (
              <button
                key={idx}
                type="button"
                className="quick-prompt-chip"
                onClick={() => {
                  setText(qp.prompt);
                  taRef.current?.focus();
                }}
              >
                <Icon name={qp.icon} size={12} />
                <span>{qp.label}</span>
              </button>
            ))}
          </div>

          <div className="composer-box">
            {/* Slash & Mention Picker Menu */}
            {pickerOpen && (
              <>
                <div
                  className="picker-backdrop"
                  onClick={() => setPickerOpen(false)}
                  onTouchStart={() => setPickerOpen(false)}
                />
                <div className="command-mention-picker">
                  <div className="picker-header">
                    <div className="picker-tabs">
                      <button
                        type="button"
                        className={"picker-tab" + (pickerTab === "all" ? " active" : "")}
                        onClick={() => setPickerTab("all")}
                      >
                        <Icon name="search" size={12} />
                        <span>Tất cả</span>
                      </button>
                      <button
                        type="button"
                        className={"picker-tab" + (pickerTab === "slash" ? " active" : "")}
                        onClick={() => setPickerTab("slash")}
                      >
                        <Icon name="zap" size={12} />
                        <span>Lệnh (/)</span>
                      </button>
                      <button
                        type="button"
                        className={"picker-tab" + (pickerTab === "file" ? " active" : "")}
                        onClick={() => setPickerTab("file")}
                      >
                        <Icon name="file" size={12} />
                        <span>Tệp tin</span>
                      </button>
                      <button
                        type="button"
                        className={"picker-tab" + (pickerTab === "folder" ? " active" : "")}
                        onClick={() => setPickerTab("folder")}
                      >
                        <Icon name="folder" size={12} />
                        <span>Thư mục</span>
                      </button>
                      <button
                        type="button"
                        className={"picker-tab" + (pickerTab === "chat" ? " active" : "")}
                        onClick={() => setPickerTab("chat")}
                      >
                        <Icon name="chat" size={12} />
                        <span>Đoạn chat</span>
                      </button>
                    </div>
                    <button
                      type="button"
                      className="picker-close"
                      onClick={() => setPickerOpen(false)}
                      title="Đóng (Esc)"
                    >
                      <Icon name="close" size={13} />
                    </button>
                  </div>

                  <ul className="picker-list">
                    {pickerItems.length === 0 ? (
                      <li className="picker-empty">Không tìm thấy kết quả phù hợp</li>
                    ) : (
                      pickerItems.map((item, idx) => {
                        const isSelected = idx === pickerSelectedIndex;
                        let iconName: IconName = "file";
                        if (item.type === "slash") iconName = "zap";
                        else if (item.type === "folder") iconName = "folder";
                        else if (item.type === "chat") iconName = "chat";

                        let badgeText = "Tệp";
                        if (item.type === "slash") badgeText = "Lệnh";
                        else if (item.type === "folder") badgeText = "Thư mục";
                        else if (item.type === "chat") badgeText = "Chat";

                        return (
                          <li key={item.id}>
                            <button
                              type="button"
                              className={"picker-item" + (isSelected ? " active" : "")}
                              onClick={() => selectPickerItem(item)}
                              onMouseEnter={() => setPickerSelectedIndex(idx)}
                            >
                              <div className="picker-item-left">
                                <span className={"picker-icon-badge " + item.type}>
                                  <Icon name={iconName} size={13} />
                                </span>
                                <div className="picker-item-info">
                                  <span className={"picker-item-title" + (item.type === "slash" ? " mono" : "")}>
                                    {item.label}
                                  </span>
                                  {item.sublabel && (
                                    <span className="picker-item-desc">{item.sublabel}</span>
                                  )}
                                </div>
                              </div>
                              <div className="picker-item-right">
                                <span className={"picker-tag " + item.type}>{badgeText}</span>
                              </div>
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>
              </>
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
                          window.dispatchEvent(new CustomEvent("refresh-models", { detail: m.models }));
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
                      onTouchStart={() => {
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

            {(pendingSlash || pendingMentions.length > 0 || pending.length > 0) && (
              <div className="attach-chips">
                {pendingSlash && (
                  <span className="attach-chip slash" title={pendingSlash.name}>
                    <Icon name="zap" size={12} />
                    <span className="attach-chip-name">/{pendingSlash.name}</span>
                    <button
                      type="button"
                      className="attach-chip-x"
                      onClick={() => setPendingSlash(null)}
                      title="Bỏ lệnh"
                    >
                      <Icon name="close" size={11} />
                    </button>
                  </span>
                )}

                {pendingMentions.map((m) => {
                  let iconName: IconName = "file";
                  if (m.type === "folder") iconName = "folder";
                  else if (m.type === "chat") iconName = "chat";

                  return (
                    <span className={"attach-chip " + m.type} key={m.id} title={m.value}>
                      <Icon name={iconName} size={12} />
                      <span className="attach-chip-name">{m.label}</span>
                      <button
                        type="button"
                        className="attach-chip-x"
                        onClick={() => removePendingMention(m.id)}
                        title="Bỏ đính kèm"
                      >
                        <Icon name="close" size={11} />
                      </button>
                    </span>
                  );
                })}

                {pending.map((p, i) => (
                  <span className="attach-chip image" key={i}>
                    <img src={p} alt="" className="attach-chip-thumb" />
                    <button
                      type="button"
                      className="attach-chip-x"
                      onClick={() => setPending((cur) => cur.filter((_, idx) => idx !== i))}
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
              onChange={handleTextChange}
              onKeyDown={onKeyDown}
              onBlur={() => {
                [50, 150, 300, 450, 600].forEach((delay) => {
                  setTimeout(() => {
                    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
                    if (document.body) document.body.scrollTop = 0;
                    if (document.documentElement) document.documentElement.scrollTop = 0;
                  }, delay);
                });
              }}
              placeholder="Nhắn tin cho AI… (Gõ / để dùng lệnh, @ để nhắc file/thư mục/chat)"
              rows={1}
            />

            <div className="composer-actions">
              <div className="composer-quick-actions">
                <button
                  type="button"
                  className={"composer-quick-btn" + (pickerOpen ? " active" : "")}
                  onClick={() => {
                    if (pickerOpen) {
                      setPickerOpen(false);
                    } else {
                      setPickerOpen("mention");
                      setPickerTab("all");
                      setPickerSearch("");
                      setPickerSelectedIndex(0);
                    }
                  }}
                  title="Danh sách Lệnh & Nhắc tới (/ @)"
                >
                  <Icon name="zap" size={13} />
                  <span>Lệnh</span>
                </button>

                <button
                  type="button"
                  className={"composer-quick-btn" + (toolsMenuOpen ? " active" : "")}
                  onClick={() => {
                    setToolsMenuOpen(!toolsMenuOpen);
                    setAttachModalOpen(false);
                  }}
                  title="Công cụ & Tiện ích"
                >
                  <Icon name="plus" size={13} />
                  <span>Tiện ích</span>
                </button>

                <button
                  type="button"
                  className={"composer-quick-btn" + (attachModalOpen ? " active" : "")}
                  onClick={() => {
                    setAttachModalOpen(!attachModalOpen);
                    setToolsMenuOpen(false);
                  }}
                  title="Đính kèm hình ảnh & tệp tin"
                >
                  <Icon name="attach" size={13} />
                  <span>Đính kèm</span>
                </button>
              </div>

              {/* Tools Menu Popup */}
              {toolsMenuOpen && (
                <>
                  <div
                    className="menu-backdrop"
                    onClick={() => setToolsMenuOpen(false)}
                    onTouchStart={() => setToolsMenuOpen(false)}
                  />
                  <div className="tools-dropdown-menu">
                    <div className="tools-menu-header">
                      <Icon name="sparkles" size={13} />
                      <span>Công cụ & Tiện ích</span>
                    </div>

                    <button
                      type="button"
                      className="tools-menu-item"
                      disabled={screenshotLoading}
                      onClick={async () => {
                        setToolsMenuOpen(false);
                        await captureScreenshot();
                      }}
                    >
                      <Icon
                        name={screenshotLoading ? "spinner" : "camera"}
                        size={16}
                        className={screenshotLoading ? "spin" : ""}
                      />
                      <div className="tools-menu-item-info">
                        <span className="tools-menu-item-title">Chụp màn hình IDE / Mac</span>
                        <span className="tools-menu-item-desc">Chụp nhanh ảnh màn hình và đính kèm vào tin nhắn</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      className="tools-menu-item"
                      onClick={() => {
                        setToolsMenuOpen(false);
                        exportChatToMarkdown();
                      }}
                    >
                      <Icon name="file" size={16} />
                      <div className="tools-menu-item-info">
                        <span className="tools-menu-item-title">Xuất đoạn chat (.md)</span>
                        <span className="tools-menu-item-desc">Lưu toàn bộ lịch sử trò chuyện sang file Markdown</span>
                      </div>
                    </button>

                    {pending.length > 0 && (
                      <button
                        type="button"
                        className="tools-menu-item danger"
                        onClick={() => {
                          setToolsMenuOpen(false);
                          setPending([]);
                        }}
                      >
                        <Icon name="trash" size={16} />
                        <div className="tools-menu-item-info">
                          <span className="tools-menu-item-title">Xóa tất cả ảnh đính kèm</span>
                          <span className="tools-menu-item-desc">Hủy {pending.length} ảnh đang chờ gửi</span>
                        </div>
                      </button>
                    )}
                  </div>
                </>
              )}

              {/* Attachment Custom Action Sheet / Modal */}
              {attachModalOpen && (
                <>
                  <div
                    className="menu-backdrop"
                    onClick={() => setAttachModalOpen(false)}
                    onTouchStart={() => setAttachModalOpen(false)}
                  />
                  <div className="attach-dropdown-menu">
                    <div className="tools-menu-header">
                      <Icon name="attach" size={13} />
                      <span>Đính kèm tệp tin &amp; Hình ảnh</span>
                    </div>

                    <label className="tools-menu-item" style={{ cursor: "pointer" }}>
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        style={{ display: "none" }}
                        onChange={onUpload}
                      />
                      <div className="tools-menu-item-icon-box camera">
                        <Icon name="camera" size={18} />
                      </div>
                      <div className="tools-menu-item-info">
                        <span className="tools-menu-item-title">Chụp ảnh trực tiếp</span>
                        <span className="tools-menu-item-desc">Sử dụng máy ảnh thiết bị chụp hình</span>
                      </div>
                    </label>

                    <label className="tools-menu-item" style={{ cursor: "pointer" }}>
                      <input
                        type="file"
                        multiple
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={onUpload}
                      />
                      <div className="tools-menu-item-icon-box gallery">
                        <Icon name="image" size={18} />
                      </div>
                      <div className="tools-menu-item-info">
                        <span className="tools-menu-item-title">Thư viện hình ảnh</span>
                        <span className="tools-menu-item-desc">Chọn một hoặc nhiều ảnh từ thiết bị</span>
                      </div>
                    </label>

                    <label className="tools-menu-item" style={{ cursor: "pointer" }}>
                      <input
                        type="file"
                        multiple
                        accept=".txt,.md,.json,.js,.ts,.tsx,.jsx,.html,.css,.py,.go,.rs,.sh,.log,.yaml,.yml,.sql,.env"
                        style={{ display: "none" }}
                        onChange={onUpload}
                      />
                      <div className="tools-menu-item-icon-box doc">
                        <Icon name="file" size={18} />
                      </div>
                      <div className="tools-menu-item-info">
                        <span className="tools-menu-item-title">Tệp tài liệu &amp; Mã nguồn</span>
                        <span className="tools-menu-item-desc">Đính kèm text, JSON, code hoặc log vào chat</span>
                      </div>
                    </label>

                    <button
                      type="button"
                      className="tools-menu-item"
                      disabled={screenshotLoading}
                      onClick={async () => {
                        setAttachModalOpen(false);
                        await captureScreenshot();
                      }}
                    >
                      <div className="tools-menu-item-icon-box screen">
                        <Icon
                          name={screenshotLoading ? "spinner" : "terminal"}
                          size={18}
                          className={screenshotLoading ? "spin" : ""}
                        />
                      </div>
                      <div className="tools-menu-item-info">
                        <span className="tools-menu-item-title">Chụp màn hình IDE / Mac</span>
                        <span className="tools-menu-item-desc">Chụp nhanh không gian làm việc máy tính từ xa</span>
                      </div>
                    </button>
                  </div>
                </>
              )}

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

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      zoomIn();
    } else {
      zoomOut();
    }
  };

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
  const pinchDist = useRef<number | null>(null);
  const pinchStartScale = useRef<number>(1);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchDist.current = dist;
      pinchStartScale.current = scale;
      return;
    }
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
    if (e.touches.length === 2 && pinchDist.current != null) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = dist / pinchDist.current;
      const nextScale = Math.min(Math.max(Number((pinchStartScale.current * ratio).toFixed(1)), 1), 4);
      setScale(nextScale);
      if (nextScale === 1) setPos({ x: 0, y: 0 });
      return;
    }
    if (!isDragging || e.touches.length !== 1) return;
    setPos({ x: e.touches[0].clientX - dragStart.current.x, y: e.touches[0].clientY - dragStart.current.y });
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    pinchDist.current = null;
  };

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
            <button className="icon-btn sm btn-fullscreen" onClick={toggleFullscreen} title="Toàn màn hình">
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
          onWheel={handleWheel}
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
    "Gemini 3.7 Flash (Thinking)",
    "Gemini 3.5 Flash",
    "Gemini 3.6 Flash",
    "Gemini 3.1 Pro",
    "Claude Sonnet 4.6 (Thinking)",
    "Claude Opus 4.6 (Thinking)",
    "GPT-OSS 120B (Medium)",
  ];

  const groups: ModelGroup[] = [];

  for (const [key, val] of map.entries()) {
    const levelRank: Record<string, number> = { High: 1, Medium: 2, Low: 3, "": 4 };
    val.variants.sort((a, b) => (levelRank[a.level] || 9) - (levelRank[b.level] || 9));

    const sel =
      val.variants.find((v) => v.selected) ||
      val.variants.find((v) => v.level === "High") ||
      val.variants[0];
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
  const textSig = String(s?.text || "").slice(0, 30);
  const dur = s.meta?.durationMs ?? "";
  const tok = s.meta?.tokens ?? "";
  return `step-${index}-${s.kind || ""}-${textSig}-${dur}-${tok}`;
}

const Timeline = memo(function Timeline({
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
});

// Format a duration in ms as a compact "1.2s" / "850ms" / "2m 3s".
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

// Format message timestamp in hh:mm (or dd/mm hh:mm if not today).
function fmtMsgTime(ts?: number): string {
  if (!ts || !Number.isFinite(ts) || ts <= 0) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const timeStr = `${hours}:${minutes}`;

  if (isToday) {
    return timeStr;
  }
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month} ${timeStr}`;
}

const TimelineStep = memo(function TimelineStep({
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
        <StepDetailBox step={step} detail={detail!} onOpenFile={onOpenFile} />
      )}
    </li>
  );
});

const StepDetailBox = memo(function StepDetailBox({
  step,
  detail,
  onOpenFile,
}: {
  step: ChatMsg;
  detail: string;
  onOpenFile?: (path: string) => void | Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isTerminal = step.kind === "run" || String(step.meta?.type || "") === "RUN_COMMAND";
  const isEdit =
    step.kind === "edit" ||
    /replace|write_to_file|code_action/i.test(String(step.meta?.type || ""));
  const editUri = String(step.meta?.artifactUri ?? "");
  const editPath = editUri
    ? decodeURIComponent(editUri.replace(/^file:\/\//, ""))
    : "";

  // Highlight helper
  const renderHighlighted = (code: string, lang = "") => {
    try {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      return code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
  };

  if (isTerminal) {
    let cmd = "";
    let output = detail;
    const match = detail.match(/^\$\s*(.+?)(?:\n\n|\n(?=[^\$]))([\s\S]*)$/);
    if (match) {
      cmd = match[1].trim();
      output = match[2].trim();
    } else if (detail.startsWith("$ ")) {
      cmd = detail.slice(2).trim();
      output = "";
    }

    return (
      <div className="tstep-detail-box terminal-detail">
        <div className="tstep-detail-header">
          <span className="tstep-detail-tag">
            <Icon name="terminal" size={12} /> <span>Terminal</span>
          </span>
          <button
            className="code-copy"
            onClick={() => copy(cmd ? `$ ${cmd}\n\n${output}` : output)}
          >
            <Icon name={copied ? "check" : "file"} size={12} />
            <span>{copied ? "Đã chép" : "Sao chép"}</span>
          </button>
        </div>
        {cmd && (
          <div className="tstep-cmd-line">
            <span className="cmd-prompt">$</span>
            <span className="cmd-text">{cmd}</span>
          </div>
        )}
        {output && (
          <pre className="tstep-term-output hljs">
            <code
              dangerouslySetInnerHTML={{
                __html: renderHighlighted(output, "bash"),
              }}
            />
          </pre>
        )}
      </div>
    );
  }

  if (isEdit) {
    const isDiff =
      detail.includes("--- Target:\n") || detail.includes("+++ Replacement:\n");
    const langMatch = editPath.match(/\.([a-zA-Z0-9]+)$/);
    const lang = langMatch ? langMatch[1] : "typescript";

    return (
      <div className="tstep-detail-box edit-detail">
        <div className="tstep-detail-header">
          <div className="tstep-detail-file">
            <Icon name="edit" size={12} />
            {editPath ? (
              <button
                type="button"
                className="tstep-file-link"
                title="Mở trong tab Files"
                onClick={() => onOpenFile && onOpenFile(editPath)}
              >
                <span>{editPath}</span>
              </button>
            ) : (
              <span>Chỉnh sửa tệp</span>
            )}
          </div>
          <button className="code-copy" onClick={() => copy(detail)}>
            <Icon name={copied ? "check" : "file"} size={12} />
            <span>{copied ? "Đã chép" : "Sao chép"}</span>
          </button>
        </div>
        {isDiff ? (
          <div className="tstep-diff-box">
            <pre className="tstep-diff-content">
              <code>{detail}</code>
            </pre>
          </div>
        ) : (
          <pre className="tstep-code-body hljs">
            <code
              dangerouslySetInnerHTML={{
                __html: renderHighlighted(detail, lang),
              }}
            />
          </pre>
        )}
      </div>
    );
  }

  return (
    <div className="tstep-detail-box generic-detail">
      <div className="tstep-detail-header">
        <span className="tstep-detail-tag">
          <Icon name="file" size={12} /> <span>Chi tiết</span>
        </span>
        <button className="code-copy" onClick={() => copy(detail)}>
          <Icon name={copied ? "check" : "file"} size={12} />
          <span>{copied ? "Đã chép" : "Sao chép"}</span>
        </button>
      </div>
      <pre className="tstep-code-body hljs">
        <code dangerouslySetInnerHTML={{ __html: renderHighlighted(detail) }} />
      </pre>
    </div>
  );
});

// A real message: user / assistant / plan / ask get an avatar + bubble.
const MessageRow = memo(function MessageRow({
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
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const textToCopy = msg.text || "";
    if (!textToCopy) return;
    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(textToCopy);
      } else {
        const ta = document.createElement("textarea");
        ta.value = textToCopy;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

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

  const isError = msg.kind === "error" || msg.role === "error";
  const isUser = msg.role === "user";

  if (isError) {
    return (
      <div className="msg assistant msg-error-row">
        <div className="msg-avatar error-avatar">
          <Icon name="close" size={15} />
        </div>
        <div className="msg-body">
          <div className="bubble bubble-error">
            <div className="error-bubble-header">
              <div className="error-bubble-title-box">
                <Icon name="close" size={14} />
                <span className="error-bubble-title">Lỗi từ Agent / Quota</span>
                {msg.ts ? (
                  <span className="error-bubble-time" title={`Nhận lúc ${new Date(msg.ts).toLocaleString()}`}>
                    {fmtMsgTime(msg.ts)}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                className="msg-action-btn error-copy"
                title="Sao chép thông báo lỗi"
                onClick={handleCopy}
              >
                <Icon name={copied ? "check" : "file"} size={11} />
                <span>{copied ? "Đã chép" : "Sao chép"}</span>
              </button>
            </div>
            <div className="error-bubble-content">
              <Markdown text={msg.text} onOpenFile={onOpenFile} onPreviewImage={onPreviewImage} />
            </div>
          </div>
        </div>
      </div>
    );
  }

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

        {isUser ? (
          <div className="msg-actions user-actions">
            {msg.ts ? (
              <span className="msg-time user-time" title={`Đã gửi lúc ${new Date(msg.ts).toLocaleString()}`}>
                {fmtMsgTime(msg.ts)}
              </span>
            ) : null}
            <button
              type="button"
              className="msg-action-btn"
              title="Sao chép nội dung tin nhắn"
              onClick={handleCopy}
            >
              <Icon name={copied ? "check" : "file"} size={11} />
              <span>{copied ? "Đã chép" : "Sao chép"}</span>
            </button>
            {msg.stepIndex != null && (
              <button
                type="button"
                className="msg-action-btn msg-revert"
                title="Hoàn tác code về đúng thời điểm này"
                onClick={() => onRequestRevert && onRequestRevert(msg.stepIndex!)}
              >
                <Icon name="revert" size={11} /> <span>Revert</span>
              </button>
            )}
          </div>
        ) : (
          <div className="msg-meta-footer">
            <button
              type="button"
              className="msg-action-btn assistant-copy"
              title="Sao chép toàn bộ phản hồi"
              onClick={handleCopy}
            >
              <Icon name={copied ? "check" : "file"} size={11} />
              <span>{copied ? "Đã chép" : "Sao chép"}</span>
            </button>
            {msg.ts ? (
              <span className="meta-item time-stamp" title={`Đã nhận lúc ${new Date(msg.ts).toLocaleString()}`}>
                <Icon name="clock" size={11} />
                <span>{fmtMsgTime(msg.ts)}</span>
              </span>
            ) : null}
            {(msg.meta?.turnTokens != null || msg.meta?.tokens != null) && (
              <span className="meta-item tokens" title="Tổng số token đã tiêu tốn cho lượt này">
                <Icon name="zap" size={11} />
                <span>
                  {((msg.meta?.turnTokens || msg.meta?.tokens || 0) as number) >= 1000
                    ? `${(((msg.meta?.turnTokens || msg.meta?.tokens || 0) as number) / 1000).toFixed(1)}k tokens`
                    : `${msg.meta?.turnTokens || msg.meta?.tokens} tokens`}
                </span>
              </span>
            )}
            {msg.meta?.turnDurationMs != null && (
              <span className="meta-item time" title="Tổng thời gian thực thi của lượt">
                <span>{fmtDuration(msg.meta.turnDurationMs as number)}</span>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// Plan card: renders the implementation plan + centered Đồng ý / Từ chối / Sửa.
// Once the plan is answered (agent recorded an approval), the buttons vanish.
// Clicking approve/reject shows a spinner until the poll reflects the answer.
const PlanCard = memo(function PlanCard({
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
    await onApprovePlan(artifactUri || "implementation_plan.md", approved);
  };

  return (
    <div className="msg assistant plan-msg">
      <div className="msg-avatar">
        <Icon name="bot" size={15} />
      </div>
      <div className="msg-body">
        <div className="plan-tag">
          <Icon name="sparkles" size={12} /> <span>Kế hoạch triển khai</span>
          {msg.ts ? <span className="plan-time">{fmtMsgTime(msg.ts)}</span> : null}
        </div>
        <div className="bubble">
          <Markdown text={msg.text} onOpenFile={onOpenFile} onPreviewImage={onPreviewImage} />
        </div>
        {!answered && (
          <div className="plan-actions">
            <button
              type="button"
              className="primary sm plan-btn-proceed"
              disabled={busy != null}
              onClick={() => act(true)}
            >
              {busy === "approve" ? (
                <Icon name="spinner" size={14} className="spin" />
              ) : (
                <Icon name="play" size={14} />
              )}
              <span>Tiến hành (Proceed)</span>
            </button>
            <button
              type="button"
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
            <button
              type="button"
              className="ghost sm"
              disabled={busy != null}
              onClick={onEditPlan}
            >
              <Icon name="edit" size={14} /> <span>Góp ý sửa</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

// Inline ask-question card: shows each question's options as selectable chips
// and a Submit / Skip pair. Single-select per question (matches the IDE). Once
// answered it locks so the choice is visible but not re-submittable.
const AskQuestion = memo(function AskQuestion({
  msg,
  onAnswer,
  onSkip,
}: {
  msg: ChatMsg;
  onAnswer: (
    stepIndex: number,
    answers: { selectedOptionIds: string[]; freeText?: string }[]
  ) => Promise<any> | void;
  onSkip: (stepIndex: number) => Promise<any> | void;
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
    } catch (e) {
      console.error("Failed to answer question:", e);
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    setBusy(true);
    try {
      await onSkip(stepIdx);
    } catch (e) {
      console.error("Failed to skip question:", e);
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = questions.every(
    (_, qi) => (picks[qi] && picks[qi].length > 0) || (freeText[qi] && freeText[qi].trim())
  );

  return (
    <div className="msg assistant ask-msg">
      <div className="msg-avatar">
        <Icon name="bot" size={15} />
      </div>
      <div className="msg-body">
        <div className="ask-tag">
          <Icon name="message" size={12} /> <span>Câu hỏi từ AI</span>
          {msg.ts ? <span className="ask-time">{fmtMsgTime(msg.ts)}</span> : null}
        </div>
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
                <div className="ask-options">
                  {options.map((opt: any, oi: number) => {
                    const optId = opt?.id || String(oi);
                    const optLabel = typeof opt === "string" ? opt : opt?.label || opt?.text || optId;
                    const isPicked =
                      picks[qi]?.includes(optId) ||
                      (!picks[qi] && preSelected.includes(optId));

                    return (
                      <button
                        key={optId}
                        type="button"
                        className={"ask-chip" + (isPicked ? " selected" : "")}
                        disabled={busy || answered}
                        onClick={() => toggle(qi, optId)}
                      >
                        <span className="ask-chip-dot" />
                        <span>{optLabel}</span>
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
});
