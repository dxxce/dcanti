import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Icon } from "./Icon";

interface Status {
  branch: string;
  files: { path: string; index: string; work: string }[];
  ahead: number;
  behind: number;
}

export function GitPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [commits, setCommits] = useState<
    { hash: string; author: string; date: string; subject: string }[]
  >([]);
  const [branches, setBranches] = useState<{ current: string; all: string[] }>({
    current: "",
    all: [],
  });
  const [commitMsg, setCommitMsg] = useState("");
  const [diff, setDiff] = useState("");
  const [diffFile, setDiffFile] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [s, l, b] = await Promise.all([
        api.gitStatus(),
        api.gitLog(25),
        api.gitBranches(),
      ]);
      setStatus(s);
      setCommits(l.commits ?? []);
      setBranches(b.branches ?? { current: "", all: [] });
    } catch {
      /* not a repo, or no workspace */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<{ ok: boolean; message: string }>) => {
    setBusy(true);
    setLog("");
    try {
      const r = await fn();
      setLog(r.message || (r.ok ? "Thành công" : "Thất bại"));
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const showDiff = async (file?: string) => {
    setDiffFile(file || "Tất cả thay đổi");
    const r = await api.gitDiff(file);
    setDiff(r.diff || "(Không có thay đổi nào)");
  };

  const suggestCommitMsg = () => {
    if (!status || status.files.length === 0) return;
    const fileNames = status.files.map((f) => f.path.split("/").pop()).slice(0, 3).join(", ");
    const count = status.files.length;
    setCommitMsg(`feat: cập nhật ${fileNames}${count > 3 ? ` và ${count - 3} tệp khác` : ""}`);
  };

  const renderColoredDiff = (rawDiff: string) => {
    const lines = rawDiff.split("\n");
    return lines.map((line, idx) => {
      let cls = "diff-line";
      if (line.startsWith("+++") || line.startsWith("---")) cls += " diff-header";
      else if (line.startsWith("+")) cls += " diff-add";
      else if (line.startsWith("-")) cls += " diff-del";
      else if (line.startsWith("@@")) cls += " diff-range";
      return (
        <div key={idx} className={cls}>
          {line || " "}
        </div>
      );
    });
  };

  return (
    <div className="git">
      <div className="git-main">
        <div className="git-head">
          <Icon name="branch" size={15} className="muted" />
          <strong className="git-current-branch">{status?.branch || "—"}</strong>
          {status && (status.ahead > 0 || status.behind > 0) && (
            <span className="ahead-behind">
              {status.ahead > 0 && (
                <span className="ab" title={`${status.ahead} commit chưa push`}>
                  <Icon name="arrowUp" size={12} />
                  {status.ahead}
                </span>
              )}
              {status.behind > 0 && (
                <span className="ab" title={`${status.behind} commit chưa pull`}>
                  <Icon name="arrowDown" size={12} />
                  {status.behind}
                </span>
              )}
            </span>
          )}
          <div className="spacer" />
          <button className="ghost icon-btn" onClick={refresh} disabled={busy} title="Làm mới trạng thái Git">
            <Icon name="refresh" size={14} />
          </button>
        </div>

        <div className="git-actions">
          <button className="ghost icon-btn sm" onClick={() => run(() => api.gitPull())} disabled={busy} title="Kéo code mới nhất từ remote (Git Pull)">
            <Icon name="pull" size={14} /> <span>Pull</span>
          </button>
          <button
            className="ghost icon-btn sm"
            onClick={() => run(() => api.gitPush(undefined, status?.ahead === 0))}
            disabled={busy}
            title="Đẩy commits lên remote (Git Push)"
          >
            <Icon name="push" size={14} /> <span>Push</span>
          </button>
          <button className="ghost icon-btn sm" onClick={() => run(() => api.gitAdd("."))} disabled={busy} title="Stage tất cả tệp thay đổi">
            <Icon name="plus" size={14} /> <span>Stage all</span>
          </button>
          <button className="ghost icon-btn sm" onClick={() => showDiff()} disabled={busy} title="Xem toàn bộ diff">
            <Icon name="eye" size={14} /> <span>Xem diff</span>
          </button>
        </div>

        <div className="commit-row">
          <input
            placeholder="Nội dung commit message..."
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && commitMsg.trim()) {
                await run(() => api.gitCommit(commitMsg));
                setCommitMsg("");
              }
            }}
          />
          <button
            type="button"
            className="ghost icon-btn sm"
            onClick={suggestCommitMsg}
            title="Gợi ý commit message tự động"
          >
            <Icon name="sparkles" size={14} />
          </button>
          <button
            className="primary icon-btn sm"
            disabled={busy || !commitMsg.trim()}
            onClick={async () => {
              await run(() => api.gitCommit(commitMsg));
              setCommitMsg("");
            }}
          >
            <Icon name="commit" size={14} /> <span>Commit</span>
          </button>
        </div>

        <div className="branch-row">
          <select
            value={branches.current}
            onChange={(e) => run(() => api.gitCheckout(e.target.value))}
            disabled={busy}
            title="Chuyển nhánh Git"
          >
            {branches.all.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          <button
            className="ghost icon-btn sm"
            disabled={busy}
            onClick={async () => {
              const name = prompt("Tên nhánh mới (New branch):");
              if (name) await run(() => api.gitCreateBranch(name));
            }}
            title="Tạo nhánh mới"
          >
            <Icon name="branch" size={14} /> <span>Nhánh mới</span>
          </button>
        </div>

        <div className="git-section-title">
          <span>Tệp thay đổi ({status?.files.length || 0})</span>
        </div>
        <ul className="status-list">
          {status?.files.length ? (
            status.files.map((f) => (
              <li
                key={f.path}
                className={"status-item" + (diffFile === f.path ? " active" : "")}
                onClick={() => showDiff(f.path)}
              >
                <code className="code-flag">
                  {f.index || " "}
                  {f.work || " "}
                </code>
                <span className="status-path">{f.path}</span>
              </li>
            ))
          ) : (
            <li className="status-empty">Không có thay đổi nào (Working tree clean).</li>
          )}
        </ul>

        <div className="git-section-title">
          <span>Lịch sử Commit gần đây</span>
        </div>
        <ul className="commit-list">
          {commits.map((c) => (
            <li key={c.hash} className="commit-item">
              <span className="commit-hash">{c.hash.slice(0, 7)}</span>
              <span className="commit-subject">{c.subject}</span>
              <span className="commit-meta">{c.date} • {c.author}</span>
            </li>
          ))}
        </ul>

        {log && <pre className="git-log">{log}</pre>}
      </div>

      {diff && (
        <div className="git-diff">
          <div className="editor-head">
            <Icon name="edit" size={13} />
            <span className="crumb">{diffFile}</span>
            <div className="spacer" />
            <button className="ghost icon-btn sm" onClick={() => setDiff("")}>
              <Icon name="close" size={13} /> <span>Đóng</span>
            </button>
          </div>
          <div className="git-diff-viewer">{renderColoredDiff(diff)}</div>
        </div>
      )}
    </div>
  );
}
