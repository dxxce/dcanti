import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js/lib/common";
import { api, type FileEntry } from "../api";
import { Icon } from "./Icon";

interface Props {
  openPath?: string | null;
  onConsumeOpenPath?: () => void;
}

interface OpenTab {
  path: string;
  name: string;
  content: string;
  dirty: boolean;
  editing: boolean;
  bookmarked?: boolean;
}

function langForPath(p: string): string | undefined {
  const ext = p.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    mjs: "javascript", cjs: "javascript", json: "json", css: "css", scss: "scss",
    html: "xml", xml: "xml", md: "markdown", py: "python", rb: "ruby", go: "go",
    rs: "rust", java: "java", c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp",
    cs: "csharp", php: "php", sh: "bash", bash: "bash", zsh: "bash", yml: "yaml",
    yaml: "yaml", toml: "ini", ini: "ini", sql: "sql", swift: "swift",
    kt: "kotlin", dart: "dart", vue: "xml", asm: "x86asm",
  };
  return map[ext];
}

const TEXT_EXT = /\.(txt|md|markdown|json|jsonc|ya?ml|toml|ini|cfg|conf|env|log|csv|tsv|ts|tsx|js|jsx|mjs|cjs|css|scss|less|html?|xml|svg|py|rb|go|rs|java|c|h|cpp|cc|hpp|cs|php|sh|bash|zsh|sql|swift|kt|dart|vue|asm|gitignore|dockerfile|makefile)$/i;

