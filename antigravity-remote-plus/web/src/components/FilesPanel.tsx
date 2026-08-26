import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import hljs from "highlight.js/lib/common";
import { api, type FileEntry } from "../api";
import { Icon } from "./Icon";

interface Props {
  // An absolute file path to open on mount / when it changes (from a chat file
  // link). Once handled we call onConsumeOpenPath so it doesn't re-open.
  openPath?: string | null;
  onConsumeOpenPath?: () => void;
}

// Map a file extension to a highlight.js language (best-effort; hljs also
// auto-detects, but hinting keeps common cases accurate).
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
  const [selected, setSelected] = useState<string>("");
  const [content, setContent] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

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
    const r = await api.readFile(absPath);
    if (r.error) {
      setMsg(r.error);
      return;
    }
    setSelected(absPath);
    setContent(r.text ?? "");
    setDirty(false);
    setEditing(false);
    setMsg("");
  }, []);

  // Open a file requested from elsewhere (chat file link / plan reference).
  useEffect(() => {
    if (!openPath) return;
    openFileByPath(openPath);
    onConsumeOpenPath?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPath]);

  const openEntry = async (e: FileEntry) => {
    if (e.type === "dir") {
      load(e.path);
      return;
    }
    await openFileByPath(e.path);
  };

  const up = () => {
    if (!cwd) return;
    const parts = cwd.split("/");
    parts.pop();
    load(parts.join("/"));
  };

  const save = async () => {
    if (!selected) return;
    const r = await api.writeFile(selected, content);
    if (r.error) setMsg(r.error);
    else {
      setMsg("Đã lưu.");
      setDirty(false);
    }
  };

  const del = async (e: FileEntry) => {
    if (!confirm(`Xoá ${e.path}?`)) return;
    const r = await api.deleteFile(e.path);
    if (r.error) setMsg(r.error);
    else load(cwd);
  };

  const openInIde = async () => {
    if (selected) await api.openFile(selected);
  };

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const r = await api.upload(files);
    setMsg(`Đã tải lên: ${r.absPaths.length} tệp`);
    load(cwd);
  };

  // Syntax-highlighted HTML + line count for the read-only viewer.
  const isText = selected ? TEXT_EXT.test(selected) || !selected.includes(".") : false;
  const highlighted = useMemo(() => {
    if (!selected || !isText) return null;
    const lang = langForPath(selected);
    try {
      const html = lang
        ? hljs.highlight(content, { language: lang, ignoreIllegals: true }).value
        : hljs.highlightAuto(content).value;
      return html;
    } catch {
      return null;
    }
  }, [content, selected, isText]);

  const lineCount = useMemo(
    () => (content ? content.split("\n").length : 0),
    [content]
  );

  return (
    <div className="files">
      <div className="files-tree">
        <div className="files-head">
          <button className="ghost icon-btn" onClick={up} disabled={!cwd} title="Up">
            <Icon name="arrowUp" size={15} /> <span>Up</span>
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
          <button
            className="ghost icon-btn"
            onClick={() => fileInput.current?.click()}
            title="Upload"
          >
            <Icon name="upload" size={15} /> <span>Upload</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(e) => onUpload(e.target.files)}
          />
        </div>
        <ul className="entry-list">
          {entries.map((e) => (
            <li key={e.path} className={e.path === selected ? "active" : ""}>
              <span className="entry-name" onClick={() => openEntry(e)}>
                <Icon
                  name={e.type === "dir" ? "folder" : "file"}
                  size={15}
                  className={e.type === "dir" ? "entry-icon dir" : "entry-icon"}
                />
                <span>{e.name}</span>
              </span>
              {e.type === "file" && (
                <button className="del icon-btn" onClick={() => del(e)} title="Delete">
                  <Icon name="trash" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="files-editor">
        {selected ? (
          <>
            <div className="editor-head">
              <Icon name="file" size={14} className="muted" />
              <span className="crumb">{selected}</span>
              <div className="spacer" />
              {isText && (
                <button
                  className="ghost icon-btn"
                  onClick={() => setEditing((v) => !v)}
                  title={editing ? "Xem" : "Sửa"}
                >
                  <Icon name={editing ? "file" : "edit"} size={15} />
                  <span>{editing ? "Xem" : "Sửa"}</span>
                </button>
              )}
              <button className="ghost icon-btn" onClick={openInIde}>
                <Icon name="link" size={15} /> <span>Open in IDE</span>
              </button>
              {editing && (
                <button className="primary icon-btn" onClick={save} disabled={!dirty}>
                  <Icon name="save" size={15} /> <span>Save</span>
                </button>
              )}
              <button
                className="ghost icon-btn"
                onClick={() => {
                  setSelected("");
                  setContent("");
                  setDirty(false);
                  setEditing(false);
                }}
                title="Đóng tệp"
              >
                <Icon name="close" size={15} />
              </button>
            </div>

            {editing || !isText ? (
              <textarea
                value={content}
                onChange={(e) => {
                  setContent(e.target.value);
                  setDirty(true);
                }}
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
                    <code>{content}</code>
                  )}
                </pre>
              </div>
            )}
          </>
        ) : (
          <div className="center muted">Chọn một tệp để xem hoặc sửa.</div>
        )}
        {msg && <div className="editor-msg">{msg}</div>}
      </div>
    </div>
  );
}
