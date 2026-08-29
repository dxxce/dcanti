import { useEffect, useRef, useState, useCallback } from "react";
import { api, type TerminalInfo } from "../api";
import { termBus } from "../termBus";
import { Icon } from "./Icon";

interface Props {
  cwd: string | null;
}

const DEFAULT_PRESETS: Array<{ label: string; cmd: string }> = [
  { label: "ls -la", cmd: "ls -la" },
  { label: "git status", cmd: "git status" },
  { label: "git pull", cmd: "git pull" },
  { label: "pnpm dev", cmd: "pnpm dev" },
  { label: "pnpm build", cmd: "pnpm build" },
  { label: "npm test", cmd: "npm test" },
  { label: "clear", cmd: "clear" },
];

export function TerminalPanel({ cwd }: Props) {
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [input, setInput] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [searchLog, setSearchLog] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [copied, setCopied] = useState(false);

  const [presets, setPresets] = useState<Array<{ label: string; cmd: string }>>(() => {
    try {
      const saved = localStorage.getItem("agy_term_presets");
      return saved ? JSON.parse(saved) : DEFAULT_PRESETS;
    } catch {
      return DEFAULT_PRESETS;
    }
  });

  const [newMacroOpen, setNewMacroOpen] = useState(false);
  const [macroLabel, setMacroLabel] = useState("");
  const [macroCmd, setMacroCmd] = useState("");

  const buffers = useRef<Record<string, string>>({});
  const [, forceRepaint] = useState(0);
  const outRef = useRef<HTMLPreElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const repaint = useCallback(() => forceRepaint((n) => n + 1), []);

  useEffect(() => {
    (async () => {
      const { terminals: list } = await api.termList();
      setTerminals(list);
      if (list.length > 0) {
        setActiveId((cur) => cur || list[0].id);
        for (const t of list) {
          const { buffer } = await api.termBuffer(t.id);
          buffers.current[t.id] = buffer;
        }
        repaint();
      }
    })();
  }, []);

  useEffect(() => {
    return termBus.subscribe((e) => {
      if (e.type === "term-data") {
        buffers.current[e.id] = (buffers.current[e.id] ?? "") + e.data;
        repaint();
      } else if (e.type === "term-list") {
        setTerminals(e.terminals);
      } else if (e.type === "term-exit") {
        buffers.current[e.id] =
          (buffers.current[e.id] ?? "") + "\r\n[đã kết thúc]\r\n";
        repaint();
      }
    });
  }, [repaint]);

  useEffect(() => {
    if (autoScroll) {
      const el = outRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  });

  const createTerm = async () => {
    const info = await api.termCreate(cwd ?? undefined);
    buffers.current[info.id] = "";
    setActiveId(info.id);
    setTerminals((prev) =>
      prev.some((t) => t.id === info.id) ? prev : [...prev, info]
    );
    inputRef.current?.focus();
  };

  const killTerm = async (id: string) => {
    await api.termKill(id);
    delete buffers.current[id];
    setActiveId((cur) => {
      if (cur !== id) return cur;
      const rest = terminals.filter((t) => t.id !== id);
      return rest.length ? rest[0].id : "";
    });
  };

  const runLine = async (line: string) => {
    if (!activeId) {
      const info = await api.termCreate(cwd ?? undefined);
      buffers.current[info.id] = "";
      setActiveId(info.id);
      await api.termInput(info.id, line + "\n");
      return;
    }
    await api.termInput(activeId, line + "\n");
  };

  const submit = async () => {
    const line = input;
    setInput("");
    await runLine(line);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "c" && e.ctrlKey) {
      e.preventDefault();
      if (activeId) api.termInput(activeId, "\x03");
    }
  };

  const sendCtrlC = () => {
    if (activeId) api.termInput(activeId, "\x03");
  };

  const clearActiveBuffer = () => {
    if (activeId) {
      buffers.current[activeId] = "";
      repaint();
    }
  };

  const copyLog = () => {
    if (!activeId) return;
    const text = buffers.current[activeId] ?? "";
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const addMacro = () => {
    if (!macroLabel.trim() || !macroCmd.trim()) return;
    const next = [...presets, { label: macroLabel.trim(), cmd: macroCmd.trim() }];
    setPresets(next);
    try {
      localStorage.setItem("agy_term_presets", JSON.stringify(next));
    } catch {}
    setMacroLabel("");
    setMacroCmd("");
    setNewMacroOpen(false);
  };

  const removeMacro = (index: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = presets.filter((_, i) => i !== index);
    setPresets(next);
    try {
      localStorage.setItem("agy_term_presets", JSON.stringify(next));
    } catch {}
  };

  const activeBuffer = activeId ? buffers.current[activeId] ?? "" : "";

  return (
    <section className="terminal">
      <div className="term-tabs">
        {terminals.map((t) => (
          <div
            key={t.id}
            className={"term-tab" + (t.id === activeId ? " active" : "")}
            onClick={() => setActiveId(t.id)}
            title={t.cwd}
          >
            <Icon name="terminal" size={13} />
            <span className="term-tab-title">{t.title}</span>
            <button
              className="term-tab-close"
              title="Đóng terminal"
              onClick={(e) => {
                e.stopPropagation();
                killTerm(t.id);
              }}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        ))}
        <button className="term-new" onClick={createTerm} title="Terminal mới">
          <Icon name="plus" size={15} />
        </button>

        <div className="spacer" />

        <div className="term-top-actions">
          <button
            type="button"
            className={"ghost icon-btn sm" + (showSearch ? " active" : "")}
            onClick={() => setShowSearch(!showSearch)}
            title="Tìm kiếm trong output log"
          >
            <Icon name="search" size={13} />
          </button>
          <button
            type="button"
            className={"ghost icon-btn sm" + (autoScroll ? " active" : "")}
            onClick={() => setAutoScroll(!autoScroll)}
            title={autoScroll ? "Đang tự động cuộn (Nhấn để khóa)" : "Đang khóa cuộn (Nhấn để tự cuộn)"}
          >
            <Icon name="arrowDown" size={13} />
          </button>
          <button
            type="button"
            className="ghost icon-btn sm"
            onClick={copyLog}
            title="Sao chép toàn bộ log"
          >
            <Icon name={copied ? "check" : "copy"} size={13} />
          </button>
          <button
            type="button"
            className="ghost icon-btn sm"
            onClick={clearActiveBuffer}
            title="Xóa sạch màn hình terminal"
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>

      {showSearch && (
        <div className="term-search-bar">
          <Icon name="search" size={13} />
          <input
            type="text"
            placeholder="Tìm kiếm chuỗi trong terminal log..."
            value={searchLog}
            onChange={(e) => setSearchLog(e.target.value)}
            autoFocus
          />
          {searchLog && (
            <button
              type="button"
              className="ghost icon-btn sm"
              onClick={() => setSearchLog("")}
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      )}

      {terminals.length === 0 ? (
        <div className="term-empty">
          <Icon name="terminal" size={38} className="empty-icon" />
          <p>Chưa có terminal. Tạo một terminal để bắt đầu.</p>
          <button className="primary icon-btn" onClick={createTerm}>
            <Icon name="plus" size={16} /> <span>Terminal mới</span>
          </button>
        </div>
      ) : (
        <>
          <pre className="term-output" ref={outRef}>
            {activeBuffer || "\n"}
          </pre>

          <div className="term-composer">
            <div className="term-composer-box">
              <div className="term-presets">
                {presets.map((p, idx) => (
                  <div key={idx} className="term-preset-wrap">
                    <button
                      className="term-preset"
                      onClick={() => runLine(p.cmd)}
                      title={p.cmd}
                    >
                      <Icon name="zap" size={11} />
                      <span>{p.label}</span>
                    </button>
                    {idx >= DEFAULT_PRESETS.length && (
                      <button
                        className="term-preset-del"
                        onClick={(e) => removeMacro(idx, e)}
                        title="Xóa macro này"
                      >
                        <Icon name="close" size={9} />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  className="term-preset add-preset"
                  onClick={() => setNewMacroOpen(true)}
                  title="Thêm phím tắt lệnh mới"
                >
                  <Icon name="plus" size={11} /> <span>Thêm Macro</span>
                </button>
              </div>

              {newMacroOpen && (
                <div className="new-macro-row">
                  <input
                    type="text"
                    placeholder="Tên nút (vd: Build)..."
                    value={macroLabel}
                    onChange={(e) => setMacroLabel(e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Lệnh (vd: pnpm build)..."
                    value={macroCmd}
                    onChange={(e) => setMacroCmd(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addMacro();
                      if (e.key === "Escape") setNewMacroOpen(false);
                    }}
                  />
                  <button className="primary sm" onClick={addMacro}>Lưu</button>
                  <button className="ghost sm" onClick={() => setNewMacroOpen(false)}>Hủy</button>
                </div>
              )}

              <div className="term-input-row">
                <span className="term-prompt">$</span>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Nhập lệnh rồi Enter… (Ctrl+C để dừng)"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
                <button
                  className="ghost icon-btn term-ctrl-c"
                  onClick={sendCtrlC}
                  title="Gửi Ctrl+C để dừng lệnh"
                >
                  <span>Ctrl+C</span>
                </button>
                <button
                  className="primary icon-btn term-run"
                  onClick={submit}
                  disabled={!input.trim()}
                  title="Chạy lệnh"
                >
                  <Icon name="send" size={15} />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