export function FilesPanel({ openPath, onConsumeOpenPath }: Props) {
  const [cwd, setCwd] = useState("");
  const [root, setRoot] = useState<string | null>(null);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [filterQuery, setFilterQuery] = useState("");
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activeTabPath, setActiveTabPath] = useState<string>("");
  const [msg, setMsg] = useState("");
  const [bookmarks, setBookmarks] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("agy_bookmarks");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });

  const [creatingType, setCreatingType] = useState<"file" | "dir" | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const activeTab = useMemo(
    () => tabs.find((t) => t.path === activeTabPath) || null,
    [tabs, activeTabPath]
  );

  const load = useCallback(async (path: string) => {
    const r = await api.files(path);
    setRoot(r.root);
    setEntries(r.entries);
    setCwd(path);
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  const openFileByPath = useCallback(async (absPath: string) => {
    const existing = tabs.find((t) => t.path === absPath);
    if (existing) {
      setActiveTabPath(absPath);
      return;
    }

    const r = await api.readFile(absPath);
    if (r.error) {
      setMsg(r.error);
      return;
    }

    const name = absPath.split("/").filter(Boolean).pop() || absPath;
    const newTab: OpenTab = {
      path: absPath,
      name,
      content: r.text ?? "",
      dirty: false,
      editing: false,
      bookmarked: bookmarks.has(absPath),
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabPath(absPath);
    setMsg("");
  }, [tabs, bookmarks]);

  useEffect(() => {
    if (!openPath) return;
    openFileByPath(openPath);
    onConsumeOpenPath?.();
  }, [openPath, openFileByPath, onConsumeOpenPath]);

  const closeTab = (path: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (activeTabPath === path) {
        const nextActive = next.length > 0 ? next[next.length - 1].path : "";
        setActiveTabPath(nextActive);
      }
      return next;
    });
  };

  const updateActiveContent = (text: string) => {
    if (!activeTab) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.path === activeTab.path ? { ...t, content: text, dirty: true } : t
      )
    );
  };

  const toggleEditing = () => {
    if (!activeTab) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.path === activeTab.path ? { ...t, editing: !t.editing } : t
      )
    );
  };

  const saveActiveTab = async () => {
    if (!activeTab) return;
    const r = await api.writeFile(activeTab.path, activeTab.content);
    if (r.error) {
      setMsg(r.error);
    } else {
      setMsg(`Đã lưu ${activeTab.name}`);
      setTabs((prev) =>
        prev.map((t) =>
          t.path === activeTab.path ? { ...t, dirty: false } : t
        )
      );
      setTimeout(() => setMsg(""), 2000);
    }
  };

  const toggleBookmark = (path: string) => {
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      try {
        localStorage.setItem("agy_bookmarks", JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  // Keyboard shortcut Ctrl/Cmd + S
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        if (activeTab && activeTab.dirty) {
          e.preventDefault();
          saveActiveTab();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTab]);

  const handleCreate = async () => {
    const name = newItemName.trim();
    if (!name || !creatingType) return;
    const targetPath = cwd ? `${cwd}/${name}` : name;
    if (creatingType === "file") {
      await api.writeFile(targetPath, "");
      load(cwd);
      openFileByPath(targetPath);
    } else {
      // Create folder
      load(cwd);
    }
    setCreatingType(null);
    setNewItemName("");
  };

  const filteredEntries = useMemo(() => {
    if (!filterQuery.trim()) return entries;
    const q = filterQuery.toLowerCase();
    return entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [entries, filterQuery]);

  const isText = activeTab
    ? TEXT_EXT.test(activeTab.path) || !activeTab.path.includes(".")
    : false;

  const highlighted = useMemo(() => {
    if (!activeTab || !isText) return null;
    const lang = langForPath(activeTab.path);
    try {
      return lang
        ? hljs.highlight(activeTab.content, { language: lang, ignoreIllegals: true }).value
        : hljs.highlightAuto(activeTab.content).value;
    } catch {
      return null;
    }
  }, [activeTab, isText]);

  const lineCount = useMemo(
    () => (activeTab?.content ? activeTab.content.split("\n").length : 0),
    [activeTab?.content]
  );

  return (
    <div className="files">
      <div className="files-tree">
        <div className="files-head">
          <button
            className="ghost icon-btn"
            onClick={() => {
              if (!cwd) return;
              const parts = cwd.split("/");
              parts.pop();
              load(parts.join("/"));
            }}
            disabled={!cwd}
            title="Thư mục cha (Up)"
          >
            <Icon name="arrowUp" size={14} />
          </button>
          {root && (
            <span className="files-ws" title={root}>
              <Icon name="folder" size={14} />
              <span>{root.split("/").filter(Boolean).pop() || root}</span>
            </span>
          )}
          <span className="crumb" title={root ?? ""}>
            /{cwd}
          </span>
          <div className="spacer" />
          <button
            className="ghost icon-btn"
            onClick={() => setCreatingType("file")}
            title="Tạo tệp tin mới"
          >
            <Icon name="plus" size={14} />
          </button>
          <button
            className="ghost icon-btn"
            onClick={() => fileInput.current?.click()}
            title="Tải tệp tin lên"
          >
            <Icon name="upload" size={14} />
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={async (e) => {
              const files = e.target.files;
              if (files && files.length > 0) {
                const r = await api.upload(files);
                setMsg(`Đã tải lên: ${r.absPaths.length} tệp`);
                load(cwd);
              }
            }}
          />
        </div>

        {/* Tree Search Bar */}
        <div className="files-search-box">
          <Icon name="search" size={12} className="files-search-icon" />
          <input
            type="text"
            placeholder="Lọc tệp tin trong thư mục..."
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
          />
          {filterQuery && (
            <button
              type="button"
              className="ghost icon-btn sm"
              onClick={() => setFilterQuery("")}
            >
              <Icon name="close" size={11} />
            </button>
          )}
        </div>

        {/* Create new item form */}
        {creatingType && (
          <div className="new-item-form">
            <Icon name={creatingType === "dir" ? "folder" : "file"} size={13} />
            <input
              type="text"
              placeholder={creatingType === "dir" ? "Tên thư mục mới..." : "Tên tệp mới..."}
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") setCreatingType(null);
              }}
              autoFocus
            />
            <button className="primary sm" onClick={handleCreate}>Tạo</button>
            <button className="ghost sm" onClick={() => setCreatingType(null)}>Hủy</button>
          </div>
        )}

        <ul className="entry-list">
          {filteredEntries.map((e) => {
            const isBookmarked = bookmarks.has(e.path);
            const isOpen = tabs.some((t) => t.path === e.path);

            return (
              <li
                key={e.path}
                className={
                  (e.path === activeTabPath ? "active " : "") +
                  (isOpen ? "is-open" : "")
                }
              >
                <span
                  className="entry-name"
                  onClick={() => {
                    if (e.type === "dir") load(e.path);
                    else openFileByPath(e.path);
                  }}
                >
                  <Icon
                    name={e.type === "dir" ? "folder" : "file"}
                    size={14}
                    className={e.type === "dir" ? "entry-icon dir" : "entry-icon"}
                  />
                  <span>{e.name}</span>
                </span>
                <div className="entry-actions">
                  {e.type === "file" && (
                    <button
                      className={"ghost icon-btn sm star-btn" + (isBookmarked ? " active" : "")}
                      onClick={(evt) => {
                        evt.stopPropagation();
                        toggleBookmark(e.path);
                      }}
                      title={isBookmarked ? "Bỏ đánh dấu" : "Đánh dấu sao"}
                    >
                      <Icon name="bookmark" size={12} />
                    </button>
                  )}
                  {e.type === "file" && (
                    <button
                      className="del icon-btn sm"
                      onClick={async (evt) => {
                        evt.stopPropagation();
                        if (confirm(`Xoá tệp ${e.name}?`)) {
                          const r = await api.deleteFile(e.path);
                          if (!r.error) {
                            closeTab(e.path);
                            load(cwd);
                          }
                        }
                      }}
                      title="Xóa tệp"
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="files-editor">
        {tabs.length > 0 && (
          <div className="editor-tabs-bar">
            {tabs.map((t) => (
              <div
                key={t.path}
                className={"editor-tab" + (t.path === activeTabPath ? " active" : "")}
                onClick={() => setActiveTabPath(t.path)}
                title={t.path}
              >
                <Icon name="file" size={13} />
                <span className="editor-tab-title">{t.name}</span>
                {t.dirty && <span className="tab-dirty-dot" title="Chưa lưu (Ctrl+S)">•</span>}
                <button
                  type="button"
                  className="editor-tab-close"
                  onClick={(e) => closeTab(t.path, e)}
                  title="Đóng tab"
                >
                  <Icon name="close" size={11} />
                </button>
              </div>
            ))}
          </div>
        )}

        {activeTab ? (
          <>
            <div className="editor-head">
              <span className="crumb" title={activeTab.path}>
                {activeTab.path}
              </span>
              <div className="spacer" />
              {isText && (
                <button
                  className={"ghost icon-btn sm" + (activeTab.editing ? " active" : "")}
                  onClick={toggleEditing}
                  title={activeTab.editing ? "Chế độ đọc (Highlight)" : "Chế độ soạn thảo (Sửa)"}
                >
                  <Icon name={activeTab.editing ? "file" : "edit"} size={13} />
                  <span>{activeTab.editing ? "Xem" : "Sửa"}</span>
                </button>
              )}
              <button
                className="ghost icon-btn sm"
                onClick={() => api.openFile(activeTab.path)}
                title="Mở tệp này trong VS Code / Antigravity IDE"
              >
                <Icon name="link" size={13} /> <span>Mở IDE</span>
              </button>
              {activeTab.editing && (
                <button
                  className="primary sm"
                  onClick={saveActiveTab}
                  disabled={!activeTab.dirty}
                  title="Lưu tệp tin (Ctrl/Cmd + S)"
                >
                  <Icon name="save" size={13} /> <span>Lưu (Ctrl+S)</span>
                </button>
              )}
            </div>

            {activeTab.editing || !isText ? (
              <textarea
                className="code-textarea"
                value={activeTab.content}
                onChange={(e) => updateActiveContent(e.target.value)}
                spellCheck={false}
              />
            ) : (
              <div className="code-view">
                <pre className="code-gutter" aria-hidden="true">
                  {Array.from({ length: lineCount }, (_, i) => i + 1).join("\n")}
                </pre>
                <pre className="code-body hljs">
                  {highlighted != null ? (
                    <code dangerouslySetInnerHTML={{ __html: highlighted }} />
                  ) : (
                    <code>{activeTab.content}</code>
                  )}
                </pre>
              </div>
            )}
          </>
        ) : (
          <div className="editor-empty-state">
            <Icon name="files" size={42} className="muted" />
            <p>Chọn một tệp từ cây thư mục bên trái hoặc mở tệp từ đường link chat.</p>
          </div>
        )}
        {msg && <div className="editor-msg">{msg}</div>}
      </div>
    </div>
  );
}
