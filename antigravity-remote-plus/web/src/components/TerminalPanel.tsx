import { useEffect, useRef, useState, useCallback } from "react";
import { api, type TerminalInfo } from "../api";
import { termBus } from "../termBus";
import { Icon } from "./Icon";

interface Props {
  // The workspace path the terminals should open in (cwd). Null → home.
  cwd: string | null;
}

// Quick command shortcuts pre-filled into the input on click.
const PRESETS: Array<{ label: string; cmd: string }> = [
  { label: "ls", cmd: "ls -la" },
  { label: "git status", cmd: "git status" },
  { label: "git pull", cmd: "git pull" },
  { label: "npm install", cmd: "npm install" },
  { label: "npm run dev", cmd: "npm run dev" },
  { label: "clear", cmd: "clear" },
];

export function TerminalPanel({ cwd }: Props) {
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [input, setInput] = useState("");
  // Per-terminal output buffers kept in a ref so streaming doesn't re-render
  // the whole tree on every chunk; we bump a counter to repaint the active one.
  const buffers = useRef<Record<string, string>>({});
  const [, forceRepaint] = useState(0);
  const outRef = useRef<HTMLPreElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const repaint = useCallback(() => forceRepaint((n) => n + 1), []);

  // Load existing terminals on mount; create one if none exist.
  useEffect(() => {
    (async () => {
      const { terminals: list } = await api.termList();
      setTerminals(list);
      if (list.length > 0) {
        setActiveId((cur) => cur || list[0].id);
        // Prime buffers for existing terminals.
        for (const t of list) {
          const { buffer } = await api.termBuffer(t.id);
          buffers.current[t.id] = buffer;
        }
        repaint();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to streamed terminal frames.
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

  // Auto-scroll the active terminal to the bottom on new output.
  useEffect(() => {
    const el = outRef.current;
    if (el) el.scrollTop = el.scrollHeight;
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
      // No terminal yet — create one, then send.
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
      // Ctrl-C → send interrupt to the shell.
      e.preventDefault();
      if (activeId) api.termInput(activeId, "\x03");
    }
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
      </div>

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
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    className="term-preset"
                    onClick={() => runLine(p.cmd)}
                    title={p.cmd}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="term-input-row">
                <span className="term-prompt">$</span>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Nhập lệnh rồi Enter…  (Ctrl+C để dừng)"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
                <button
                  className="primary icon-btn term-run"
                  onClick={submit}
                  disabled={!input.trim()}
                  title="Chạy"
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
